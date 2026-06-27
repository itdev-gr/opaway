// Shared filtering/sorting logic for the admin booking lists (transfers, tours,
// experiences). Pure functions so they can be unit-tested without a DOM.

export type BookingStatusFilter = 'active' | 'cancelled' | 'all';
export type BookingSort = 'date_asc' | 'date_desc' | 'added';

export interface BookingFilterState {
  status: BookingStatusFilter;
  /** Inclusive lower bound, YYYY-MM-DD. */
  from?: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to?: string;
  sort: BookingSort;
}

export interface BookingAccessors<T> {
  /** Returns the booking's date as YYYY-MM-DD, or '' when unknown. */
  getDate: (row: T) => string;
  /** Returns the booking's ride status (e.g. 'new', 'cancelled'). */
  getStatus: (row: T) => string;
}

/**
 * Resolve a booking's display date as a sortable YYYY-MM-DD string.
 * Prefers the explicit `date` field and falls back to `created_at`.
 * Both are sliced to their first 10 chars so a datetime works too.
 */
export function getBookingDate(row: Record<string, any>): string {
  const raw = (row.date ?? '') || (row.created_at ?? '');
  return String(raw).slice(0, 10);
}

function isCancelled(status: string): boolean {
  return status.toLowerCase() === 'cancelled';
}

/**
 * Filter by status + date range, then sort. Never mutates `rows`.
 */
export function filterAndSortBookings<T>(
  rows: T[],
  state: BookingFilterState,
  { getDate, getStatus }: BookingAccessors<T>,
): T[] {
  const hasRange = Boolean(state.from || state.to);

  const filtered = rows.filter((row) => {
    // Status
    if (state.status === 'active' && isCancelled(getStatus(row))) return false;
    if (state.status === 'cancelled' && !isCancelled(getStatus(row))) return false;

    // Date range
    if (hasRange) {
      const date = getDate(row);
      if (!date) return false;
      if (state.from && date < state.from) return false;
      if (state.to && date > state.to) return false;
    }

    return true;
  });

  if (state.sort === 'added') return filtered;

  const dir = state.sort === 'date_desc' ? -1 : 1;
  return filtered.slice().sort((a, b) => {
    const da = getDate(a);
    const db = getDate(b);
    // Undated rows always sort to the end, regardless of direction.
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    if (da < db) return -1 * dir;
    if (da > db) return 1 * dir;
    return 0;
  });
}
