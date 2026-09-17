-- Google reviews, approved one by one before they reach the site (2026-09-17)
--
-- The client wants the reviews from their Google Business Profile on the
-- homepage, but every new review has to be approved in the admin panel first.
-- A daily sync (Vercel cron → /api/admin/sync-google-reviews, service role)
-- pulls the latest reviews from the Places API and inserts unseen ones as
-- 'pending'. The admin flips them to 'approved' or 'hidden'. The public site
-- reads approved rows only, through get_public_reviews().
--
-- dedupe_key is computed in src/lib/google-reviews.ts from the author's
-- Google contributor id + publish time, because the two Places endpoints
-- (legacy "newest" and New "most relevant") share no review id.
--
-- Posture: the tables are admin-only under RLS. There is deliberately no
-- public SELECT policy; the two RPCs below are the only public window and
-- expose approved rows / the aggregate figures, never status or raw payloads.
-- Idempotent: safe to re-run.

-- ── 1. Reviews ───────────────────────────────────────────────────────────────

create table if not exists public.google_reviews (
  id uuid primary key default uuid_generate_v4(),
  dedupe_key text not null unique,
  author_name text not null,
  author_url text,
  author_photo_url text,
  rating smallint not null check (rating between 1 and 5),
  text text not null default '',
  language text,
  published_at timestamptz not null,
  google_maps_uri text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'hidden')),
  status_changed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create index if not exists google_reviews_status_published
  on public.google_reviews (status, published_at desc);

alter table public.google_reviews enable row level security;

drop policy if exists "Admins manage google_reviews" on public.google_reviews;
create policy "Admins manage google_reviews" on public.google_reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 2. Aggregate figures + sync bookkeeping (single row, id = 1) ────────────

create table if not exists public.google_reviews_meta (
  id int primary key default 1 check (id = 1),
  rating numeric,
  user_ratings_total int,
  place_name text,
  place_url text,
  last_sync_at timestamptz,
  last_sync_error text,
  last_sync_new int not null default 0
);

insert into public.google_reviews_meta (id) values (1) on conflict (id) do nothing;

alter table public.google_reviews_meta enable row level security;

drop policy if exists "Admins manage google_reviews_meta" on public.google_reviews_meta;
create policy "Admins manage google_reviews_meta" on public.google_reviews_meta
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 3. Public read RPCs ─────────────────────────────────────────────────────

create or replace function public.get_public_reviews(p_limit int default 12)
returns table (
  author_name text,
  author_photo_url text,
  author_url text,
  rating smallint,
  text text,
  language text,
  published_at timestamptz,
  google_maps_uri text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.author_name, r.author_photo_url, r.author_url, r.rating, r.text,
         r.language, r.published_at, r.google_maps_uri
  from public.google_reviews r
  where r.status = 'approved'
  order by r.published_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

grant execute on function public.get_public_reviews(int) to anon, authenticated;

create or replace function public.get_public_reviews_meta()
returns table (rating numeric, user_ratings_total int, place_url text, approved_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.rating, m.user_ratings_total, m.place_url,
         (select count(*) from public.google_reviews where status = 'approved') as approved_count
  from public.google_reviews_meta m
  where m.id = 1;
$$;

grant execute on function public.get_public_reviews_meta() to anon, authenticated;

-- ── 4. Realtime, so the admin sidebar badge updates after a sync ────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'google_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.google_reviews';
  end if;
end $$;
