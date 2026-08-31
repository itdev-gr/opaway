export type CouponFlow = 'transfer' | 'hourly' | 'tour';

export interface AppliedCoupon {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  return_extra_value: number;
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

// Effective discount value for a booking: the base value plus, for round-trip
// transfers, the coupon's return extra (same unit as discount_type). Percent
// totals are capped at 100.
export function effectiveCouponValue(
  coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value' | 'return_extra_value'>,
  roundTripTransfer: boolean,
): number {
  const v = coupon.discount_value + (roundTripTransfer ? (coupon.return_extra_value || 0) : 0);
  return coupon.discount_type === 'percent' ? Math.min(v, 100) : v;
}

export interface BestCoupon {
  coupon: AppliedCoupon;
  amount: number;
}

// Coupons are applied automatically, so several may fit one booking. The one
// that saves the customer the most money wins; because a fixed coupon beats a
// percent one on a cheap ride and loses on an expensive one, this has to be
// decided per price, not once per page. Ties keep the caller's order, and
// get_auto_coupons hands them over newest first.
export function bestCouponFor(
  coupons: AppliedCoupon[],
  total: number,
  roundTripTransfer: boolean,
): BestCoupon | null {
  let best: BestCoupon | null = null;
  for (const coupon of coupons) {
    const amount = couponDiscountAmount(total, {
      discount_type: coupon.discount_type,
      discount_value: effectiveCouponValue(coupon, roundTripTransfer),
    });
    if (amount > 0 && (!best || amount > best.amount)) best = { coupon, amount };
  }
  return best;
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

function toAppliedCoupon(row: any): AppliedCoupon | null {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    code: String(row.code),
    discount_type: row.discount_type === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value),
    return_extra_value: Number(row.return_extra_value ?? 0),
  };
}

// Every offer the current visitor qualifies for on this flow, newest first.
// The coupons table is admin-only, so this SECURITY DEFINER RPC is the only
// public window onto it; it resolves the customer group from the session.
export async function fetchAutoCoupons(flow: CouponFlow): Promise<AppliedCoupon[]> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('get_auto_coupons', { p_flow: flow });
    if (error) {
      console.error('get_auto_coupons failed:', error);
      return [];
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map(toAppliedCoupon).filter((c): c is AppliedCoupon => c !== null);
  } catch (err) {
    console.error('get_auto_coupons request failed:', err);
    return [];
  }
}
