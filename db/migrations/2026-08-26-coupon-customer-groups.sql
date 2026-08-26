-- Coupon customer-group targeting: a coupon applies to all customers or to
-- selected groups ('retail' | 'hotel' | 'agency' | 'driver'). The caller's
-- group is resolved server-side inside validate_coupon() from auth.uid():
-- an approved partners row yields its type; everyone else (guests included)
-- is 'retail'. Booking RPCs and payment pages need no changes — they all
-- validate through this function.
-- Idempotent: safe to re-run.

alter table public.coupons add column if not exists applies_to_all_groups boolean not null default true;
alter table public.coupons add column if not exists groups text[] not null default '{}';

do $$ begin
  alter table public.coupons
    add constraint coupons_groups_known check (groups <@ array['retail','hotel','agency','driver']);
exception
  when duplicate_object then null;
end $$;

create or replace function public.validate_coupon(p_code text, p_flow text)
returns table (id uuid, code text, discount_type text, discount_value numeric)
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
  select c.id, c.code, c.discount_type, c.discount_value
  from public.coupons c, caller
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;
