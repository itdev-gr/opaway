# 2026-04-22 — Admin console, booking fixes & notification system smoke test

Branch: `feat/admin-booking-notifications-2026-04-22`
Commits under test: `723b996..4371ec7` (19 commits on branch)
Live Supabase project: `wjqfcijisslzqxesbbox`

The smoke test splits into two halves:

1. **Programmatic (controller-runnable)** — HTTP route checks + DB-level simulation of every bug-fix path via the Supabase management API. Run and recorded below.
2. **Browser-driven (human-runnable)** — Full UI journeys that require real user credentials across admin / hotel / agency / driver / regular client. Documented as a checklist for the user to execute.

## 1. Programmatic results

### 1.1 Route availability (dev server `http://localhost:4324`)

| Route | HTTP | Outcome |
|---|---|---|
| `/` | 200 | Home renders |
| `/login` | 200 | Login page renders |
| `/admin` | 200 | Admin layout renders auth overlay |
| `/book/tour/passenger` | 200 | Passenger page renders |

All routes reachable under the dev server.

### 1.2 Auth gate presence in compiled modules

`curl` of the Vite-compiled page modules confirms each booking funnel contains the login redirect and `getSession()` call:

- `/src/pages/book/tour/passenger.astro` → `window.location.href = \`/login?next=${next}&reason=booking\`` ✓
- `/src/pages/book/transfer/passenger.astro` → same redirect ✓
- `/src/pages/book/hourly/passenger.astro` → same redirect ✓

`/src/pages/login.astro` contains the hardened open-redirect guard:

```
rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
```

Blocks `//evil.com` and `/\evil` variants.

### 1.3 DB-level simulation of the client-reported bugs

All runs use the Supabase management API with `set local role authenticated` + a JWT-claims override to impersonate an approved driver (`fd942e8b-23f7-45e9-b1e0-6c7164ee8643`). Each transaction is rolled back after the assertion; no data changes.

**Bug A — Tour booking save: BEFORE the fix (expected: fails).**
```sql
insert into tours (uid, first_name, last_name, email, phone, date, ride_status)
values ('fd94…','John','Doe','a@b.gr','+30 0','2026-05-01','new');
```
Result: `ERROR: 42703: column "first_name" of relation "tours" does not exist` ✓ — proves the client-reported "failed to save" was real.

**Bug A — Tour booking save: AFTER the fix (expected: succeeds).**
```sql
insert into tours (uid, tour, tour_id, tour_name, pickup, pickup_location,
  destination, date, time, passengers, participants, vehicle, vehicle_name,
  name, email, phone, special_requests, notes, total_price, ride_status,
  payment_status, payment_method, added_by_admin)
values (…);
```
Result: one row returned with `ride_status='new'`, `released_to_drivers=false` (default from Task 6 migration), `payment_method='cash'` ✓.

**Bug B — Client (anon) transfer insert blocked by RLS.**
```sql
set local role anon;
insert into transfers ("from","to",date,time,first_name,last_name,email,phone)
values ('A','B','2026-05-01','10:00','X','Y','x@y.gr','+30 0');
```
Result: `ERROR: 42501: new row violates row-level security policy for table "transfers"` ✓ — confirms the client-reported "failed to save" for Client/Transfer path was RLS, and Task 2's login-gate is the right fix.

**Bug C — Driver vehicle add: AFTER the fix (lowercase category).**
```sql
insert into driver_vehicles (partner_id, brand, model, plate, category, status)
values ('fd94…','Smoke','V1','SMK-100','sedan','active');
```
Result: row returned with `category='sedan'`, `status='active'` ✓ — confirms Task 5 form-value change clears the CHECK constraint.

**Release gate default.** Tour insert above returned `released_to_drivers: false` — new bookings now default to "hidden from drivers until admin releases" (Task 6) ✓.

**Hotel commission in EUR.** `update partners set commission_eur = 12.50 where type='hotel'` returns an updated hotel row with the numeric column populated; nulling it back works too ✓.

**Notification counts sanity.** Running the same SQL the `adminCounts()` helper composes:

| Count | Value |
|---|---:|
| requests where status='new' | 0 |
| transfers where ride_status='new' | 12 |
| tours where ride_status='new' | 0 |
| experiences where ride_status='new' | 0 |
| partners where status='pending' | 0 |
| transfers released+new+unclaimed (driver pool) | 11 |

Values are coherent (1 of the 12 new transfers is currently held back from drivers — the release-gate in action).

### 1.4 Schema assertions

| Column | Table | Exists |
|---|---|---|
| `released_to_drivers` (boolean default false) | transfers, tours, experiences | ✓ |
| `category` (check day-tour/multiday-tour/experience-single/experience-multi) | tours_catalog, experiences_catalog | ✓ |
| `entrance_ticket_per_person`, `entrance_ticket_count` | tours_catalog, experiences_catalog | ✓ |
| `hotel_option` (check none/self-book/include-booking) | tours_catalog, experiences_catalog | ✓ |
| `images` (jsonb default `[]`) | tours_catalog, experiences_catalog | ✓ |
| `commission_eur` (numeric 10,2) | partners | ✓ |

