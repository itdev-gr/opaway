/**
 * Sales-report aggregation. Pure functions so they can be unit-tested without a
 * DOM or a database.
 *
 * Two distinct money figures, deliberately kept apart:
 *
 * - **Collected** (Total Revenue) — money actually received. A booking counts
 *   once its `payment_status` is 'paid' or 'paid_to_driver', and it is filed
 *   under its **payment date** (`paid_at`), not the date the booking was made.
 * - **Possible** (Possible Incomes) — money still expected. Bookings that are
 *   not paid yet and still can be, filed under their **ride date** (`date`),
 *   because that is when the service (and normally the payment) happens.
 *
 * Anything that will never turn into money — refunds, failed and abandoned
 * checkouts — is in neither bucket; it is summarised separately as `excluded`
 * so the numbers stay honest instead of quietly disappearing.
 *
 * All dates are plain `YYYY-MM-DD` strings in Europe/Athens, so comparisons are
 * lexicographic and no Date parsing (with its timezone pitfalls) is needed at
 * comparison time.
 */

import { todayAthens, toAthensDate } from './booking-date';
import { getBookingDate } from './booking-filters';

export type BookingType = 'transfer' | 'tour' | 'experience';
export type Period = 'week' | 'month' | 'quarter' | 'year' | 'all';

/** Payment statuses that mean the money is in. */
export const COLLECTED_STATUSES = ['paid', 'paid_to_driver'];

/**
 * Payment statuses that will never become revenue.
 *
 * `awaiting_payment` is included on purpose: the row is written *before* the
 * customer is redirected to Stripe, so abandoned checkouts sit in this status
 * forever. Counting them as expected income would inflate Possible Incomes with
 * every abandoned cart.
 */
export const DEAD_STATUSES = [
  'cancelled',
  'refunded',
  'partially_refunded',
  'failed',
  'awaiting_payment',
];

export interface SalesRow {
  id: string;
  type: BookingType;
  /** Ride/service date, YYYY-MM-DD. */
  serviceDate: string;
  /** Payment date in Athens, YYYY-MM-DD; '' when never paid. */
  paidDate: string;
  /** Raw creation timestamp, used only as a sort tie-breaker. */
  createdAt: string;
  name: string;
  email: string;
  vehicleName: string;
  totalPrice: number;
  paymentMethod: string;
  paymentStatus: string;
  rideStatus: string;
}

export interface DateRange {
  /** Inclusive lower bound, YYYY-MM-DD. */
  from: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to: string;
}

export interface Bucket {
  total: number;
  count: number;
}

export interface SalesSummary {
  /** The period's bounds, or null for 'all'. */
  range: DateRange | null;
  collected: {
    rows: SalesRow[];
    total: number;
    count: number;
    byType: Record<BookingType, Bucket>;
    byMethod: Record<string, Bucket>;
    byVehicle: Record<string, Bucket>;
  };
  possible: {
    rows: SalesRow[];
    total: number;
    count: number;
    byType: Record<BookingType, Bucket>;
  };
  /** Refunded / failed / abandoned — counted in neither figure. */
  excluded: {
    rows: SalesRow[];
    total: number;
    count: number;
  };
}

/* ── Date helpers (pure string math on YYYY-MM-DD) ────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');

function toParts(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Shift a YYYY-MM-DD date by `n` days. UTC math keeps it timezone-free. */
export function addDays(date: string, n: number): string {
  const p = toParts(date);
  if (!p) return date;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  t.setUTCDate(t.getUTCDate() + n);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Last calendar day of month `m` (1-12) in year `y`. */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Bounds of the calendar period containing `today`.
 *
 * Full calendar intervals (not "the last N days"): the end bound can be in the
 * future, which is what makes Possible Incomes meaningful — "This Month" has to
 * include the rides still to come this month, not just the ones already past.
 * Weeks run Monday-Sunday.
 *
 * Returns null for 'all' (no filtering).
 */
export function periodRange(period: Period, today: string): DateRange | null {
  const p = toParts(today);
  if (period === 'all' || !p) return null;

  switch (period) {
    case 'week': {
      const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
      const from = addDays(today, -((dow + 6) % 7)); // back to Monday
      return { from, to: addDays(from, 6) };
    }
    case 'month':
      return { from: fmt(p.y, p.m, 1), to: fmt(p.y, p.m, lastDayOfMonth(p.y, p.m)) };
    case 'quarter': {
      const startMonth = Math.floor((p.m - 1) / 3) * 3 + 1;
      const endMonth = startMonth + 2;
      return {
        from: fmt(p.y, startMonth, 1),
        to: fmt(p.y, endMonth, lastDayOfMonth(p.y, endMonth)),
      };
    }
    case 'year':
      return { from: fmt(p.y, 1, 1), to: fmt(p.y, 12, 31) };
    default:
      return null;
  }
}

/** Inclusive range test. A null range matches everything; an empty date never matches. */
export function inRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  if (!date) return false;
  return date >= range.from && date <= range.to;
}

