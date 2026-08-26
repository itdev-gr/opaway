import { describe, it, expect } from 'vitest';
import { couponDiscountAmount, couponStatusOn } from '../src/lib/coupons';

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
