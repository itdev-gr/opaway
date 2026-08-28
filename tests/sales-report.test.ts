import { describe, it, expect } from 'vitest';
import {
  addDays,
  inRange,
  isCollected,
  isPossible,
  periodRange,
  summarize,
  toSalesRow,
  type BookingType,
  type SalesRow,
} from '../src/lib/sales-report';

/** Build a SalesRow through the real mapper, so mapping stays covered too. */
function row(raw: Record<string, any>, type: BookingType = 'transfer'): SalesRow {
  return toSalesRow(
    {
      id: 'id-1',
      date: '2026-08-15',
      created_at: '2026-08-01T10:00:00Z',
      first_name: 'Maria',
      last_name: 'Papadopoulou',
      vehicle_name: 'Sedan',
      total_price: 100,
      payment_method: 'stripe',
      payment_status: 'pending',
      ride_status: 'new',
      ...raw,
    },
    type,
  );
}

describe('toSalesRow', () => {
  it('converts paid_at to the Athens calendar date', () => {
    // 21:30 UTC on Jul 31 is 00:30 on Aug 1 in Athens.
    expect(row({ paid_at: '2026-07-31T21:30:00Z' }).paidDate).toBe('2026-08-01');
  });

  it('leaves paidDate empty when never paid', () => {
    expect(row({ paid_at: null }).paidDate).toBe('');
  });

  it('falls back to created_at for the service date when date is empty', () => {
    expect(row({ date: '', created_at: '2026-08-03T09:00:00Z' }).serviceDate).toBe('2026-08-03');
  });

  it('composes the customer name and falls back to name', () => {
    expect(row({}).name).toBe('Maria Papadopoulou');
    expect(row({ first_name: '', last_name: '', name: 'Walk-in' }).name).toBe('Walk-in');
  });

  it('normalises statuses to lower case', () => {
    const r = row({ payment_status: 'PAID', ride_status: 'Completed' });
    expect(r.paymentStatus).toBe('paid');
    expect(r.rideStatus).toBe('completed');
  });
});

