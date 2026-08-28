import { describe, it, expect } from 'vitest';
import { couponDiscountAmount, couponStatusOn, effectiveCouponValue, validateCouponFields, type CouponFields } from '../src/lib/coupons';

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
