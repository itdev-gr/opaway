-- Adds experience-specific columns to the `requests` table so the public
-- Experiences page can send request rows that the admin dashboard
-- differentiates from tour / contact requests.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS experience_id   text,
  ADD COLUMN IF NOT EXISTS experience_name text;
