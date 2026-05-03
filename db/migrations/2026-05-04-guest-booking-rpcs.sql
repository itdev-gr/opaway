-- 1. Catch-up: tours.payment_token + tours.card_surcharge
-- The transfer-flow payment row already had these two columns; the tour-flow
-- payment row referenced them in JS (commit 545af79) but they were never
-- added to public.tours. Without these PostgREST returns 400 PGRST204 on
-- every tour booking insert. Add them now (idempotent) so the column-shape
-- of the three booking flows is uniform.
alter table public.tours add column if not exists payment_token  text;
alter table public.tours add column if not exists card_surcharge numeric not null default 0;

-- Guest-booking RPCs.
--
-- Background: every payment.astro currently does:
--   const id = crypto.randomUUID();
--   await supabase.from('transfers').insert({ id, ...rest });   // no .select()
-- The client-side UUID is what lets us avoid asking for RETURNING (which would
-- be rejected by the SELECT RLS policies for an anon caller). It works, but
-- every new booking flow has to remember the same dance and the row-shape is
-- duplicated across files.
--
-- These two SECURITY DEFINER RPCs hide that detail. They:
--   - Generate the row id server-side (caller can't spoof it).
--   - Force `uid = auth.uid()` (or NULL for guests) — caller can't attribute
--     the booking to another user.
--   - Insert with explicit column lists so DB column defaults still apply for
--     fields the caller omitted (jsonb_populate_record would override defaults
--     with NULL — we don't want that for created_at, etc.).
--   - Return the new id so the success page can show the reference.
--
-- Granted to anon + authenticated. Idempotent.

-- ──────────────────────────────────────────────────────────────────────
-- create_transfer_booking — used by /book/transfer + /book/hourly
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
  -- Strip caller-controlled trust fields; we'll re-attach our own.
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
    hours, per_hour
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
    nullif((safe->>'per_hour')::text, '')::numeric
  );

  return new_id;
end;
$$;

revoke all on function public.create_transfer_booking(jsonb) from public;
grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- create_tour_booking — used by /book/tour
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
    card_surcharge, partner_id, added_by_admin
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
    coalesce((safe->>'added_by_admin')::boolean, false)
  );

  return new_id;
end;
$$;

revoke all on function public.create_tour_booking(jsonb) from public;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
