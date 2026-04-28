-- Hotel commission restructure.
-- Replaces 4 single-type EUR columns (commission_transfer_eur, _hourly_eur, _tour_eur,
-- _experience_eur) with a richer structure: per-vehicle EUR for transfers and per-type
-- percentages for hourly/tour/experience. Old columns are kept as deprecated for
-- historical data; nothing reads them after this migration.
-- Idempotent.

alter table public.partners
  add column if not exists commission_transfer_sedan_eur   numeric(10,2),
  add column if not exists commission_transfer_van_eur     numeric(10,2),
  add column if not exists commission_transfer_minibus_eur numeric(10,2),
  add column if not exists commission_hourly_pct           numeric(5,2),
  add column if not exists commission_tour_pct             numeric(5,2),
  add column if not exists commission_experience_pct       numeric(5,2);

-- Backfill: hotels that had a flat transfer EUR get it copied to all 3 vehicle slots.
-- Operators can refine per-vehicle in the admin UI afterwards.
update public.partners
set commission_transfer_sedan_eur   = coalesce(commission_transfer_sedan_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0),
    commission_transfer_van_eur     = coalesce(commission_transfer_van_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0),
    commission_transfer_minibus_eur = coalesce(commission_transfer_minibus_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0)
where type = 'hotel';

-- Percentage columns: there's no clean way to convert EUR → %, so they stay NULL/0
-- until the operator sets them in the UI. The new resolver treats null/missing as 0%.