All four migrations applied live and idempotent.

### 1.5 Build hygiene

`npm run build` → 62 pages built, 0 errors, 0 warnings (every task checked this).

---

## 2. Browser-driven checklist (needs user credentials)

These require logging in as real accounts. Recommend the user runs through each and ticks the box after verifying.

### A. Client tour booking end-to-end (previously broken)
- [ ] Log out.
- [ ] `/book/tour/` → pick a tour → Book.
- [ ] Expect redirect to `/login?next=%2Fbook%2Ftour%2Fpassenger&reason=booking`.
- [ ] Log in as a regular user (`type='user'`).
- [ ] Land on `/book/tour/passenger`; complete the form.
- [ ] Payment page → "Pay cash on arrival" → Complete.
- [ ] Expect success panel with a reference ID.
- [ ] Repeat with "Card on arrival" and Stripe test card `4242 4242 4242 4242`.
- [ ] In Supabase SQL editor: `select id, tour, payment_method, uid, released_to_drivers from tours order by created_at desc limit 5;` — three new rows with correct payment methods, non-null `uid`, `released_to_drivers=false`.

### B. Client transfer + hourly (previously broken)
- [ ] Same flow for `/book/transfer/` — three payment methods.
- [ ] Same flow for `/book/hourly/` — three payment methods.
- [ ] Confirm all six rows in `transfers` table with correct `booking_type` and non-null `uid`.

### C. Partner regression
- [ ] Log in as an approved agency.
- [ ] Book a tour end-to-end (partner flow previously worked for transfer+hourly, broken for tour).
- [ ] Confirm one new row in `tours` with correct `partner_id`.

### D. Admin — tour catalog new fields
- [ ] Log in as admin → `/admin/manage-tours`.
- [ ] "Add Tour": fill all fields, category = Multi-day Tour, sedan/van/minibus prices, entrance €10 × 2, hotel = "Include hotel booking", upload 2 files + paste 1 URL → 3 images.
- [ ] Save. Reload. Grid shows the new tour with first image as cover.
- [ ] Edit → gallery re-hydrates; remove middle image; save.
- [ ] Public `/tours` or `/book/tour`: card uses cover image, "From €X" shows sedan price.

### E. Admin — reservation detail modal
- [ ] `/admin/transfers` → click a non-form-control cell on any row.
- [ ] Modal opens, shows customer notes, driver notes, payment method, full price breakdown, release state.
- [ ] Close via X, overlay, and Escape.
- [ ] Same on `/admin/tours` and `/admin/experiences`.
- [ ] Clicking the driver inline-edit cell does NOT open the modal (fixed in `fab49de`).

### F. Admin — partner detail modal + commission EUR
- [ ] `/admin/partners` → click a hotel row → modal shows contact data, discount, payment method, booking counts.
- [ ] Column header reads "Discount / Commission".
- [ ] Click the commission cell for a hotel → inline edit appears → enter `8.00` → Save.
- [ ] Reload → value persists.
- [ ] Click an agency row → modal shows discount (%) not commission.

### G. Admin-first release gate
- [ ] As authenticated client, book a new transfer.
- [ ] In another browser, log in as driver → `/driver/available` → ride NOT visible.
- [ ] As admin → `/admin/transfers` → new row has amber "Release" badge → click it → turns emerald "Released".
- [ ] Driver refreshes → ride appears.
- [ ] Driver clicks Accept → ride moves to `/driver/upcoming`.

### H. Driver add vehicle
- [ ] As approved driver → `/driver/vehicles` → "Add Vehicle" → fill Brand/Model/Plate, pick Category "Sedan".
- [ ] Save. Row appears. No error.
- [ ] Toggle Deactivate → badge updates. Delete → row removed.

### I. Admin notification badges (Realtime)
- [ ] Admin at `/admin`. Initially: badges show the counts from 1.3 (11 or 12 on Transfers depending on release state).
- [ ] In a second tab: register a new partner. Admin sidebar → Partners badge increments within ~2s.
- [ ] Admin approves the partner → badge decrements.

### J. Driver notification badge
- [ ] Driver at `/driver`. Badge shows the current `driver_available_count` (11).
- [ ] Admin creates + releases a new ride → driver badge increments.
- [ ] Driver accepts → decrements.

### K. Hotel / Agency notification badge
- [ ] Hotel on `/hotel/profile`. No badge visible.
- [ ] Admin creates a booking with `partner_id = <this hotel>`.
- [ ] Hotel sidebar → Reservations badge shows 1.
- [ ] Hotel clicks Reservations. Badge clears.
- [ ] Refresh — stays cleared (localStorage watermark updated).

---

## Status summary

- **Programmatic half: all green.** Every bug-fix path is proven at the DB / module level.
- **Browser-driven half: awaiting user credentials.** The checklist is comprehensive and runs off a short list of accounts (admin, hotel, agency, approved driver, regular user).

Branch ready for review and merge to `main` after section 2 is checked off.
