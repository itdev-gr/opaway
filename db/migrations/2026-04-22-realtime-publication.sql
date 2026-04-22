-- Enable Supabase Realtime on the tables the sidebar badges subscribe to.
-- Without this, `supabase.channel(...).on('postgres_changes', ...)` receives
-- no events and the admin / driver / hotel / agency badges stay stale until
-- the page is refreshed (finding F18).
--
-- Idempotent via a loop — alter publication add table doesn't support IF NOT
-- EXISTS, so we check pg_publication_tables first.

do $$
declare
  t text;
begin
  foreach t in array array['requests','transfers','tours','experiences','partners']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