/* ── Row mapping and classification ───────────────────────────────────────── */

/** Map a raw Supabase booking row to the shape the report works with. */
export function toSalesRow(raw: Record<string, any>, type: BookingType): SalesRow {
  const first = String(raw.first_name ?? '').trim();
  const last = String(raw.last_name ?? '').trim();
  return {
    id: String(raw.id ?? ''),
    type,
    serviceDate: getBookingDate(raw),
    paidDate: toAthensDate(raw.paid_at),
    createdAt: String(raw.created_at ?? ''),
    name: first ? `${first} ${last}`.trim() : String(raw.name || '—'),
    email: String(raw.email || '—'),
    vehicleName: String(raw.vehicle_name || raw.vehicle || '—'),
    totalPrice: Number(raw.total_price) || 0,
    paymentMethod: String(raw.payment_method || '—'),
    paymentStatus: String(raw.payment_status || 'pending').toLowerCase(),
    rideStatus: String(raw.ride_status ?? '').toLowerCase(),
  };
}

/**
 * Money received. Requires a payment date: a row flagged paid but never stamped
 * (only possible if the DB trigger was bypassed) is not silently filed under
 * some other date — it shows up under `excluded` instead.
 */
export function isCollected(row: SalesRow): boolean {
  return COLLECTED_STATUSES.includes(row.paymentStatus) && row.paidDate !== '';
}

/**
 * Money still expected: a live booking that hasn't been paid and still can be.
 *
 * A row carrying a collected status is never "expected" even when its payment
 * date is missing — that money has already been received, so counting it here
 * would report it twice. Such rows land in `excluded` as the data anomaly they
 * are.
 */
export function isPossible(row: SalesRow): boolean {
  if (COLLECTED_STATUSES.includes(row.paymentStatus)) return false;
  if (row.rideStatus === 'cancelled') return false;
  return !DEAD_STATUSES.includes(row.paymentStatus);
}

/* ── Aggregation ──────────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyByType(): Record<BookingType, Bucket> {
  return {
    transfer: { total: 0, count: 0 },
    tour: { total: 0, count: 0 },
    experience: { total: 0, count: 0 },
  };
}

function add(bucket: Record<string, Bucket>, key: string, amount: number): void {
  if (!bucket[key]) bucket[key] = { total: 0, count: 0 };
  bucket[key].count++;
  bucket[key].total = round2(bucket[key].total + amount);
}

/**
 * Split rows into collected / possible / excluded for the given period.
 *
 * Collected rows are filtered and sorted by payment date (newest first —
 * "what came in most recently"); possible rows by ride date (oldest first —
 * "what is due next"). Cancelled rides are dropped entirely.
 */
export function summarize(
  rows: SalesRow[],
  period: Period,
  today: string = todayAthens(),
): SalesSummary {
  const range = periodRange(period, today);

  const collectedRows: SalesRow[] = [];
  const possibleRows: SalesRow[] = [];
  const excludedRows: SalesRow[] = [];

  for (const row of rows) {
    if (isCollected(row)) {
      if (inRange(row.paidDate, range)) collectedRows.push(row);
    } else if (row.rideStatus === 'cancelled') {
      continue;
    } else if (isPossible(row)) {
      if (inRange(row.serviceDate, range)) possibleRows.push(row);
    } else if (inRange(row.serviceDate, range)) {
      excludedRows.push(row);
    }
  }

  collectedRows.sort((a, b) => b.paidDate.localeCompare(a.paidDate) || b.createdAt.localeCompare(a.createdAt));
  possibleRows.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.createdAt.localeCompare(b.createdAt));
  excludedRows.sort((a, b) => b.serviceDate.localeCompare(a.serviceDate));

  const collectedByType = emptyByType();
  const byMethod: Record<string, Bucket> = {};
  const byVehicle: Record<string, Bucket> = {};
  let collectedTotal = 0;

  for (const row of collectedRows) {
    collectedTotal = round2(collectedTotal + row.totalPrice);
    add(collectedByType, row.type, row.totalPrice);
    add(byMethod, row.paymentMethod, row.totalPrice);
    add(byVehicle, row.vehicleName, row.totalPrice);
  }

  const possibleByType = emptyByType();
  let possibleTotal = 0;
  for (const row of possibleRows) {
    possibleTotal = round2(possibleTotal + row.totalPrice);
    add(possibleByType, row.type, row.totalPrice);
  }

  const excludedTotal = round2(excludedRows.reduce((sum, row) => sum + row.totalPrice, 0));

  return {
    range,
    collected: {
      rows: collectedRows,
      total: collectedTotal,
      count: collectedRows.length,
      byType: collectedByType,
      byMethod,
      byVehicle,
    },
    possible: {
      rows: possibleRows,
      total: possibleTotal,
      count: possibleRows.length,
      byType: possibleByType,
    },
    excluded: {
      rows: excludedRows,
      total: excludedTotal,
      count: excludedRows.length,
    },
  };
}
