import { describe, it, expect } from 'vitest';
import {
  fieldsFor, coerce, sameValue, buildUpdatePayload,
  PAYMENT_STATUSES, RIDE_STATUSES, type FieldDef,
} from '../src/lib/booking-edit';

const keys = (kind: Parameters<typeof fieldsFor>[0]) => fieldsFor(kind).map((f) => f.key);

describe('fieldsFor', () => {
  it('transfer covers trip, luggage, hourly, pricing, status, driver and notes', () => {
    const k = keys('transfer');
    for (const expected of [
      'first_name', 'last_name', 'email', 'phone', 'booking_type', 'from', 'to', 'date', 'time',
      'return_date', 'return_time', 'passengers', 'child_seats', 'luggage_small', 'luggage_big',
      'hours', 'per_hour', 'vehicle_slug', 'total_price', 'base_price', 'outward_price', 'return_price',
      'card_surcharge', 'coupon_code', 'coupon_discount', 'influencer_code', 'influencer_commission',
      'payment_method', 'payment_status', 'ride_status', 'driver_uid', 'released_to_drivers',
      'partner_id', 'sign_name', 'notes', 'driver_notes', 'driver_remarks',
    ]) expect(k, expected).toContain(expected);
  });

  it('tour has entrance tickets + hotel choice; experience has last_name instead', () => {
    expect(keys('tour')).toEqual(expect.arrayContaining(['tour_name', 'entrance_tickets_count', 'entrance_tickets_total', 'hotel_choice', 'coupon_code']));
    expect(keys('tour')).not.toContain('last_name');
    expect(keys('experience')).toEqual(expect.arrayContaining(['experience_name', 'last_name']));
    expect(keys('experience')).not.toContain('hotel_choice');
  });

  it('request exposes source/status and per-source fields', () => {
    expect(keys('request')).toEqual(expect.arrayContaining(['source', 'status', 'message', 'tour_name', 'experience_name', 'pickup_location', 'participants']));
  });

  it('vehicle is a select of the same names the add-booking form offers', () => {
    const v = fieldsFor('transfer').find((f) => f.key === 'vehicle_slug')!;
    expect(v.type).toBe('select');
    expect(v.options!.map((o) => o.value)).toEqual(['', 'sedan', 'suv', 'van', 'minibus', 'bus']);
  });

  it('selects carry the DB-legal enum values', () => {
    const ps = fieldsFor('transfer').find((f) => f.key === 'payment_status')!;
    expect(ps.options!.map((o) => o.value)).toEqual([...PAYMENT_STATUSES]);
    const rs = fieldsFor('tour').find((f) => f.key === 'ride_status')!;
    expect(rs.options!.map((o) => o.value)).toEqual([...RIDE_STATUSES]);
  });

  it('readonly fields are marked and never editable', () => {
    const created = fieldsFor('transfer').find((f) => f.key === 'created_at')!;
    expect(created.readonly).toBe(true);
  });
});

describe('coerce', () => {
  const text: FieldDef = { key: 'x', label: 'X', type: 'text' };
  const textNull: FieldDef = { ...text, nullable: true };
  const int: FieldDef = { key: 'n', label: 'N', type: 'int' };
  const intNull: FieldDef = { ...int, nullable: true };
  const money: FieldDef = { key: 'p', label: 'Price', type: 'money' };
  const check: FieldDef = { key: 'b', label: 'B', type: 'checkbox' };

  it('text: empty → "" unless nullable → null; trims', () => {
    expect(coerce(text, '')).toBe('');
    expect(coerce(text, '  hi ')).toBe('hi');
    expect(coerce(textNull, '')).toBeNull();
    expect(coerce(textNull, undefined)).toBeNull();
  });

  it('numbers: empty → 0 unless nullable → null', () => {
    expect(coerce(int, '')).toBe(0);
    expect(coerce(intNull, '')).toBeNull();
    expect(coerce(money, '')).toBe(0);
  });

  it('parses ints and money (rounded to cents)', () => {
    expect(coerce(int, '6')).toBe(6);
    expect(coerce(money, '90.005')).toBe(90.01);
    expect(coerce(money, '12')).toBe(12);
  });

  it('rejects garbage numbers with a readable message', () => {
    expect(() => coerce(money, 'abc')).toThrow('Price must be a number');
    expect(() => coerce(int, '1.5')).toThrow('N must be a whole number');
  });

  it('checkbox → boolean', () => {
    expect(coerce(check, true)).toBe(true);
    expect(coerce(check, false)).toBe(false);
    expect(coerce(check, 'on')).toBe(true);
  });
});

