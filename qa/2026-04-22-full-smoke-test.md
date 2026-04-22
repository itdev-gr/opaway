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
| Task 4  Public pages | pending | — |
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

No findings yet.