describe('isCollected / isPossible', () => {
  it('paid with a payment date is collected', () => {
    expect(isCollected(row({ payment_status: 'paid', paid_at: '2026-08-20T10:00:00Z' }))).toBe(true);
  });

  it('paid_to_driver counts as collected', () => {
    const r = row({ payment_status: 'paid_to_driver', paid_at: '2026-08-20T10:00:00Z' });
    expect(isCollected(r)).toBe(true);
    expect(isPossible(r)).toBe(false);
  });

  it('paid without a payment date is neither collected nor possible', () => {
    const r = row({ payment_status: 'paid', paid_at: null });
    expect(isCollected(r)).toBe(false);
    expect(isPossible(r)).toBe(false);
  });

  it('pending is possible income', () => {
    expect(isPossible(row({ payment_status: 'pending' }))).toBe(true);
  });

  it('a cancelled ride is never possible income', () => {
    expect(isPossible(row({ payment_status: 'pending', ride_status: 'cancelled' }))).toBe(false);
  });

  it('refunded, failed and abandoned checkouts are not possible income', () => {
    for (const status of ['refunded', 'partially_refunded', 'failed', 'awaiting_payment', 'cancelled']) {
      expect(isPossible(row({ payment_status: status }))).toBe(false);
    }
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('periodRange', () => {
  it('week runs Monday to Sunday', () => {
    // 2026-08-28 is a Friday.
    expect(periodRange('week', '2026-08-28')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
    // A Monday is the start of its own week.
    expect(periodRange('week', '2026-08-24')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
    // A Sunday belongs to the week that started six days earlier.
    expect(periodRange('week', '2026-08-30')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('month covers the whole calendar month, including days still to come', () => {
    expect(periodRange('month', '2026-08-28')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('quarter covers three months', () => {
    expect(periodRange('quarter', '2026-08-28')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodRange('quarter', '2026-01-05')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRange('quarter', '2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('year covers the calendar year', () => {
    expect(periodRange('year', '2026-08-28')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('all has no bounds', () => {
    expect(periodRange('all', '2026-08-28')).toBeNull();
  });
});

describe('inRange', () => {
  const range = { from: '2026-08-01', to: '2026-08-31' };

  it('is inclusive on both bounds', () => {
    expect(inRange('2026-08-01', range)).toBe(true);
    expect(inRange('2026-08-31', range)).toBe(true);
    expect(inRange('2026-07-31', range)).toBe(false);
    expect(inRange('2026-09-01', range)).toBe(false);
  });

  it('a null range matches everything, an empty date matches nothing', () => {
    expect(inRange('2026-08-15', null)).toBe(true);
    expect(inRange('', range)).toBe(false);
    expect(inRange('', null)).toBe(true);
  });
});

describe('summarize', () => {
  const today = '2026-08-28';

  it('files revenue under the payment date, not the booking date', () => {
    // Booked and ridden in July, paid in August.
    const rows = [
      row({
        id: 'july-ride',
        date: '2026-07-10',
        created_at: '2026-06-01T10:00:00Z',
        payment_status: 'paid',
        paid_at: '2026-08-05T12:00:00Z',
        total_price: 250,
      }),
    ];

    expect(summarize(rows, 'month', today).collected.total).toBe(250);
    expect(summarize(rows, 'month', '2026-07-15').collected.total).toBe(0);
  });

  it('counts unpaid bookings as possible income under their ride date', () => {
    const rows = [
      // Upcoming ride later this month — still in the future, must be counted.
      row({ id: 'upcoming', date: '2026-08-30', payment_status: 'pending', total_price: 80 }),
      // Next month's ride — outside this period.
      row({ id: 'next-month', date: '2026-09-02', payment_status: 'pending', total_price: 90 }),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.possible.total).toBe(80);
    expect(summary.possible.count).toBe(1);
    expect(summary.possible.rows[0].id).toBe('upcoming');
    expect(summary.collected.total).toBe(0);
  });

  it('keeps collected and possible strictly separate', () => {
    const rows = [
      row({ id: 'a', payment_status: 'paid', paid_at: '2026-08-10T09:00:00Z', total_price: 100 }),
      row({ id: 'b', payment_status: 'paid_to_driver', paid_at: '2026-08-12T09:00:00Z', total_price: 50 }),
      row({ id: 'c', payment_status: 'pending', date: '2026-08-20', total_price: 70 }),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.collected.total).toBe(150);
    expect(summary.collected.count).toBe(2);
    expect(summary.possible.total).toBe(70);
    expect(summary.possible.count).toBe(1);
  });

  it('drops cancelled rides from every bucket', () => {
    const rows = [
      row({ id: 'x', ride_status: 'cancelled', payment_status: 'pending', total_price: 500 }),
      row({ id: 'y', ride_status: 'cancelled', payment_status: 'paid', paid_at: null, total_price: 500 }),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.collected.count).toBe(0);
    expect(summary.possible.count).toBe(0);
    expect(summary.excluded.count).toBe(0);
  });

  it('reports refunded, failed and abandoned rows as excluded rather than dropping them', () => {
    const rows = [
      row({ id: 'r', payment_status: 'refunded', total_price: 40 }),
      row({ id: 'f', payment_status: 'failed', total_price: 30 }),
      row({ id: 'a', payment_status: 'awaiting_payment', total_price: 20 }),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.excluded.total).toBe(90);
    expect(summary.excluded.count).toBe(3);
    expect(summary.collected.total).toBe(0);
    expect(summary.possible.total).toBe(0);
  });

  it('breaks collected revenue down by type, method and vehicle', () => {
    const rows = [
      row({ id: 't1', payment_status: 'paid', paid_at: '2026-08-02T09:00:00Z', total_price: 100, payment_method: 'stripe', vehicle_name: 'Sedan' }, 'transfer'),
      row({ id: 't2', payment_status: 'paid_to_driver', paid_at: '2026-08-03T09:00:00Z', total_price: 60, payment_method: 'cash', vehicle_name: 'Van' }, 'transfer'),
      row({ id: 'to1', payment_status: 'paid', paid_at: '2026-08-04T09:00:00Z', total_price: 200, payment_method: 'stripe', vehicle_name: 'Sedan' }, 'tour'),
      // Unpaid: must not appear in any breakdown.
      row({ id: 'p1', payment_status: 'pending', total_price: 999, payment_method: 'cash', vehicle_name: 'Minibus' }, 'experience'),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.collected.byType.transfer).toEqual({ total: 160, count: 2 });
    expect(summary.collected.byType.tour).toEqual({ total: 200, count: 1 });
    expect(summary.collected.byType.experience).toEqual({ total: 0, count: 0 });
    expect(summary.collected.byMethod.stripe).toEqual({ total: 300, count: 2 });
    expect(summary.collected.byMethod.cash).toEqual({ total: 60, count: 1 });
    expect(summary.collected.byVehicle.Sedan).toEqual({ total: 300, count: 2 });
    expect(summary.collected.byVehicle.Minibus).toBeUndefined();
    expect(summary.possible.byType.experience).toEqual({ total: 999, count: 1 });
  });

  it('sorts collected newest-paid first and possible soonest-ride first', () => {
    const rows = [
      row({ id: 'old', payment_status: 'paid', paid_at: '2026-08-02T09:00:00Z' }),
      row({ id: 'new', payment_status: 'paid', paid_at: '2026-08-20T09:00:00Z' }),
      row({ id: 'later', payment_status: 'pending', date: '2026-08-25' }),
      row({ id: 'sooner', payment_status: 'pending', date: '2026-08-05' }),
    ];

    const summary = summarize(rows, 'month', today);
    expect(summary.collected.rows.map((r) => r.id)).toEqual(['new', 'old']);
    expect(summary.possible.rows.map((r) => r.id)).toEqual(['sooner', 'later']);
  });

  it('all-time includes everything regardless of date', () => {
    const rows = [
      row({ id: 'ancient', payment_status: 'paid', paid_at: '2019-01-01T09:00:00Z', total_price: 10 }),
      row({ id: 'future', payment_status: 'pending', date: '2030-01-01', total_price: 5 }),
    ];

    const summary = summarize(rows, 'all', today);
    expect(summary.range).toBeNull();
    expect(summary.collected.total).toBe(10);
    expect(summary.possible.total).toBe(5);
  });

  it('rounds money to cents', () => {
    const rows = [
      row({ id: 'a', payment_status: 'paid', paid_at: '2026-08-02T09:00:00Z', total_price: 0.1 }),
      row({ id: 'b', payment_status: 'paid', paid_at: '2026-08-03T09:00:00Z', total_price: 0.2 }),
    ];

    expect(summarize(rows, 'month', today).collected.total).toBe(0.3);
  });
});
