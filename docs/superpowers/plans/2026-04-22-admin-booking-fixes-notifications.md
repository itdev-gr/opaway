# OPAWAY — Admin Console, Booking Fixes & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client feedback from `OPAWEY Website testing 20260421.docx` — specifically Section 3 (Admin Console) and Section 4 (Testing Bookings) — plus a red-badge notification system for all dashboards.

**Architecture:** Astro 5 (file-based routing, SSR-ready) + Supabase (Postgres + Auth + Storage + Realtime) + Tailwind v4. Booking saves go straight from the browser to Supabase via the JS client, so fixes land in `src/pages/book/**/payment.astro` and in Postgres RLS. Catalog edits and admin dashboards are Astro pages under `src/pages/admin/**` driven by Supabase tables. Notifications are computed client-side from existing status columns (`ride_status='new'`, `partners.status='pending'`, `requests.status='new'`), injected into each layout sidebar, and refreshed via Supabase Realtime.

**Tech Stack:** Astro 5, Supabase JS v2 (`@supabase/supabase-js`), Tailwind v4, Stripe JS, Google Maps Places, Supabase Storage (bucket `images`).

**Reference files (absolute paths):**
- Booking insert bugs: `src/pages/book/tour/payment.astro`, `src/pages/book/transfer/payment.astro`, `src/pages/book/hourly/payment.astro`
- Reference fix: `src/pages/book/experience/payment.astro` (commit `1d2759d` — already-applied pattern)
- Admin dashboards: `src/pages/admin/{transfers,tours,experiences,partners,manage-tours,manage-experiences,manage-vehicles,requests}.astro`
- Layouts: `src/components/{AdminLayout,DriverLayout,HotelLayout,AgencyLayout}.astro`
- Driver pages: `src/pages/driver/{available,vehicles}.astro`
- Hotel/Agency roll-ups: `src/pages/{hotel,agency}/index.astro`
- Schema: `supabase-migration.sql` + `db/migrations/*.sql` (repo is behind live DB — `partner_id` and `driver_vehicles` already exist on production but are not in the committed SQL)
- Lib: `src/lib/{supabase.ts,upload.ts,userSupabase.ts,form-errors.ts}`

**Non-goals (explicitly out of scope):**
- Redesigning the public Home page (Section 1 of the docx).
- Rewriting the `/experiences` request-only flow (Section 2 — already done in commit `c7b4ec9`).
- Building a server-side admin API — everything stays in the Astro client with Supabase RLS.
- Reworking Stripe from token-charge (legacy) to Payment Intents.

---

## Root-Cause Summary (verified)

The client's four repro reports collapse into **three** underlying bugs:

1. **Tour booking always fails** — every user type, every payment method. Root cause: `src/pages/book/tour/payment.astro:408-428` inserts `first_name`, `last_name` into the `tours` table, which only has a single `name` column. Supabase rejects unknown columns with `PGRST204`. Same fix pattern as commit `1d2759d` on `src/pages/book/experience/payment.astro`.
2. **Client (unauthenticated) transfer/hourly fails** — but authenticated partners (agency/hotel/driver) succeed. Root cause: the RLS policy `Auth users can create transfers` (`supabase-migration.sql:338-339`) requires `auth.uid() is not null`. The booking funnel currently lets anonymous visitors reach `payment.astro` without logging in, so the anon Supabase client's insert is blocked. Fix: require login before reaching the payment step (redirect to `/login?next=...`) — safer than loosening RLS, keeps the `uid` link on bookings meaningful.
3. **Driver add-vehicle silently fails** — the form posts to the `driver_vehicles` table, which likely has RLS denying inserts from partners, or a required column missing. Needs one direct insert attempt with error capture to confirm, then RLS/schema fix.

Additional schema/UX work (Section 3) is independent of the bugs above.

---

## File Structure

### New files
| Path | Responsibility |
|------|----------------|
| `db/migrations/2026-04-22-tours-catalog-categories.sql` | Add `category`, `entrance_ticket_per_person`, `entrance_ticket_count`, `hotel_option`, `images jsonb` to `tours_catalog`; parity columns to `experiences_catalog` where missing |
| `db/migrations/2026-04-22-partners-commission-eur.sql` | Add `commission_eur numeric` on `partners` for per-EUR hotel commission |
| `db/migrations/2026-04-22-transfers-released-flag.sql` | Add `released_to_drivers boolean default false` on `transfers`, `tours`, `experiences`; backfill existing rows to `true` so nothing is hidden retroactively |
| `db/migrations/2026-04-22-driver-vehicles-rls.sql` | Confirm `driver_vehicles` table schema + RLS so approved drivers can CRUD their own vehicles |
| `src/lib/notifications.ts` | Shared notification-count helper for all sidebars (counts `ride_status='new'`, `status='pending'`, `status='new'` across tables; subscribes via Realtime) |
| `src/components/SidebarBadge.astro` | Reusable red badge component rendered inside each sidebar `<a>` |
| `src/components/ReservationDetailModal.astro` | Shared admin modal showing full reservation info (notes, driver notes, special requests, payment method, price) |
| `src/components/PartnerDetailModal.astro` | Shared admin modal showing full partner info (payment data, discount/commission, contacts) |

### Modified files
| Path | Change |
|------|--------|
| `src/pages/book/tour/payment.astro` | Align insert to `tours` schema (drop `first_name`/`last_name`, add `tour`, `vehicle`, `special_requests`) |
| `src/pages/book/transfer/payment.astro` | Require auth before save; redirect to `/login?next=...` if anonymous |
| `src/pages/book/hourly/payment.astro` | Same auth gate as transfer |
| `src/pages/book/transfer/passenger.astro`, `src/pages/book/tour/passenger.astro`, `src/pages/book/hourly/passenger.astro` | Early auth gate (redirect before collecting PII) |
| `src/pages/admin/manage-tours.astro` | Tour catalog form: category dropdown, per-vehicle pricing (Sedan 1-3 / Van 4-7 / Minibus 8-20), entrance ticket field, multi-image upload (file + URL paste), multi-day hotel option |
| `src/pages/admin/manage-experiences.astro` | Mirror the new upload UX for parity |
| `src/pages/admin/transfers.astro` | Click a row → open `ReservationDetailModal` showing notes + payment method + full payload |
| `src/pages/admin/tours.astro` | Same modal for tours |
| `src/pages/admin/experiences.astro` | Same modal for experiences |
| `src/pages/admin/partners.astro` | Click a row → open `PartnerDetailModal`; hotel commission edit as EUR amount not `%` |
| `src/pages/hotel/index.astro` | Commission column uses `partners.commission_eur` (EUR) not `discount` (%) |
| `src/components/AdminLayout.astro` | Sidebar items render notification badges; wired to `src/lib/notifications.ts` |
| `src/components/DriverLayout.astro` | Sidebar notification badge on "Available Rides" |
| `src/components/HotelLayout.astro` | Sidebar notification badge on "Reservations" |
| `src/components/AgencyLayout.astro` | Sidebar notification badge on "Reservations" |
| `src/pages/driver/available.astro` | Filter adds `released_to_drivers = true` |
| `src/pages/driver/vehicles.astro` | Error bubble-up: display `err.code` + `err.message` in status pill, and trim optional fields correctly |
| `src/pages/admin/transfers.astro` | New "Release to drivers" action on each row (toggles `released_to_drivers`) |

---

## Self-Review Protocol

After implementing each Task, the engineer must:
1. Run the task's acceptance test (listed per task).
2. Stage only the files the task touched.
3. Commit with the exact message in the task's final step.
4. Move on — never batch multiple tasks into one commit.

---

# PART A — Section 4 fixes (Booking save failures)

## Task 1: Fix tour booking save (align insert to `tours` schema)

**Files:**
- Modify: `src/pages/book/tour/payment.astro:408-428`

- [ ] **Step 1: Capture current failure**

