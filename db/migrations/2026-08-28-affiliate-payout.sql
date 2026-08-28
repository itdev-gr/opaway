-- Affiliate payout details.
--
-- An affiliate fills in their own IBAN + beneficiary name on /affiliate so the
-- admin can pay their commission. The admin sees the details on
-- /admin/affiliates but does not edit them.
--
-- Affiliates stay SELECT-only on public.influencers: giving them UPDATE would
-- also let them raise their own commission_value. Instead this migration adds
-- a SECURITY DEFINER RPC that can only ever touch the two payout columns of
-- the caller's own row.
--
-- Idempotent: safe to re-run.

-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.influencers
  add column if not exists iban text not null default '',
  add column if not exists bank_holder text not null default '';

-- Shape only: length + the ISO 13616 layout (2 letters, 2 digits, then
-- alphanumerics). The mod-97 checksum is validated client-side before we ever
-- get here; '' means "not provided yet".
alter table public.influencers drop constraint if exists influencers_iban_shape;
alter table public.influencers add constraint influencers_iban_shape
  check (iban = '' or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$');

-- ── 2. The only write an affiliate is allowed to make ───────────────────────

create or replace function public.set_affiliate_payout(p_iban text, p_holder text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id    uuid;
  v_iban  text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  v_holder text := btrim(coalesce(p_holder, ''));
begin
  -- Resolve the caller's own affiliate row. Anyone else gets nothing to write to.
  select id into v_id
  from public.influencers
  where user_id = auth.uid() and active
  limit 1;

  if v_id is null then
    raise exception 'NOT_AN_ACTIVE_AFFILIATE';
  end if;

  if v_iban <> '' and v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    raise exception 'INVALID_IBAN';
  end if;

  if length(v_holder) > 120 then
    raise exception 'HOLDER_TOO_LONG';
  end if;

  update public.influencers
     set iban = v_iban,
         bank_holder = v_holder
   where id = v_id;
end;
$function$;

-- Supabase grants EXECUTE to anon/authenticated by default privileges, so the
-- revoke has to name anon explicitly. An anon caller could not do anything
-- anyway (auth.uid() is null, so no row resolves) — this just narrows it.
revoke all on function public.set_affiliate_payout(text, text) from public;
revoke all on function public.set_affiliate_payout(text, text) from anon;
grant execute on function public.set_affiliate_payout(text, text) to authenticated;
