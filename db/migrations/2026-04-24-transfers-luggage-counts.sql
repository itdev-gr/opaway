-- Luggage counts for transfer + hourly bookings. Two integer counts
-- (small carry-on vs big checked). Collected via a +/- counter widget
-- at the first booking step. Idempotent.

alter table public.transfers
  add column if not exists luggage_small integer not null default 0,
  add column if not exists luggage_big   integer not null default 0;

-- No backfill: existing rows stay at 0, which matches the UX of
-- "customer didn't specify" for legacy bookings.
