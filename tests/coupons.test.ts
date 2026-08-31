import { describe, it, expect, vi, beforeEach } from 'vitest';

// coupons.ts lazy-imports './supabase' *inside* fetchAutoCoupons so the module
// loads without env vars. Mock the specifier it resolves to from tests/.
const mockRpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  bestCouponFor, couponDiscountAmount, couponStatusOn, effectiveCouponValue, fetchAutoCoupons,
  validateCouponFields, type AppliedCoupon, type CouponFields,
} from '../src/lib/coupons';

describe('couponDiscountAmount', () => {
  it('percent: 10% of €50.00 is €5.00', () => {
    expect(couponDiscountAmount(50, { discount_type: 'percent', discount_value: 10 })).toBe(5);
  });

  it('percent: rounds to 2 decimals (15% of €33.33 → €5.00)', () => {
    expect(couponDiscountAmount(33.33, { discount_type: 'percent', discount_value: 15 })).toBe(5);
  });

  it('fixed: €10 off €50.00 is €10.00', () => {
    expect(couponDiscountAmount(50, { discount_type: 'fixed', discount_value: 10 })).toBe(10);
  });

  it('fixed: clamps so at least €1.00 stays payable (€20 off €8 → €7 discount)', () => {
    expect(couponDiscountAmount(8, { discount_type: 'fixed', discount_value: 20 })).toBe(7);
  });

  it('percent: 100% clamps so at least €1.00 stays payable (€40 → €39 discount)', () => {
    expect(couponDiscountAmount(40, { discount_type: 'percent', discount_value: 100 })).toBe(39);
  });

  it('total at or below €1 yields no discount', () => {
    expect(couponDiscountAmount(1, { discount_type: 'percent', discount_value: 50 })).toBe(0);
    expect(couponDiscountAmount(0, { discount_type: 'fixed', discount_value: 5 })).toBe(0);
  });

  it('non-positive or non-finite inputs yield no discount', () => {
    expect(couponDiscountAmount(50, { discount_type: 'fixed', discount_value: -3 })).toBe(0);
    expect(couponDiscountAmount(NaN, { discount_type: 'percent', discount_value: 10 })).toBe(0);
  });
});

describe('couponStatusOn', () => {
  const coupon = { active: true, valid_from: '2026-08-01', valid_until: '2026-08-31' };

  it('closed wins over everything when active=false', () => {
    expect(couponStatusOn({ ...coupon, active: false }, '2026-08-15')).toBe('closed');
  });

  it('scheduled before valid_from', () => {
    expect(couponStatusOn(coupon, '2026-07-31')).toBe('scheduled');
  });

  it('active inside the period, inclusive of both bounds', () => {
    expect(couponStatusOn(coupon, '2026-08-01')).toBe('active');
    expect(couponStatusOn(coupon, '2026-08-31')).toBe('active');
  });

  it('expired after valid_until', () => {
    expect(couponStatusOn(coupon, '2026-09-01')).toBe('expired');
  });
});

describe('effectiveCouponValue', () => {
  const pct = { discount_type: 'percent' as const, discount_value: 10, return_extra_value: 5 };

  it('adds the round-trip extra for transfer round trips', () => {
    expect(effectiveCouponValue(pct, true)).toBe(15);
  });

  it('ignores the extra for one-way bookings', () => {
    expect(effectiveCouponValue(pct, false)).toBe(10);
  });

  it('caps combined percent at 100', () => {
    expect(effectiveCouponValue({ ...pct, discount_value: 98 }, true)).toBe(100);
  });

  it('sums fixed euro amounts without a cap', () => {
    expect(effectiveCouponValue({ discount_type: 'fixed', discount_value: 10, return_extra_value: 5 }, true)).toBe(15);
  });

  it('treats a zero extra as no change', () => {
    expect(effectiveCouponValue({ ...pct, return_extra_value: 0 }, true)).toBe(10);
  });
});

describe('bestCouponFor', () => {
  const pct = (value: number, extra = 0): AppliedCoupon =>
    ({ id: `pct-${value}-${extra}`, code: `PCT${value}`, discount_type: 'percent', discount_value: value, return_extra_value: extra });
  const fixed = (value: number, extra = 0): AppliedCoupon =>
    ({ id: `fix-${value}-${extra}`, code: `FIX${value}`, discount_type: 'fixed', discount_value: value, return_extra_value: extra });

  it('returns null when there is nothing on offer', () => {
    expect(bestCouponFor([], 100, false)).toBeNull();
  });

  it('returns the only coupon with the amount it saves', () => {
    expect(bestCouponFor([pct(10)], 100, false)).toEqual({ coupon: pct(10), amount: 10 });
  });

  it('picks the fixed coupon on a cheap ride and the percent one on an expensive ride', () => {
    const offers = [pct(10), fixed(20)];
    expect(bestCouponFor(offers, 100, false)?.coupon.code).toBe('FIX20');
    expect(bestCouponFor(offers, 300, false)?.coupon.code).toBe('PCT10');
  });

  it('lets the round-trip extra flip the winner', () => {
    const offers = [pct(10, 8), pct(15)];
    expect(bestCouponFor(offers, 100, false)?.coupon.code).toBe('PCT15');
    expect(bestCouponFor(offers, 100, true)?.coupon.code).toBe('PCT10');
    expect(bestCouponFor(offers, 100, true)?.amount).toBe(18);
  });

  it('never prefers a coupon that saves nothing', () => {
    // At the €1 floor every discount is worth 0, so there is no winner to pick.
    expect(bestCouponFor([pct(50), fixed(20)], 1, false)).toBeNull();
  });

  it('keeps the first entry on a tie (the RPC hands them over newest first)', () => {
    const newest = fixed(20);
    const older = pct(20);
    expect(bestCouponFor([newest, older], 100, false)?.coupon.code).toBe('FIX20');
  });
});

