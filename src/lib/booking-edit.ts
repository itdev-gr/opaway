// Admin "edit booking" field schema + pure payload builder.
// No supabase import here — this module must be loadable without env vars
// (same rule as the pure coupon / affiliate helpers) so it can be unit-tested.
//
// Column facts this encodes (see supabase-migration.sql + db/migrations):
//  - transfers.ride_status CHECK: new/assigned/pickup/onboard/completed/cancelled
//  - transfers/tours.payment_status CHECK: 8 values (2026-05-04-stripe-server-capture.sql)
//  - tours.hotel_choice CHECK: null | self-book | include-booking
//  - text columns default '' (never write null unless the def says `nullable`)
//  - numeric columns default 0 (same rule)

export type Kind = 'transfer' | 'tour' | 'experience' | 'request';

export type FieldType =
  | 'text' | 'textarea' | 'int' | 'money' | 'number'
  | 'date' | 'time' | 'select' | 'checkbox';

export type Option = { value: string; label: string };

/** Dynamic option lists the modal resolves at runtime. */
export type DynamicSource = 'drivers' | 'partners';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: Option[];
  source?: DynamicSource;
  /** Span both grid columns. */
  full?: boolean;
  /** Empty input → null (column is nullable). Otherwise '' / 0. */
  nullable?: boolean;
  /** Render as plain text; never included in the update payload. */
  readonly?: boolean;
  /** Wire Google Places autocomplete onto this input (address fields). */
  places?: boolean;
};

export const RIDE_STATUSES = ['new', 'assigned', 'pickup', 'onboard', 'completed', 'cancelled'] as const;
export const PAYMENT_STATUSES = [
  'pending', 'awaiting_payment', 'paid', 'paid_to_driver',
  'cancelled', 'failed', 'refunded', 'partially_refunded',
] as const;
export const PAYMENT_METHODS = ['cash', 'stripe', 'card-onsite'] as const;
export const BOOKING_TYPES = ['transfer', 'hourly'] as const;
export const REQUEST_STATUSES = ['new', 'answered', 'follow-up', 'discarded'] as const;
export const REQUEST_SOURCES = ['contact', 'tour', 'experience'] as const;
/** Same list the admin "Add booking" form offers; stored as name + lowercased slug. */
export const VEHICLE_NAMES = ['Sedan', 'SUV', 'Van', 'Minibus', 'Bus'] as const;
export const VEHICLE_OPTIONS: Option[] = [
  { value: '', label: '—' },
  ...VEHICLE_NAMES.map((n) => ({ value: n.toLowerCase(), label: n })),
];

const opts = (values: readonly string[], labels: Record<string, string> = {}): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

const PAYMENT_STATUS_OPTS = opts(PAYMENT_STATUSES, {
  awaiting_payment: 'awaiting payment', paid_to_driver: 'paid to driver', partially_refunded: 'partially refunded',
});
const RIDE_STATUS_OPTS = opts(RIDE_STATUSES);
const PAYMENT_METHOD_OPTS = opts(PAYMENT_METHODS, { 'card-onsite': 'card on site' });

const t  = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'text', ...extra });
const ta = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'textarea', full: true, ...extra });
const i  = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'int', ...extra });
const m  = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'money', ...extra });
const sel = (key: string, label: string, options: Option[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'select', options, ...extra });
const cb = (key: string, label: string): FieldDef => ({ key, label, type: 'checkbox' });
const ro = (key: string, label: string): FieldDef => ({ key, label, type: 'text', readonly: true });

const driverField  = (): FieldDef => ({ key: 'driver_uid', label: 'Driver', type: 'select', source: 'drivers' });
const partnerField = (): FieldDef => ({ key: 'partner_id', label: 'Partner (hotel / agency)', type: 'select', source: 'partners', nullable: true });