Run the dev server (`npm run dev`), navigate to `/book/tour/` → pick a tour → fill passenger details → pick "Cash on arrival" payment → click Complete. Confirm the error banner reads "Failed to save booking. Please try again." Open DevTools → Network → inspect the failed Supabase call; the response body should contain a reference to `first_name` or `last_name` being an unknown column. Note the `code` field (expect `PGRST204` or `42703`). Save screenshot to `qa/tour-book-fail-before.png`.

- [ ] **Step 2: Edit the insert payload**

Replace lines 408-428 of `src/pages/book/tour/payment.astro` with:

```ts
const { data: inserted, error } = await supabase.from('tours').insert({
    tour: tourName,
    tour_id: tourId,
    tour_name: tourName,
    pickup: pickup,
    pickup_location: pickup,
    destination: tourName,
    date, time,
    passengers: parseInt(participants, 10),
    participants: parseInt(participants, 10),
    vehicle: vehicleName,
    vehicle_name: vehicleName,
    name: `${firstName} ${lastName}`.trim(),
    email, phone,
    special_requests: driverNotes || null,
    notes: driverNotes || null,
    total_price: finalTotal,
    ride_status: 'new',
    payment_status: paymentMethod === 'stripe' ? 'paid' : 'pending',
    payment_method: paymentMethod,
    uid: user?.id || null,
    partner_id: partnerId,
    added_by_admin: false,
}).select().single();
```

Rationale: `first_name`/`last_name`/`payment_token` don't exist on `tours` (confirmed against `supabase-migration.sql:106-134`). `tour`, `vehicle`, `special_requests` do and are needed so the admin list can show them.

- [ ] **Step 3: Re-run the same booking flow**

Run the same repro as Step 1 while logged in as an approved partner (or admin). Expect the success panel to render with a reference ID. Confirm the row exists:

```bash
# Use supabase dashboard SQL editor or local psql
select id, tour, name, payment_method, ride_status, total_price, created_at from public.tours order by created_at desc limit 3;
```

Save screenshot `qa/tour-book-fail-after.png` showing the success state.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/tour/payment.astro
git commit -m "$(cat <<'EOF'
fix(book): align tour payment insert with actual tours table schema

The tours table has `name`, `tour`, `vehicle`, `special_requests` —
no first_name/last_name/payment_token columns (same issue commit 1d2759d
fixed on experiences). Drop the nonexistent columns and populate the
singular columns the admin list reads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Require auth before transfer payment (fix "Client" transfer failure)

**Files:**
- Modify: `src/pages/book/transfer/passenger.astro` (add early auth redirect)
- Modify: `src/pages/book/transfer/payment.astro` (defensive guard)

Why do this before touching RLS: the RLS policy `Auth users can create transfers` is correct (every booking should be attributable to a user). The bug is that the funnel never forces a user to log in. Redirecting at `passenger.astro` keeps the RLS contract intact and guarantees `uid` is populated so hotel/agency/driver dashboards keep working.

- [ ] **Step 1: Add auth guard to passenger.astro**

At the top of the inline `<script>` in `src/pages/book/transfer/passenger.astro`, insert (before anything else runs):

```ts
import { supabase } from '../../../lib/supabase';

(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}&reason=booking`;
        return;
    }
})();
```

- [ ] **Step 2: Mirror the guard on payment.astro**

In `src/pages/book/transfer/payment.astro`, just after `const { data: { user } } = await supabase.auth.getUser();` (line 435), before the `partnerId` resolution, add:

```ts
if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}&reason=booking`;
    return;
}
```

- [ ] **Step 3: Handle the `?next=` param on login.astro**

Open `src/pages/login.astro` — find the success redirect after successful sign-in. Replace the hard-coded redirect target with:

```ts
const params = new URLSearchParams(window.location.search);
const next = params.get('next');
window.location.href = next && next.startsWith('/') ? next : '/profile/dashboard';
```

(If the current code already honours `next`, skip this step and verify only.)

- [ ] **Step 4: Verify**

Log out. Navigate to `/book/transfer/` → fill form → try to reach `passenger`. Expect an immediate redirect to `/login?next=/book/transfer/passenger...`. Log in. Expect to land back on the passenger page with the booking state still in `sessionStorage`.

Then try a Client Transfer booking (authenticated) end-to-end with each payment method (`stripe`, `cash-onsite`, `card-onsite`). All three should save.

- [ ] **Step 5: Commit**

```bash
git add src/pages/book/transfer/passenger.astro src/pages/book/transfer/payment.astro src/pages/login.astro
git commit -m "$(cat <<'EOF'
fix(book): require login before transfer booking, honour ?next=

Transfer RLS requires auth.uid(); anon visitors hit a save failure on
payment. Gate the funnel at passenger.astro (and defensively in payment)
and restore the booking path via ?next= on login.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Require auth before hourly payment (same bug, same fix)

**Files:**
- Modify: `src/pages/book/hourly/passenger.astro`
- Modify: `src/pages/book/hourly/payment.astro`

- [ ] **Step 1: Add guard to hourly passenger.astro**

At the top of the inline `<script>`:

```ts
import { supabase } from '../../../lib/supabase';

(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}&reason=booking`;
        return;
    }
})();
```

- [ ] **Step 2: Defensive guard on hourly payment.astro**

In `src/pages/book/hourly/payment.astro:322`, after `const { data: { user } } = await supabase.auth.getUser();`, add:

```ts
if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}&reason=booking`;
    return;
}
```

- [ ] **Step 3: Verify hourly save as logged-in client**

Run all three payment methods end-to-end. Confirm rows in `public.transfers` with `booking_type='hourly'`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/hourly/passenger.astro src/pages/book/hourly/payment.astro
git commit -m "fix(book): require login before hourly booking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Gate the tour booking funnel too (Tour failure path for Client)

**Files:**
- Modify: `src/pages/book/tour/passenger.astro`
- Modify: `src/pages/book/tour/payment.astro`

- [ ] **Step 1: Add auth guard to tour passenger.astro**

Same pattern as Task 2 Step 1, adjusted for the `/book/tour/` path.

- [ ] **Step 2: Defensive guard on tour payment.astro**

In `src/pages/book/tour/payment.astro:399`, after `const { data: { user } } = await supabase.auth.getUser();`:

```ts
if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}&reason=booking`;
    return;
}
```

- [ ] **Step 3: Verify client tour booking**

Log in as a regular user (`type='user'`). Book a tour with each payment method. Confirm rows in `public.tours` include correct `uid`, `name`, `tour`, `payment_method`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/tour/passenger.astro src/pages/book/tour/payment.astro
git commit -m "fix(book): require login before tour booking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fix driver add-vehicle silent failure

**Files:**
- Modify: `src/pages/driver/vehicles.astro`
- Create: `db/migrations/2026-04-22-driver-vehicles-rls.sql`

- [ ] **Step 1: Reproduce and capture the error**

Log in as an approved driver partner. Open `/driver/vehicles`. Click "Add Vehicle", fill Brand / Model / Plate, click Save. Observe: "Failed to save." in red. Open DevTools → Network → inspect the `driver_vehicles` POST response. Record the exact error (`code`, `message`, `details`). Most likely either:
- `42501` (permission denied) → RLS missing
- `PGRST204` / `42703` (column not found) → schema missing a column (e.g. `max_luggage`)

- [ ] **Step 2: Write idempotent RLS migration**

Create `db/migrations/2026-04-22-driver-vehicles-rls.sql`:

```sql
-- Ensure driver_vehicles table + RLS allow approved drivers to CRUD their own fleet.
-- Idempotent; safe to re-run.

create table if not exists public.driver_vehicles (
  id uuid primary key default uuid_generate_v4(),
  partner_id uuid references public.partners(id) on delete cascade,
  brand text default '',
  model text default '',
  year text,
  color text,
  category text,
  max_passengers int,
  max_luggage int,
  plate text default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

alter table public.driver_vehicles enable row level security;

do $$ begin
  drop policy if exists "Drivers CRUD own vehicles" on public.driver_vehicles;
  drop policy if exists "Admins full access driver_vehicles" on public.driver_vehicles;
exception when undefined_object then null; end $$;

create policy "Drivers CRUD own vehicles"
  on public.driver_vehicles for all
  using (partner_id = auth.uid() and public.is_approved_driver())
  with check (partner_id = auth.uid() and public.is_approved_driver());

create policy "Admins full access driver_vehicles"
  on public.driver_vehicles for all
  using (public.is_admin());

create index if not exists idx_driver_vehicles_partner on public.driver_vehicles(partner_id);
```

- [ ] **Step 3: Run the migration**

Open Supabase Dashboard → SQL Editor → paste and run the file. Confirm no errors. Verify policies with:

```sql
select policyname, cmd, qual from pg_policies where tablename = 'driver_vehicles';
```

- [ ] **Step 4: Improve error surfacing in the form**

In `src/pages/driver/vehicles.astro`, replace the catch block at line 278-280:

```ts
} catch (err: any) {
    const msg = err?.code ? `[${err.code}] ${err.message}` : (err?.message || 'Failed to save.');
    console.error('Vehicle save failed:', err);
    showStatus(msg, false);
}
```

This exposes Supabase error codes in the UI so the next bug is trivial to diagnose.

- [ ] **Step 5: Verify add + toggle + delete**

With the same driver account: add a vehicle → observe the row → click Deactivate → observe the badge → click Delete → confirm prompt → observe removal. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/driver/vehicles.astro db/migrations/2026-04-22-driver-vehicles-rls.sql
git commit -m "$(cat <<'EOF'
fix(driver): add driver_vehicles RLS + surface Supabase error codes

driver_vehicles inserts were failing silently for approved drivers. Add
idempotent RLS granting CRUD over own rows and full admin access, and
bubble the error code up in the form status pill so future failures are
self-describing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: "Admin-first" release gate on new bookings

The client wrote: *"The rides should appears visible as available for all, once we assigned to the pool, but first should appears in the admin console."* Meaning: a new booking should land in the admin console; only after admin releases it should drivers see it in `/driver/available`.

**Files:**
- Create: `db/migrations/2026-04-22-transfers-released-flag.sql`
- Modify: `src/pages/driver/available.astro`
- Modify: `src/pages/admin/transfers.astro`, `src/pages/admin/tours.astro`, `src/pages/admin/experiences.astro`

- [ ] **Step 1: Migration**

Create `db/migrations/2026-04-22-transfers-released-flag.sql`:

```sql
-- Admin-first release gate: new rides are only visible to drivers once admin releases them.
-- Existing rows backfilled to released=true so nothing disappears retroactively.

alter table public.transfers   add column if not exists released_to_drivers boolean default false;
alter table public.tours       add column if not exists released_to_drivers boolean default false;
alter table public.experiences add column if not exists released_to_drivers boolean default false;

update public.transfers   set released_to_drivers = true where released_to_drivers is null or released_to_drivers = false;
update public.tours       set released_to_drivers = true where released_to_drivers is null or released_to_drivers = false;
update public.experiences set released_to_drivers = true where released_to_drivers is null or released_to_drivers = false;

-- From now on new rows default to false; release is explicit.
alter table public.transfers   alter column released_to_drivers set default false;
alter table public.tours       alter column released_to_drivers set default false;
alter table public.experiences alter column released_to_drivers set default false;

create index if not exists idx_transfers_released   on public.transfers(released_to_drivers);
create index if not exists idx_tours_released       on public.tours(released_to_drivers);
create index if not exists idx_experiences_released on public.experiences(released_to_drivers);
```

Run in Supabase SQL editor.

- [ ] **Step 2: Filter driver/available.astro by `released_to_drivers = true`**

In `src/pages/driver/available.astro` (around line 188, inside `loadRides`):

```ts
const { data: rows, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('ride_status', 'new')
    .eq('released_to_drivers', true)
    .order('created_at', { ascending: false });
```

- [ ] **Step 3: Add "Release" toggle to admin transfers.astro**

In `src/pages/admin/transfers.astro`, add a column between "Ride Status" and "Payment":

Header:
```html
<th class="px-4 py-2 text-left">Released</th>
```

Cell rendering in the row template:
```ts
`<td class="px-4 py-2">
  <button data-release="${b.id}" data-released="${b.released_to_drivers ? '1' : '0'}"
    class="text-xs px-3 py-1 rounded-lg border ${b.released_to_drivers ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}">
    ${b.released_to_drivers ? 'Released' : 'Release to drivers'}
  </button>
</td>`
```

Handler (after rendering):
```ts
tbody?.querySelectorAll<HTMLButtonElement>('[data-release]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const id = btn.dataset.release!;
        const next = btn.dataset.released === '1' ? false : true;
        await supabase.from('transfers').update({ released_to_drivers: next }).eq('id', id);
        await loadTransfers();
    });
});
```

Repeat for `tours.astro` and `experiences.astro` with the same structure (using `tours` / `experiences` tables).

- [ ] **Step 4: Verify**

As an authenticated client, book a new transfer. Log in as a driver — `/driver/available` should NOT show it yet. Log in as admin — `/admin/transfers` shows the new row with an amber "Release to drivers" badge. Click it, it turns emerald. Back to driver — ride now appears in available.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-04-22-transfers-released-flag.sql src/pages/driver/available.astro src/pages/admin/transfers.astro src/pages/admin/tours.astro src/pages/admin/experiences.astro
git commit -m "$(cat <<'EOF'
feat(bookings): admin-first release gate before drivers see rides

New rides default to released_to_drivers=false and must be explicitly
released from the admin dashboards before they appear in driver pools.
Existing rows backfilled to released=true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART B — Section 3 (Admin Console)

## Task 7: Tour catalog categories, entrance tickets, hotel option, per-vehicle pricing, multi-image

**Files:**
- Create: `db/migrations/2026-04-22-tours-catalog-categories.sql`
- Modify: `src/pages/admin/manage-tours.astro`
- Modify: `src/lib/upload.ts` (support array upload)

### Data model

- [ ] **Step 1: Migration**

Create `db/migrations/2026-04-22-tours-catalog-categories.sql`:

```sql
-- Tours catalog: add categories, per-vehicle pricing, entrance tickets, hotel option, image gallery.
-- Idempotent.

alter table public.tours_catalog
  add column if not exists category text
    check (category in ('day-tour', 'multiday-tour', 'experience-single', 'experience-multi')) default 'day-tour',
  add column if not exists price_sedan   numeric(10,2),
  add column if not exists price_van     numeric(10,2),
  add column if not exists price_minibus numeric(10,2),
  add column if not exists entrance_ticket_per_person numeric(10,2) default 0,
  add column if not exists entrance_ticket_count int default 0,
  add column if not exists hotel_option text
    check (hotel_option in ('none', 'self-book', 'include-booking')) default 'none',
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Backfill per-vehicle price from flat price if missing.
update public.tours_catalog
set price_sedan   = coalesce(price_sedan,   price),
    price_van     = coalesce(price_van,     price),
    price_minibus = coalesce(price_minibus, price)
where price is not null;

-- Backfill images with existing single image_url as a one-element array.
update public.tours_catalog
set images = jsonb_build_array(image_url)
where images = '[]'::jsonb and image_url is not null and image_url <> '';
```

Run it.

- [ ] **Step 2: Commit the migration**