describe('sameValue', () => {
  const money: FieldDef = { key: 'p', label: 'P', type: 'money' };
  const text: FieldDef = { key: 't', label: 'T', type: 'text', nullable: true };
  it('treats numeric strings from PostgREST as numbers', () => {
    expect(sameValue(money, '90.00', 90)).toBe(true);
    expect(sameValue(money, '90.00', 95)).toBe(false);
  });
  it('treats null and "" as the same empty', () => {
    expect(sameValue(text, null, '')).toBe(true);
    expect(sameValue(text, '', null)).toBe(true);
    expect(sameValue(text, null, 'x')).toBe(false);
  });
});

describe('buildUpdatePayload', () => {
  const defs = fieldsFor('transfer');
  const row = {
    first_name: 'MOHAMED', last_name: 'HAMEED', email: 'a@b.c', phone: '+1', booking_type: 'transfer',
    from: 'Hotel', to: 'Airport', date: '2026-05-19', time: '10:30', return_date: null, return_time: null,
    passengers: 6, child_seats: 0, luggage_small: 0, luggage_big: 6, hours: null, per_hour: null,
    total_price: '90', base_price: '90', outward_price: '90', return_price: '0', card_surcharge: '0',
    coupon_code: null, coupon_discount: '0', influencer_code: null, influencer_commission: '0',
    payment_method: 'cash', payment_status: 'paid', ride_status: 'completed', driver_uid: '',
    released_to_drivers: false, added_by_admin: false, partner_id: null, sign_name: null,
    notes: '', driver_notes: null, driver_remarks: null, created_at: '2026-05-19T06:56:21Z',
  };
  const formOf = (over: Record<string, string | boolean> = {}) => {
    const v: Record<string, string | boolean> = {};
    for (const d of defs) {
      if (d.readonly) continue;
      const cur = (row as any)[d.key];
      v[d.key] = d.type === 'checkbox' ? Boolean(cur) : cur == null ? '' : String(cur);
    }
    return { ...v, ...over };
  };

  it('returns an empty payload when nothing changed (numeric strings, nulls, "" all stable)', () => {
    expect(buildUpdatePayload(row, defs, formOf())).toEqual({});
  });

  it('includes only the changed keys, coerced', () => {
    const p = buildUpdatePayload(row, defs, formOf({ phone: '+30 123', total_price: '95.5', luggage_big: '4', released_to_drivers: true }));
    expect(p).toEqual({ phone: '+30 123', total_price: 95.5, luggage_big: 4, released_to_drivers: true });
  });

  it('never emits null for NOT NULL columns, emits null for nullable ones', () => {
    const p = buildUpdatePayload(row, defs, formOf({ notes: '', luggage_big: '', sign_name: '', hours: '', return_date: '' }));
    expect(p).toEqual({ luggage_big: 0 });   // notes '' → '' (unchanged), sign_name/hours/return_date null (unchanged)
    const p2 = buildUpdatePayload({ ...row, sign_name: 'ABC', hours: 3 }, defs, formOf({ sign_name: '', hours: '' }));
    expect(p2).toEqual({ sign_name: null, hours: null });
  });

  it('ignores readonly keys even if present in values', () => {
    const p = buildUpdatePayload(row, defs, formOf({ created_at: 'hacked' } as any));
    expect(p).toEqual({});
  });

  it('propagates coercion errors', () => {
    expect(() => buildUpdatePayload(row, defs, formOf({ total_price: 'lots' }))).toThrow('Total price must be a number');
  });
});
