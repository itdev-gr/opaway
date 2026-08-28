-- Influencer referral profiles: admin-created rows with a unique ref_code and
-- an admin-set commission. Bookings arriving with an influencer_code payload
-- key are attributed server-side (id + canonical code + commission snapshot).
-- Unknown/inactive codes are ignored silently — attribution never blocks a
-- booking. Idempotent: safe to re-run.

-- ── 1. Influencers table ─────────────────────────────────────────────────────

create table if not exists public.influencers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  ref_code text not null,
  commission_type text not null default 'percent'
    check (commission_type in ('percent', 'fixed')),
  commission_value numeric not null default 0 check (commission_value >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint influencers_ref_code_shape check (ref_code ~ '^[a-zA-Z0-9_-]{3,32}$'),
  constraint influencers_percent_max check (commission_type <> 'percent' or commission_value <= 100)
);

create unique index if not exists influencers_ref_code_ci on public.influencers (lower(ref_code));

alter table public.influencers enable row level security;

drop policy if exists "Admins manage influencers" on public.influencers;
create policy "Admins manage influencers" on public.influencers
  for all using (public.is_admin()) with check (public.is_admin());
-- Deliberately NO public policies: ref codes are resolved only inside the
-- SECURITY DEFINER booking RPCs below.

-- ── 2. Attribution columns on booking tables ────────────────────────────────

alter table public.transfers add column if not exists influencer_id uuid references public.influencers(id) on delete set null;
alter table public.transfers add column if not exists influencer_code text;
alter table public.transfers add column if not exists influencer_commission numeric not null default 0;

alter table public.tours add column if not exists influencer_id uuid references public.influencers(id) on delete set null;
alter table public.tours add column if not exists influencer_code text;
alter table public.tours add column if not exists influencer_commission numeric not null default 0;

-- ── 3. Booking RPCs, re-created with influencer attribution ─────────────────
-- Based on the live definitions from db/migrations/2026-08-26-coupons.sql
-- (coupon-aware). Additions: influencer declares, the attribution block after
-- the coupon block, and three new insert columns. Nothing else changes.

create or replace function public.create_transfer_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
  v_coupon_id   uuid;
  v_coupon_code text;
  v_inf_id    uuid;
  v_inf_code  text;
  v_inf_type  text;
  v_inf_value numeric;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  begin
    if (safe->>'date') is null
       or (safe->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (safe->>'date')::date < (now() at time zone 'Europe/Athens')::date then
      raise exception 'BOOKING_DATE_PAST';
    end if;
    if coalesce(safe->>'return_date', '') <> '' then
      if (safe->>'return_date') !~ '^\d{4}-\d{2}-\d{2}$'
         or (safe->>'return_date')::date < (safe->>'date')::date then
        raise exception 'BOOKING_DATE_PAST';
      end if;
    end if;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      -- Shape-valid but calendar-invalid (e.g. 2026-02-30): same contract.
      raise exception 'BOOKING_DATE_PAST';
  end;

  -- Re-validate the coupon server-side and store the canonical id/code.
  if coalesce(safe->>'coupon_code', '') <> '' then
    select vc.id, vc.code into v_coupon_id, v_coupon_code
    from public.validate_coupon(safe->>'coupon_code', coalesce(safe->>'booking_type', 'transfer')) vc;
    if v_coupon_id is null then
      raise exception 'COUPON_INVALID';
    end if;
  end if;

  -- Attribute to an active influencer when a ref code rode along. Unknown or
  -- inactive codes are ignored silently — attribution never blocks a booking.
  if coalesce(safe->>'influencer_code', '') <> '' then
    select i.id, i.ref_code, i.commission_type, i.commission_value
      into v_inf_id, v_inf_code, v_inf_type, v_inf_value
    from public.influencers i
    where lower(i.ref_code) = lower(trim(safe->>'influencer_code'))
      and i.active;
  end if;

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
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
    coupon_id, coupon_code, coupon_discount,
    influencer_id, influencer_code, influencer_commission
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
    safe->>'stripe_charge_id',
    v_coupon_id,
    v_coupon_code,
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end,
    v_inf_id,
    v_inf_code,
    case
      when v_inf_id is null then 0
      when v_inf_type = 'fixed' then round(v_inf_value, 2)
      else round(coalesce((safe->>'total_price')::numeric, 0) * v_inf_value / 100, 2)
    end
  );

  return new_id;
end;
$function$;

create or replace function public.create_tour_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
  v_coupon_id   uuid;
  v_coupon_code text;
  v_inf_id    uuid;
  v_inf_code  text;
  v_inf_type  text;
  v_inf_value numeric;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  begin
    if (safe->>'date') is null
       or (safe->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (safe->>'date')::date < (now() at time zone 'Europe/Athens')::date then
      raise exception 'BOOKING_DATE_PAST';
    end if;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      -- Shape-valid but calendar-invalid (e.g. 2026-02-30): same contract.
      raise exception 'BOOKING_DATE_PAST';
  end;

  -- Re-validate the coupon server-side and store the canonical id/code.
  if coalesce(safe->>'coupon_code', '') <> '' then
    select vc.id, vc.code into v_coupon_id, v_coupon_code
    from public.validate_coupon(safe->>'coupon_code', 'tour') vc;
    if v_coupon_id is null then
      raise exception 'COUPON_INVALID';
    end if;
  end if;

  -- Attribute to an active influencer when a ref code rode along. Unknown or
  -- inactive codes are ignored silently — attribution never blocks a booking.
  if coalesce(safe->>'influencer_code', '') <> '' then
    select i.id, i.ref_code, i.commission_type, i.commission_value
      into v_inf_id, v_inf_code, v_inf_type, v_inf_value
    from public.influencers i
    where lower(i.ref_code) = lower(trim(safe->>'influencer_code'))
      and i.active;
  end if;

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
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
    coupon_id, coupon_code, coupon_discount,
    influencer_id, influencer_code, influencer_commission
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
    safe->>'stripe_charge_id',
    v_coupon_id,
    v_coupon_code,
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end,
    v_inf_id,
    v_inf_code,
    case
      when v_inf_id is null then 0
      when v_inf_type = 'fixed' then round(v_inf_value, 2)
      else round(coalesce((safe->>'total_price')::numeric, 0) * v_inf_value / 100, 2)
    end
  );

  return new_id;
end;
$function$;

grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