```bash
git add db/migrations/2026-04-22-tours-catalog-categories.sql
git commit -m "db: extend tours_catalog with category, per-vehicle pricing, entrance tickets, hotel option, image gallery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### UI (manage-tours.astro) — form additions

Current form fields (per repo exploration): title, description, price, duration, three highlights, single image URL, published toggle. Add the following — keep existing fields working.

- [ ] **Step 3: Extend `uploadImage` in `src/lib/upload.ts` to accept multiple files**

Append to `src/lib/upload.ts`:

```ts
export async function uploadImages(files: FileList | File[], folder: string): Promise<string[]> {
    const arr: File[] = Array.from(files as File[]);
    const urls: string[] = [];
    for (const f of arr) {
        urls.push(await uploadImage(f, folder));
    }
    return urls;
}
```

No need for parallel uploads — catalog forms upload a handful of images at a time and sequential is simpler to reason about.

- [ ] **Step 4: Add Category dropdown to the tour modal**

In `src/pages/admin/manage-tours.astro`, inside the create/edit modal form, after the Title input add:

```html
<div>
    <label class="block text-sm font-medium text-neutral-700 mb-1.5">Category *</label>
    <select id="tc-category" required
        class="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm">
        <option value="day-tour">Day Tour</option>
        <option value="multiday-tour">Multi-day Tour</option>
        <option value="experience-single">Experience (single day)</option>
        <option value="experience-multi">Experience (multi day)</option>
    </select>
</div>
```

Read the value when building the payload (`category: (document.getElementById('tc-category') as HTMLSelectElement).value`).

- [ ] **Step 5: Per-vehicle pricing inputs**

Replace the current single "Price" input with a three-input block:

```html
<div class="grid grid-cols-3 gap-3">
    <div>
        <label class="block text-xs font-medium text-neutral-600 mb-1">Sedan (1-3 pax) €</label>
        <input type="number" id="tc-price-sedan" step="0.01" min="0" required
            class="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
    </div>
    <div>
        <label class="block text-xs font-medium text-neutral-600 mb-1">Van (4-7 pax) €</label>
        <input type="number" id="tc-price-van" step="0.01" min="0" required
            class="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
    </div>
    <div>
        <label class="block text-xs font-medium text-neutral-600 mb-1">Minibus (8-20 pax) €</label>
        <input type="number" id="tc-price-minibus" step="0.01" min="0" required
            class="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
    </div>
</div>
```

Payload additions:
```ts
price_sedan: parseFloat((document.getElementById('tc-price-sedan') as HTMLInputElement).value) || 0,
price_van: parseFloat((document.getElementById('tc-price-van') as HTMLInputElement).value) || 0,
price_minibus: parseFloat((document.getElementById('tc-price-minibus') as HTMLInputElement).value) || 0,
price: parseFloat((document.getElementById('tc-price-sedan') as HTMLInputElement).value) || 0, // keep legacy flat price in sync
```

- [ ] **Step 6: Entrance ticket fields**

Add below the price block:

```html
<div class="grid grid-cols-2 gap-3">
    <div>
        <label class="block text-xs font-medium text-neutral-600 mb-1">Entrance ticket per person €</label>
        <input type="number" id="tc-entrance-price" step="0.01" min="0"
            class="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
        <p class="text-[11px] text-neutral-500 mt-1">Archaeological site entry cost, charged per passenger.</p>
    </div>
    <div>
        <label class="block text-xs font-medium text-neutral-600 mb-1">Number of tickets</label>
        <input type="number" id="tc-entrance-count" step="1" min="0" value="0"
            class="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
        <p class="text-[11px] text-neutral-500 mt-1">0 for Day Tours with one entry; multi-day tours may need more than one.</p>
    </div>
</div>
```

Payload:
```ts
entrance_ticket_per_person: parseFloat((document.getElementById('tc-entrance-price') as HTMLInputElement).value) || 0,
entrance_ticket_count: parseInt((document.getElementById('tc-entrance-count') as HTMLInputElement).value) || 0,
```

- [ ] **Step 7: Hotel option (shown only when category = multiday-tour)**

Add this field:

```html
<div id="tc-hotel-wrap" class="hidden">
    <label class="block text-sm font-medium text-neutral-700 mb-1.5">Hotel option</label>
    <select id="tc-hotel-option"
        class="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm">
        <option value="none">No hotel option</option>
        <option value="self-book">No hotel needed (guest books their own)</option>
        <option value="include-booking">Include hotel booking (agent contacts after booking)</option>
    </select>
</div>
```

Wire visibility on the category change event:
```ts
document.getElementById('tc-category')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    const isMulti = val === 'multiday-tour' || val === 'experience-multi';
    document.getElementById('tc-hotel-wrap')?.classList.toggle('hidden', !isMulti);
});
```

Payload:
```ts
hotel_option: (document.getElementById('tc-hotel-option') as HTMLSelectElement).value || 'none',
```

- [ ] **Step 8: Multi-image upload (file + URL paste)**

Replace the current single `image_url` input with a gallery builder:

```html
<div>
    <label class="block text-sm font-medium text-neutral-700 mb-1.5">Images</label>
    <div class="flex items-center gap-2 mb-2">
        <input type="file" id="tc-image-files" accept="image/*" multiple
            class="text-sm" />
        <span class="text-xs text-neutral-500">or</span>
        <input type="url" id="tc-image-url-input" placeholder="Paste image URL"
            class="flex-1 px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
        <button type="button" id="tc-image-url-add"
            class="px-3 py-2 bg-neutral-100 text-neutral-700 text-sm font-semibold rounded-lg hover:bg-neutral-200">Add URL</button>
    </div>
    <p class="text-[11px] text-neutral-500 mb-2">Up to 10 images. First image is the cover.</p>
    <ul id="tc-image-list" class="grid grid-cols-5 gap-2"></ul>
</div>
```

JS (inside the init function):

```ts
let gallery: string[] = [];
const MAX_IMAGES = 10;
const listEl = document.getElementById('tc-image-list')!;

function renderGallery() {
    listEl.innerHTML = gallery.map((url, i) => `
        <li class="relative group">
            <img src="${url}" class="w-full h-20 object-cover rounded-lg border" />
            ${i === 0 ? '<span class="absolute top-1 left-1 text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">Cover</span>' : ''}
            <button type="button" data-img-remove="${i}" class="absolute top-1 right-1 bg-white/90 text-red-600 w-5 h-5 rounded-full text-xs">×</button>
        </li>`).join('');
    listEl.querySelectorAll<HTMLButtonElement>('[data-img-remove]').forEach(b => {
        b.addEventListener('click', () => {
            gallery.splice(parseInt(b.dataset.imgRemove!), 1);
            renderGallery();
        });
    });
}

document.getElementById('tc-image-files')?.addEventListener('change', async (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    if (gallery.length + files.length > MAX_IMAGES) {
        alert(`Max ${MAX_IMAGES} images`); return;
    }
    const { uploadImages } = await import('../../lib/upload');
    const urls = await uploadImages(files, 'tours');
    gallery.push(...urls);
    renderGallery();
    (e.target as HTMLInputElement).value = '';
});

