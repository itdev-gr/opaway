export type CouponFlow = 'transfer' | 'hourly' | 'tour';

export interface AppliedCoupon {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
}

// Stripe checkout rejects totals under €1 (see create-checkout-session.ts
// MIN_TOTAL_EUR), so a coupon never discounts below this floor.
export const MIN_PAYABLE_TOTAL_EUR = 1;

export function couponDiscountAmount(
  total: number,
  coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value'>,
): number {
  if (!Number.isFinite(total) || total <= MIN_PAYABLE_TOTAL_EUR) return 0;
  const raw = coupon.discount_type === 'percent'
    ? total * (Math.min(coupon.discount_value, 100) / 100)
    : coupon.discount_value;
  const max = total - MIN_PAYABLE_TOTAL_EUR;
  return Math.round(Math.min(Math.max(raw, 0), max) * 100) / 100;
}

export type CouponStatus = 'active' | 'scheduled' | 'expired' | 'closed';

export function couponStatusOn(
  coupon: { active: boolean; valid_from: string; valid_until: string },
  todayISO: string,
): CouponStatus {
  if (!coupon.active) return 'closed';
  if (todayISO < coupon.valid_from) return 'scheduled';
  if (todayISO > coupon.valid_until) return 'expired';
  return 'active';
}

// Today's date (YYYY-MM-DD) in the business timezone, matching the server's
// validity check in validate_coupon().
export function athensTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });
}

export async function validateCoupon(code: string, flow: CouponFlow): Promise<AppliedCoupon | null> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('validate_coupon', { p_code: code, p_flow: flow });
  if (error) {
    console.error('validate_coupon failed:', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    code: String(row.code),
    discount_type: row.discount_type === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value),
  };
}
