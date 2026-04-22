-- Hotels get a per-EUR commission amount (flat per-booking) independent of the
-- percentage discount used by agencies. Leave null by default so admins set it
-- explicitly per hotel.
-- Idempotent.

alter table public.partners
  add column if not exists commission_eur numeric(10,2);
