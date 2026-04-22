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
| Task 7  Transfer funnel | pending | — |
| Task 8  Hourly funnel | pending | — |
| Task 9  Tour funnel | pending | — |
| Task 10 Contact + experience forms | pending | — |
| Task 11 Admin — bookings | pending | — |
| Task 12 Admin — management | pending | — |
| Task 13 Admin — catalog | pending | — |
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
**Status:** open

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
