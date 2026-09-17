-- Google reviews: full admin control (2026-09-17, follow-up)
--
-- The admin can now also delete a review (to a trash status, so the daily
-- sync does not bring it straight back), restore it, delete it for good, and
-- pin approved reviews to the top of the homepage section.
--
--   status 'deleted' — in the trash; never shown, never touched by the sync
--   featured         — approved + featured rows come first on the site
--
-- Idempotent: safe to re-run.

alter table public.google_reviews drop constraint if exists google_reviews_status_check;
alter table public.google_reviews
  add constraint google_reviews_status_check
  check (status in ('pending', 'approved', 'hidden', 'deleted'));

alter table public.google_reviews add column if not exists featured boolean not null default false;

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
  order by r.featured desc, r.published_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

grant execute on function public.get_public_reviews(int) to anon, authenticated;
