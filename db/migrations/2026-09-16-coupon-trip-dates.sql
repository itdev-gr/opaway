-- Coupons tied to the travel date (2026-09-16)
--
-- Client report: a customer booked an OCTOBER transfer during September and
-- got the September offer. Until now every coupon check only asked whether
-- TODAY (Europe/Athens) falls inside valid_from..valid_until, so a booking
-- made inside the period got the discount whatever date it was travelling on.
--
-- New rule, enforced in one place (the two public coupon RPCs):
--   * the booking is still made inside the period (today check, unchanged), AND
--   * the ride date falls inside the period, AND
--   * for a round-trip transfer the return date falls inside the period too.
-- A trip that leaves the period on either leg gets no coupon at all -- the
-- offer exists to fill the running month, not to discount future months.
--
-- Both RPCs gain (p_date, p_return_date). A missing p_date yields NO coupon
-- (fail closed): a client still running the previous build gets full price
-- rather than an out-of-period discount. The old single-arity overloads are
-- dropped first, otherwise PostgREST could not pick between the two.
--
-- The booking RPCs are re-created from the live bodies
-- (db/migrations/2026-08-28-influencers.sql) with ONLY the validate_coupon
-- call changed to pass the payload's date / return_date. The date guards that
-- run just before already guarantee both are well-formed YYYY-MM-DD strings.
--
-- get_promo_banner() is untouched: the site-wide bar advertises the running
-- offer; the admin's banner_text is where the travel period is described.
-- Idempotent: safe to re-run.

-- ── 1. Offers a visitor qualifies for, for a given trip ─────────────────────

drop function if exists public.get_auto_coupons(text);

create or replace function public.get_auto_coupons(
  p_flow text,
  p_date date default null,
  p_return_date date default null
)
returns table (
  id uuid,
  code text,
  discount_type text,
  discount_value numeric,
  return_extra_value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select coalesce(
      (select p.type
       from public.partners p
       where p.id = auth.uid() and p.status = 'approved'),
      'retail'
    ) as grp
  )
  select c.id, c.code, c.discount_type, c.discount_value, c.return_extra_value
  from public.coupons c, caller
  where c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and p_date is not null
    and p_date between c.valid_from and c.valid_until
    and (p_return_date is null or p_return_date between c.valid_from and c.valid_until)
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  order by c.created_at desc;
$$;

grant execute on function public.get_auto_coupons(text, date, date) to anon, authenticated;

-- ── 2. Server-side re-validation at booking time ────────────────────────────

drop function if exists public.validate_coupon(text, text);

create or replace function public.validate_coupon(
  p_code text,
  p_flow text,
  p_date date default null,
  p_return_date date default null
)
returns table (id uuid, code text, discount_type text, discount_value numeric, return_extra_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select coalesce(
      (select p.type
       from public.partners p
       where p.id = auth.uid() and p.status = 'approved'),
      'retail'
    ) as grp
  )
  select c.id, c.code, c.discount_type, c.discount_value, c.return_extra_value
  from public.coupons c, caller
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and p_date is not null
    and p_date between c.valid_from and c.valid_until
    and (p_return_date is null or p_return_date between c.valid_from and c.valid_until)
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text, date, date) to anon, authenticated;

-- ── 3. Booking RPCs, re-created passing the trip dates to validate_coupon ───

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
    from public.validate_coupon(
      safe->>'coupon_code',
      coalesce(safe->>'booking_type', 'transfer'),
      (safe->>'date')::date,
      nullif(safe->>'return_date', '')::date
    ) vc;
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
    from public.validate_coupon(safe->>'coupon_code', 'tour', (safe->>'date')::date, null) vc;
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
