-- Prevent duplicate plate registrations per partner on driver_vehicles (F29).
-- A driver can't physically have two vehicles with the same plate; without
-- this guard the form silently accepted duplicates which would cause
-- dispatching conflicts when admin assigns a ride by plate.
--
-- Scope is (partner_id, plate) rather than a global UNIQUE(plate) so that a
-- plate collision across two different driver partners doesn't block real
-- registrations while we migrate. The client-side add-vehicle form now
-- surfaces the resulting 23505 error via the error-code surfacing added in
-- 8a322ec.
--
-- Idempotent.

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'driver_vehicles'
      and indexname = 'driver_vehicles_partner_plate_unique'
  ) then
    execute 'create unique index driver_vehicles_partner_plate_unique
             on public.driver_vehicles(partner_id, plate)
             where plate is not null and plate <> ''''';
  end if;
end $$;
