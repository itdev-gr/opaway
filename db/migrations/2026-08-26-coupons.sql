-- Discount coupons: admin-managed codes with a validity period, applying to
-- all payable flows or a selected subset ('transfer' | 'hourly' | 'tour').
-- Customers validate codes only through validate_coupon(); booking RPCs
-- re-validate at insert time and raise 'COUPON_INVALID' on failure.
-- Idempotent: safe to re-run.

-- ── 1. Coupons table ─────────────────────────────────────────────────────────

create table if not exists public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code text not null,
  discount_type text not null default 'percent'
    check (discount_type in ('percent', 'fixed')),
  discount_value numeric not null check (discount_value > 0),
  valid_from date not null,
  valid_until date not null,
  active boolean not null default true,
  applies_to_all boolean not null default true,
  flows text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint coupons_valid_period check (valid_until >= valid_from),
  constraint coupons_percent_max check (discount_type <> 'percent' or discount_value <= 100),
  constraint coupons_flows_known check (flows <@ array['transfer','hourly','tour'])
);

create unique index if not exists coupons_code_ci on public.coupons (lower(code));

alter table public.coupons enable row level security;

drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());
-- Deliberately NO public SELECT policy: customers cannot enumerate codes.
-- Validation happens only through validate_coupon() below.

-- ── 2. Coupon columns on booking tables ──────────────────────────────────────

alter table public.transfers add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.transfers add column if not exists coupon_code text;
alter table public.transfers add column if not exists coupon_discount numeric not null default 0;

alter table public.tours add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.tours add column if not exists coupon_code text;
alter table public.tours add column if not exists coupon_discount numeric not null default 0;

-- ── 3. Validation RPC (used by the payment pages AND the booking RPCs) ──────

create or replace function public.validate_coupon(p_code text, p_flow text)
returns table (id uuid, code text, discount_type text, discount_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.code, c.discount_type, c.discount_value
  from public.coupons c
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all or p_flow = any (c.flows));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;

-- ── 4. Booking RPCs, re-created with coupon validation + columns ────────────
-- Based on the live definitions (which match db/migrations/2026-07-16-block-past-booking-dates.sql)
-- plus: coupon validation after the date checks, and three new insert columns.

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
    coupon_id, coupon_code, coupon_discount
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
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end
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
    coupon_id, coupon_code, coupon_discount
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
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end
  );

  return new_id;
end;
$function$;

grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
