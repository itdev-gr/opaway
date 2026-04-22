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
| Task 5  Auth flows | pending | — |
| Task 6  User profile | pending | — |
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

### Section 3 — Dev-server warmup + environment

- Dev server started cleanly on **http://localhost:4321**.
- Stripe publishable key present and is **test mode** (`pk_test_*`) — Stripe card submissions will use test card `4242 4242 4242 4242` (CVC 123, exp 12/30).
- Playwright MCP browser reached `/` — page title "Opawey", nav / main / hero / footer all present in snapshot. Browser drives OK.
- No console / network errors on home-page load (baseline).

No findings.

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
