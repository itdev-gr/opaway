# 2026-04-22 — Full-scale smoke test journal

Branch: `feat/admin-booking-notifications-2026-04-22`
Started: 2026-04-22
Dev server port: **4321** (http://localhost:4321)
Stripe mode: **test** (publishable key `pk_test_*`)

Accounts: see `.test-accounts.json` (gitignored). Shared password: `SmokeTest!2026-04-22`.

| role | email | uid |
|---|---|---|
| admin | smoke-admin-2026-04-22@opawey.test | df4ffb6c-b444-4545-bad5-13cc7846645e |
| user | smoke-user-2026-04-22@opawey.test | 005fe47d-e8f7-4c60-b5ae-c5d056eaf9a6 |
| hotel | smoke-hotel-2026-04-22@opawey.test | b1262d59-e410-4666-b010-ea378a3c6229 |
| agency | smoke-agency-2026-04-22@opawey.test | 17ade4af-8c36-477c-b0cb-7f0e8acaafbe |
| driver | smoke-driver-2026-04-22@opawey.test | 01d2fa49-be7a-4c04-8640-971350557bca |
| pending | smoke-pending-2026-04-22@opawey.test | 02e1e877-f180-44b0-b58a-1dc096dfa9d7 |

---

## Status tracker

| Phase / Task | Status | Findings added |
|---|---|---|
| Task 1  Mint test accounts | done | — |
| Task 2  Init journal | done | — |
| Task 3  Dev-server warmup | done | — |
| Task 4  Public pages | done | F1–F5 |
| Task 5  Auth flows | done | F6–F8 |
| Task 6  User profile | done | F9–F14 |
| Task 7  Transfer funnel | done | F15 |
| Task 8  Hourly funnel | done | F16 |
| Task 9  Tour funnel | done | — (no new findings) |
| Task 10 Contact + experience forms | done | F17 |
| Task 11 Admin — bookings | done | F18–F20 |
| Task 12 Admin — management | done | F21 |
| Task 13 Admin — catalog | done | F22–F24 |
| Task 14 Driver — rides | pending | — |
| Task 15 Driver — account | pending | — |
| Task 16 Hotel dashboard | pending | — |
| Task 17 Agency dashboard | pending | — |
| Task 18 Cross-role notifications | pending | — |
| Task 19 Fix pass | pending | — |
| Task 20 Regression | pending | — |

---

## Section reports

### Section 4 — Public pages sweep

| # | URL | Slug | Result | Notes |
|---|---|---|---|---|
| 1 | `/` | home | pass | Google Maps deprecation warnings only; "Book a Tour" CTA in Tours section links to `/book` instead of `/book/tour` (F2) |
| 2 | `/about` | about | pass | Scroll-trigger sections render; no errors |
| 3 | `/contact` | contact | **fail** | Contact form sends `passengers` field not in DB schema → 400 from Supabase, false success banner shown (F1) |
| 4 | `/experiences` | experiences | pass | No experiences in DB; form validates correctly; no errors |
| 5 | `/book` | book | **fail** | Hub page missing "Rent per Hour" service card (F3) |
| 6 | `/book/tour` | booktour | **fail** | "Book Now" catalog cards link to `/book/tour` (same page) with no tour ID; tour is not pre-selected (F4). Logged-out user can reach vehicle-select results page. |
| 7 | `/work-with-us` | workwithus | pass | Hero + partnership CTAs render; all CTAs link to `/register-partner` |
| 8 | `/privacy` | privacy | pass | Content renders, footer present, no errors |
| 9 | `/terms` | terms | pass | Content renders, footer present, no errors |
| 10 | `/asdf-nope` | notfound | pass | 404 page renders; "Back to Home" CTA resolves to `/` |

---

### Section 5 — Auth flows sweep

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 20 scenarios executed.

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Register new user (email/password) | **partial-pass** | auth.users row created; redirect goes to `/` not `/profile`; `public.users` row NOT created (F6) |
| 2 | Register validation errors | pass | Empty → "Please enter email and password." Invalid email → "Please enter a valid email address." Short password → "Password must be at least 8 characters." All inline, no redirect |
| 3 | Register with existing email | pass | "This email is already registered. Try signing in instead." — no duplicate row created |
| 4 | Google OAuth button | note | No Google OAuth button present on `/login` — not a finding |
| 5 | Login valid | pass | Session token in localStorage; redirect to `/` (consistent with Sc1) |
| 6 | Login invalid password | pass | "Invalid login credentials" shown inline; no redirect |
| 7 | Login unknown email | pass | "Invalid login credentials" shown inline; no redirect |
| 8 | Login ?next= honoured | pass | `?next=/profile/dashboard` → landed on `/profile/dashboard` after login |
| 9 | Login ?next= open-redirect (protocol-relative) | pass | `?next=//evil.com/x` → landed on `/` (blocked) |
| 10 | Login ?next= absolute URL blocked | pass | `?next=https://evil.com` → landed on `/` (blocked) |
| 11 | Forgot password | **fail** | Both error and success states rendered simultaneously; email blank in success text (F7) |
| 12 | Partner registration — Hotel | pass | `smoke-reg-hotel-2026-04-22@opawey.test` → `public.partners` type=hotel status=pending confirmed |
| 13 | Partner registration — Agency | pass | `smoke-reg-agency-2026-04-22@opawey.test` → `public.partners` type=agency status=pending confirmed |
| 14 | Partner registration — Driver | pass | `smoke-reg-driver-2026-04-22@opawey.test` → `public.partners` type=driver status=pending confirmed |
| 15 | Partner registration validation | partial-pass | Validation fires but shows one error at a time (password first); no field-by-field highlighting |
| 16 | Logout | pass | Session cleared; redirect to `/`; localStorage has no auth-token |
| 17 | Auth-gated pages unauthenticated | pass | All 5 routes (`/profile/dashboard`, `/admin`, `/driver`, `/hotel`, `/agency`) redirect to `/login`; no `?next=` param preserved |
| 18 | Partner dashboard access control | partial-pass | Hotel→`/admin`: loads briefly then redirects to `/` (not `/login`); Hotel→`/driver`: `/login`; Hotel→`/agency`: `/login`. Inconsistent redirect targets (F8) |
| 19 | Pending partner sign-in | pass | Login succeeds; navigating `/hotel` redirects to `/login` |
| 20 | Booking funnel pre-auth redirect | pass | All three paths encode correctly: `?next=%2Fbook%2F{type}%2Fpassenger&reason=booking` |

**Summary:** 14 pass, 1 fail (Sc11), 2 partial-pass (Sc1, Sc18), 1 partial-pass (Sc15), 1 note (Sc4). Findings F6, F7, F8 raised.

**Cleanup:** `public.partners` and `public.users` smoke-reg-* rows deleted. `auth.users` rows for 4 smoke-reg accounts remain — pending cleanup: auth.users rows with email like `smoke-reg-%` — controller will sweep via `scripts/smoke/create-test-accounts.mjs` rerun or manual admin cleanup.

Screenshots captured: `qa/smoke-authgated-profile-dashboard.png`, `qa/smoke-authgated-admin.png`, `qa/smoke-authgated-driver.png`, `qa/smoke-authgated-hotel.png`, `qa/smoke-authgated-agency.png`, `qa/smoke-F7-hotel-accesses-admin.png`.

---

### Section 3 — Dev-server warmup + environment

- Dev server started cleanly on **http://localhost:4321**.
- Stripe publishable key present and is **test mode** (`pk_test_*`) — Stripe card submissions will use test card `4242 4242 4242 4242` (CVC 123, exp 12/30).
- Playwright MCP browser reached `/` — page title "Opawey", nav / main / hero / footer all present in snapshot. Browser drives OK.
- No console / network errors on home-page load (baseline).

No findings.

---

### Section 6 — User profile dashboard

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. Seeds all succeeded (4/4 rows inserted).

#### Pre-seed results

| Seed | Table | Result |
|---|---|---|
| Transfer (Athens → Piraeus, Sedan) | `public.transfers` | OK — id `7c613fcf` |
| Hourly (Athens → Athens, Van) | `public.transfers` | OK — id `a5724736` |
| Tour (Acropolis Classic) | `public.tours` | OK — id `ad90d25b` |
| Experience request (Greek Cooking Class) | `public.requests` | OK — id `5d4d4644` |

#### Page sweep results

| # | URL | Slug | Result | Notes |
|---|---|---|---|---|
| 1 | `/profile` | profile-root | **fail** | Does not redirect to `/profile/dashboard`; renders incomplete profile info page; Name field shows "—" (F9) |
| 2 | `/profile/dashboard` | profile-dashboard | **partial-pass** | Renders, auth works, navbar shows "Smoke User"; but no stat cards or booking summary — just a welcome text stub (F10) |
| 3 | `/profile/settings` | profile-settings | **partial-pass** | Display name edit works (DB confirmed); password change works and was reverted; but no avatar upload UI (F11), and current-password field is cosmetic/not verified (F12) |
| 4 | `/profile/transfers` | profile-transfers | **partial-pass** | Both seeded transfers shown (transfer + hourly); empty-state renders correctly; but rows are not clickable (no detail view) (F13); booking_type not shown in table |
| 5 | `/profile/trips` | profile-trips | pass | Tour row shows correctly (Date, Tour, Pickup, Passengers, Status); row click: no detail view (same as transfers, consistent if by design) |
| 6 | `/profile/experiences` | profile-experiences | **fail** | Reads from `public.experiences` (legacy), not `public.requests` (current); seeded experience request invisible; always shows empty state (F14) |

**Summary:** 1 pass, 1 partial-pass (dashboard), 2 partial-pass (settings, transfers), 1 fail (profile-root), 1 fail (experiences). Findings F9–F14 raised.

**Password revert:** confirmed — changed to `SmokeTempPw!2026-04-22`, verified login, reverted to `SmokeTest!2026-04-22`, verified login.

Screenshots: `qa/smoke-profile-profile-root.png`, `qa/smoke-profile-profile-dashboard.png`, `qa/smoke-profile-profile-settings.png`, `qa/smoke-profile-profile-transfers.png`, `qa/smoke-profile-profile-trips.png`, `qa/smoke-profile-profile-experiences.png`.

---

### Section 7 — Transfer booking funnel

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 6 matrix rows executed + A1/A2/A3 additional tests.

#### Auth gate spot-check

Navigating to `/book/transfer/passenger` while logged out redirects to `/login?next=%2Fbook%2Ftransfer%2Fpassenger&reason=booking`. Gate is working correctly.

#### Matrix results

| # | Account | Scenario | Payment | Result | DB id | Notes |
|---|---|---|---|---|---|---|
| T1 | user | Athens→Piraeus one-way, 2 pax, 1 child seat, "smoke T1" | cash-onsite | **pass** | `24fa6e95` | `payment_method=cash`, `payment_status=pending`, `child_seats=1`, `uid=005fe47d`, `partner_id=null`, `ride_status=new`, `released_to_drivers=false` |
| T2 | user | Athens→Airport one-way, 2 pax, "smoke T2 card" | card-onsite | **pass** | `5e151c96` | `card_surcharge=4.25` (5% of 85), `payment_status=pending`, all verified |
| T3 | user | Athens→Delphi one-way, 2 pax, "smoke T3 stripe" | stripe | **pass** | `695ec4cb` | `payment_status=paid`, `payment_token=tok_1TP0iL...`, Stripe test card 4242 accepted |
| T4 | user | Athens→Piraeus round-trip same day, 3 pax, sign "Welcome Mr Smoke", "smoke T4" | cash-onsite | **pass** | `937d36d6` | `return_date=2026-05-13`, `return_time=18:00`, `return_price=70`, `sign_name=Welcome Mr Smoke`, `passengers=3` |
| T5 | hotel | Athens→Airport one-way, 2 pax, "smoke T5 hotel" | card-onsite | **pass** | `2082d1b0` | `uid=b1262d59` (hotel), `partner_id=b1262d59` (set correctly for hotel), `card_surcharge=4.25` |
| T6 | agency | Athens→Airport one-way, 2 pax, "smoke T6 agency" | stripe | **pass** | `17fd6fa5` | `uid=17ade4af` (agency), `partner_id=17ade4af` (set correctly), `payment_status=paid`, 10% partner discount applied (€85→€76.50) |

All 6 bookings: `booking_type=transfer`, `ride_status=new`, `released_to_drivers=false`, `total_price>0`.

#### Additional tests

**A1 — Abandonment**: Started T7 (Athens→Piraeus), reached payment step, navigated away, then re-opened the same payment URL. Result: **acceptable** — page repopulates from URL params correctly (order summary, vehicle, price all shown; no error banner). State is stored in the URL, not session storage.

**A2 — Back button**: From payment page, clicked Back → landed on `/book/transfer/passenger` with **all prior inputs intact** (first name, last name, email, phone). Clicked Back again → landed on `/book/transfer/results`. Note: vehicle selection bar did not re-render as "selected" (JS state reset on page reload), but vehicle cards loaded correctly and sidebar showed correct route. Minor UX finding: going back to results requires re-selecting vehicle (F15).

**A3 — Mobile viewport (390×844)**: Navigated to `/book/transfer`, filled step 1. Screenshot: `qa/smoke-T-mobile.png`. No horizontal overflow (`scrollWidth == clientWidth = 390`). Sub-nav tabs, form fields, date/time inputs, passenger counter, and "See prices" button are all accessible and correctly sized. No text-too-small or unclickable-button issues detected. **Pass**.

#### Stripe notes

- Stripe `card` element v3 requires both `exp-date` and `postal` fields. Postal code (`name="postal"`) must be filled or Stripe returns "Your postal code is incomplete." This is not a bug — it's Stripe's default behavior for test mode.
- Stripe iframe is mounted lazily and `stripe-expand` div uses `.hidden` class. The Tailwind `hidden` class sets `display: none`, so the iframe is not visible/interactable until the Stripe payment option is activated via a proper click event (dispatchEvent needed when using JS evaluate).

**Summary:** 6/6 pass, 1 finding raised (F15).

---

### Section 8 — Hourly booking funnel

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 5 matrix rows executed.

#### Pre-run note

The hourly booking form enforces a minimum of 3 hours. Matrix rows H1 and H5 specify 2 hours, which the form blocks with an alert "Minimum rental is 3 hours." Both rows were executed at 3 hours (the enforced minimum). This is logged as F16.

#### Matrix results

| # | Account | Hours (spec→actual) | Pickup | Pax | Payment | Result | DB id |
|---|---|---|---|---|---|---|---|
| H1 | user | 2→3 (min enforced) | Athens, Greece | 2 | cash-onsite | **pass** | `8adee9b6` |
| H2 | user | 4 | Athens, Greece | 3 | card-onsite | **pass** | `09a29ae1` |
| H3 | user | 6 | Athens, Greece | 2 | stripe (4242) | **pass** | `e752b6ef` |
| H4 | user | 12 | Athens | 4 | cash-onsite | **pass** | `f44755d7` |
| H5 | agency | 2→3 (min enforced) | Athens, Greece | 2 | card-onsite | **pass** | `3d20d1cb` |

#### DB verification summary

All 5 rows: `booking_type='hourly'`, `per_hour=60`, `from`=`to` (same location, hourly rental), `ride_status='new'`, `released_to_drivers=false`.

| Row | hours | per_hour | total_price | base_price | card_surcharge | payment_method | payment_status | uid | partner_id |
|---|---|---|---|---|---|---|---|---|---|
| H1 | 3 | 60 | 180 | 180 | 0 | cash | pending | 005fe47d | null |
| H2 | 4 | 60 | 252 | 240 | 12 | card-onsite | pending | 005fe47d | null |
| H3 | 6 | 60 | 360 | 360 | 0 | stripe | paid | 005fe47d | null |
| H4 | 12 | 60 | 720 | 720 | 0 | cash | pending | 005fe47d | null |
| H5 | 3 | 60 | 170.10 | 162 | 8.10 | card-onsite | pending | 17ade4af | 17ade4af |

H5 agency: 10% partner discount applied (€180→€162 base), then 5% card surcharge (€162×1.05=€170.10). `partner_id` set correctly to agency uid.

**Screenshots:** `qa/smoke-H1-success.png`, `qa/smoke-H2-success.png`, `qa/smoke-H3-success.png`, `qa/smoke-H4-success.png`, `qa/smoke-H5-success.png`

**Summary:** 5/5 pass, 1 finding raised (F16).

---

### Section 9 — Tour booking funnel

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 6 matrix rows executed.

#### Seed

- `Smoke Day Tour` inserted into `public.tours_catalog` → id `7b8cf9b5-00bf-4b98-863b-49966e457250`
- `Smoke Multi Day` inserted into `public.tours_catalog` → id `d8d51bd2-aa7b-4ae3-b4dd-b2f652f0aa4e`

#### Pre-flight note (F4 status)

As noted in Section 4, "Book Now" catalog cards still link to `/book/tour` with no tour ID pre-selected (F4 still open). All R1–R6 rows used the dropdown to select tours as the workaround.

#### Matrix results

| # | Account | Tour | Payment | Result | DB id | Notes |
|---|---|---|---|---|---|---|
| R1 | user | Smoke Day Tour (day-tour) | cash-onsite | **pass** | `cec024b2` | `name=Smoke QA1`, `payment_method=cash`, `payment_status=pending`, `total_price=120`, `uid=005fe47d`, `partner_id=null`, `tour_id=7b8cf9b5` (UUID), `vehicle=Sedan` |
| R2 | user | Smoke Day Tour (day-tour) | card-onsite | **pass** | `ba8bc53d` | `payment_method=card-onsite`, `total_price=126` (5% surcharge on 120), `payment_status=pending` |
| R3 | user | Smoke Day Tour (day-tour) | stripe (4242) | **pass** | `4844c2d3` | `payment_method=stripe`, `payment_status=paid`, `total_price=120` (no surcharge on Stripe) |
| R4 | user | Smoke Multi Day (multiday-tour) | cash-onsite | **pass** | `4c9564e1` | `tour_id=d8d51bd2` (correct multiday UUID), `total_price=500`, no hotel dialog triggered on passenger step |
| R5 | hotel | Smoke Day Tour (day-tour) | card-onsite | **pass** | `0d2475f6` | `uid=b1262d59` (hotel), `partner_id=b1262d59` (set correctly), `total_price=126` |
| R6 | agency | Smoke Day Tour (day-tour) | stripe | **pass** | `2cd56050` | `uid=17ade4af` (agency), `partner_id=17ade4af` (set correctly), `total_price=108` (10% agency discount applied), `payment_status=paid` |

#### DB verification summary

All 6 rows confirmed in `public.tours`:

| Row | `name` (single field) | `tour`+`tour_name` | `vehicle`+`vehicle_name` | `uid` correct | `partner_id` | `payment_method` | `payment_status` | `tour_id` is UUID |
|---|---|---|---|---|---|---|---|---|
| R1 | Smoke QA1 | yes | Sedan / Sedan | yes | null | cash | pending | yes |
| R2 | Smoke QA2 | yes | Sedan / Sedan | yes | null | card-onsite | pending | yes |
| R3 | Smoke QA3 | yes | Sedan / Sedan | yes | null | stripe | paid | yes |
| R4 | Smoke QA4 | yes | Sedan / Sedan | yes | null | cash | pending | yes |
| R5 | Smoke QA5 | yes | Sedan / Sedan | hotel uid | hotel uid | card-onsite | pending | yes |
| R6 | Smoke QA6 | yes | Sedan / Sedan | agency uid | agency uid | stripe | paid | yes |

#### Regression check (commit 950e471)

No "Failed to save the booking. Please try again." error observed in any of 6 runs. The fix removing non-existent `first_name`/`last_name` columns is confirmed working. The `name` column is correctly stored as a single full-name string (e.g. "Smoke QA1").

#### Multi-day tour note

`hotel_option='include-booking'` on the Smoke Multi Day tour did **not** trigger any hotel dialog on the passenger step. No finding raised — the feature may not be implemented on the front-end booking form.

**Screenshots:** `qa/smoke-R1-success.png`, `qa/smoke-R2-success.png`, `qa/smoke-R3-success.png`, `qa/smoke-R4-success.png`, `qa/smoke-R5-success.png`, `qa/smoke-R6-success.png`

**Summary:** 6/6 pass, 0 new findings.

---

## Fix status (Phase 4 — as-of-commit log)

| Finding | Severity | Status | Fix commit |
|---|---|---|---|
| F1  | C | fixed-pending-verify | `b4f0c93` contact: rename `passengers` → `participants` |
| F2  | I | fixed-pending-verify | `d212286` home ToursSection CTA → `/book/tour` |
| F3  | I | fixed-pending-verify | `d212286` book hub: add "Rent per Hour" card, 4-col grid |
| F4  | I | fixed-pending-verify | `d212286` /book/tour cards pass `?tour=<id>` + pre-select + scroll |
| F6  | C | fixed-pending-verify | `f6d0aeb` register: `await ensureUserProfile`, redirect `/profile/dashboard` |
| F7  | M | fixed-pending-verify | `85b0aea` forgot-password: mutually-exclusive panes + stricter email regex |
| F12 | C | fixed-pending-verify | `1850609` auth: re-authenticate with current password on profile + driver settings |
| F14 | C | fixed-pending-verify | `34d7a28` profile/experiences: query `requests` source=experience + RLS policy |
| F17 | C | fixed-pending-verify | `b4f0c93` (same fix as F1) |
| F19 | C | fixed-pending-verify | `1cb176e` admin: surface driver inline-edit errors across 3 pages |
| F20 | I | fixed-pending-verify | `6599df5` admin add-transfer: save `vehicle_slug` + surface error |
| F21 | M | fixed-pending-verify | `35c30a2` admin settings: wrap password inputs in `<form>` with autocomplete |
| F23 | H | fixed-pending-verify | `5414086` manage-vehicles: add missing columns + align form payload |
| F24 | H | fixed-pending-verify | `5414086` (same migration + rewrite as F23) |

Pending / deferred (all non-Critical, non-Blocking):

| Finding | Severity | Status | Note |
|---|---|---|---|
| F5  | M | deferred | Footer social icons use `href="#"`. Needs real Opawey social URLs from client. |
| F8  | M | deferred | /admin layout flashes for non-admin before redirect — client-side-only gate. Security polish; not a data leak. |
| F9  | I | deferred | /profile renders orphaned info page. Redesign needed. |
| F10 | I | deferred | /profile/dashboard is a text-only stub. Needs real stat cards / quick actions. |
| F11 | M | deferred | No avatar upload UI on profile/settings. Build-new feature. |
| F13 | I | deferred | /profile/transfers rows not clickable. Detail view would be a new component. |
| F15 | I | deferred | Back from transfer passenger → results resets vehicle selection. Wizard state hardening. |
| F16 | I | deferred | Hourly funnel enforces 3-hour minimum but plan matrix specified 2. Verify with business whether 3 is intentional. |
| F18 | I | deferred | Admin sidebar notification badges stale until refresh. Supabase Realtime subscription likely not delivering events. Needs Realtime config investigation on the live project. |
| F22 | I | deferred | manage-experiences has no category/entrance-ticket/hotel-option/gallery fields. Columns exist in `experiences_catalog` (migration 2026-04-22-tours-catalog-categories.sql added them), form UI is the gap. Parity refactor. |

**Summary:** 14 of 24 findings (58%) closed — all Critical (6) and Blocking (2), plus 4 Important and 2 Minor.
**Verification:** UI-level regression of all 14 fixed-pending-verify items is deferred until Playwright MCP reconnects (Task 20). DB-level simulation confirmed new shape for F1/F17, F14, F19, F23/F24.

---

## Punch list

<!-- One `### F<N>` block per finding, added in the order discovered.
Finding template:

### F<N> — <severity C/I/M> — <area> — <one-line title>

**Page:** <route or component>
**Preconditions:** <account logged in / catalog state / etc.>
**Repro:**
1. …
**Expected:** …
**Observed:** …
**Console / network errors:** <pasted or "none">
**Screenshot:** `qa/smoke-F<N>.png`
**Status:** open | fixed-pending-verify | verified | wontfix
**Fixed in:** <commit sha>
**Verified:** <re-run note>
-->

### F15 — I — transfer-results — Vehicle selection state not preserved on back navigation from passenger page

**Page:** `/book/transfer/results`
**Preconditions:** Navigate results → select vehicle → continue to passenger → click Back
**Repro:**
1. Complete step 1 on `/book/transfer` and land on `/book/transfer/results`
2. Click a vehicle card (e.g. Sedan) — selection bar appears showing "Your choice: Sedan"
3. Click Continue → `/book/transfer/passenger` loads with correct data
4. Click Back → returns to `/book/transfer/results`
**Expected:** The previously selected vehicle is highlighted and the "Continue" selection bar shows "Your choice: Sedan".
**Observed:** Page reloads from history; vehicle cards re-render via JS. The selection bar is hidden (`selectionBarHidden=true`) and `selected-name` is empty — the user must re-select a vehicle to proceed. The Tailwind border highlight appears on the first card (likely a CSS class-inheritance artifact from the previous render), but the JS state (`selectedVehicleSlug`) is reset to empty.
**Console / network errors:** none
**Screenshot:** not captured (minor UX issue)
**Status:** open

---

### F16 — I — hourly-funnel — Hourly booking form enforces 3-hour minimum; matrix rows H1 and H5 (2 hours) cannot be booked as specified

**Page:** `/book/hourly`
**Preconditions:** any authenticated user
**Repro:**
1. Navigate to `/book/hourly`
2. Set Hours to 2 using the "Fewer hours" button (default is 3; click "−" once)
3. Click "See prices"
**Expected:** Either (a) 2-hour bookings are accepted, or (b) the "−" button is disabled at 3 (minimum), preventing the user from reaching an invalid state.
**Observed:** The form allows decrement to 2 but then blocks submission with alert "Minimum rental is 3 hours." and a validation error. The booking cannot proceed at 2 hours — the funnel enforces a 3-hour floor. Matrix rows H1 and H5 were therefore executed at 3 hours instead of 2.
**Console / network errors:** none
**Screenshot:** none (form-level validation, no crash)
**Notes:** This may be intentional business logic. If the minimum is 3 hours the counter should not allow decrement below 3, or the matrix should be updated to reflect the minimum. The "−" button remains enabled at 2 but does not allow proceeding.
**Status:** open

---

### F1 — C — contact-form — Contact form inserts `passengers` column that does not exist; shows false success

**Page:** `/contact`
**Preconditions:** logged out
**Repro:**
1. Navigate to `/contact`
2. Fill Name = "Smoke", Last Name = "QA", Email = `smoke-contact-2026-04-22@opawey.test`, Phone = "+30 000", City = "Athens", Country = "Greece", Passengers = 2, Vehicle = "Sedan", Comments = "Testing the contact form."
3. Click "Send Message"
**Expected:** Row inserted in `public.requests`; success banner shown only after confirmed DB write.
**Observed:** Supabase REST returns `400 — PGRST204: Could not find the 'passengers' column of 'requests' in the schema cache`. Despite the failed insert, the page displays a "Message sent! Thank you" success state. DB row confirmed absent via SQL.
**Console / network errors:**
```
[ERROR] Failed to load resource: 400 @ https://wjqfcijisslzqxesbbox.supabase.co/rest/v1/requests
[ERROR] {code: PGRST204, details: null, hint: null, message: Could not find the 'passengers' column of 'requests' in the schema cache}
```
**Screenshot:** `qa/smoke-public-contact.png`
**Root cause:** `/contact.astro` sends `passengers` field; the `requests` table uses `participants` (integer). The success state is shown unconditionally before checking `error`.
**Status:** fixed-pending-verify
**Fixed in:** `b4f0c93` — renamed payload key in `src/pages/contact.astro:331` from `passengers` to `participants`. DB-level insert with the new shape succeeds (returns row). UI-level regression pending Playwright MCP restoration (will check that success banner only shows on actual 201, not false-positive).

---

### F2 — I — home — "Book a Tour" CTA in Tours section links to `/book` instead of `/book/tour`

**Page:** `/`
**Preconditions:** logged out
**Repro:**
1. Navigate to `/`
2. Scroll to the "Tours" marketing section
3. Inspect or click the "Book a Tour →" CTA button
**Expected:** Link resolves to `/book/tour` (the tour booking funnel).
**Observed:** `href="/book"` — routes to the generic booking hub page, not the tour funnel.
**Console / network errors:** none
**Screenshot:** `qa/smoke-public-home.png`
**Status:** open

---

### F3 — I — book-hub — `/book` hub page missing "Rent per Hour" service card

**Page:** `/book`
**Preconditions:** logged out
**Repro:**
1. Navigate to `/book`
2. Inspect the service cards rendered
**Expected:** Three or four cards: Book a Transfer, Rent per Hour, Book a Tour, (Book an Experience).
**Observed:** Only three cards: Book a Transfer, Book a Tour, Book an Experience. "Rent per Hour" is absent even though `/book/hourly` exists and the navbar BOOK ONLINE dropdown includes it.
**Console / network errors:** none
**Screenshot:** `qa/smoke-public-book.png`
**Status:** open

---

### F4 — I — book-tour — Catalog "Book Now" buttons link back to `/book/tour` with no tour pre-selected

**Page:** `/book/tour`
**Preconditions:** logged out
**Repro:**
1. Navigate to `/book/tour` and wait for catalog to load
2. Click "Book Now" on any tour card in the grid below the form
**Expected:** Either (a) the tour ID is passed as a query param so the booking form pre-selects that tour, or (b) user is navigated to a tour detail page.
**Observed:** All "Book Now" links have `href="/book/tour"` (hard-coded, no query params). Clicking reloads the page; the tour-select dropdown reverts to the placeholder "Select a tour...".
**Console / network errors:** none
**Screenshot:** `qa/smoke-public-booktour.png`
**Status:** open

---

### F5 — M — footer — Social media links (Facebook, X, Instagram) all use `href="#"`

**Page:** All pages (footer component)
**Preconditions:** logged out
**Repro:**
1. Inspect footer social icons on any page
**Expected:** Each social icon links to the official Opawey social profile.
**Observed:** All three icon links use `href="#"` (dead placeholder links).
**Console / network errors:** none
**Screenshot:** `qa/smoke-public-home.png`
**Status:** open

---

### F6 — C — register — New user registration does not create `public.users` row; post-register redirect goes to `/` not `/profile`

**Page:** `/register`
**Preconditions:** logged out; email not previously registered
**Repro:**
1. Navigate to `/register`
2. Fill full name, email=`smoke-reg-user-2026-04-22@opawey.test`, password, confirm password, check terms
3. Click "Create Account"
**Expected:** (a) Row created in `public.users` with `type='user'`; (b) redirect to `/profile` or `/profile/dashboard`.
**Observed:** (a) `auth.users` row created (confirmed via SQL) but `public.users` has NO corresponding row — DB trigger/function to create public profile on signup is absent or failing. (b) Redirect lands on `/` (home), not `/profile`. Login flow has the same `/` redirect issue.
**Console / network errors:** none visible at registration time
**Screenshot:** none (redirect resolved before capture)
**Root cause:** Missing `handle_new_user` trigger on `auth.users` insert, or function is not inserting into `public.users`. Post-auth redirect target is hardcoded to `/` instead of `/profile`.
**Status:** open

---

### F7 — M — forgot-password — Reset-password form shows simultaneous error + success states; email blank in success message

**Page:** `/forgot-password`
**Preconditions:** logged out
**Repro:**
1. Navigate to `/forgot-password`
2. Enter `smoke-user-2026-04-22@opawey.test`
3. Click "Send reset link"
**Expected:** Single success banner "We've sent a password reset link to smoke-user-2026-04-22@opawey.test"; no error visible.
**Observed:** Both "Something went wrong. Please try again." AND "We've sent a password reset link to  " (email blank) appear simultaneously. Console shows 2 errors.
**Console / network errors:** 2 errors in browser console (content not captured — likely a Supabase email provider or redirect URL config issue)
**Screenshot:** none captured
**Root cause:** The forgot-password component renders both `errorState` and `successState` concurrently instead of exclusively; the email is not interpolated correctly into the success message. Likely the Supabase project has no email provider configured for `resetPasswordForEmail`.
**Status:** open

---

### F8 — M — access-control — `/admin` redirect for non-admin authenticated user goes to `/` not `/login`; admin page HTML briefly loads before redirect

**Page:** `/admin`
**Preconditions:** logged in as `smoke-hotel-2026-04-22@opawey.test` (type=hotel, not admin)
**Repro:**
1. Log in as smoke-hotel
2. Navigate to `/admin`
3. Observe page title flash and final URL
**Expected:** Immediate redirect to `/login` (or an access-denied page), consistent with the behavior of `/driver` and `/agency` which redirect hotel users to `/login`.
**Observed:** Page title briefly shows "Dashboard — Opaway" (admin layout HTML is rendered), then client-side guard fires and redirects to `/` (home), not `/login`. `/driver` and `/agency` redirect to `/login` — inconsistent. The admin layout SSR output is momentarily in the DOM before the redirect.
**Console / network errors:** none
**Screenshot:** `qa/smoke-F7-hotel-accesses-admin.png` (captured on `/` after redirect)
**Root cause:** Admin page uses a client-side auth guard (React island) rather than server-side middleware. Redirect target is `/` instead of `/login`. Other protected partner dashboards use a different guard that correctly targets `/login`.
**Status:** open

---

### F9 — I — profile-root — `/profile` does not redirect to `/profile/dashboard`; renders a minimal account-info page instead

**Page:** `/profile`
**Preconditions:** logged in as smoke-user
**Repro:**
1. Navigate to `/profile`
**Expected:** Redirect (302/client) to `/profile/dashboard`.
**Observed:** `/profile` renders its own page (heading "Profile", showing Name = "—" and Email fields, and a "Sign out" button). URL stays at `/profile`; no redirect occurs.
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-root.png`
**Notes:** Name field shows "—" even though `public.users.display_name` is "Smoke User". The /profile page appears to not query `public.users` at all. The sidebar nav shows a "Dashboard" link that goes to `/profile/dashboard` — indicating the two pages serve different purposes but `/profile` is an orphaned, incomplete view.
**Status:** open

---

### F10 — I — profile-dashboard — Dashboard has no stat cards or booking summary; renders only a welcome text paragraph

**Page:** `/profile/dashboard`
**Preconditions:** logged in as smoke-user; 2 transfers, 1 tour, 1 experience request seeded
**Repro:**
1. Navigate to `/profile/dashboard`
**Expected:** Summary cards showing counts of transfers, trips, experiences; quick links.
**Observed:** Only text: "Welcome to your dashboard. Use the menu to view transfers, trips, experiences, or settings." No stat cards, no counts, no quick links to bookings.
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-dashboard.png`
**Notes:** Navbar shows "Smoke User" correctly. Dashboard appears to be a placeholder/stub page.
**Status:** open

---

### F11 — M — profile-settings — Settings page has no avatar upload UI; `photo_url` column is never populated via UI

**Page:** `/profile/settings`
**Preconditions:** logged in as smoke-user
**Repro:**
1. Navigate to `/profile/settings`
2. Look for avatar/profile picture upload control
**Expected:** An avatar upload section allowing the user to pick an image file, which uploads to Supabase Storage `images` bucket and updates `public.users.photo_url`.
**Observed:** No avatar upload section exists anywhere on the settings page. The page only has "Profile Information" (display name + email + provider badge), "Change Password", and "Danger Zone".
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-settings.png`
**Root cause:** Feature not implemented. `public.users.photo_url` is confirmed NULL for smoke-user.
**Status:** open

---

### F12 — C — profile-settings — "Current Password" field in Change Password is cosmetic; password is changed without verifying it

**Page:** `/profile/settings`
**Preconditions:** logged in as smoke-user
**Repro:**
1. Navigate to `/profile/settings`
2. Fill "Current Password" with any arbitrary string (even incorrect password)
3. Fill "New Password" and "Confirm New Password" with valid matching passwords
4. Click "Update Password"
**Expected:** The form should verify the current password against the stored credential before updating; an incorrect current password should return an error.
**Observed:** Password is updated unconditionally — `supabase.auth.updateUser({ password: newPw })` is called directly without verifying `currentPassword`. The "Current Password" input is visually present but its value is never used in the handler code.
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-settings.png`
**Root cause:** `settings.astro` password handler reads `newPasswordInput` and `confirmPasswordInput` only; `currentPasswordInput.value` is never passed to `supabase.auth.reauthenticate()` or similar. Any logged-in attacker with brief access to an unlocked session can change the password silently.
**Status:** open

---

### F13 — I — profile-transfers — Transfer rows are not clickable; no detail view on row click

**Page:** `/profile/transfers`
**Preconditions:** logged in as smoke-user; 2 transfer rows seeded
**Repro:**
1. Navigate to `/profile/transfers`
2. Click either transfer row
**Expected:** Navigation to a detail view (e.g. `/profile/transfers/<id>`) or an inline expanded detail panel.
**Observed:** Row click fires no action. URL stays at `/profile/transfers`. No detail view exists.
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-transfers.png`
**Notes:** Rows display: Date, From, To, Vehicle, Status, Price — price column present. `booking_type` is not shown (cannot distinguish transfer vs hourly from list). Empty-state: "No transfers yet. Book a transfer." renders correctly with working link.
**Status:** open

---

### F14 — C — profile-experiences — `/profile/experiences` queries `public.experiences` table, not `public.requests`; experience requests seeded into `requests` are invisible to users

**Page:** `/profile/experiences`
**Preconditions:** logged in as smoke-user; experience request seeded in `public.requests` with `source='experience'`, `user_id='005fe47d...'`
**Repro:**
1. Seed a row in `public.requests` with `source='experience'` for the smoke user
2. Navigate to `/profile/experiences`
**Expected:** The seeded experience request appears in the list.
**Observed:** Page queries `public.experiences` table (column `uid`), not `public.requests`. The seeded `requests` row is invisible. Page shows "No experiences yet."
**Console / network errors:** none
**Screenshot:** `qa/smoke-profile-profile-experiences.png`
**Root cause:** The `/experiences` public page was rewritten to a request-only form (commit `c7b4ec9`) which submits to `public.requests`. But the profile page `/profile/experiences` still reads from the legacy `public.experiences` table. The two halves of the feature are now disconnected — users submit to `requests`, but their "My experiences" view reads from `experiences`. No experience request is ever surfaced back to the user.
**Status:** open

---

### Section 10 — Contact + experience request forms

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`.

Pre-seed: inserted one row into `public.experiences_catalog` (id `f6aeed25`) titled "Smoke E1 Experience" so E1 has a catalog entry to select.

#### C1 — Contact valid submission (authenticated)

| Metric | Result |
|---|---|
| Account | smoke-user (uid `005fe47d`) |
| Network call | `POST /rest/v1/requests` → **400** |
| Error code | `PGRST204: Could not find the 'passengers' column of 'requests' in the schema cache` |
| UI behaviour | Error banner shown: "Something went wrong. Please try again." — form stays visible |
| DB row | **None** — confirmed by SQL (no row for uid `005fe47d` or email `smoke-c1-auth-2026-04-22@opawey.test` post-test) |
| F1 reference | Root cause identical to F1 (`passengers` field does not exist; correct column is `participants`). **F1 is still open.** |
| F1 false-success | F1 originally documented a false success banner for logged-out context. Current re-test (both authenticated and logged-out) shows the error banner correctly — the false-success UI behaviour may have been fixed or was a prior misread. The insert failure is confirmed and unchanged. No new finding raised; referencing F1. |

#### C2 — Contact empty submission (logged out)

| Metric | Result |
|---|---|
| Account | logged out |
| Action | Click "Send Message" with all fields empty |
| Result | **pass** — custom JS validation fires before submission; inline error "Please select your country." shown; no network request sent |
| Validation pattern | Sequential per-field checks; shows first missing field error, not all at once. Fields validated in order: country → city → name → last name → phone → email → passengers → vehicle type → message |

No new finding. Validation works as expected.

#### E1 — Experience request valid submission (logged out)

| Metric | Result |
|---|---|
| Account | logged out |
| Network call | `POST /rest/v1/requests` → **201** |
| UI behaviour | "Request sent!" success panel shown; form body hidden |
| Screenshot | `qa/smoke-E1-success.png` |
| DB row confirmed | id `37718da7` |
| `source` | `"experience"` |
| `experience_id` | `"f6aeed25-bd12-4470-907e-41d0ab4e2fc2"` (UUID from `experiences_catalog`) — **populated** |
| `experience_name` | `"Smoke E1 Experience"` — **populated** |
| `pickup_location` | `"Athens city center"` |
| `date` / `time` | `"2026-06-15"` / `"10:00"` |
| `participants` | `2` |
| `name` / `last_name` | `"Smoke"` / `"E1"` |
| `phone` | `"+30 000"` |
| `special_requests` | `"smoke E1"` |
| `user_id` | `null` (logged out — correct) |

**Pass.** All fields written correctly. `source='experience'` confirmed per 2026-04-20 migration.

Note: `experiences_catalog` was empty before this test run (Section 4 noted "No experiences in DB"). One catalog entry was seeded as a pre-condition for E1. The experience form itself is healthy; the DB round-trip succeeded end-to-end.

#### E2 — Experience request empty submission (logged out)

| Metric | Result |
|---|---|
| Account | logged out |
| Action | Click "Send request" with all fields empty |
| Result | **pass** — all 6 field errors shown simultaneously inline: experience-select ("Please select an experience."), experience-date ("Please select an experience date."), r-first-name ("First name is required."), r-last-name ("Last name is required."), r-email ("Email is required."), r-phone ("Phone number is required.") |
| Network | No request sent |

Better validation UX than contact form (all errors shown simultaneously vs first-error-stops pattern).

#### E3 — Experience request without experience selected

The form enforces experience selection — `experienceId` is validated before submit, and an error is shown if blank. There is no UI path to submit with `experience_id = NULL`. **E3 not applicable — form prevents null experience_id submission.**

**Summary:** 1 new finding raised (F17). F1 (contact `passengers` column mismatch) confirmed still open in authenticated context — root cause unchanged; F17 documents the auth-context reproduction and clarifies the F1 false-success discrepancy. E1 experience form end-to-end pass. E2 and C2 validation both pass.

**Screenshots:** `qa/smoke-E1-success.png`

---

### F17 — C — contact-form — Contact form `passengers` column mismatch causes all submissions to fail with 400; F1 root cause confirmed still open in authenticated context

**Page:** `/contact`
**Preconditions:** logged in as smoke-user (uid `005fe47d`)
**Repro:**
1. Log in as smoke-user
2. Navigate to `/contact`
3. Fill all required fields (country=Greece, city=Athens, name=Smoke User, last\_name=C1, phone=+30 000, email=smoke-c1-auth-2026-04-22@opawey.test, passengers=2, vehicle=Sedan, message=Auth-user contact submission)
4. Click "Send Message"
**Expected:** Row inserted into `public.requests`; success state shown.
**Observed:** `POST /rest/v1/requests` returns 400 `PGRST204: Could not find the 'passengers' column of 'requests' in the schema cache`. Error banner "Something went wrong. Please try again." displayed correctly (no false success). No DB row created.
**Console / network errors:**
```
[ERROR] Failed to load resource: 400 @ https://wjqfcijisslzqxesbbox.supabase.co/rest/v1/requests
[ERROR] {code: PGRST204, details: null, hint: null, message: Could not find the 'passengers' column of 'requests' in the schema cache}
```
**Root cause:** `/contact.astro` sends `passengers: parseInt(passengers)` but the `requests` table column is named `participants` (integer). Confirmed by checking `requests` schema: `participants int` exists; `passengers` does not. Affects both authenticated and unauthenticated users — 100% of contact form submissions fail. F1 was first raised from a logged-out session in Section 4; this confirms the same bug in an authenticated context.
**Note on F1 false-success:** F1 originally documented that the UI showed a false success despite the 400. Current re-test shows the error banner correctly. The UI behaviour may have been silently fixed (error path now correctly caught), but the root cause (wrong column name) remains unresolved.
**Screenshot:** none (same error as F1)
**Status:** fixed-pending-verify
**Fixed in:** `b4f0c93` (same fix as F1 — single-line rename)

---

### Section 11 — Admin dashboard (bookings)

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 5 sub-pages swept.

#### 11.1 — `/admin` (home calendar)

| Check | Result | Notes |
|---|---|---|
| Navigate + screenshot | pass | `qa/smoke-admin-home.png` captured |
| Prev/Next month buttons | pass | April → May → April; heading updates correctly |
| Day cell with bookings (Day 17, count=6) — click | pass | Day-detail panel shows "Bookings for Friday, April 17, 2026" with 6 rows |
| Day cell with 0 bookings (Day 27) | pass | "No bookings on this day." empty state shown |
| Legend dots | pass | Transfer=`bg-[#0C6B95]` (blue), Tour=`bg-emerald-500`, Experience=`bg-violet-500`, Request=`bg-amber-500` — all correct |
| Sidebar notification badges | pass | Requests=2, Transfers=25 (new-only), Tours=7, Experiences=0, Partners=1 — all present and accurate on page load |
| Sidebar badges update on cross-page navigation | pass | After deleting requests on 11.2 page, navigating back to Transfers shows Requests=0 (updated on fresh load) |
| Realtime badge update (same-page) | observation | Badge does not update in real-time without page refresh — Supabase Realtime likely not active or not subscribed in sidebar. Count stays stale until page reload |
| Mobile burger menu toggle | pass | 390×844 viewport: "Open menu" button appears; click → sidebar slides in (transform: none); click again → `-translate-x-full` class applied (hidden). Toggle works correctly |

**Summary 11.1:** all pass.

---

#### 11.2 — `/admin/requests`

| Check | Result | Notes |
|---|---|---|
| Tabs: All / New / Answered / Follow-up / Discarded / Tour Requests / Contact Messages | pass | All 7 tabs present and filter correctly |
| Tab counts vs DB | partial-pass | DB: new=2, discarded=1 (total 3). UI: All=2, New=2, Discarded=1 — "All" tab excludes discarded rows (counts active only). Consistent with intended behavior |
| Actions dropdown per row | pass | Opens correctly; shows Mark as Answered / Mark as Follow up / Discard / Delete |
| Mark as Answered | pass | Row status → "answered" in UI; DB confirmed `status='answered'` |
| Mark as Follow up | pass | Row status → "follow-up" in UI; DB confirmed `status='follow-up'` |
| Discard | pass | Row moves to Discarded tab; tab counts update; DB confirmed `status='discarded'` |
| Delete + confirmation modal | pass | "Delete Request" modal with "Are you sure? Cannot be undone." — Cancel + red Delete buttons; confirmed delete removes row from DB |
| Restore / back to New option | note | No "Restore to New" action exists in any dropdown — once answered/discarded, can only discard further or delete. Not a finding unless spec requires it |
| Tour Requests tab | pass | Shows empty (no tour requests with status=new) |
| Contact Messages tab | pass | Shows empty (no contact source rows) |

**Summary 11.2:** all pass. 1 finding: **F18** (sidebar badge stale until page reload — Realtime not active).

---

#### 11.3 — `/admin/transfers`

| Check | Result | Notes |
|---|---|---|
| Table shows rows | pass | 37–38 rows (seeded + admin-added); all smoke booking rows present |
| Add Booking modal opens | pass | "Add Transfer Booking" modal with all fields: First/Last Name, Email, Phone, From, To, Date, Time, Passengers, Vehicle, Notes, Ride Status |
| Google Places autocomplete on From | pass | `.pac-container` present; typing "Athens Airport" surfaces suggestions including full airport name |
| Google Places autocomplete on To | pass | typing "Monastiraki" surfaces 5 suggestions |
| Passengers field default empty | note | Input `type=number` has placeholder "1" but `value=""` — HTML5 validation blocks submit until filled. Minor UX: should default to 1 |
| Submit → new row with `added_by_admin=true` | pass | Row `6ef30e06` inserted; DB confirms `added_by_admin=true`, `date=2026-06-15`, `notes=Smoke admin Add Booking test 11` |
| `vehicle_slug` on admin-added row | note | DB shows `vehicle_slug=""` despite "Sedan" selected — modal form may write to `vehicle` (display) column not `vehicle_slug`. Observation only |
| Driver inline-edit: click span → input | pass | Clicking driver "Unassigned" span shows `input[placeholder="Driver name"]`; typing "Smoke Driver" updates UI display |
| Driver inline-edit does NOT open modal | pass | Confirmed: `z-[60]` modal wrapper remains `display:none` when driver span is clicked — regression fix is working |
| Driver inline-edit: DB persisted | **fail** | `driver_uid` remains `""` in DB after blur and Enter key. **F19** |
| Ride Status select → 'assigned' | pass | DB confirmed `ride_status='assigned'`; reverted to 'new' |
| Payment Status select → 'paid' | pass | DB confirmed `payment_status='paid'`; reverted to 'pending' |
| Release toggle: amber → emerald | pass | DB confirmed `released_to_drivers=true` |
| Release toggle: emerald → amber (revert) | pass | DB confirmed `released_to_drivers=false` |
| Click non-form-control cell → ReservationDetailModal | pass | Name cell click opens "Transfer booking Ref 6EF30E06" modal |
| Modal shows notes, driver, payment method, sign name | pass | Visible: Customer, Email, Booking type, From, To, Date, Time, Passengers, Child seats, Vehicle, Total price, Base price, Outward price, Return price, Card surcharge, Payment method, Payment status, Ride status, Driver, Released to drivers, Customer notes, Created |
| Close via X | pass | X button closes modal (display:none) |
| Close via overlay/backdrop click | pass | `.bg-black/40` backdrop click closes modal |
| Close via Escape key | pass | Escape key closes modal |

**Summary 11.3:** 1 finding raised (**F19** — driver inline edit not persisted to DB).

---

#### 11.4 — `/admin/tours`

| Check | Result | Notes |
|---|---|---|
| Table shows rows | pass | 7 rows — matches sidebar badge |
| Add Booking modal — tour-select dropdown populated | pass | 8 tours from `tours_catalog` (published=true): Smoke Multi Day, Smoke Day Tour + 6 live catalog tours |
| Detail modal shows `special_requests` + `notes` + `vehicle` | pass | "Tour booking Ref 2CD56050": Vehicle=Sedan, Special requests="smoke R6", Notes="smoke R6" — all present |
| Same ride-status / payment / release controls | pass | Comboboxes and Release buttons present in table rows |

**Summary 11.4:** all pass.

---

#### 11.5 — `/admin/experiences`

| Check | Result | Notes |
|---|---|---|
| Table shows rows | pass (empty) | 0 rows — matches sidebar badge (0); empty state "No experiences found." shown correctly |
| Add Booking modal — experience-select populated | pass | 1 experience from `experiences_catalog` ("Smoke E1 Experience" — seeded in Section 10) |
| Add Booking modal fields | pass | Full Name, Email, Phone, Experience (select), Pickup Location, Date, Time, Passengers, Notes, Ride Status |

**Summary 11.5:** all pass.

**Screenshots:** `qa/smoke-admin-home.png`, `qa/smoke-admin-mobile-menu.png`, `qa/smoke-transfers-add-booking-modal.png`, `qa/smoke-transfers-add-booking-form.png`, `qa/smoke-F18-driver-cell-opens-modal.png` (disproved — modal not actually open), `qa/smoke-transfers-detail-modal.png`, `qa/smoke-tours-add-booking-modal.png`, `qa/smoke-experiences-add-booking-modal.png`, `qa/smoke-requests-delete-modal.png`

---

### F18 — I — admin-sidebar — Sidebar notification badges do not update in real-time; stale until page refresh

**Page:** `/admin/requests` (and other admin pages)
**Preconditions:** logged in as admin; perform an action that changes badge count (e.g. mark all requests as answered/discarded/deleted)
**Repro:**
1. Navigate to `/admin/requests` — sidebar shows "Requests 2"
2. Mark both requests as answered (badge source: new requests)
3. Observe sidebar badge on the same page
**Expected:** Badge updates in real-time via Supabase Realtime subscription.
**Observed:** Badge stays at "2" until navigating to another page and back. On fresh page load, badge shows correct count (0 after deleting all active requests).
**Console / network errors:** none; no Supabase Realtime connection visible in network tab
**Screenshot:** `qa/smoke-admin-home.png` (baseline)
**Root cause:** Sidebar badge counts appear to be computed at page load via a single `count()` query. No Supabase Realtime subscription updates the badge in real time. As noted in gotchas — if Realtime is disabled on the project, live badge updates will not occur.
**Status:** open
**Severity:** Info — the badge is accurate on fresh page loads; stale only during same-page interactions.

---

### F19 — C — admin-transfers — Driver inline-edit saves to UI but does not persist to DB; `driver_uid` remains empty

**Page:** `/admin/transfers`
**Preconditions:** logged in as admin; any transfer row with "Unassigned" driver
**Repro:**
1. Navigate to `/admin/transfers`
2. Click "Unassigned" driver cell in any row → input with placeholder "Driver name" appears
3. Type "Smoke Driver"
4. Blur the input (click elsewhere or press Enter)
5. UI cell now shows "Smoke Driver"
6. Query DB: `SELECT driver_uid FROM transfers WHERE id = '<row-id>'`
**Expected:** `driver_uid` updated in DB with the typed name (or matched driver UID).
**Observed:** `driver_uid` remains `""` (empty string) in DB. The change is cosmetic/local state only. On page refresh the cell reverts to "Unassigned".
**Console / network errors:** none visible; no PATCH/UPDATE network request was made when blurring
**Screenshot:** none
**Root cause:** The inline-edit component updates local React state on blur but does not fire a `supabase.from('transfers').update({ driver_uid: ... })` call. The `driver_uid` column is text (not a UUID foreign key) so name matching is not required — the update is simply absent. This also explains why the detail modal shows "Smoke Driver" (reads from same local state) but DB has empty string.
**Status:** open

---

### F20 — I — admin-transfers — `vehicle_slug` not saved when adding booking via admin modal; modal saves `vehicle` display name but not `vehicle_slug`

**Page:** `/admin/transfers` → "Add Booking" modal
**Preconditions:** logged in as admin
**Repro:**
1. Open "Add Booking" modal
2. Select "Sedan" from Vehicle dropdown
3. Fill all required fields and click "Save Booking"
4. Query DB: `SELECT vehicle_slug, vehicle FROM transfers WHERE id = '<new-id>'`
**Expected:** Both `vehicle` (display name) and `vehicle_slug` (e.g. "sedan") populated.
**Observed:** `vehicle_slug=""` (empty) in DB. The `vehicle` column likely gets the display name but `vehicle_slug` is not sent in the INSERT payload.
**Console / network errors:** none
**Screenshot:** none
**Root cause:** The admin Add Transfer Booking modal form only writes the selected option's `text` value (display name), not the slug. The `vehicle_slug` field is either not mapped or not included in the INSERT.
**Status:** open

---

### Section 12 — Admin management

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. All 5 sub-pages swept.

#### 12.1 — `/admin/partners`

| Check | Result | Notes |
|---|---|---|
| Page renders, 8 partners shown | pass | "8 of 8 partners" counter correct |
| Sidebar badges on load | pass | Requests=0, Transfers=26, Tours=7, Experiences=0, Partners=1 |
| Search by name/email ("smoke") | pass | Filters from 8 → 4 smoke partners in real time |
| Type filter: Hotels | pass | 3 Hotel rows |
| Type filter: Agencies | pass | 3 Agency rows |
| Type filter: Drivers | pass | 2 Driver rows |
| Status filter: Pending | pass | 1 row (smoke-pending) |
| Status filter: Approved | pass | 7 rows |
| Column header "Discount / Commission" | pass | Header text confirmed |
| Sort by Type asc | pass | Agency, Agency, Agency, Driver, Driver, Hotel, Hotel, Hotel |
| Sort by Type desc | pass | Hotel, Hotel, Hotel, Driver, Driver, Agency, Agency, Agency |
| Sort by Status asc | pass | 7 approved rows first, 1 pending last |
| Sort by Registered desc | pass | 22/4/2026 × 4, 8/4/2026, 7/4/2026 × 3 |
| Agency row: commission cell shows "10%" | pass | `discount-cell` with "Click to edit discount" tooltip |
| Agency inline-edit → save 15 → reload → 15% | pass | DB persisted; UI shows 15% after reload |
| Agency inline-edit → revert to 10 | pass | DB confirmed |
| Hotel row: commission cell shows "€10.00" | pass | `discount-cell` with "Click to edit commission" tooltip |
| Hotel inline-edit → save 12.50 → reload → €12.50 | pass | DB persisted |
| Hotel inline-edit → revert to 10.00 | pass | DB confirmed |
| Driver row: discount cell shows "—" ("Click to edit discount") | pass | Driver shows % discount tooltip, not commission |
| Pending partner Approve → confirmation modal | pass | "Approve 'Pending Hotel' as a partner?" modal shown |
| Approve Confirm → status=approved in UI | pass | Row shows "approved" |
| Revert smoke-pending to pending via API | pass | `PATCH /rest/v1/partners` with admin JWT → 200, status='pending' confirmed |
| Reject action → confirmation modal | pass | "Reject 'Pending Hotel'? status will be set to rejected." |
| Reject Confirm → status=rejected in UI | pass | Row shows "rejected" |
| Revert smoke-pending to pending via API | pass | 204 response; reload confirms "pending" |
| Hotel row click → PartnerDetailModal opens | pass | Modal shows within 1.5s |
| Modal: type badge "Hotel", status "Approved" | pass | Badges correct |
| Modal: Transfers=1, Tours=1, Experiences=0 | pass | Matches Tasks 7/9 hotel bookings |
| Modal: Commission (EUR) €10.00 shown | pass | After revert from 12.50 |
| Modal: no Discount (%) row for hotel | pass | `hasDiscount: false` confirmed |
| Modal: Contact, Hotel, Payment Data sections | pass | "No payment data on file." for hotel |
| Close modal via X button | pass | Modal hidden (has `hidden` class) |
| Agency row click → modal | pass | Type badge "Agency", Discount (%): 10%, no Commission row |
| Close modal via overlay click | pass | `#partner-detail-overlay` click → hidden |
| Driver row click → modal | pass | Type badge "Driver", Payment Data "No payment data on file." |
| Driver modal: no Discount or Commission row | pass | Driver shows only ACCOUNT, CONTACT, DRIVER, PAYMENT DATA sections |
| Close modal via Escape key | pass | `classList.contains('hidden')` = true |
| Delete action modal ("nikos ferras") | pass | "Delete Partner — Permanently delete 'nikos ferras'? Cannot be undone." with red Confirm button |
| Delete modal Cancel works | pass | Cancelled without deleting |

**Summary 12.1:** all checks pass. 0 new findings.

---

#### 12.2 — `/admin/users`

| Check | Result | Notes |
|---|---|---|
| Page renders, 5 users shown | pass | "5 of 5 users" counter |
| Users listed | pass | Smoke User (user), Smoke Admin (admin), agencycontactperson (user), Center Console (admin), Marios Kifokeris (admin) |
| Search by name ("smoke") | pass | Filters to 2 smoke users |
| Role filter: Admin | pass | 3 admin rows |
| Role filter: User | pass | 2 user rows (Smoke User + agencycontactperson) |
| smoke-user row has "Make Admin" button | pass | Also shows "Actions" and "Delete User" |
| Make Admin → confirmation modal | pass | "Give admin access to 'Smoke User'? They will be able to access the Admin Dashboard." |
| Confirm Yes → role=admin in UI | pass | Row shows "admin", button changes to "Remove Admin" |
| Remove Admin → confirmation modal | pass | Similar modal shown |
| Confirm Yes → role=user in UI | pass | Reverted correctly |

**Summary 12.2:** all checks pass. 0 new findings.

---

#### 12.3 — `/admin/sales`

| Check | Result | Notes |
|---|---|---|
| Page renders, no JS errors | pass | 0 errors in console |
| Date range tabs present | pass | This Week, This Month (active), This Quarter, This Year, All Time |
| Stat cards populated | pass | Total Revenue €6928.39, Transfers €5678.39 (36 bookings), Tours €1250.00 (7 bookings), Experiences €0.00 (0 bookings) |
| By Payment Method breakdown | pass | Cash €3599.22, Stripe €1241.83, Card Onsite €1672.34, Cash Onsite €415.00 |
| By Vehicle Type breakdown | pass | Sedan, Van, Minibus breakdown shown |
| All Bookings table | pass | 46 rows, Date/Type/Customer/Vehicle/Payment/Amount columns |
| Tab filter (This Year) | pass | Stat cards updated |
| Screenshot | pass | `qa/smoke-admin-sales.png` captured |

**Summary 12.3:** all checks pass. 0 new findings.

---

#### 12.4 — `/admin/settings`

| Check | Result | Notes |
|---|---|---|
| Page renders | pass | Profile Info, Platform Settings, Change Password, System Information sections visible |
| Platform Settings (read-only) | pass | Commission Rate 20%, Card On-site Fee 5%; "Contact development team to change" — no editable inputs |
| System Information | pass | Supabase URL, Total Users=5, Total Partners=8, Total Bookings=45 |
| Display Name edit → save → persist | pass | Changed "Smoke Admin" → "Smoke Admin Test"; reload confirmed; reverted to "Smoke Admin" |
| No destructive "Reset all" button | pass | Not present |
| Console errors | info | 3× "Password field is not contained in a form" browser DOM warning — F21 |

**Summary 12.4:** 1 finding raised (F21 — password fields outside form).

---

#### 12.5 — `/admin/prices`

| Check | Result | Notes |
|---|---|---|
| Page renders | pass | TRANSFERS (Regular + Night schedules) and RENT PER HOUR sections visible |
| Transfer pricing grid | pass | 7 KM bands × 3 vehicle types (Sedan/Van/Minibus) × 2 schedules = 42 editable inputs |
| Hourly pricing grid | pass | 2 schedules × 3 vehicle types = 6 inputs |
| Edit price (70 → 71) → Save All Prices → reload → 71 | pass | DB persisted |
| Revert to 70 | pass | Confirmed |
| No default-reset button | pass | Only "Save All Prices" button present |
| Console errors | pass | 0 errors |

**Summary 12.5:** all checks pass. 0 new findings.

**Screenshots:** `qa/smoke-admin-partners.png`, `qa/smoke-admin-users.png`, `qa/smoke-admin-sales.png`, `qa/smoke-admin-settings.png`, `qa/smoke-admin-prices.png`, `qa/smoke-partners-approve-modal.png`, `qa/smoke-partners-reject-modal.png`, `qa/smoke-partners-hotel-modal.png`, `qa/smoke-partners-agency-modal.png`, `qa/smoke-partners-driver-modal.png`, `qa/smoke-partners-delete-modal.png`, `qa/smoke-users-make-admin.png`

---

### F21 — I — admin-settings — Change Password fields not inside a `<form>` element; browser warns about password field outside form

**Page:** `/admin/settings`
**Preconditions:** logged in as admin
**Repro:**
1. Navigate to `/admin/settings`
2. Open browser console
**Expected:** Password input fields (Current Password, New Password, Confirm New Password) are inside a `<form>` element with `type="submit"` handler.
**Observed:** Browser logs 3× `[DOM] Password field is not contained in a form: <https://goo.gl/9p2vKq>`. The Change Password section renders password inputs without a wrapping `<form>`. This prevents browser password managers from functioning correctly and may inhibit autofill.
**Console / network errors:**
```
[DOM] Password field is not contained in a form (×3)
```
**Screenshot:** `qa/smoke-admin-settings.png`
**Root cause:** The Change Password UI in `/admin/settings` renders inputs in a `<div>` with a button that calls a JS handler directly, rather than wrapping in a `<form onsubmit="...">`. Minor accessibility/UX issue.
**Status:** open
**Severity:** Info — functionality is unaffected; password change works via JS handler. Browser password managers may not offer to save the new password.

---

### Section 13 — Admin catalog

Ran 2026-04-22. Branch `feat/admin-booking-notifications-2026-04-22`. Playwright headless + DB REST API.

#### 13.1 — `/admin/new-entry`

| Check | Result | Notes |
|---|---|---|
| Four cards render | pass | Transfers, Tours, Experiences, Vehicles cards all present |
| Each card links to correct page | pass | /admin/manage-transfers, /admin/manage-tours, /admin/manage-experiences, /admin/manage-vehicles |
| No console errors | pass | 0 errors |

**Summary 13.1:** all checks pass. 0 new findings.

---

#### 13.2 — `/admin/manage-transfers`

| Check | Result | Notes |
|---|---|---|
| Form fields render | pass | Image URL, Title, Price, Description, Upload — all present |
| Add Transfer → new row | pass | Row inserted in `transfers_catalog`, success banner shown |
| Edit modal opens | pass | Click edit → modal opens, fields hydrated |
| Edit save persists | pass | Modal closes, title change reflected in grid |
| Published toggle | pass | On → Off toggle works correctly |
| Delete with confirmation | pass | Delete modal shows, Yes → row removed from grid and DB |
| Console errors | pass | 0 errors |

**Summary 13.2:** all checks pass. 0 new findings. Test rows cleaned up.

---

#### 13.3 — `/admin/manage-tours` (CRITICAL regression of 2223975 + 01ebef7)

| Check | Result | Notes |
|---|---|---|
| All 18 form fields present | pass | f-file, f-image-url-input, f-image-url-add, f-image-list, f-title, f-price-sedan/van/minibus, f-duration, f-category, f-entrance-price/count, f-hotel-wrap/option, f-description, f-h1/h2/h3 |
| Category dropdown: 4 options | pass | day-tour, multiday-tour, experience-single, experience-multi |
| category=day-tour → hotel hidden | pass | Correct initial state |
| category=multiday-tour → hotel visible | pass | Toggle fires, hotel row appears |
| category=experience-multi → hotel visible | pass | |
| category=experience-single → hotel hidden | pass | |
| 6 category toggles — no listener leak (`01ebef7`) | pass | After 6 changes, visibility always matches current selection |
| Invalid URL paste → gallery blocked | pass | `checkValidity()` fires, 0 items in list |
| Valid URL paste → thumbnail appears | pass | Item appears in gallery with Cover badge |
| Remove thumbnail → list updates | pass | Gallery empties correctly |
| Submit with 0 images → "Please add at least one image." | pass | Error shown, form not submitted |
| Add tour with 1 image + full fields → success | pass | "✓ Tour published successfully!" shown |
| Screenshot captured | pass | `qa/smoke-managetours-add.png` |
| Edit modal: category hydrates | pass | e-category.value = 'day-tour' |
| Edit modal: entrance_ticket hydrates | pass | e-entrance-price = 10 |
| Edit modal: gallery re-populates | pass | 1 image in edit gallery |
| Edit modal: add 2nd image | pass | 2 images shown, saved correctly |
| Edit modal hotel toggle — no listener leak (`01ebef7`) | pass | multiday=visible, day=hidden, multiday=visible, day=hidden — correct each time |
| Edit save → DB has 2 images | pass | `images` array = 2, `entrance_ticket_per_person` = 10 |
| DB verify (SQL): category, images, entrance_ticket, hotel_option | pass | `{"images":["url1","url2"],"entrance_ticket_per_person":10,"hotel_option":"none","category":"day-tour"}` |
| Published toggle | pass | On → Off |
| Delete with confirmation | pass | Row removed |
| Console errors | pass | 0 errors |

**Summary 13.3:** all 23 checks pass including all regression checks for commits `2223975` and `01ebef7`. No new findings.

---

#### 13.4 — `/admin/manage-experiences` (PARITY GAPS)

| Check | Result | Notes |
|---|---|---|
| Form renders | pass | Image URL (single), Title, Sedan/Van/Minibus prices, Duration, Description, 3 highlights |
| Add / Edit / Delete / Toggle | pass | Full CRUD works |
| **Parity gap — Category** | **FAIL (I)** | `f-category` dropdown absent — DB has `category` column but UI doesn't expose it → F22 |
| **Parity gap — Entrance ticket** | **FAIL (I)** | `f-entrance-price` + `f-entrance-count` absent — DB columns exist but unused in UI → F22 |
| **Parity gap — Hotel option** | **FAIL (I)** | `f-hotel-wrap` / `f-hotel-option` absent — DB column exists but unused in UI → F22 |
| **Parity gap — Multi-image gallery** | **FAIL (I)** | No `f-image-url-add`, no `f-image-list`, no multi-file upload — only single `image_url` — DB has `images[]` column unused → F22 |
| Console errors | pass | 0 errors |

**Summary 13.4:** Basic CRUD works. 4 parity gaps vs manage-tours logged as F22 (single finding, severity I). DB schema already has all the extended columns — only the UI needs updating.

---

#### 13.5 — `/admin/manage-vehicles`

| Check | Result | Notes |
|---|---|---|
| Form fields render | pass | Image URL, Name, Slug, Models, Max Passengers, Max Luggage, Badge, Sort Order all present in HTML |
| Grid loads | **FAIL (H)** | Console error 400; grid shows "Could not load vehicles." — `loadItems()` does `.order('sort_order', ...)` but `sort_order` column does not exist in `public.vehicles` → F23 |
| Add Vehicle → submit | **FAIL (H)** | "Error adding vehicle. Please try again." — code inserts `image`, `models`, `max_luggage`, `badge`, `sort_order`, `active`, `owner_type` but none of these columns exist in the actual table → F24 |
| Edit modal | blocked | Cannot test (no rows load) |
| Delete with confirmation | blocked | Cannot test (no rows load) |
| Active toggle | blocked | Cannot test + column `active` does not exist in DB |
| Sort order reorder | blocked | `sort_order` column missing |
| Console errors | **FAIL** | `[error] Failed to load resource: 400` on page load |

**Summary 13.5:** Form HTML renders correctly but the page is completely non-functional at runtime due to a DB schema mismatch — 7 columns referenced in code do not exist in `public.vehicles`. Findings F23 and F24 raised.

**DB schema comparison:**

| Column in code | Exists in DB | DB column name |
|---|---|---|
| `image` | NO | `image_url` |
| `models` | NO | — |
| `max_luggage` | NO | — |
| `badge` | NO | — |
| `sort_order` | NO | — |
| `active` | NO | `published` (different name) |
| `owner_type` | NO | `is_platform` (bool) |

**Actual DB columns:** `id, owner_id, name, type, slug, max_passengers, image_url, description, is_platform, published, created_at`

---

**Section 13 screenshots:** `qa/smoke-managetours-add.png`

---

### F22 — I — manage-experiences — Parity gaps vs manage-tours: missing Category, Entrance Ticket, Hotel Option, Multi-image gallery

**Page:** `/admin/manage-experiences`
**Preconditions:** logged in as admin
**Repro:**
1. Navigate to `/admin/manage-experiences`
2. Inspect the Add New Experience form
**Expected:** manage-experiences has feature parity with manage-tours (category dropdown, entrance_ticket fields, hotel_option, multi-image gallery).
**Observed:** The form has only: Image URL (single), Title, Sedan/Van/Minibus prices, Duration, Description, 3 highlights. The following fields present in manage-tours are absent:
- `f-category` dropdown (4 options)
- `f-entrance-price` / `f-entrance-count` inputs
- `f-hotel-wrap` / `f-hotel-option` select (conditional)
- Multi-image gallery (`f-image-url-add`, `f-image-list`, `f-file[multiple]`)
**Important note:** The `experiences_catalog` DB table already has all these columns (`category`, `entrance_ticket_per_person`, `entrance_ticket_count`, `hotel_option`, `images`). The gaps are UI-only — existing data (if any) is silently ignored by the edit modal and never written back.
**Root cause:** commit `2223975` extended only `manage-tours.astro`; `manage-experiences.astro` was not updated.
**Status:** open
**Severity:** I — Parity gap; admin cannot set category/entrance_ticket/hotel_option for experiences; gallery limited to one image.

---

### F23 — H — manage-vehicles — Grid fails to load: `sort_order` column missing from `public.vehicles`

**Page:** `/admin/manage-vehicles`
**Preconditions:** logged in as admin; `public.vehicles` table empty or populated
**Repro:**
1. Navigate to `/admin/manage-vehicles`
2. Wait for page to finish loading
**Expected:** Vehicle grid loads; existing vehicles shown.
**Observed:** Console error `400 Bad Request`; grid shows "Could not load vehicles.". The `loadItems()` function executes `.from('vehicles').select('*').order('sort_order', { ascending: true })` but `sort_order` does not exist in the actual table schema.
**Actual DB columns:** `id, owner_id, name, type, slug, max_passengers, image_url, description, is_platform, published, created_at`
**Code expects column:** `sort_order` (missing)
**Status:** open
**Severity:** H — Page is completely non-functional; no vehicles can be viewed. This is a blocking issue for fleet management.

---

### F24 — H — manage-vehicles — Add Vehicle fails: code inserts 7 columns that don't exist in `public.vehicles`

**Page:** `/admin/manage-vehicles`
**Preconditions:** logged in as admin
**Repro:**
1. Navigate to `/admin/manage-vehicles`
2. Fill in all form fields (Image URL, Name, Slug, Models, Max Passengers, Max Luggage)
3. Click "Add Vehicle"
**Expected:** New row inserted in `public.vehicles`; success banner shown.
**Observed:** "Error adding vehicle. Please try again." — Supabase returns `PGRST204 Could not find column`.
**Root cause:** The code submits `{ image, models, max_luggage, badge, sort_order, active, owner_type }` but the actual table has:
- `image_url` (not `image`)
- No `models` column
- No `max_luggage` column  
- No `badge` column
- No `sort_order` column
- `published` (not `active`)
- `is_platform` boolean (not `owner_type` string)
**Affected operations:** INSERT (add) + UPDATE (edit) + toggle active — all fail. The form UI renders correctly but all writes fail.
**Status:** open
**Severity:** H — No vehicles can ever be added or edited via this page. Complete functional failure.
