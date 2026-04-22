-- Bring public.vehicles in line with what the /admin/manage-vehicles form
-- was already trying to write: models (comma-separated list shown on the
-- card), max_luggage, badge label, and sort_order for grid ordering.
-- Idempotent.

alter table public.vehicles
  add column if not exists models      text,
  add column if not exists max_luggage integer,
  add column if not exists badge       text,
  add column if not exists sort_order  integer not null default 0;

create index if not exists idx_vehicles_sort_order on public.vehicles(sort_order);
