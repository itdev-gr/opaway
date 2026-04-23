-- Driver-writable remarks on each booking (F25).
--
-- `driver_notes` on transfers/tours/experiences has historically been used
-- for the CUSTOMER's comments at booking time (that's what the /driver/ride
-- page labels "Customer Comments"). Drivers had no column to store their
-- own notes on a ride (arrival condition, passenger behaviour, etc.).
-- Rather than rename driver_notes (which would require a data migration
-- and a simultaneous code flip), add a separate driver_remarks column so
-- the two concerns stay disjoint.
--
-- Idempotent.

alter table public.transfers
  add column if not exists driver_remarks text;

alter table public.tours
  add column if not exists driver_remarks text;

alter table public.experiences
  add column if not exists driver_remarks text;
