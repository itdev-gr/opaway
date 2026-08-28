import { describe, it, expect } from 'vitest';
import {
  transferToBooking, tourToBooking, sortBookings, groupByAffiliate,
  affiliateTotals, refUrl, rateLabel,
  TRANSFER_COLUMNS_PORTAL, TRANSFER_COLUMNS_ADMIN, TOUR_COLUMNS_PORTAL, TOUR_COLUMNS_ADMIN,
  type AffiliateBooking,
} from '../src/lib/affiliate-earnings';

const booking = (over: Partial<AffiliateBooking> = {}): AffiliateBooking => ({
  id: 'b1', source: 'transfers', influencer_id: 'a1', date: '2026-05-19', time: '10:30',
  label: 'A → B', customer: '', total_price: 100, influencer_commission: 10,
  ride_status: 'completed', payment_status: 'paid', ...over,
});

describe('portal column lists', () => {
  it('never request customer PII', () => {
    for (const cols of [TRANSFER_COLUMNS_PORTAL, TOUR_COLUMNS_PORTAL]) {
      expect(cols).not.toMatch(/first_name|last_name|\bname\b|email|phone/);
    }
  });

  it('admin lists add the customer columns on top of the portal ones', () => {
    expect(TRANSFER_COLUMNS_ADMIN).toContain(TRANSFER_COLUMNS_PORTAL);
    expect(TRANSFER_COLUMNS_ADMIN).toMatch(/first_name, last_name/);
    expect(TOUR_COLUMNS_ADMIN).toContain(TOUR_COLUMNS_PORTAL);
  });
});

describe('row → booking', () => {
  it('transfer: builds a route label', () => {
    const b = transferToBooking({
      id: 't1', influencer_id: 'a1', booking_type: 'transfer', from: 'Hotel', to: 'Airport',
      date: '2026-05-19', time: '10:30', total_price: '90', influencer_commission: '9',
      ride_status: 'completed', payment_status: 'paid', first_name: 'MO', last_name: 'HA',
    });
    expect(b).toMatchObject({ source: 'transfers', label: 'Hotel → Airport', customer: 'MO HA', total_price: 90, influencer_commission: 9 });
  });

  it('transfer: hourly gets its own label', () => {
    expect(transferToBooking({ booking_type: 'hourly', from: 'Hotel', to: '' }).label).toBe('Hourly — Hotel');
  });

  it('tour: labels with the tour name', () => {
    expect(tourToBooking({ tour_name: 'Delphi', name: 'Jane' })).toMatchObject({ source: 'tours', label: 'Tour — Delphi', customer: 'Jane' });
  });

  it('coerces PostgREST numeric strings and missing values', () => {
    const b = transferToBooking({ total_price: '45.50', influencer_commission: null });
    expect(b.total_price).toBe(45.5);
    expect(b.influencer_commission).toBe(0);
    expect(b.customer).toBe('');
  });

  it('portal rows (no customer columns) yield an empty customer', () => {
    expect(transferToBooking({ from: 'A', to: 'B' }).customer).toBe('');
    expect(tourToBooking({ tour_name: 'X' }).customer).toBe('');
  });
});

describe('sortBookings', () => {
  it('newest first by date then time, without mutating the input', () => {
    const input = [
      booking({ id: 'old', date: '2026-01-01', time: '09:00' }),
      booking({ id: 'new', date: '2026-05-19', time: '08:00' }),
      booking({ id: 'mid', date: '2026-05-19', time: '07:00' }),
    ];
    const copy = [...input];
    expect(sortBookings(input).map((b) => b.id)).toEqual(['new', 'mid', 'old']);
    expect(input).toEqual(copy);
  });
});

describe('groupByAffiliate', () => {
  it('buckets transfers and tours per affiliate and drops unattributed rows', () => {
    const grouped = groupByAffiliate(
      [
        { id: 't1', influencer_id: 'a1', from: 'A', to: 'B', date: '2026-05-01', time: '10:00' },
        { id: 't2', influencer_id: null, from: 'C', to: 'D', date: '2026-05-02', time: '10:00' },
      ],
      [{ id: 'u1', influencer_id: 'a2', tour_name: 'Delphi', date: '2026-05-03', time: '08:00' }],
    );
    expect(Object.keys(grouped).sort()).toEqual(['a1', 'a2']);
    expect(grouped.a1).toHaveLength(1);
    expect(grouped.a2[0].label).toBe('Tour — Delphi');
  });
});

describe('affiliateTotals', () => {
  it('sums revenue and commission, excluding cancelled rides', () => {
    const t = affiliateTotals([
      booking({ id: '1', total_price: 100, influencer_commission: 10 }),
      booking({ id: '2', total_price: 50, influencer_commission: 5, ride_status: 'new' }),
      booking({ id: '3', total_price: 999, influencer_commission: 99, ride_status: 'cancelled' }),
    ]);
    expect(t.count).toBe(2);
    expect(t.revenue).toBe(150);
    expect(t.commission).toBe(15);
    expect(t.all).toHaveLength(3);   // cancelled still listed
  });

  it('upcoming bookings count too (unlike the hotel model)', () => {
    expect(affiliateTotals([booking({ ride_status: 'assigned', influencer_commission: 7 })]).commission).toBe(7);
  });

  it('handles an empty / missing list', () => {
    expect(affiliateTotals([])).toEqual({ count: 0, revenue: 0, commission: 0, all: [] });
    expect(affiliateTotals().count).toBe(0);
  });
});

describe('refUrl / rateLabel', () => {
  it('builds the referral link and tolerates a trailing slash', () => {
    expect(refUrl('https://opawey.com', 'maria')).toBe('https://opawey.com/?ref=maria');
    expect(refUrl('https://opawey.com/', 'maria')).toBe('https://opawey.com/?ref=maria');
  });

  it('encodes the code', () => {
    expect(refUrl('https://x.gr', 'a b')).toBe('https://x.gr/?ref=a%20b');
  });

  it('labels percent and fixed rates', () => {
    expect(rateLabel('percent', 10)).toBe('10%');
    expect(rateLabel('fixed', '12.5')).toBe('€12.50 / booking');
  });
});
