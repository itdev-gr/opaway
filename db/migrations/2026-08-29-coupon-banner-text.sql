-- Coupon-driven promo banner: banner_text turns a coupon into the site-wide
-- offer message. get_promo_banner() exposes ONLY the code + text of the single
-- coupon currently being advertised, so the coupons table stays unreadable to
-- the public (no code enumeration). Group targeting mirrors validate_coupon:
-- an approved partner sees their group's offers, everyone else sees retail.
-- Idempotent: safe to re-run.

alter table public.coupons add column if not exists banner_text text not null default '';

create or replace function public.get_promo_banner()
returns table (code text, banner_text text)
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
  select c.code, c.banner_text
  from public.coupons c, caller
  where c.active
    and length(btrim(c.banner_text)) > 0
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  order by c.created_at desc
  limit 1;
$$;

grant execute on function public.get_promo_banner() to anon, authenticated;
