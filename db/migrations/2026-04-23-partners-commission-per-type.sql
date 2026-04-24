-- Per-booking-type commission amounts for hotel partners.
-- commission_eur (legacy, flat amount) stays in place as a fallback when a
-- type-specific column is null. Existing hotels get their current flat
-- amount copied to all four types so the dashboard doesn't zero out.
-- Idempotent.

alter table public.partners
  add column if not exists commission_transfer_eur   numeric(10,2),
  add column if not exists commission_hourly_eur     numeric(10,2),
  add column if not exists commission_tour_eur       numeric(10,2),
  add column if not exists commission_experience_eur numeric(10,2);

-- Backfill: for any hotel that has commission_eur set but no type-specific
-- values yet, copy commission_eur into each of the four columns. Null stays
-- null (no legacy value to carry forward).
update public.partners
set
  commission_transfer_eur   = coalesce(commission_transfer_eur,   commission_eur),
  commission_hourly_eur     = coalesce(commission_hourly_eur,     commission_eur),
  commission_tour_eur       = coalesce(commission_tour_eur,       commission_eur),
  commission_experience_eur = coalesce(commission_experience_eur, commission_eur)
where type = 'hotel' and commission_eur is not null;