describe('fetchAutoCoupons', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('asks the RPC for the flow it was given', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchAutoCoupons('tour');
    expect(mockRpc).toHaveBeenCalledWith('get_auto_coupons', { p_flow: 'tour' });
  });

  it('normalises the rows it gets back', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: 'a', code: 'SUMMER', discount_type: 'percent', discount_value: '10', return_extra_value: '5' },
        { id: 'b', code: 'FLAT', discount_type: 'fixed', discount_value: 20, return_extra_value: null },
      ],
      error: null,
    });
    await expect(fetchAutoCoupons('transfer')).resolves.toEqual([
      { id: 'a', code: 'SUMMER', discount_type: 'percent', discount_value: 10, return_extra_value: 5 },
      { id: 'b', code: 'FLAT', discount_type: 'fixed', discount_value: 20, return_extra_value: 0 },
    ]);
  });

  it('drops rows with no id rather than pricing off them', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'GHOST', discount_type: 'percent', discount_value: 10 }], error: null });
    await expect(fetchAutoCoupons('transfer')).resolves.toEqual([]);
  });

  it('returns nothing when there is no offer running', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchAutoCoupons('hourly')).resolves.toEqual([]);
  });

  it('returns nothing when the RPC errors, so prices stay at full price', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchAutoCoupons('transfer')).resolves.toEqual([]);
  });

  it('returns nothing when the request throws', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(fetchAutoCoupons('transfer')).resolves.toEqual([]);
  });
});

describe('validateCouponFields', () => {
  const valid: CouponFields = {
    code: 'SUMMER25',
    discountType: 'percent',
    discountValue: 10,
    returnExtra: 5,
    validFrom: '2026-09-01',
    validUntil: '2026-09-30',
    appliesToAll: true,
    flows: [],
    appliesToAllGroups: true,
    groups: [],
    bannerText: '',
  };

  it('accepts a well-formed coupon', () => {
    expect(validateCouponFields(valid)).toBeNull();
  });

  it('requires a code', () => {
    expect(validateCouponFields({ ...valid, code: '' })).toBe('Enter a coupon name/code.');
  });

  it('requires a positive discount value', () => {
    expect(validateCouponFields({ ...valid, discountValue: 0 })).toBe('Discount value must be greater than 0.');
    expect(validateCouponFields({ ...valid, discountValue: NaN })).toBe('Discount value must be greater than 0.');
  });

  it('caps a percent discount at 100', () => {
    expect(validateCouponFields({ ...valid, discountValue: 101, returnExtra: 0 })).toBe('Percent discount cannot exceed 100.');
  });

  it('rejects a negative round-trip extra', () => {
    expect(validateCouponFields({ ...valid, returnExtra: -1 })).toBe('Extra round-trip discount cannot be negative.');
  });

  it('caps percent discount plus extra at 100', () => {
    expect(validateCouponFields({ ...valid, discountValue: 98, returnExtra: 5 })).toBe('Discount plus round-trip extra cannot exceed 100%.');
  });

  it('allows a fixed discount above 100 with an extra', () => {
    expect(validateCouponFields({ ...valid, discountType: 'fixed', discountValue: 150, returnExtra: 20 })).toBeNull();
  });

  it('requires a period with the end on or after the start', () => {
    expect(validateCouponFields({ ...valid, validFrom: '', validUntil: '2026-09-30' })).toBe('Set a valid period (end date not before start date).');
    expect(validateCouponFields({ ...valid, validFrom: '2026-09-30', validUntil: '2026-09-01' })).toBe('Set a valid period (end date not before start date).');
    expect(validateCouponFields({ ...valid, validFrom: '2026-09-01', validUntil: '2026-09-01' })).toBeNull();
  });

  it('requires at least one service when the scope is selected', () => {
    expect(validateCouponFields({ ...valid, appliesToAll: false, flows: [] })).toBe('Pick at least one service, or choose "All services".');
    expect(validateCouponFields({ ...valid, appliesToAll: false, flows: ['transfer'] })).toBeNull();
  });

  it('requires at least one customer group when the scope is selected', () => {
    expect(validateCouponFields({ ...valid, appliesToAllGroups: false, groups: [] })).toBe('Pick at least one customer group, or choose "All customers".');
    expect(validateCouponFields({ ...valid, appliesToAllGroups: false, groups: ['hotel'] })).toBeNull();
  });
});
