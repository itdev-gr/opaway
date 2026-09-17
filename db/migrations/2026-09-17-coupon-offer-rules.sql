-- Coupon offer rules (2026-09-17)
--
-- Client feedback, three points:
--   1. The promo banner must send the visitor to the booking page of the
--      service the offer is for → get_promo_banner() now also returns the
--      offer's services (return-shape change: drop + create).
--   2. A transfer offer can target one-way rides only, round trips only, or
--      both → coupons.trip_scope ('any' | 'one_way' | 'round_trip'). The two
--      coupon RPCs already receive p_return_date, which says whether the trip
--      is a round trip. return_extra_value keeps its meaning (added on top for
--      round trips).
--   3. The period the offer can be BOOKED in must be separate from the TRAVEL
--      dates it covers, so an "early booking" October offer can run in
--      September → coupons.travel_from / travel_until. valid_from/valid_until
--      now mean the offer (booking) period only: today must fall inside it;
--      the ride date and, for a round trip, the return date must fall inside
--      travel_from..travel_until.
--
-- Existing coupons are backfilled with travel = valid and trip_scope = 'any',
-- so nothing changes for the offers running today.
-- Idempotent: safe to re-run.

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.coupons add column if not exists travel_from date;
alter table public.coupons add column if not exists travel_until date;

update public.coupons
set travel_from = coalesce(travel_from, valid_from),
    travel_until = coalesce(travel_until, valid_until)
where travel_from is null or travel_until is null;

alter table public.coupons alter column travel_from set not null;
alter table public.coupons alter column travel_until set not null;

do $$ begin
  alter table public.coupons
    add constraint coupons_travel_period check (travel_until >= travel_from);
exception
  when duplicate_object then null;
end $$;

alter table public.coupons add column if not exists trip_scope text not null default 'any';

do $$ begin
  alter table public.coupons
    add constraint coupons_trip_scope_known check (trip_scope in ('any', 'one_way', 'round_trip'));
exception
  when duplicate_object then null;
end $$;

-- ── 2. Offers a visitor qualifies for, for a given trip ─────────────────────

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
    -- offer (booking) period: today
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    -- travel period: the ride, and the return leg when there is one
    and p_date is not null
    and p_date between c.travel_from and c.travel_until
    and (p_return_date is null or p_return_date between c.travel_from and c.travel_until)
    -- trip type, transfers only
    and (p_flow <> 'transfer'
         or c.trip_scope = 'any'
         or (c.trip_scope = 'round_trip' and p_return_date is not null)
         or (c.trip_scope = 'one_way' and p_return_date is null))
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  order by c.created_at desc;
$$;

grant execute on function public.get_auto_coupons(text, date, date) to anon, authenticated;

-- ── 3. Server-side re-validation at booking time ────────────────────────────

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
    and p_date between c.travel_from and c.travel_until
    and (p_return_date is null or p_return_date between c.travel_from and c.travel_until)
    and (p_flow <> 'transfer'
         or c.trip_scope = 'any'
         or (c.trip_scope = 'round_trip' and p_return_date is not null)
         or (c.trip_scope = 'one_way' and p_return_date is null))
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text, date, date) to anon, authenticated;

-- ── 4. Promo banner, now with the offer's services ──────────────────────────

drop function if exists public.get_promo_banner();

create function public.get_promo_banner()
returns table (code text, banner_text text, applies_to_all boolean, flows text[])
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
  select c.code, c.banner_text, c.applies_to_all, c.flows
  from public.coupons c, caller
  where c.active
    and length(btrim(c.banner_text)) > 0
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  order by c.created_at desc
  limit 1;
$$;

grant execute on function public.get_promo_banner() to anon, authenticated;
