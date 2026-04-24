alter table public.tours
  add column if not exists entrance_tickets_count integer not null default 0,
  add column if not exists entrance_tickets_total numeric not null default 0;