document.getElementById('tc-image-url-add')?.addEventListener('click', () => {
    const input = document.getElementById('tc-image-url-input') as HTMLInputElement;
    const url = input.value.trim();
    if (!url) return;
    if (gallery.length >= MAX_IMAGES) { alert(`Max ${MAX_IMAGES} images`); return; }
    gallery.push(url);
    input.value = '';
    renderGallery();
});
```

Payload:
```ts
images: gallery,
image_url: gallery[0] || '', // keep legacy single-image columns in sync
```

On modal open for edit, seed `gallery` from `row.images ?? (row.image_url ? [row.image_url] : [])` and call `renderGallery()`. On modal close / new-row open, reset `gallery = []`.

- [ ] **Step 9: Verify**

`npm run dev`, log in as admin. `/admin/manage-tours` → "+ Add Tour". Fill all new fields, upload 2 files + paste 1 URL → total 3 images. Set category to "Multi-day Tour" → hotel dropdown appears. Save. Confirm DB row has all new fields populated. Edit the same tour → gallery re-populates; delete middle image; reorder by deleting+re-adding; save. Re-open → confirm order persists.

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/manage-tours.astro src/lib/upload.ts
git commit -m "$(cat <<'EOF'
feat(admin): extend tour catalog form with category, per-vehicle pricing, entrance tickets, hotel option, multi-image gallery

Addresses client feedback 3.1: categories (Day / Multi-day / Experience),
Sedan/Van/Minibus tiered pricing, archaeological entrance ticket cost
per person, multi-day hotel option, and 1-10 image uploads via file
picker or pasted URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Public tour page reads new fields (per-vehicle pricing + images gallery)

**Files:**
- Modify: `src/pages/book/tour/results.astro` (already reads `price_sedan` etc for experiences — verify tour parity)
- Modify: `src/components/ToursSection.astro` (homepage catalog card — display first image from gallery + "From €X" using the sedan price)

- [ ] **Step 1: Map the tour card display to new schema**

In `src/components/ToursSection.astro`, where the card currently uses `tour.image_url` and `tour.price`:

```ts
const cover = (Array.isArray(tour.images) && tour.images[0]) || tour.image_url || '';
const fromPrice = tour.price_sedan ?? tour.price ?? 0;
```

Use `cover` and `fromPrice` in the rendered card.

- [ ] **Step 2: Verify the results page vehicle selector uses per-vehicle pricing**

Read `src/pages/book/tour/results.astro` around lines 300-400 (vehicle card block). Confirm it already reads `price_sedan`/`price_van`/`price_minibus`. If it doesn't, mirror the pattern from `src/pages/book/experience/results.astro` (commit `5744a8b`).

- [ ] **Step 3: Commit**

```bash
git add src/components/ToursSection.astro src/pages/book/tour/results.astro
git commit -m "feat(tours): prefer gallery[0] and price_sedan in public card + results

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Reservation detail modal for admin transfer/tour/experience dashboards

The client's point 3.3: *"we cannot see if the customer have some specific comment in the booking. If possible, to see all the information when clicking in the specific reservation."*

**Files:**
- Create: `src/components/ReservationDetailModal.astro`
- Modify: `src/pages/admin/transfers.astro`, `src/pages/admin/tours.astro`, `src/pages/admin/experiences.astro`

- [ ] **Step 1: Build the shared modal**

Create `src/components/ReservationDetailModal.astro`:

