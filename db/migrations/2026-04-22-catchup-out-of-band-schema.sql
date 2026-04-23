-- ============================================================
-- Catch-up migration: tables + columns added to production out-of-band
-- (via Supabase dashboard or earlier SQL not captured in this repo).
-- Idempotent. If this file runs against prod it's a no-op.
-- Captures:
--   * partners columns: country, zip_code, mite_number
--   * billing_reports table + RLS
--   * driver_staff table + RLS
--   * driver_vehicles table + RLS  (columns added in other migrations are
--     safe to re-run since they're all IF NOT EXISTS)
--   * payment_data table + RLS
--   * pricing table + RLS
-- ============================================================

-- Helper functions is_admin() + is_approved_driver() are already created in
-- supabase-migration.sql — don't redeclare here.

-- ------------------------------------------------------------
-- partners: extra profile columns
-- ------------------------------------------------------------
alter table public.partners
  add column if not exists country     text,
  add column if not exists zip_code    text,
  add column if not exists mite_number text;

-- ------------------------------------------------------------
-- billing_reports
-- ------------------------------------------------------------
create table if not exists public.billing_reports (
  id          uuid primary key default uuid_generate_v4(),
  partner_id  uuid not null references auth.users(id) on delete cascade,
  month       integer not null,
  year        integer not null,
  amount      numeric default 0,
  status      text default 'pending' check (status in ('pending', 'paid')),
  report_url  text default '',
  invoice_url text default '',
  created_at  timestamptz not null default now()
);
alter table public.billing_reports enable row level security;
do $$ begin
  drop policy if exists "Drivers can read own billing"   on public.billing_reports;
  drop policy if exists "Admins full access billing"     on public.billing_reports;
exception when undefined_object then null; end $$;
create policy "Drivers can read own billing"
  on public.billing_reports for select using (partner_id = auth.uid());
create policy "Admins full access billing"
  on public.billing_reports for all using (public.is_admin());

-- ------------------------------------------------------------
-- driver_staff (sub-drivers working under a driver partner)
-- ------------------------------------------------------------
create table if not exists public.driver_staff (
  id          uuid primary key default uuid_generate_v4(),
  partner_id  uuid not null references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text default '',
  email       text default '',
  languages   text default '',
  status      text default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now()
);
alter table public.driver_staff enable row level security;
do $$ begin
  drop policy if exists "Drivers can manage own staff"      on public.driver_staff;
  drop policy if exists "Admins full access driver_staff"   on public.driver_staff;
exception when undefined_object then null; end $$;
create policy "Drivers can manage own staff"
  on public.driver_staff for all using (partner_id = auth.uid());
create policy "Admins full access driver_staff"
  on public.driver_staff for all using (public.is_admin());

-- ------------------------------------------------------------
-- driver_vehicles (driver's fleet). Base table definition; the column
-- extensions in 2026-04-22-driver-vehicles-rls.sql and
-- 2026-04-22-vehicles-missing-columns.sql / plate-unique.sql compose
-- on top of this — all IF NOT EXISTS, safe to reorder.
-- ------------------------------------------------------------
create table if not exists public.driver_vehicles (
  id             uuid primary key default uuid_generate_v4(),
  partner_id     uuid not null references auth.users(id) on delete cascade,
  brand          text not null default '',
  model          text not null default '',
  year           text default '',
  color          text default '',
  category       text default 'sedan' check (category in ('sedan', 'van', 'minibus')),
  max_passengers integer default 4,
  max_luggage    integer default 4,
  plate          text default '',
  image_url      text default '',
  insurance_url  text default '',
  status         text default 'active' check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now()
);
alter table public.driver_vehicles enable row level security;
do $$ begin
  drop policy if exists "Drivers can manage own vehicles"      on public.driver_vehicles;
  drop policy if exists "Admins full access driver_vehicles"   on public.driver_vehicles;
exception when undefined_object then null; end $$;
create policy "Drivers can manage own vehicles"
  on public.driver_vehicles for all using (partner_id = auth.uid());
create policy "Admins full access driver_vehicles"
  on public.driver_vehicles for all using (public.is_admin());

-- ------------------------------------------------------------
-- payment_data (one row per partner, unique partner_id)
-- ------------------------------------------------------------
create table if not exists public.payment_data (
  id                uuid primary key default uuid_generate_v4(),
  partner_id        uuid not null unique references auth.users(id) on delete cascade,
  payment_method    text default 'bank' check (payment_method in ('bank', 'stripe')),
  bank_name         text default '',
  iban              text default '',
  swift             text default '',
  stripe_account_id text default '',
  created_at        timestamptz not null default now()
);
alter table public.payment_data enable row level security;
do $$ begin
  drop policy if exists "Drivers can manage own payment data"  on public.payment_data;
  drop policy if exists "Admins full access payment_data"      on public.payment_data;
exception when undefined_object then null; end $$;
create policy "Drivers can manage own payment data"
  on public.payment_data for all using (partner_id = auth.uid());
create policy "Admins full access payment_data"
  on public.payment_data for all using (public.is_admin());

-- ------------------------------------------------------------
-- pricing (platform-wide per-vehicle-type rates, one row per region/tier).
-- Public read so the booking pages can price without auth; admin write.
-- ------------------------------------------------------------
create table if not exists public.pricing (
  id            text primary key,
  sedan         numeric not null default 0,
  van           numeric not null default 0,
  minibus       numeric not null default 0,
  sedan_night   numeric not null default 0,
  van_night     numeric not null default 0,
  minibus_night numeric not null default 0
);
alter table public.pricing enable row level security;
do $$ begin
  drop policy if exists "Public read pricing" on public.pricing;
  drop policy if exists "Admin update pricing" on public.pricing;
exception when undefined_object then null; end $$;
create policy "Public read pricing"
  on public.pricing for select using (true);
create policy "Admin update pricing"
  on public.pricing for update using (
    exists (select 1 from public.users where users.id = auth.uid() and users.type = 'admin')
  );
