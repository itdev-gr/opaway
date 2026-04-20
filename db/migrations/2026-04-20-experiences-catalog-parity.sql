-- Brings experiences_catalog to parity with tours_catalog:
-- per-vehicle pricing, duration label, and three highlight strings.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.experiences_catalog
  ADD COLUMN IF NOT EXISTS price_sedan   numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_van     numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_minibus numeric(10,2),
  ADD COLUMN IF NOT EXISTS duration      text,
  ADD COLUMN IF NOT EXISTS highlight1    text,
  ADD COLUMN IF NOT EXISTS highlight2    text,
  ADD COLUMN IF NOT EXISTS highlight3    text;

-- Back-fill per-vehicle pricing from the existing flat `price` column
-- so existing catalog rows produce a valid results page immediately.
UPDATE public.experiences_catalog
SET
  price_sedan   = COALESCE(price_sedan,   price),
  price_van     = COALESCE(price_van,     price),
  price_minibus = COALESCE(price_minibus, price)
WHERE price IS NOT NULL;

-- No index / RLS changes needed: `published` index (if any) and
-- existing RLS on experiences_catalog continue to apply.
