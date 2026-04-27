-- Audit columns for admin driver assignment.
-- Records WHO assigned the driver and WHEN. Both nullable so existing rows
-- (and rides assigned via driver-self-accept in /driver/available) just have
-- the timestamps set by the new admin flow; legacy data is left untouched.
-- Idempotent.

alter table public.transfers
  add column if not exists driver_assigned_at timestamptz,
  add column if not exists driver_assigned_by uuid references auth.users(id);

alter table public.tours
  add column if not exists driver_assigned_at timestamptz,
  add column if not exists driver_assigned_by uuid references auth.users(id);

alter table public.experiences
  add column if not exists driver_assigned_at timestamptz,
  add column if not exists driver_assigned_by uuid references auth.users(id);
