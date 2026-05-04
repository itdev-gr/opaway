-- Stripe server-side Checkout capture: schema additions + RPC updates.
--
-- Background: previously, payment.astro called stripe.createToken() client-side
-- and stored the token on the booking row. No server-side capture existed and
-- payment_status was hard-coded 'pending'. This migration adds the columns and
-- RPC infrastructure to support a real server-side Checkout flow:
--   - stripe_session_id, stripe_payment_intent_id, stripe_charge_id on bookings
--   - stripe_events table (PRIMARY KEY = event id) for webhook idempotency
--   - apply_stripe_event(...) RPC that does idempotency + booking UPDATE in one tx
--   - create_transfer_booking / create_tour_booking re-created with stripe_* passthrough
--
-- Idempotent (`if not exists`, `or replace`).

-- ──────────────────────────────────────────────────────────────────────
-- 1. New stripe_* columns on the two booking tables
-- ──────────────────────────────────────────────────────────────────────
alter table public.transfers
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;

alter table public.tours
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Replace the broken payment_status CHECK constraint
--    (current: in ('pending','paid'); but driver/ride.astro already writes 'paid_to_driver')
-- ──────────────────────────────────────────────────────────────────────
alter table public.transfers drop constraint if exists transfers_payment_status_check;
alter table public.transfers add constraint transfers_payment_status_check
  check (payment_status in (
    'pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'
  ));

alter table public.tours drop constraint if exists tours_payment_status_check;
alter table public.tours add constraint tours_payment_status_check
  check (payment_status in (
    'pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'
  ));

-- ──────────────────────────────────────────────────────────────────────
-- 3. Idempotency table for webhook events
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.stripe_events (
  id          text primary key,           -- evt_…
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- No grants to anon/authenticated. Only service role and SECURITY DEFINER RPCs
-- (which run as table owner) read/write this table.

-- ──────────────────────────────────────────────────────────────────────
-- 4. Indexes for fast webhook lookups
-- ──────────────────────────────────────────────────────────────────────
create index if not exists transfers_stripe_session_id_idx
  on public.transfers (stripe_session_id) where stripe_session_id is not null;
create index if not exists transfers_stripe_payment_intent_idx
  on public.transfers (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists tours_stripe_session_id_idx
  on public.tours (stripe_session_id) where stripe_session_id is not null;
create index if not exists tours_stripe_payment_intent_idx
  on public.tours (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- ──────────────────────────────────────────────────────────────────────
-- 5. Re-create create_transfer_booking with stripe_* passthrough
--    (Supersedes the version in 2026-05-04-guest-booking-rpcs.sql.)
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.create_transfer_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  insert into public.transfers (
    id, uid,
    "from", "to", date, time,
    passengers, return_date, return_time,
    vehicle_slug, vehicle_name,
    first_name, last_name, email, phone,
    sign_name, child_seats, driver_notes,
    total_price, base_price, outward_price, return_price, card_surcharge,
    ride_status, payment_status, payment_method, payment_token,
    booking_type, partner_id, luggage_small, luggage_big,
    hours, per_hour,
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id
  )
  values (
    new_id,
    auth.uid(),
    safe->>'from', safe->>'to', safe->>'date', safe->>'time',
    coalesce((safe->>'passengers')::int, 1),
    safe->>'return_date', safe->>'return_time',
    safe->>'vehicle_slug', safe->>'vehicle_name',
    safe->>'first_name', safe->>'last_name', safe->>'email', safe->>'phone',
    safe->>'sign_name',
    coalesce((safe->>'child_seats')::int, 0),
    safe->>'driver_notes',
    coalesce((safe->>'total_price')::numeric, 0),
    coalesce((safe->>'base_price')::numeric, 0),
    coalesce((safe->>'outward_price')::numeric, 0),
    coalesce((safe->>'return_price')::numeric, 0),
    coalesce((safe->>'card_surcharge')::numeric, 0),
    coalesce(safe->>'ride_status', 'new'),
    coalesce(safe->>'payment_status', 'pending'),
    coalesce(safe->>'payment_method', 'cash'),
    safe->>'payment_token',
    coalesce(safe->>'booking_type', 'transfer'),
    safe->>'partner_id',
    coalesce((safe->>'luggage_small')::int, 0),
    coalesce((safe->>'luggage_big')::int, 0),
    nullif((safe->>'hours')::text, '')::int,
    nullif((safe->>'per_hour')::text, '')::numeric,
    safe->>'stripe_session_id',
    safe->>'stripe_payment_intent_id',
    safe->>'stripe_charge_id'
  );

  return new_id;
end;
$$;
revoke all on function public.create_transfer_booking(jsonb) from public;
grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 6. Re-create create_tour_booking with stripe_* passthrough
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.create_tour_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  insert into public.tours (
    id, uid,
    tour, tour_id, tour_name,
    pickup, pickup_location, destination,
    date, time,
    passengers, participants,
    vehicle, vehicle_name,
    name, email, phone,
    special_requests, notes, hotel_choice,
    total_price,
    entrance_tickets_count, entrance_tickets_total,
    ride_status, payment_status, payment_method, payment_token,
    card_surcharge, partner_id, added_by_admin,
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id
  )
  values (
    new_id,
    auth.uid(),
    safe->>'tour', safe->>'tour_id', safe->>'tour_name',
    safe->>'pickup', safe->>'pickup_location', safe->>'destination',
    safe->>'date', safe->>'time',
    coalesce((safe->>'passengers')::int, 1),
    coalesce((safe->>'participants')::int, 1),
    safe->>'vehicle', safe->>'vehicle_name',
    safe->>'name', safe->>'email', safe->>'phone',
    safe->>'special_requests', safe->>'notes', safe->>'hotel_choice',
    coalesce((safe->>'total_price')::numeric, 0),
    coalesce((safe->>'entrance_tickets_count')::int, 0),
    coalesce((safe->>'entrance_tickets_total')::numeric, 0),
    coalesce(safe->>'ride_status', 'new'),
    coalesce(safe->>'payment_status', 'pending'),
    coalesce(safe->>'payment_method', 'cash'),
    safe->>'payment_token',
    coalesce((safe->>'card_surcharge')::numeric, 0),
    safe->>'partner_id',
    coalesce((safe->>'added_by_admin')::boolean, false),
    safe->>'stripe_session_id',
    safe->>'stripe_payment_intent_id',
    safe->>'stripe_charge_id'
  );

  return new_id;
end;
$$;
revoke all on function public.create_tour_booking(jsonb) from public;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 7. apply_stripe_event RPC: idempotency + booking UPDATE in one transaction
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.apply_stripe_event(
  p_event_id   text,
  p_event_type text,
  p_payload    jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id text;
begin
  insert into public.stripe_events(id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing
    returning id into inserted_id;

  if inserted_id is null then
    return 'duplicate';
  end if;

  case p_event_type
    when 'checkout.session.completed' then
      update public.transfers set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';
      update public.tours set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';

    when 'payment_intent.payment_failed' then
      update public.transfers set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';
      update public.tours set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';

    when 'charge.refunded' then
      update public.transfers set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';
      update public.tours set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';

    else
      null;
  end case;

  return 'applied';
end;
$$;
revoke all on function public.apply_stripe_event(text, text, jsonb) from public;
-- Not granted to anon/authenticated; called only from server endpoint via service role.
