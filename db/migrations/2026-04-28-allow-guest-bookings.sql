-- Allow guest (anonymous) bookings on transfers, tours, experiences.
-- The frontend payment pages collect first_name / last_name / email / phone in
-- every flow, so the booking row carries enough contact info even without a
-- user account. Admins still see all rows; logged-in users still only see their
-- own (the SELECT policies match on uid which can now be null for guests).
-- Idempotent.

-- 1. Make `uid` nullable so guest rows can have NULL user.
alter table public.transfers   alter column uid drop not null;
alter table public.tours       alter column uid drop not null;
alter table public.experiences alter column uid drop not null;

-- 2. Replace the "auth.uid() IS NOT NULL" INSERT policies with permissive ones.
drop policy if exists "Authenticated insert transfers"   on public.transfers;
drop policy if exists "Authenticated insert tours"       on public.tours;
drop policy if exists "Authenticated insert experiences" on public.experiences;

-- Best-effort: also drop policies that exist under the actual current names.
drop policy if exists "Insert transfers"   on public.transfers;
drop policy if exists "Insert tours"       on public.tours;
drop policy if exists "Insert experiences" on public.experiences;

-- Drop the actual policy names found in the database (pre-migration audit).
drop policy if exists "Auth users can create transfers"   on public.transfers;
drop policy if exists "Auth users can create tours"       on public.tours;
drop policy if exists "Auth users can create experiences" on public.experiences;

create policy "Anyone insert transfers"
  on public.transfers for insert
  to anon, authenticated
  with check (true);

create policy "Anyone insert tours"
  on public.tours for insert
  to anon, authenticated
  with check (true);

create policy "Anyone insert experiences"
  on public.experiences for insert
  to anon, authenticated
  with check (true);
