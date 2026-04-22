-- Allow authenticated users to read their own requests (contact messages +
-- experience requests) so the /profile/experiences page can list them.
-- Matches on user_id or email so rows submitted before login (anon form)
-- that carry the user's email still surface once they create an account.
-- Idempotent.

drop policy if exists "Users can read own requests" on public.requests;
create policy "Users can read own requests"
  on public.requests for select
  using (
    (user_id is not null and user_id = auth.uid())
    or (auth.jwt() ->> 'email' is not null and email = (auth.jwt() ->> 'email'))
  );