```astro
---
// Props: none — the modal is driven by JS via window.OpawayReservationDetail.open(row, kind)
---

<div id="res-detail-modal" class="fixed inset-0 z-[60] hidden">
    <div class="absolute inset-0 bg-black/40" id="res-detail-overlay"></div>
    <div class="absolute inset-0 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 md:p-8 relative">
            <button type="button" id="res-detail-close"
                class="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            <h3 id="res-detail-title" class="text-lg font-bold text-neutral-900 mb-2">Reservation</h3>
            <p id="res-detail-ref" class="text-xs font-mono text-neutral-500 mb-5"></p>
            <div id="res-detail-body" class="space-y-5 text-sm"></div>
        </div>
    </div>
</div>

<script>
    type Row = Record<string, any>;

    function field(label: string, value: any, opts: { mono?: boolean; full?: boolean } = {}) {
        if (value == null || value === '') return '';
        const cls = `mt-0.5 ${opts.mono ? 'font-mono' : ''} ${opts.full ? 'whitespace-pre-wrap' : ''} text-neutral-800`;
        return `<div class="${opts.full ? 'col-span-2' : ''}">
            <div class="text-[11px] uppercase tracking-wider text-neutral-500">${label}</div>
            <div class="${cls}">${String(value)}</div>
        </div>`;
    }

    function badge(text: string, tone: 'blue'|'emerald'|'amber'|'red'|'neutral' = 'neutral') {
        const palette = {
            blue: 'bg-blue-50 text-blue-700 border-blue-200',
            emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            amber: 'bg-amber-50 text-amber-700 border-amber-200',
            red: 'bg-red-50 text-red-700 border-red-200',
            neutral: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        };
        return `<span class="inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${palette[tone]}">${text}</span>`;
    }

    function renderTransfer(r: Row) {
        return `
        <div class="grid grid-cols-2 gap-4">
            ${field('Customer', [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name)}
            ${field('Email', r.email)}
            ${field('Phone', r.phone)}
            ${field('Booking type', r.booking_type)}
            ${field('From', r.from)}
            ${field('To', r.to)}
            ${field('Date', r.date)}
            ${field('Time', r.time)}
            ${field('Return', r.return_date ? `${r.return_date} ${r.return_time ?? ''}` : '')}
            ${field('Passengers', r.passengers)}
            ${field('Child seats', r.child_seats)}
            ${field('Vehicle', r.vehicle_name || r.vehicle_slug)}
            ${field('Hours', r.hours)}
            ${field('€/hour', r.per_hour)}
            ${field('Total', r.total_price != null ? `€${Number(r.total_price).toFixed(2)}` : '')}
            ${field('Outward', r.outward_price != null ? `€${Number(r.outward_price).toFixed(2)}` : '')}
            ${field('Return price', r.return_price != null ? `€${Number(r.return_price).toFixed(2)}` : '')}
            ${field('Card surcharge', r.card_surcharge != null ? `€${Number(r.card_surcharge).toFixed(2)}` : '')}
            ${field('Payment method', r.payment_method)}
            ${field('Payment status', r.payment_status)}
            ${field('Ride status', r.ride_status)}
            ${field('Driver', r.driver || '—')}
            ${field('Released', r.released_to_drivers ? 'Yes' : 'No')}
            ${field('Customer notes', r.notes, { full: true })}
            ${field('Driver notes', r.driver_notes, { full: true })}
            ${field('Sign name', r.sign_name)}
            ${field('Created', r.created_at)}
        </div>`;
    }

    function renderTourOrExp(r: Row, labelKey: 'tour'|'experience') {
        return `
        <div class="grid grid-cols-2 gap-4">
            ${field('Customer', r.name)}
            ${field('Email', r.email)}
            ${field('Phone', r.phone)}
            ${field(labelKey === 'tour' ? 'Tour' : 'Experience', r[`${labelKey}_name`] || r[labelKey])}
            ${field('Pickup', r.pickup || r.pickup_location)}
            ${field('Date', r.date)}
            ${field('Time', r.time)}
            ${field('Participants', r.participants ?? r.passengers)}
            ${field('Vehicle', r.vehicle || r.vehicle_name)}
            ${field('Total', r.total_price != null ? `€${Number(r.total_price).toFixed(2)}` : '')}
            ${field('Payment method', r.payment_method)}
            ${field('Payment status', r.payment_status)}
            ${field('Ride status', r.ride_status)}
            ${field('Driver', r.driver || '—')}
            ${field('Released', r.released_to_drivers ? 'Yes' : 'No')}
            ${field('Special requests', r.special_requests, { full: true })}
            ${field('Customer notes', r.notes, { full: true })}
            ${field('Created', r.created_at)}
        </div>`;
    }

    const modal = document.getElementById('res-detail-modal')!;
    const body  = document.getElementById('res-detail-body')!;
    const title = document.getElementById('res-detail-title')!;
    const refEl = document.getElementById('res-detail-ref')!;

    function close() { modal.classList.add('hidden'); }
    document.getElementById('res-detail-overlay')?.addEventListener('click', close);
    document.getElementById('res-detail-close')?.addEventListener('click', close);

    (window as any).OpawayReservationDetail = {
        open(row: Row, kind: 'transfer'|'tour'|'experience') {
            title.textContent = kind === 'transfer' ? 'Transfer booking' : kind === 'tour' ? 'Tour booking' : 'Experience booking';
            refEl.textContent = `Ref ${String(row.id || '').slice(0, 8).toUpperCase()}`;
            body.innerHTML = kind === 'transfer'
                ? renderTransfer(row)
                : renderTourOrExp(row, kind as 'tour'|'experience');
            modal.classList.remove('hidden');
        },
        close,
    };
</script>
```

- [ ] **Step 2: Mount the modal + wire row clicks in `admin/transfers.astro`**

Import and include the modal at the bottom of the page:

```astro
---
import AdminLayout from '../../components/AdminLayout.astro';
import ReservationDetailModal from '../../components/ReservationDetailModal.astro';
---
<AdminLayout ...>
  ...existing table...
  <ReservationDetailModal />
</AdminLayout>
```

Inside the inline `<script>` for the page, declare a module-scope map and populate it in `loadTransfers` before rendering:

```ts
const allRowsById = new Map<string, any>();

async function loadTransfers() {
    const { data, error } = await supabase.from('transfers').select('*').order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    allRowsById.clear();
    (data ?? []).forEach(r => allRowsById.set(r.id, r));
    renderRows(data ?? []);
}
```

In the render template, add `data-row-id` + cursor class to the opening `<tr>`:

```ts
`<tr data-row-id="${b.id}" class="cursor-pointer hover:bg-neutral-50">`
```

After render (at the end of `renderRows`), wire the click listener alongside the existing inline-edit wiring:

```ts
tbody?.querySelectorAll<HTMLElement>('[data-row-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
        // Ignore clicks on form controls so inline edit (driver / status / payment / release) still works.
        if ((e.target as HTMLElement).closest('input, select, button, [data-release]')) return;
        const row = allRowsById.get(tr.dataset.rowId!);
        if (row) (window as any).OpawayReservationDetail.open(row, 'transfer');
    });
});
```

Also add an Escape-key close handler near where the modal is mounted (inside `ReservationDetailModal.astro` is fine; add to the `<script>` there):

```ts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
});
```

- [ ] **Step 3: Mirror in `admin/tours.astro` (kind = 'tour') and `admin/experiences.astro` (kind = 'experience')**

Same pattern; change only the `kind` argument passed to `.open()`.

- [ ] **Step 4: Verify**

As admin, open `/admin/transfers` → click a non-button cell on any row. Modal opens showing all fields including `notes`, `driver_notes`, `sign_name`, `payment_method`. Close via X, overlay, or Escape (add if missing). Repeat on tours and experiences.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReservationDetailModal.astro src/pages/admin/transfers.astro src/pages/admin/tours.astro src/pages/admin/experiences.astro
git commit -m "$(cat <<'EOF'
feat(admin): click-through reservation detail modal on booking dashboards

Exposes all fields (notes, driver_notes, sign_name, payment_method, price
breakdown, released flag) so admins can read customer comments without
leaving the dashboard. Addresses feedback 3.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Partner detail modal (feedback 3.4)

**Files:**
- Create: `src/components/PartnerDetailModal.astro`
- Modify: `src/pages/admin/partners.astro`

- [ ] **Step 1: Build the modal**

Create `src/components/PartnerDetailModal.astro` following the same structure as `ReservationDetailModal.astro`, but rendering a partners row. Fields to surface by type:

- **All types:** id, display_name, email, type, status, discount (%), commission_eur, vat, location, website, contact_name, contact_phone, contact_email, provider, created_at
- **Hotel:** hotel_name, hotel_type, business_phone, business_email
- **Agency:** agency_name, agency_type, agency_phone, agency_email
- **Driver:** full_name, phone, num_vehicles, primary_car_type, car_types

Also pull from the `driver_payment_data` (if present) table when `type = 'driver'`:

```ts
if (row.type === 'driver') {
    const { data: pay } = await supabase
        .from('driver_payment_data')
        .select('*')
        .eq('partner_id', row.id)
        .maybeSingle();
    // Render: payment method (bank | paypal | etc), iban, account_holder, bank_name, paypal_email
}
```

(Reference `src/pages/driver/payment-data.astro` for the actual payment-data schema — fields to display should match what's stored.)

For hotels/agencies, also pull a bookings summary:

```ts
const { count: transferCount } = await supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('partner_id', row.id);
// same for tours, experiences
```

Show a three-tile summary: `# Transfers`, `# Tours`, `# Experiences`.

Expose the same `window.OpawayPartnerDetail.open(row)` pattern.

- [ ] **Step 2: Mount + wire in `admin/partners.astro`**

Import the modal; add `data-row-id` to each `<tr>` as in Task 9 Step 2; open on row click (ignoring clicks inside inputs/selects/actions dropdowns).

- [ ] **Step 3: Verify**

Open `/admin/partners` → click a hotel row. Modal shows hotel business info + booking counts + commission. Click a driver row → payment data loads below the driver fields.

- [ ] **Step 4: Commit**

```bash
git add src/components/PartnerDetailModal.astro src/pages/admin/partners.astro
git commit -m "$(cat <<'EOF'
feat(admin): click-through partner detail modal

Surfaces payment method, contact data, commission, discount, and booking
totals for hotels/agencies/drivers without leaving the partners list.
Addresses feedback 3.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Hotel commission as EUR amount (feedback 3.2)

Currently `partners.discount` is a percentage and `src/pages/hotel/index.astro:343` computes `commission = totalPrice * discount / 100`. The client wants a per-EUR amount.

**Files:**
- Create: `db/migrations/2026-04-22-partners-commission-eur.sql`
- Modify: `src/pages/admin/partners.astro` (inline-edit commission_eur for hotels)
- Modify: `src/pages/hotel/index.astro` (commission column reads `commission_eur`)
- Modify: `src/components/PartnerDetailModal.astro` (expose the new field)

- [ ] **Step 1: Migration**

Create `db/migrations/2026-04-22-partners-commission-eur.sql`:

```sql
-- Hotels get a per-EUR commission independent of the percentage discount used by agencies.
alter table public.partners
  add column if not exists commission_eur numeric(10,2);

-- Backfill: for existing hotel partners who have a discount, we DON'T auto-convert —
-- commission_eur is a flat EUR amount per booking, not a percentage of total.
-- Leave null so admins set it explicitly.
```

Run in SQL editor.

- [ ] **Step 2: Admin inline-edit EUR commission for hotel partners**

In `src/pages/admin/partners.astro`, when the partner row has `type === 'hotel'`, render the existing Discount cell as two stacked inputs OR conditionally render only `commission_eur` for hotels and keep `discount` (%) for agencies:

```ts
const commissionCellHtml = (p.type === 'hotel')
    ? `<span data-commission-eur="${p.id}" class="cursor-pointer hover:bg-neutral-50 px-2 py-1 rounded">
         ${p.commission_eur != null ? `€${Number(p.commission_eur).toFixed(2)}` : '—'}
       </span>`
    : `<span data-discount="${p.id}" class="cursor-pointer hover:bg-neutral-50 px-2 py-1 rounded">
         ${p.discount ? `${p.discount}%` : '—'}
       </span>`;
```

Add an equivalent inline-edit handler for `[data-commission-eur]` that updates `partners.commission_eur`:

```ts
tbody?.querySelectorAll<HTMLElement>('[data-commission-eur]').forEach(span => {
    span.addEventListener('click', () => {
        const id = span.dataset.commissionEur!;
        const current = span.textContent?.replace('€', '').trim() ?? '';
        span.innerHTML = `<input type="number" step="0.01" min="0" value="${current === '—' ? '' : current}"
            class="w-24 px-2 py-1 border border-neutral-200 rounded text-sm" />
            <button class="ml-1 text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded">Save</button>`;
        const input = span.querySelector('input')!;
        const btn = span.querySelector('button')!;
        input.focus();
        btn.addEventListener('click', async () => {
            const val = parseFloat(input.value);
            await supabase.from('partners').update({ commission_eur: isNaN(val) ? null : val }).eq('id', id);
            await loadPartners();
        });
    });
});
```

Also update the table header for the column to read "Discount / Commission" (or split into two columns if you prefer).

- [ ] **Step 3: Hotel dashboard commission column**

In `src/pages/hotel/index.astro` around line 343:

```ts
const commissionEur = Number(partner?.commission_eur ?? 0);
const commission = commissionEur; // flat per-booking amount
```

Render `€${commission.toFixed(2)}` in the Hotel Commission column.

- [ ] **Step 4: Partner detail modal**

In `PartnerDetailModal.astro`, when `row.type === 'hotel'` include `commission_eur` formatted as `€X.XX` (or `—`). When `row.type === 'agency'` keep `discount` formatted as `X%`.

- [ ] **Step 5: Verify**

As admin, open `/admin/partners`, filter by Hotel. Click the commission cell → enter `12.50` → Save. Reload — still `€12.50`. Log in as that hotel → `/hotel` → create a test booking (via admin on behalf) → commission column shows €12.50 per booking. Edit back to empty, confirm dash.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-04-22-partners-commission-eur.sql src/pages/admin/partners.astro src/pages/hotel/index.astro src/components/PartnerDetailModal.astro
git commit -m "$(cat <<'EOF'
feat(partners): per-EUR commission for hotels, % discount stays for agencies

Adds partners.commission_eur, exposes it as inline-edit on the admin
partner row for hotel type, and swaps the hotel dashboard commission
column from percentage-of-total to the flat per-booking EUR amount.
Addresses feedback 3.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART C — Notification system (red badges on all sidebars)

The client asks for a pop-up/number on each tab in the dashboard showing "something new." Implementation:

- **Sources:**
  - Admin: `requests where status='new'`, `transfers where ride_status='new'`, `tours where ride_status='new'`, `experiences where ride_status='new'`, `partners where status='pending'`.
  - Driver: `transfers where ride_status='new' and released_to_drivers=true and (driver_uid is null or '')` (same for tours/experiences — combined into the single "Available Rides" tab).
  - Hotel / Agency: `transfers/tours/experiences where partner_id=<self> and created_at > last_viewed_at` (stored per-user in localStorage; resets when the page is opened).

## Task 12: Notification library + Realtime subscription helper

**Files:**
- Create: `src/lib/notifications.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/notifications.ts
import { supabase } from './supabase';

export type DashboardKind = 'admin' | 'driver' | 'hotel' | 'agency';

/** For admin sidebar: count pending/new across each source table. */
export async function adminCounts() {
    const [req, tr, to, ex, pa] = await Promise.all([
        supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('ride_status', 'new'),
        supabase.from('tours').select('*', { count: 'exact', head: true }).eq('ride_status', 'new'),
        supabase.from('experiences').select('*', { count: 'exact', head: true }).eq('ride_status', 'new'),
        supabase.from('partners').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    return {
        requests: req.count ?? 0,
        transfers: tr.count ?? 0,
        tours: to.count ?? 0,
        experiences: ex.count ?? 0,
        partners: pa.count ?? 0,
    };
}

/** For driver "Available Rides" tab. */
export async function driverAvailableCount() {
    const conditions = (q: any) => q
        .eq('ride_status', 'new')
        .eq('released_to_drivers', true)
        .or('driver_uid.is.null,driver_uid.eq.');
    const [t, to, ex] = await Promise.all([
        conditions(supabase.from('transfers').select('*', { count: 'exact', head: true })),
        conditions(supabase.from('tours').select('*', { count: 'exact', head: true })),
        conditions(supabase.from('experiences').select('*', { count: 'exact', head: true })),
    ]);
    return (t.count ?? 0) + (to.count ?? 0) + (ex.count ?? 0);
}

/** For hotel/agency "Reservations" tab. */
export async function partnerReservationsCount(partnerId: string) {
    const lastSeen = localStorage.getItem(`opaway:partner-reservations-seen:${partnerId}`) || '1970-01-01T00:00:00Z';
    const head = (table: string) => supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .gt('created_at', lastSeen);
    const [t, to, ex] = await Promise.all([head('transfers'), head('tours'), head('experiences')]);
    return (t.count ?? 0) + (to.count ?? 0) + (ex.count ?? 0);
}

export function markPartnerReservationsSeen(partnerId: string) {
    localStorage.setItem(`opaway:partner-reservations-seen:${partnerId}`, new Date().toISOString());
}

/** Subscribe to changes on a list of tables; fire callback on any INSERT/UPDATE. Returns an unsubscribe. */
export function subscribeTables(tables: string[], onChange: () => void): () => void {
    const channels = tables.map(t =>
        supabase
            .channel(`notif-${t}-${Math.random().toString(36).slice(2, 8)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange)
            .subscribe()
    );
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat(lib): notification counters + realtime subscription helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Sidebar badge component

**Files:**
- Create: `src/components/SidebarBadge.astro`

- [ ] **Step 1: Write the component**

```astro
---
interface Props { id: string }
const { id } = Astro.props;
---
<span
    data-notif-badge={id}
    class="hidden ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold bg-red-600 text-white shadow-sm"
    aria-live="polite"
>0</span>
```

Usage: placed inside sidebar `<a>` tags; `id` should be a stable kebab-case key matching the dashboard (e.g. `admin-requests`, `admin-tours`, `driver-available`, `hotel-reservations`).

- [ ] **Step 2: Commit**

```bash
git add src/components/SidebarBadge.astro
git commit -m "feat(ui): reusable sidebar red-badge component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Wire notifications into `AdminLayout.astro`

**Files:**
- Modify: `src/components/AdminLayout.astro`

- [ ] **Step 1: Import and place badges**

Inside each sidebar `<a>` render, after the label span, insert a `SidebarBadge` with the matching id:

```astro
import SidebarBadge from './SidebarBadge.astro';
// ...inside the .map that renders nav items (around line 101):
<a href={item.href} class="...">
    <svg ...icon.../>
    <span>{item.label}</span>
    {item.notifId && <SidebarBadge id={item.notifId} />}
</a>
```

Extend the nav array so each notif-enabled item has a `notifId`:

```ts
const nav = [
    { group: 'Bookings', items: [
        { label: 'Requests',    href: '/admin/requests',    icon: 'inbox',    notifId: 'admin-requests' },
        { label: 'Transfers',   href: '/admin/transfers',   icon: 'transfer', notifId: 'admin-transfers' },
        { label: 'Tours',       href: '/admin/tours',       icon: 'map',      notifId: 'admin-tours' },
        { label: 'Experiences', href: '/admin/experiences', icon: 'star',     notifId: 'admin-experiences' },
    ]},
    // ...
    { group: 'Management', items: [
        { label: 'Partners', href: '/admin/partners', icon: 'partners', notifId: 'admin-partners' },
        // others without notifId
    ]},
];
```

- [ ] **Step 2: Wire the counter loop**

At the bottom of the existing `<script>` in `AdminLayout.astro` (after the auth check completes and `admin-auth-check` is hidden), add:

```ts
import { adminCounts, subscribeTables } from '../lib/notifications';

function setBadge(id: string, n: number) {
    const el = document.querySelector(`[data-notif-badge="${id}"]`);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('hidden', n === 0);
}

async function refreshBadges() {
    const c = await adminCounts();
    setBadge('admin-requests',    c.requests);
    setBadge('admin-transfers',   c.transfers);
    setBadge('admin-tours',       c.tours);
    setBadge('admin-experiences', c.experiences);
    setBadge('admin-partners',    c.partners);
}

// After auth check passes:
await refreshBadges();
const unsub = subscribeTables(['requests', 'transfers', 'tours', 'experiences', 'partners'], refreshBadges);
window.addEventListener('beforeunload', unsub);
```

Place this logic after the admin type check (`data?.type !== 'admin'` block); DO NOT run it if the user isn't admin.

- [ ] **Step 3: Verify**

Open `/admin` as admin. Observe no badges (assuming clean DB). In another tab, log in as a regular user and create a booking. Without reloading, admin sidebar shows red `1` on Transfers (via Realtime). Click Transfers → open a row → set ride_status to "assigned" → badge decrements to `0` and hides.

- [ ] **Step 4: Commit**

```bash
git add src/components/AdminLayout.astro
git commit -m "$(cat <<'EOF'
feat(admin): red notification badges on Requests/Transfers/Tours/Experiences/Partners

Counts pending/new via existing status columns, updates live via Supabase
Realtime subscriptions. Matches client feedback: "pop up number in the
main view to know that we have something new".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Driver, Hotel, and Agency sidebar badges

**Files:**
- Modify: `src/components/DriverLayout.astro`, `src/components/HotelLayout.astro`, `src/components/AgencyLayout.astro`

- [ ] **Step 1: DriverLayout**

Add `notifId: 'driver-available'` to the "Available Rides" nav item. Render `SidebarBadge` inside the `<a>`.

At the end of the `<script>`, after the driver/approved check passes:

```ts
import { driverAvailableCount, subscribeTables } from '../lib/notifications';

async function refreshDriverBadge() {
    const n = await driverAvailableCount();
    const el = document.querySelector('[data-notif-badge="driver-available"]');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('hidden', n === 0);
}
await refreshDriverBadge();
const unsubD = subscribeTables(['transfers', 'tours', 'experiences'], refreshDriverBadge);
window.addEventListener('beforeunload', unsubD);
```

- [ ] **Step 2: HotelLayout**

`notifId: 'hotel-reservations'` on the Reservations nav item. In the script, after the hotel/approved check:

```ts
import { partnerReservationsCount, markPartnerReservationsSeen, subscribeTables } from '../lib/notifications';

async function refreshHotelBadge() {
    const n = await partnerReservationsCount(session.user.id);
    const el = document.querySelector('[data-notif-badge="hotel-reservations"]');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('hidden', n === 0);
}
await refreshHotelBadge();
const unsubH = subscribeTables(['transfers', 'tours', 'experiences'], refreshHotelBadge);
window.addEventListener('beforeunload', unsubH);

// When user navigates INTO /hotel (the reservations page), mark seen.
if (window.location.pathname === '/hotel' || window.location.pathname === '/hotel/') {
    markPartnerReservationsSeen(session.user.id);
    await refreshHotelBadge();
}
```

- [ ] **Step 3: AgencyLayout**

Identical to Hotel but with `notifId: 'agency-reservations'` and the `/agency` path check.

- [ ] **Step 4: Verify**

Hotel user logged in on `/hotel/profile` → another tab creates a booking with `partner_id = <this hotel>` → sidebar badge on Reservations shows `1`. Click Reservations → badge clears and stays cleared on refresh.

Driver logged in on `/driver` → another tab: admin creates a transfer and releases it → driver sidebar badge shows `1`. Driver clicks Accept on the ride → badge decrements.

- [ ] **Step 5: Commit**

```bash
git add src/components/DriverLayout.astro src/components/HotelLayout.astro src/components/AgencyLayout.astro
git commit -m "$(cat <<'EOF'
feat(ui): notification badges on driver/hotel/agency sidebars

Driver: count of released, unclaimed rides across all booking tables.
Hotel/Agency: count of partner bookings created since last visit (stored
per-user in localStorage; cleared on opening the reservations page).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART D — Smoke test

## Task 16: End-to-end smoke test across all fixes

**Files:**
- Create: `qa/2026-04-22-smoke-test.md` (test journal; persists what you observed)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for "Local: http://localhost:4321/" then open it in the Playwright MCP browser (or a manual browser — Playwright preferred so screenshots stay reproducible).

- [ ] **Step 2: Smoke-test script (execute sequentially)**

Record pass/fail + screenshot for each.

A. **Client tour booking (was broken):**
1. Log out.
2. Navigate `/book/tour/` → pick any tour → click Book.
3. Expect redirect to `/login?next=...&reason=booking`. ✓ Auth gate.
4. Register or sign in as a regular user.
5. Land on `/book/tour/passenger` automatically.
6. Fill form → Continue → Payment page.
7. Select "Cash on arrival" → Complete Booking.
8. Expect success panel with reference. Record ID.
9. Repeat with "Pay by card on arrival".
10. Repeat with Stripe test card `4242 4242 4242 4242`.
11. Verify three rows in `public.tours` each with correct `payment_method`, non-null `uid`, `name` populated.

B. **Client transfer + hourly:** Repeat pattern A for `/book/transfer` and `/book/hourly` — Cash, Card on site, Stripe.

C. **Partner bookings (sanity regression):**
1. Log in as an approved agency → book a tour. Expect success (agency was already authenticated; this validates we didn't break the authenticated path).

D. **Admin console — manage-tours:**
1. Log in as admin → `/admin/manage-tours` → + Add Tour.
2. Fill all new fields: category = "Multi-day Tour", sedan/van/minibus prices, entrance ticket €10 × 2, hotel option = "Include hotel booking", upload 2 files + 1 URL.
3. Save. Reload page → row visible with first image as cover.
4. Open the tour on the public `/tours` page → first image loads in card; click through → results page shows three vehicle prices.

E. **Admin console — reservation detail modal:**
1. `/admin/transfers` → click a row. Modal opens with notes/driver_notes/payment_method visible.
2. Same on `/admin/tours` and `/admin/experiences`.

F. **Admin console — partners modal + commission:**
1. `/admin/partners` → click hotel row → modal shows contact data, commission field.
2. Close modal. Click the commission cell → enter `8.00` → Save. Reload → sticks.
3. Log in as that hotel → `/hotel` → open a booking — commission column shows `€8.00`.

G. **Admin-first release gate:**
1. As an authenticated client, book a transfer.
2. Immediately log in as a driver in another browser → `/driver/available` shows nothing new.
3. As admin → `/admin/transfers` → click "Release to drivers" on the new row.
4. Driver refreshes → ride appears.
5. Driver clicks Accept → ride moves to `/driver/upcoming`.

H. **Driver add vehicle:**
1. Logged in as approved driver → `/driver/vehicles` → Add Vehicle → fill brand/model/plate → Save.
2. Row appears; no error. Toggle Deactivate → status changes. Delete → row removed.

I. **Notification badges — admin:**
1. Admin at `/admin`. No badges visible.
2. Another tab: register a partner (hits `partners.status='pending'`). Admin sidebar Partners shows `1`.
3. Admin approves the partner from `/admin/partners`. Badge clears within ~2 s (Realtime).

J. **Notification badges — driver:**
1. Driver at `/driver`. No badge.
2. Admin releases a new ride. Driver sidebar "Available Rides" shows `1` within ~2 s.
3. Driver accepts. Badge clears.

K. **Notification badges — hotel:**
1. Hotel on `/hotel/profile`. No badge.
2. Admin creates a booking with `partner_id = this hotel`. Hotel sidebar Reservations shows `1`.
3. Hotel clicks Reservations. Badge clears. Refresh — still cleared (localStorage key set).

- [ ] **Step 3: Record outcomes in `qa/2026-04-22-smoke-test.md`**

Format:
```md
## 2026-04-22 Smoke test — admin/booking/notifications

| Step | Pass | Screenshot | Notes |
|------|------|------------|-------|
| A1 tour cash |  | qa/smoke-A1.png |  |
| A2 tour card-onsite |  | qa/smoke-A2.png |  |
| ... |
```

- [ ] **Step 4: Commit the smoke test journal**

```bash
git add qa/2026-04-22-smoke-test.md qa/smoke-*.png
git commit -m "qa: end-to-end smoke test journal for admin/booking/notifications work

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-22-admin-booking-fixes-notifications.md`.

**Two execution options:**

1. **Subagent-Driven (recommended for a plan this size)** — I dispatch a fresh subagent per task, review between tasks, fast iteration, context stays clean.

2. **Inline Execution** — Execute tasks in this session with checkpoints for review.

**Which approach?**
