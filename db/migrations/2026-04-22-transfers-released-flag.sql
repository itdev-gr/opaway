-- Admin-first release gate: new bookings land in the admin dashboards and must
-- be explicitly released before drivers see them in /driver/available.
-- Idempotent; safe to re-run.

alter table public.transfers   add column if not exists released_to_drivers boolean default false;
alter table public.tours       add column if not exists released_to_drivers boolean default false;
alter table public.experiences add column if not exists released_to_drivers boolean default false;

-- Backfill existing rows to true so historical bookings stay visible to drivers.
update public.transfers   set released_to_drivers = true where released_to_drivers is not true;
update public.tours       set released_to_drivers = true where released_to_drivers is not true;
update public.experiences set released_to_drivers = true where released_to_drivers is not true;

-- From now on new rows default to false; release is explicit.
alter table public.transfers   alter column released_to_drivers set default false;
alter table public.tours       alter column released_to_drivers set default false;
alter table public.experiences alter column released_to_drivers set default false;

create index if not exists idx_transfers_released   on public.transfers(released_to_drivers);
create index if not exists idx_tours_released       on public.tours(released_to_drivers);
create index if not exists idx_experiences_released on public.experiences(released_to_drivers);
