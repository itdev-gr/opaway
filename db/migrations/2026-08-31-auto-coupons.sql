-- Auto-applied coupons (2026-08-31)
--
-- Customers no longer type a coupon code: from the moment an admin turns a
-- coupon on, the discount is baked into every price the customer sees. This
-- RPC is what the booking pages ask for the offers a given visitor qualifies
-- for; the client then picks whichever saves the most on the price shown.
--
-- Posture change worth stating: coupon codes are no longer secret, because
-- nobody has to guess or share them any more. The function still exposes only
-- the five columns pricing needs -- never the validity dates, the targeting or
-- banner_text -- so the coupons table keeps its admin-only RLS and this stays
-- the narrowest public window onto it.
--
-- validate_coupon() is deliberately left untouched: create_transfer_booking
-- and create_tour_booking still re-validate the submitted code through it.

create or replace function public.get_auto_coupons(p_flow text)
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
  -- Same caller resolution as validate_coupon: an approved partner books as
  -- their own type, everyone else (guests included) as retail.
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
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  -- Newest first: the client's tie-break when two offers save the same amount.
  order by c.created_at desc;
$$;

grant execute on function public.get_auto_coupons(text) to anon, authenticated;