function transferFields(): FieldDef[] {
  return [
    t('first_name', 'First name'),
    t('last_name', 'Last name'),
    t('email', 'Email'),
    t('phone', 'Phone'),
    sel('booking_type', 'Booking type', opts(BOOKING_TYPES)),
    sel('vehicle_slug', 'Vehicle', VEHICLE_OPTIONS),
    t('from', 'From', { full: true, places: true }),
    t('to', 'To', { full: true, places: true }),
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'time', label: 'Time', type: 'time' },
    { key: 'return_date', label: 'Return date', type: 'date', nullable: true },
    { key: 'return_time', label: 'Return time', type: 'time', nullable: true },
    i('passengers', 'Passengers'),
    i('child_seats', 'Child seats'),
    i('luggage_small', 'Small luggage'),
    i('luggage_big', 'Big luggage'),
    i('hours', 'Hours (hourly)', { nullable: true }),
    m('per_hour', '€ / hour (hourly)', { nullable: true }),
    m('total_price', 'Total price'),
    m('base_price', 'Base price'),
    m('outward_price', 'Outward price'),
    m('return_price', 'Return price'),
    m('card_surcharge', 'Card surcharge'),
    t('coupon_code', 'Coupon code', { nullable: true }),
    m('coupon_discount', 'Coupon discount'),
    t('influencer_code', 'Affiliate code', { nullable: true }),
    m('influencer_commission', 'Affiliate commission'),
    sel('payment_method', 'Payment method', PAYMENT_METHOD_OPTS),
    sel('payment_status', 'Payment status', PAYMENT_STATUS_OPTS),
    sel('ride_status', 'Ride status', RIDE_STATUS_OPTS),
    driverField(),
    cb('released_to_drivers', 'Released to drivers'),
    cb('added_by_admin', 'Added by admin'),
    partnerField(),
    t('sign_name', 'Sign name', { nullable: true }),
    ta('notes', 'Customer notes'),
    ta('driver_notes', 'Driver notes', { nullable: true }),
    ta('driver_remarks', 'Driver remarks', { nullable: true }),
    ro('created_at', 'Created'),
    ro('stripe_payment_intent_id', 'Stripe payment intent'),
    ro('stripe_charge_id', 'Stripe charge'),
  ];
}

function tourOrExperienceFields(kind: 'tour' | 'experience'): FieldDef[] {
  const isTour = kind === 'tour';
  return [
    t('name', 'Customer name'),
    ...(isTour ? [] : [t('last_name', 'Last name', { nullable: true })]),
    t('email', 'Email'),
    t('phone', 'Phone'),
    t(`${kind}_name`, isTour ? 'Tour' : 'Experience'),
    t('vehicle', 'Vehicle'),
    t('vehicle_name', 'Vehicle name'),
    t('pickup', 'Pickup', { full: true, places: true }),
    t('pickup_location', 'Pickup location', { full: true, places: true }),
    t('destination', 'Destination', { full: true, places: true }),
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'time', label: 'Time', type: 'time' },
    i('participants', 'Participants'),
    i('passengers', 'Passengers'),
    ...(isTour ? [
      i('entrance_tickets_count', 'Entrance tickets'),
      m('entrance_tickets_total', 'Entrance tickets total'),
      sel('hotel_choice', 'Hotel preference', [
        { value: 'self-book', label: 'Guest books their own hotel' },
        { value: 'include-booking', label: 'Wants hotel booked by agent' },
      ], { nullable: true }),
    ] : []),
    m('total_price', 'Total price'),
    ...(isTour ? [
      m('card_surcharge', 'Card surcharge'),
      t('coupon_code', 'Coupon code', { nullable: true }),
      m('coupon_discount', 'Coupon discount'),
      t('influencer_code', 'Affiliate code', { nullable: true }),
      m('influencer_commission', 'Affiliate commission'),
    ] : []),
    sel('payment_method', 'Payment method', PAYMENT_METHOD_OPTS),
    sel('payment_status', 'Payment status', PAYMENT_STATUS_OPTS),
    sel('ride_status', 'Ride status', RIDE_STATUS_OPTS),
    driverField(),
    cb('released_to_drivers', 'Released to drivers'),
    cb('added_by_admin', 'Added by admin'),
    partnerField(),
    ta('special_requests', 'Special requests'),
    ta('notes', 'Notes'),
    ta('driver_remarks', 'Driver remarks', { nullable: true }),
    ro(`${kind}_id`, isTour ? 'Tour id' : 'Experience id'),
    ro('created_at', 'Created'),
  ];
}

