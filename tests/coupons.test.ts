import { describe, it, expect } from 'vitest';
import { bestCouponFor, couponDiscountAmount, couponStatusOn, effectiveCouponValue, type AppliedCoupon } from '../src/lib/coupons';

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
