-- Tours catalog: add category, entrance tickets, hotel option, image gallery.
-- Per-vehicle pricing (price_sedan/price_van/price_minibus) and duration/highlights
-- already exist live; this migration only adds the new fields.
-- Idempotent.

alter table public.tours_catalog
  add column if not exists category text
    check (category in ('day-tour', 'multiday-tour', 'experience-single', 'experience-multi')) default 'day-tour',
  add column if not exists entrance_ticket_per_person numeric(10,2) default 0,
  add column if not exists entrance_ticket_count int default 0,
  add column if not exists hotel_option text
    check (hotel_option in ('none', 'self-book', 'include-booking')) default 'none',
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Backfill the images array from any pre-existing single image_url so existing
-- catalog rows keep their cover image.
update public.tours_catalog
set images = jsonb_build_array(image_url)
where (images = '[]'::jsonb or images is null)
  and image_url is not null
  and image_url <> '';

-- Same fields on the experiences catalog for parity (experiences already have
-- per-vehicle pricing + highlights from an earlier migration).
alter table public.experiences_catalog
  add column if not exists category text
    check (category in ('day-tour', 'multiday-tour', 'experience-single', 'experience-multi')) default 'experience-single',
  add column if not exists entrance_ticket_per_person numeric(10,2) default 0,
  add column if not exists entrance_ticket_count int default 0,
  add column if not exists hotel_option text
    check (hotel_option in ('none', 'self-book', 'include-booking')) default 'none',
  add column if not exists images jsonb not null default '[]'::jsonb;

update public.experiences_catalog
set images = jsonb_build_array(image_url)
where (images = '[]'::jsonb or images is null)
  and image_url is not null
  and image_url <> '';
