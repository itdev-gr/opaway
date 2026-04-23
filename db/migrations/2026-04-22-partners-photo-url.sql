-- Partner avatar / logo support (F36): hotels, agencies, and drivers can now
-- upload a logo on their profile page, stored in the images bucket. The URL
-- lands in partners.photo_url (mirrors the column that already exists on
-- public.users for regular users).
-- Idempotent.

alter table public.partners
  add column if not exists photo_url text;
