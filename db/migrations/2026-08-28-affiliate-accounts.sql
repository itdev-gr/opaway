-- Affiliate self-service accounts.
--
-- Affiliates (public.influencers — the UI calls them "affiliates", the columns
-- keep the legacy influencer_* names) get a real login so they can see the
-- bookings their referral link produced and the commission they earned.
--
-- The admin creates the account from /admin/affiliates; the server route
-- /api/admin/create-affiliate-login does the privileged work with the service
-- role and writes the resulting auth.uid() back onto the influencer row.
--
-- Idempotent: safe to re-run.

-- ── 1. Link an influencer row to an auth user ───────────────────────────────

alter table public.influencers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists influencers_user_id_uniq
  on public.influencers (user_id) where user_id is not null;

-- Email becomes the login identity, so it must be unique among affiliates that
-- have one. Legacy rows may share (or lack) an email, so this is best-effort:
-- if duplicates exist the index is skipped with a notice instead of aborting
-- the whole migration. Resolve the duplicates, then re-run.
do $$
begin
  begin
    create unique index if not exists influencers_email_ci_uniq
      on public.influencers (lower(email)) where email <> '';
  exception when unique_violation then
    raise notice 'influencers_email_ci_uniq skipped: duplicate emails exist. Run: select lower(email), count(*) from public.influencers where email <> '''' group by 1 having count(*) > 1;';
  end;
end $$;

-- ── 2. Allow the new role on public.users ───────────────────────────────────
-- users.type is authoritative for portal routing (login.astro checks it first).

alter table public.users drop constraint if exists users_type_check;
alter table public.users add constraint users_type_check
  check (type in ('admin', 'driver', 'user', 'affiliate'));

-- ── 3. Who am I? ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the booking policies below can resolve the caller's
-- affiliate id without recursing into the influencers RLS they are gated by.

create or replace function public.current_affiliate_id()
returns uuid
language sql
security definer
stable
set search_path to 'public'
as $$
  select id from public.influencers where user_id = auth.uid() and active limit 1;
$$;

revoke all on function public.current_affiliate_id() from public;
grant execute on function public.current_affiliate_id() to authenticated;

-- ── 4. RLS: an affiliate reads its own profile and its own attributed rows ──
-- SELECT only. Affiliates must never write: the commission rate is admin-set
-- and the per-booking commission is snapshotted by the booking RPCs.
-- The existing "Admins manage influencers" policy is left untouched.

drop policy if exists "Affiliates read own profile" on public.influencers;
create policy "Affiliates read own profile" on public.influencers
  for select using (user_id = auth.uid());

drop policy if exists "Affiliates read own transfers" on public.transfers;
create policy "Affiliates read own transfers" on public.transfers
  for select using (
    influencer_id is not null and influencer_id = public.current_affiliate_id()
  );

drop policy if exists "Affiliates read own tours" on public.tours;
create policy "Affiliates read own tours" on public.tours
  for select using (
    influencer_id is not null and influencer_id = public.current_affiliate_id()
  );

-- Note: public.experiences carries no influencer_* columns, so there is
-- nothing to attribute and no policy to add there.
