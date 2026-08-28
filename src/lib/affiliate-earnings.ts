// Shared affiliate (a.k.a. influencer) earnings math.
// Used by BOTH the admin page (/admin/affiliates) and the affiliate's own
// portal (/affiliate) so the two can never show different numbers.
//
// No supabase import here — this module must be loadable without env vars
// (same rule as the pure coupon / affiliate-ref helpers) so it is unit-testable.
//
// DB naming note: the columns keep the legacy `influencer_*` names; the UI
// term is "affiliate". Attribution exists only on `transfers` and `tours` —
// `experiences` has no influencer_* columns.

export type AffiliateBookingSource = 'transfers' | 'tours';

export type AffiliateBooking = {
  id: string;
  source: AffiliateBookingSource;
  influencer_id: string;
  date: string;
  time: string;
  /** Human label: "A → B", "Hourly — A", or "Tour — X". */
  label: string;
  /** Empty string in the affiliate portal — it never receives customer PII. */
  customer: string;
  total_price: number;
  influencer_commission: number;
  ride_status: string;
  payment_status: string;
};

/**
 * Column lists for the two callers. The portal set deliberately omits every
 * customer field, so the affiliate's browser never even receives the PII —
 * the privacy rule is enforced by the query, not by the rendering code.
 */
export const TRANSFER_COLUMNS_PORTAL =
  'id, influencer_id, influencer_commission, total_price, date, time, from, to, ride_status, payment_status, booking_type';
export const TRANSFER_COLUMNS_ADMIN = `${TRANSFER_COLUMNS_PORTAL}, first_name, last_name`;

export const TOUR_COLUMNS_PORTAL =
  'id, influencer_id, influencer_commission, total_price, date, time, tour_name, ride_status, payment_status';
export const TOUR_COLUMNS_ADMIN = `${TOUR_COLUMNS_PORTAL}, name`;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

export function transferToBooking(r: Record<string, unknown>): AffiliateBooking {
  const from = str(r.from);
  const to = str(r.to);
  return {
    id: str(r.id),
    source: 'transfers',
    influencer_id: str(r.influencer_id),
    date: str(r.date),
    time: str(r.time),
    label: r.booking_type === 'hourly' ? `Hourly — ${from}` : `${from} → ${to}`,
    customer: [str(r.first_name), str(r.last_name)].filter(Boolean).join(' '),
    total_price: num(r.total_price),
    influencer_commission: num(r.influencer_commission),
    ride_status: str(r.ride_status),
    payment_status: str(r.payment_status),
  };
}

export function tourToBooking(r: Record<string, unknown>): AffiliateBooking {
  return {
    id: str(r.id),
    source: 'tours',
    influencer_id: str(r.influencer_id),
    date: str(r.date),
    time: str(r.time),
    label: `Tour — ${str(r.tour_name)}`,
    customer: str(r.name),
    total_price: num(r.total_price),
    influencer_commission: num(r.influencer_commission),
    ride_status: str(r.ride_status),
    payment_status: str(r.payment_status),
  };
}

/** Newest first, by date then time. Mutates nothing. */
export function sortBookings(list: AffiliateBooking[]): AffiliateBooking[] {
  return [...list].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/** Build one list per affiliate id, each sorted newest-first. */
export function groupByAffiliate(
  transfers: Record<string, unknown>[],
  tours: Record<string, unknown>[],
): Record<string, AffiliateBooking[]> {
  const out: Record<string, AffiliateBooking[]> = {};
  for (const b of [...transfers.map(transferToBooking), ...tours.map(tourToBooking)]) {
    if (!b.influencer_id) continue;
    (out[b.influencer_id] ??= []).push(b);
  }
  for (const key of Object.keys(out)) out[key] = sortBookings(out[key]);
  return out;
}

export type AffiliateTotals = {
  /** Non-cancelled bookings. */
  count: number;
  revenue: number;
  commission: number;
  /** Every booking, cancelled included — for the detail table. */
  all: AffiliateBooking[];
};

/**
 * Cancelled rides earn nothing, but stay visible in the list. Everything else
 * counts, including upcoming trips — this mirrors what the admin page has
 * always shown, so admin and affiliate agree.
 */
export function affiliateTotals(all: AffiliateBooking[] = []): AffiliateTotals {
  const counted = all.filter((b) => b.ride_status !== 'cancelled');
  return {
    count: counted.length,
    revenue: counted.reduce((s, b) => s + b.total_price, 0),
    commission: counted.reduce((s, b) => s + b.influencer_commission, 0),
    all,
  };
}

/** The shareable referral link for a code, e.g. https://opawey.com/?ref=maria */
export function refUrl(origin: string, refCode: string): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(refCode)}`;
}

/** Label for an affiliate's commission rate. */
export function rateLabel(commissionType: string, commissionValue: unknown): string {
  const v = num(commissionValue);
  return commissionType === 'fixed' ? `€${v.toFixed(2)} / booking` : `${v}%`;
}
