-- Coupon extra discount for round-trip transfers: return_extra_value is
-- added on top of discount_value (same unit as discount_type) when a
-- transfer booking includes a return leg. validate_coupon() now returns it;
-- a return-table change requires drop + create (create or replace cannot
-- alter the return type). Idempotent: safe to re-run.

alter table public.coupons add column if not exists return_extra_value numeric not null default 0;

do $$ begin
  alter table public.coupons
    add constraint coupons_return_extra_nonneg check (return_extra_value >= 0);
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.coupons
    add constraint coupons_percent_total_max
    check (discount_type <> 'percent' or discount_value + return_extra_value <= 100);
exception
  when duplicate_object then null;
end $$;

drop function if exists public.validate_coupon(text, text);

create function public.validate_coupon(p_code text, p_flow text)
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
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;
