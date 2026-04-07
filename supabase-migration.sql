-- ============================================================
-- OPAWAY: Full Supabase Schema Migration
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- =============================================
-- TABLE: users (linked to auth.users)
-- =============================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  provider text default 'email',
  type text not null default 'user' check (type in ('admin', 'driver', 'user')),
  photo_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================
-- TABLE: partners (hotel, agency, driver profiles)
-- =============================================
create table public.partners (
  id uuid primary key references auth.users(id) on delete cascade,
  uid text not null default '',
  email text not null default '',
  display_name text,
  type text not null check (type in ('hotel', 'agency', 'driver')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  provider text default 'email',
  discount numeric default 0,
  -- Shared fields
  vat text,
  location text,
  website text,
  contact_name text,
  contact_phone text,
  contact_email text,
  -- Hotel fields
  hotel_name text,
  hotel_type text,
  business_phone text,
  business_email text,
  -- Agency fields
  agency_name text,
  agency_type text,
  agency_phone text,
  agency_email text,
  -- Driver fields
  full_name text,
  phone text,
  num_vehicles text,
  primary_car_type text,
  car_types text[] default '{}',
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: transfers (booking collection)
-- =============================================
create table public.transfers (
  id uuid primary key default uuid_generate_v4(),
  uid uuid references auth.users(id) on delete set null,
  "from" text not null default '',
  "to" text not null default '',
  date text not null default '',
  time text default '',
  passengers int default 1,
  return_date text,
  return_time text,
  vehicle_slug text default '',
  vehicle_name text default '',
  first_name text default '',
  last_name text default '',
  email text default '',
  phone text default '',
  sign_name text,
  child_seats int default 0,
  driver_notes text,
  total_price numeric default 0,
  base_price numeric default 0,
  outward_price numeric default 0,
  return_price numeric default 0,
  card_surcharge numeric default 0,
  ride_status text not null default 'new' check (ride_status in ('new', 'assigned', 'pickup', 'onboard', 'completed', 'cancelled')),
  payment_status text default 'pending' check (payment_status in ('pending', 'paid')),
  payment_method text default 'cash',
  payment_token text,
  driver text default '',
  driver_uid text default '',
  notes text default '',
  added_by_admin boolean default false,
  booking_type text default 'transfer',
  hours int,
  per_hour numeric,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: tours (tour booking collection)
-- =============================================
create table public.tours (
  id uuid primary key default uuid_generate_v4(),
  uid uuid references auth.users(id) on delete set null,
  name text default '',
  email text default '',
  phone text default '',
  tour text default '',
  tour_id text,
  tour_name text,
  pickup text default '',
  pickup_location text default '',
  destination text default '',
  date text not null default '',
  time text default '',
  passengers int default 1,
  participants int,
  vehicle text default '',
  vehicle_name text default '',
  special_requests text,
  notes text default '',
  total_price numeric default 0,
  ride_status text not null default 'new',
  payment_status text default 'pending',
  payment_method text default '',
  driver text default '',
  driver_uid text default '',
  added_by_admin boolean default false,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: experiences (experience booking collection)
-- =============================================
create table public.experiences (
  id uuid primary key default uuid_generate_v4(),
  uid uuid references auth.users(id) on delete set null,
  name text default '',
  email text default '',
  phone text default '',
  experience text default '',
  experience_id text,
  experience_name text,
  pickup text default '',
  pickup_location text default '',
  destination text default '',
  date text not null default '',
  time text default '',
  passengers int default 1,
  participants int,
  guests int,
  vehicle text default '',
  vehicle_name text default '',
  notes text default '',
  total_price numeric default 0,
  ride_status text not null default 'new',
  payment_status text default 'pending',
  payment_method text default '',
  driver text default '',
  driver_uid text default '',
  added_by_admin boolean default false,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: transfers_catalog
-- =============================================
create table public.transfers_catalog (
  id uuid primary key default uuid_generate_v4(),
  title text not null default '',
  description text default '',
  price numeric default 0,
  image_url text default '',
  published boolean default true,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: tours_catalog
-- =============================================
create table public.tours_catalog (
  id uuid primary key default uuid_generate_v4(),
  title text not null default '',
  description text default '',
  price numeric default 0,
  duration text default '',
  highlight1 text default '',
  highlight2 text default '',
  highlight3 text default '',
  image_url text default '',
  published boolean default true,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: experiences_catalog
-- =============================================
create table public.experiences_catalog (
  id uuid primary key default uuid_generate_v4(),
  title text not null default '',
  description text default '',
  price numeric default 0,
  image_url text default '',
  published boolean default true,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: requests (contact form + tour requests)
-- =============================================
create table public.requests (
  id uuid primary key default uuid_generate_v4(),
  source text default 'contact',
  status text default 'new',
  -- Contact form fields
  name text default '',
  email text default '',
  subject text default '',
  message text default '',
  -- Tour/experience request fields
  tour_id text,
  tour_name text,
  pickup_location text,
  date text,
  time text,
  participants int,
  phone text,
  contact_info text,
  special_requests text,
  -- User context
  user_id uuid references auth.users(id) on delete set null,
  user_display_name text,
  user_email text,
  created_at timestamptz not null default now()
);

-- =============================================
-- TABLE: vehicles
-- =============================================
create table public.vehicles (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null default '',
  type text default '',
  slug text default '',
  max_passengers int default 4,
  image_url text default '',
  description text default '',
  is_platform boolean default false,
  published boolean default true,
  created_at timestamptz not null default now()
);

-- =============================================
-- INDEXES
-- =============================================
create index idx_users_type on users(type);
create index idx_partners_type_status on partners(type, status);
create index idx_transfers_uid on transfers(uid);
create index idx_transfers_driver_uid on transfers(driver_uid);
create index idx_transfers_ride_status on transfers(ride_status);
create index idx_transfers_created_at on transfers(created_at desc);
create index idx_tours_uid on tours(uid);
create index idx_tours_created_at on tours(created_at desc);
create index idx_experiences_uid on experiences(uid);
create index idx_experiences_created_at on experiences(created_at desc);
create index idx_requests_created_at on requests(created_at desc);
create index idx_vehicles_slug on vehicles(slug);

-- =============================================
-- RLS: Enable on all tables
-- =============================================
alter table public.users enable row level security;
alter table public.partners enable row level security;
alter table public.transfers enable row level security;
alter table public.tours enable row level security;
alter table public.experiences enable row level security;
alter table public.transfers_catalog enable row level security;
alter table public.tours_catalog enable row level security;
alter table public.experiences_catalog enable row level security;
alter table public.requests enable row level security;
alter table public.vehicles enable row level security;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and type = 'admin'
  );
$$ language sql security definer stable;

create or replace function public.is_approved_driver()
returns boolean as $$
  select exists (
    select 1 from public.partners
    where id = auth.uid() and type = 'driver' and status = 'approved'
  );
$$ language sql security definer stable;

-- =============================================
-- RLS POLICIES: users
-- =============================================
create policy "Users can read own profile"
  on public.users for select using (id = auth.uid());
create policy "Users can insert own profile"
  on public.users for insert with check (id = auth.uid());
create policy "Users can update own profile"
  on public.users for update using (id = auth.uid());
create policy "Admins full read on users"
  on public.users for select using (public.is_admin());
create policy "Admins full write on users"
  on public.users for update using (public.is_admin());

-- =============================================
-- RLS POLICIES: partners
-- =============================================
create policy "Partners can read own record"
  on public.partners for select using (id = auth.uid());
create policy "Partners can create own record"
  on public.partners for insert with check (id = auth.uid());
create policy "Partners can update own record"
  on public.partners for update using (id = auth.uid());
create policy "Admins full read on partners"
  on public.partners for select using (public.is_admin());
create policy "Admins full write on partners"
  on public.partners for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: transfers
-- =============================================
create policy "Auth users can create transfers"
  on public.transfers for insert with check (auth.uid() is not null);
create policy "Users can read own transfers"
  on public.transfers for select using (uid = auth.uid());
create policy "Drivers can read available or assigned transfers"
  on public.transfers for select using (
    public.is_approved_driver() and (
      driver_uid = auth.uid()::text or driver_uid is null or driver_uid = ''
    )
  );
create policy "Drivers can update assigned transfers"
  on public.transfers for update using (
    public.is_approved_driver() and driver_uid = auth.uid()::text
  );
create policy "Drivers can claim unassigned transfers"
  on public.transfers for update using (
    public.is_approved_driver() and (driver_uid is null or driver_uid = '')
  );
create policy "Admins full access transfers"
  on public.transfers for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: tours
-- =============================================
create policy "Auth users can create tours"
  on public.tours for insert with check (auth.uid() is not null);
create policy "Users can read own tours"
  on public.tours for select using (uid = auth.uid());
create policy "Drivers can read available or assigned tours"
  on public.tours for select using (
    public.is_approved_driver() and (
      driver_uid = auth.uid()::text or driver_uid is null or driver_uid = ''
    )
  );
create policy "Drivers can update assigned tours"
  on public.tours for update using (
    public.is_approved_driver() and driver_uid = auth.uid()::text
  );
create policy "Drivers can claim unassigned tours"
  on public.tours for update using (
    public.is_approved_driver() and (driver_uid is null or driver_uid = '')
  );
create policy "Admins full access tours"
  on public.tours for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: experiences
-- =============================================
create policy "Auth users can create experiences"
  on public.experiences for insert with check (auth.uid() is not null);
create policy "Users can read own experiences"
  on public.experiences for select using (uid = auth.uid());
create policy "Drivers can read available or assigned experiences"
  on public.experiences for select using (
    public.is_approved_driver() and (
      driver_uid = auth.uid()::text or driver_uid is null or driver_uid = ''
    )
  );
create policy "Drivers can update assigned experiences"
  on public.experiences for update using (
    public.is_approved_driver() and driver_uid = auth.uid()::text
  );
create policy "Drivers can claim unassigned experiences"
  on public.experiences for update using (
    public.is_approved_driver() and (driver_uid is null or driver_uid = '')
  );
create policy "Admins full access experiences"
  on public.experiences for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: catalogs (public read, admin write)
-- =============================================
create policy "Public read transfers_catalog"
  on public.transfers_catalog for select using (true);
create policy "Admins write transfers_catalog"
  on public.transfers_catalog for all using (public.is_admin());

create policy "Public read tours_catalog"
  on public.tours_catalog for select using (true);
create policy "Admins write tours_catalog"
  on public.tours_catalog for all using (public.is_admin());

create policy "Public read experiences_catalog"
  on public.experiences_catalog for select using (true);
create policy "Admins write experiences_catalog"
  on public.experiences_catalog for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: requests (public create, admin read/write)
-- =============================================
create policy "Anyone can create requests"
  on public.requests for insert with check (true);
create policy "Admins full access requests"
  on public.requests for all using (public.is_admin());

-- =============================================
-- RLS POLICIES: vehicles (public read, owner/admin write)
-- =============================================
create policy "Public read vehicles"
  on public.vehicles for select using (true);
create policy "Auth users can create vehicles"
  on public.vehicles for insert with check (auth.uid() is not null);
create policy "Owners and admins can update vehicles"
  on public.vehicles for update using (owner_id = auth.uid() or public.is_admin());
create policy "Owners and admins can delete vehicles"
  on public.vehicles for delete using (owner_id = auth.uid() or public.is_admin());
