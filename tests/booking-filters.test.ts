import { describe, it, expect } from 'vitest';
import {
  getBookingDate,
  filterAndSortBookings,
  type BookingFilterState,
} from '../src/lib/booking-filters';

const getDate = (r: any) => getBookingDate(r);
const getStatus = (r: any) => String(r.ride_status ?? '');

const baseState: BookingFilterState = { status: 'all', sort: 'added' };

describe('getBookingDate', () => {
  it('uses the date field when present', () => {
    expect(getBookingDate({ date: '2026-07-01', created_at: '2026-01-01T00:00:00Z' })).toBe('2026-07-01');
  });

  it('falls back to created_at (date-only slice) when date is missing', () => {
    expect(getBookingDate({ created_at: '2026-03-15T10:30:00Z' })).toBe('2026-03-15');
  });

  it('slices a datetime in the date field down to YYYY-MM-DD', () => {
    expect(getBookingDate({ date: '2026-08-09T00:00:00.000Z' })).toBe('2026-08-09');
  });

  it('returns empty string when neither date nor created_at exist', () => {
    expect(getBookingDate({})).toBe('');
  });
});

describe('filterAndSortBookings — status filter', () => {
  const rows = [
    { id: 'a', date: '2026-07-01', ride_status: 'new' },
    { id: 'b', date: '2026-07-02', ride_status: 'cancelled' },
    { id: 'c', date: '2026-07-03', ride_status: 'completed' },
  ];

  it("'active' excludes cancelled bookings", () => {
    const out = filterAndSortBookings(rows, { ...baseState, status: 'active' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['a', 'c']);
  });

  it("'cancelled' returns only cancelled bookings", () => {
    const out = filterAndSortBookings(rows, { ...baseState, status: 'cancelled' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['b']);
  });

  it("'all' returns every booking", () => {
    const out = filterAndSortBookings(rows, { ...baseState, status: 'all' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats CANCELLED (any case) as cancelled', () => {
    const mixed = [{ id: 'x', date: '2026-07-01', ride_status: 'CANCELLED' }];
    expect(filterAndSortBookings(mixed, { ...baseState, status: 'active' }, { getDate, getStatus })).toHaveLength(0);
  });
});

describe('filterAndSortBookings — date range', () => {
  const rows = [
    { id: 'a', date: '2026-07-01', ride_status: 'new' },
    { id: 'b', date: '2026-07-10', ride_status: 'new' },
    { id: 'c', date: '2026-07-20', ride_status: 'new' },
  ];

  it('filters inclusively on the from bound', () => {
    const out = filterAndSortBookings(rows, { ...baseState, from: '2026-07-10' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['b', 'c']);
  });

  it('filters inclusively on the to bound', () => {
    const out = filterAndSortBookings(rows, { ...baseState, to: '2026-07-10' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('filters on a from+to window', () => {
    const out = filterAndSortBookings(rows, { ...baseState, from: '2026-07-05', to: '2026-07-15' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['b']);
  });

  it('excludes rows with no resolvable date when a bound is set', () => {
    const withUndated = [...rows, { id: 'd', ride_status: 'new' }];
    const out = filterAndSortBookings(withUndated, { ...baseState, from: '2026-07-01' }, { getDate, getStatus });
    expect(out.map(r => r.id)).not.toContain('d');
  });
});

describe('filterAndSortBookings — sort', () => {
  const rows = [
    { id: 'mid', date: '2026-07-10', ride_status: 'new' },
    { id: 'early', date: '2026-07-01', ride_status: 'new' },
    { id: 'late', date: '2026-07-20', ride_status: 'new' },
  ];

  it("'date_asc' orders earliest first", () => {
    const out = filterAndSortBookings(rows, { ...baseState, sort: 'date_asc' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['early', 'mid', 'late']);
  });

  it("'date_desc' orders latest first", () => {
    const out = filterAndSortBookings(rows, { ...baseState, sort: 'date_desc' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['late', 'mid', 'early']);
  });

  it("'added' preserves the input order", () => {
    const out = filterAndSortBookings(rows, { ...baseState, sort: 'added' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['mid', 'early', 'late']);
  });

  it("'date_asc' pushes undated rows to the end", () => {
    const withUndated = [{ id: 'none', ride_status: 'new' }, ...rows];
    const out = filterAndSortBookings(withUndated, { ...baseState, sort: 'date_asc' }, { getDate, getStatus });
    expect(out.map(r => r.id)).toEqual(['early', 'mid', 'late', 'none']);
  });
});

describe('filterAndSortBookings — purity', () => {
  it('does not mutate the input array', () => {
    const rows = [
      { id: 'a', date: '2026-07-10', ride_status: 'new' },
      { id: 'b', date: '2026-07-01', ride_status: 'new' },
    ];
    const snapshot = rows.map(r => r.id);
    filterAndSortBookings(rows, { ...baseState, sort: 'date_asc' }, { getDate, getStatus });
    expect(rows.map(r => r.id)).toEqual(snapshot);
  });
});