function requestFields(): FieldDef[] {
  const n = { nullable: true };
  return [
    sel('source', 'Source', opts(REQUEST_SOURCES)),
    sel('status', 'Status', opts(REQUEST_STATUSES, { 'follow-up': 'Follow up' })),
    t('name', 'Name', n),
    t('last_name', 'Last name', n),
    t('email', 'Email', n),
    t('phone', 'Phone', n),
    t('country', 'Country', n),
    t('city', 'City', n),
    t('vehicle_type', 'Vehicle type', n),
    t('subject', 'Subject', { ...n, full: true }),
    ta('message', 'Message', n),
    t('tour_name', 'Tour', n),
    t('experience_name', 'Experience', n),
    t('pickup_location', 'Pickup', { ...n, full: true, places: true }),
    { key: 'date', label: 'Date', type: 'date', nullable: true },
    { key: 'time', label: 'Time', type: 'time', nullable: true },
    i('participants', 'Participants', n),
    t('contact_info', 'Contact info', n),
    ta('special_requests', 'Special requests', n),
    ro('user_display_name', 'Account name'),
    ro('user_email', 'Account email'),
    ro('created_at', 'Created'),
  ];
}

export function fieldsFor(kind: Kind): FieldDef[] {
  switch (kind) {
    case 'transfer':   return transferFields();
    case 'tour':       return tourOrExperienceFields('tour');
    case 'experience': return tourOrExperienceFields('experience');
    case 'request':    return requestFields();
  }
}

const NUMERIC: ReadonlySet<FieldType> = new Set(['int', 'money', 'number']);

/**
 * Convert a raw form value into what the column should receive.
 * Throws with a human-readable message for unparsable numbers.
 */
export function coerce(def: FieldDef, raw: string | boolean | null | undefined): unknown {
  if (def.type === 'checkbox') return raw === true || raw === 'true' || raw === 'on';

  const s = raw == null ? '' : String(raw).trim();

  if (NUMERIC.has(def.type)) {
    if (s === '') return def.nullable ? null : 0;
    const n = def.type === 'int' ? Number.parseInt(s, 10) : Number.parseFloat(s);
    if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number`);
    if (def.type === 'int' && String(n) !== s.replace(/^\+/, '')) throw new Error(`${def.label} must be a whole number`);
    return def.type === 'money' ? Math.round(n * 100) / 100 : n;
  }

  if (s === '') return def.nullable ? null : '';
  return s;
}

/** Loose equality that treats null/undefined/'' as the same "empty" and compares numerics as numbers. */
export function sameValue(def: FieldDef, current: unknown, next: unknown): boolean {
  if (def.type === 'checkbox') return Boolean(current) === Boolean(next);
  const curEmpty = current == null || current === '';
  const nextEmpty = next == null || next === '';
  if (curEmpty || nextEmpty) return curEmpty && nextEmpty;
  if (NUMERIC.has(def.type)) return Number(current) === Number(next);
  return String(current) === String(next);
}

/**
 * Build the minimal update payload: only editable fields whose coerced value differs from the row.
 * `values` is keyed by column; missing keys are skipped (field not rendered).
 */
export function buildUpdatePayload(
  row: Record<string, unknown>,
  defs: FieldDef[],
  values: Record<string, string | boolean | null | undefined>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const def of defs) {
    if (def.readonly) continue;
    if (!(def.key in values)) continue;
    const next = coerce(def, values[def.key]);
    if (sameValue(def, row[def.key], next)) continue;
    payload[def.key] = next;
  }
  return payload;
}
