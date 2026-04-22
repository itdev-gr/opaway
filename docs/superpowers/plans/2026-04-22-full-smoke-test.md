# Full-Scale Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exercise every interactive element and flow across every dashboard, booking funnel, and auth path of the Opawey app; collect all findings in a shared punch list; fix each finding with a retest of the affected area; then run a regression pass to confirm no new breakage.

**Architecture:** Browser-driven via Playwright MCP tools, results journalled to `qa/2026-04-22-full-smoke-test.md`. No test framework added to the project — the journal is the test output. Test accounts for every role are minted via Supabase (anon signup + management-API promotion). Fixes land as small commits on the existing feature branch `feat/admin-booking-notifications-2026-04-22` and are verified by re-running the journal section(s) they touched.

**Tech Stack:** Astro 5, Supabase JS v2, Tailwind v4, Stripe JS, Playwright MCP (`mcp__playwright__browser_*`), Supabase Management API (personal access token at `.supabase-pat`).

**Testing convention (not TDD, but related):** every finding is logged to the punch list BEFORE a fix is attempted; the fix commit references the finding id; after the fix, the journal section that contained the finding is re-run to confirm it now passes. This keeps the "broken → fixed → verified" arc traceable in one file.

---

## Shared conventions

### Branch & commits

- All work continues on `feat/admin-booking-notifications-2026-04-22`.
- Each Phase 2 sweep commits its journal updates as `qa: smoke sweep <area>` (one commit per task).
- Each Phase 4 fix commits as `fix(<scope>): <title> (closes F<N>)` referencing the finding id, then ammends the journal in a follow-up commit `qa: verify F<N> closed`.
- Never `--amend` a pushed commit — these haven't been pushed, but the existing branch commits are WIP so it's still safer to add new commits rather than rewriting.

### Test accounts (created in Task 1, stored in `.test-accounts.json`, gitignored)

| Role | Email | Notes |
|---|---|---|
| Admin | `smoke-admin-2026-04-22@opawey.test` | `public.users.type = 'admin'` |
| Regular user | `smoke-user-2026-04-22@opawey.test` | default type |
| Approved hotel | `smoke-hotel-2026-04-22@opawey.test` | `partners.type='hotel'`, `status='approved'`, `commission_eur=10.00` |
| Approved agency | `smoke-agency-2026-04-22@opawey.test` | `partners.type='agency'`, `status='approved'`, `discount=10` |
| Approved driver | Existing `driver@itdev.gr` (verified approved) | fallback: mint `smoke-driver-2026-04-22@opawey.test` + approve |
| Pending partner | `smoke-pending-2026-04-22@opawey.test` | `partners.status='pending'` (for the approval flow) |

Shared password for all test accounts: `SmokeTest!2026-04-22` (rotate after tests, before production).

### Journal file layout

`qa/2026-04-22-full-smoke-test.md` will grow one `## Section <task-id>: <title>` per sweep + a single `## Punch list` section that all findings roll into.

### Finding template (copied into the Punch list per issue)

```md
### F<N> — <severity> — <area> — <one-line title>

**Page:** <route or component>
**Preconditions:** <account logged in / catalog state / etc.>
**Repro:**
1. <exact click/input>
2. ...
**Expected:** <behaviour>
**Observed:** <behaviour>
**Console / network errors:** <pasted or "none">
**Screenshot:** `qa/smoke-F<N>.png`
**Status:** open | fixed-pending-verify | verified | wontfix
**Fixed in:** <commit sha> (filled after Phase 4)
**Verified:** <re-run note> (filled after Phase 5)
```

Severity codes: **C** = Critical (blocks a core flow — bookings, auth, payments), **I** = Important (broken feature visible to user), **M** = Minor (cosmetic / edge case).

### Useful SQL snippets

The tester will run these via the Supabase management API (token at `.supabase-pat`, project ref `wjqfcijisslzqxesbbox`):

```bash
# Run arbitrary SQL:
SB_PAT=$(cat .supabase-pat)
cat > /tmp/q.json <<'EOF'
{"query": "select 1"}
EOF
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SB_PAT" -H "Content-Type: application/json" --data @/tmp/q.json
```

Common verifications:
- Latest booking rows: `select id, payment_method, ride_status, uid, partner_id, created_at from public.transfers order by created_at desc limit 5;`
- Notification counts: `select (select count(*) from public.transfers where ride_status='new') as tr, (select count(*) from public.tours where ride_status='new') as to;`
- Request rows from contact form: `select id, source, status, subject, name, email, created_at from public.requests order by created_at desc limit 10;`

### Stripe

Task 3 detects mode from `.env`. If `pk_test_*`: use test card `4242 4242 4242 4242` CVC `123` exp `12/30`. If `pk_live_*`: card submission is SKIPPED (cannot run without real charges) — log `card-submit: skipped (live key)` in the journal for every booking funnel payment-method matrix and mark related findings as "not tested".

---

# Phase 0 — Prereqs

## Task 1: Mint test accounts

**Files:**
- Create: `.test-accounts.json` (gitignored — already covered by `.gitignore` `.env.local` / `.env` rules; add explicit pattern)
- Modify: `.gitignore` (append `.test-accounts.json`)
- Create: `scripts/smoke/create-test-accounts.mjs`

- [ ] **Step 1: Add gitignore entry**

Add to `.gitignore`, one line under the `.supabase-pat` block:

```
.test-accounts.json
```

- [ ] **Step 2: Fetch project service-role key via management API**

The anon key in `.env` can sign up users but can't bypass email confirmation. The service role key can. We haven't committed it — fetch it once for the script.

```bash
SB_PAT=$(cat .supabase-pat)
curl -s -H "Authorization: Bearer $SB_PAT" \
  "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/api-keys" \
  | python3 -c "import json, sys; print(json.dumps([k for k in json.load(sys.stdin) if k['name']=='service_role'], indent=2))"
```

Expect a JSON array with one entry containing `api_key`. Export for the next step:

```bash
export SB_SERVICE_ROLE_KEY="<paste>"
```

- [ ] **Step 3: Confirm email-confirmation setting**

```bash
curl -s -H "Authorization: Bearer $SB_PAT" \
  "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/config/auth" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('mailer_autoconfirm =', d.get('mailer_autoconfirm'))"
```

If `mailer_autoconfirm = False`, the signup flow requires the user to click an email link. To avoid that, the script uses the admin API (`auth.admin.createUser` with `email_confirm: true`) via the service role key.

- [ ] **Step 4: Write the creation script**

Create `scripts/smoke/create-test-accounts.mjs`:

```js
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://wjqfcijisslzqxesbbox.supabase.co';
const SERVICE = process.env.SB_SERVICE_ROLE_KEY;
if (!SERVICE) { console.error('Set SB_SERVICE_ROLE_KEY'); process.exit(1); }

const supa = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'SmokeTest!2026-04-22';

const accounts = [
    { kind: 'admin',    email: 'smoke-admin-2026-04-22@opawey.test',   setup: async (uid) => {
        await supa.from('users').upsert({ id: uid, email: 'smoke-admin-2026-04-22@opawey.test', type: 'admin', display_name: 'Smoke Admin' });
    }},
    { kind: 'user',     email: 'smoke-user-2026-04-22@opawey.test',    setup: async (uid) => {
        await supa.from('users').upsert({ id: uid, email: 'smoke-user-2026-04-22@opawey.test', type: 'user', display_name: 'Smoke User' });
    }},
    { kind: 'hotel',    email: 'smoke-hotel-2026-04-22@opawey.test',   setup: async (uid) => {
        await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-hotel-2026-04-22@opawey.test',
            type: 'hotel', status: 'approved', hotel_name: 'Smoke Hotel', display_name: 'Smoke Hotel',
            commission_eur: 10.00, discount: 0 });
    }},
    { kind: 'agency',   email: 'smoke-agency-2026-04-22@opawey.test',  setup: async (uid) => {
        await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-agency-2026-04-22@opawey.test',
            type: 'agency', status: 'approved', agency_name: 'Smoke Agency', display_name: 'Smoke Agency',
            discount: 10 });
    }},
    { kind: 'driver',   email: 'smoke-driver-2026-04-22@opawey.test',  setup: async (uid) => {
        await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-driver-2026-04-22@opawey.test',
            type: 'driver', status: 'approved', full_name: 'Smoke Driver', display_name: 'Smoke Driver',
            num_vehicles: '1' });
    }},
    { kind: 'pending',  email: 'smoke-pending-2026-04-22@opawey.test', setup: async (uid) => {
        await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-pending-2026-04-22@opawey.test',
            type: 'hotel', status: 'pending', hotel_name: 'Pending Hotel', display_name: 'Pending Hotel' });
    }},
];

const out = { createdAt: new Date().toISOString(), password: PASSWORD, accounts: {} };

for (const a of accounts) {
    const { data: created, error: createErr } = await supa.auth.admin.createUser({
        email: a.email, password: PASSWORD, email_confirm: true,
    });
    let userId;
    if (createErr && /already.*registered|already.*exists/i.test(createErr.message || '')) {
        const { data: list } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users?.find(u => u.email === a.email);
        if (!existing) { console.error(`❌ ${a.kind}: could not find existing user`); continue; }
        userId = existing.id;
        console.log(`↺ ${a.kind} exists (${userId}) — re-running setup`);
    } else if (createErr) {
        console.error(`❌ ${a.kind}: ${createErr.message}`); continue;
    } else {
        userId = created.user.id;
        console.log(`✓ ${a.kind} created (${userId})`);
    }
    await a.setup(userId);
    out.accounts[a.kind] = { email: a.email, id: userId };
}

writeFileSync('.test-accounts.json', JSON.stringify(out, null, 2));
console.log('\nWritten to .test-accounts.json');
```

- [ ] **Step 5: Run it**

```bash
node scripts/smoke/create-test-accounts.mjs
```

Expect six `✓`/`↺` lines and `Written to .test-accounts.json`.

- [ ] **Step 6: Verify each account via SQL**

```bash
cat > /tmp/q.json <<'EOF'
{"query": "select u.email, u.type as user_type, p.type as partner_type, p.status as partner_status, p.commission_eur, p.discount from auth.users u left join public.users u2 on u2.id = u.id left join public.partners p on p.id = u.id where u.email like 'smoke-%@opawey.test' or u.email = 'driver@itdev.gr' order by u.email;"}
EOF
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" -H "Content-Type: application/json" --data @/tmp/q.json | python3 -m json.tool
```

Confirm: admin has `user_type=admin`; hotel/agency/driver show `partner_status=approved`; pending shows `partner_status=pending`; commission_eur=10.00 on hotel; discount=10 on agency.

- [ ] **Step 7: Commit**

```bash
git add .gitignore scripts/smoke/create-test-accounts.mjs
git commit -m "$(cat <<'EOF'
qa: script to mint smoke-test accounts across all roles

Creates six accounts (admin, user, hotel, agency, driver, pending)
via the Supabase admin API with email_confirm pre-set, then upserts
the matching row in public.users or public.partners. Idempotent — re-
runs look up existing auth.users by email and just re-run the profile
setup. Credentials dumped to .test-accounts.json (gitignored).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Initialise the smoke-test journal

**Files:**
- Create: `qa/2026-04-22-full-smoke-test.md`

- [ ] **Step 1: Write the journal scaffold**

```markdown
# 2026-04-22 — Full-scale smoke test journal

Branch: `feat/admin-booking-notifications-2026-04-22`
Started: 2026-04-22 <local time>
Dev server: http://localhost:<port> (port captured in Task 3)
Stripe mode: <test | live | unknown> (captured in Task 3)

Accounts used: see `.test-accounts.json`. Shared password: `SmokeTest!2026-04-22`.

---

## Status tracker

| Phase / Task | Status | Findings added |
|---|---|---|
| Task 3  Dev-server warmup | pending | — |
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

<one heading per sweep task appended below>

---

## Punch list

<one `### F<N>` block per finding, in the order discovered>
```

- [ ] **Step 2: Commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: init full-scale smoke-test journal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dev-server warmup + environment detection

**Files:**
- Modify: `qa/2026-04-22-full-smoke-test.md` (fill header values)

- [ ] **Step 1: Start dev server in background**

```bash
pkill -f 'astro dev' 2>/dev/null; sleep 1
npm run dev > /tmp/opaway-dev.log 2>&1 &
sleep 6
grep -E "Local\s+http" /tmp/opaway-dev.log | head -1
```

Capture the printed port (may not be 4321 if other Astro projects are running). Record it in the journal header.

- [ ] **Step 2: Detect Stripe mode**

```bash
grep '^PUBLIC_STRIPE\|^STRIPE' .env | sed -E 's/(=).+/\1<redacted>/'
grep -oE 'pk_(test|live)_' .env | head -1
```

- If `pk_test_` → Stripe mode = **test**. Card tests use `4242 4242 4242 4242`.
- If `pk_live_` → Stripe mode = **live**. Card submission is SKIPPED in Phase 2 (Tasks 7/8/9). Stripe Elements *rendering* is still tested; only the final "Complete booking" click on the Stripe method is skipped.
- If no Stripe key → mark "stripe-not-configured" in the journal; the `stripe-not-configured` banner should appear on payment pages.

- [ ] **Step 3: Playwright MCP browser sanity check**

Open the base URL with `mcp__playwright__browser_navigate`, then:

```
mcp__playwright__browser_snapshot
```

Confirm the snapshot shows the `<header>` / hero / logo of the home page. If snapshot fails (browser not launched, port wrong, etc.) fix before proceeding.

- [ ] **Step 4: Fill journal header**

Edit `qa/2026-04-22-full-smoke-test.md` to replace the `<port>` and `<test | live | unknown>` placeholders with actual values. Update Task 3 row to **done** in the status tracker.

- [ ] **Step 5: Commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: record dev-server port + Stripe mode in smoke journal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 1 — Public pages + auth + user profile

## Task 4: Public pages sweep

Browser: no authenticated session (clear cookies at start — `mcp__playwright__browser_evaluate` with `document.cookie.split(';').forEach(c => document.cookie = c.split('=')[0] + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'); localStorage.clear(); sessionStorage.clear();`).

### Pages to sweep

Each page: navigate, snapshot, then click every interactive element (links, CTAs, tabs, form toggles, language/menu buttons) and verify the resulting state. Console errors: capture via `mcp__playwright__browser_console_messages` after every navigation.

| # | Page | Specific elements to exercise |
|---|------|-------------------------------|
| 1 | `/` | Hero CTA "Book a transfer" → /book; navbar links (Home, About, Tours, Experiences, Contact, Work With Us, Login, Register); BookingSection type toggle (Transfer / Rent by hour / Tour); from/to Google Places autocomplete (type "Athens" → suggestions appear); date picker; time picker; passenger +/-; Search button → /book/transfer with query string; ToursSection "Book a Tour" CTA → /book; ExperienceSection CTA; FeaturesSection cards; GlobalCoverageSection; Footer links (every anchor) |
| 2 | `/about` | AboutHero image load; ScrollReveal triggers on scroll; AboutStory anchor; AboutCommitment carousel if any; AboutFleet grid; WavyDivider rendering; footer |
| 3 | `/contact` | Name, email, subject, message inputs; submit valid form → success message + new `requests.source='contact'` row; submit empty → validation errors |
| 4 | `/experiences` | Hero; experience catalog grid (if any); "Request a quote" CTA → form; submit form with pickup + date + participants → success + new `requests.source='experience'`-ish row (check `source` value in DB) |
| 5 | `/book` | Type toggle; Greece-restricted autocomplete; Search button; no required-field guard slips through |
| 6 | `/book/tour` | Tour catalog grid uses `images[0]` cover (verify by inspecting `<img src=>` — should match a tour's `images[0]` or `image_url`); carousel prev/next; catalog card "Book Now" button — **without login** expect redirect to `/login?next=/book/tour&reason=booking` OR direct to `/book/tour/passenger` (which ITSELF redirects). Log whichever happens. |
| 7 | `/work-with-us` | Hero; partnership CTAs (each resolves); footer |
| 8 | `/privacy` | Content renders; footer |
| 9 | `/terms` | Content renders; footer |
| 10 | `/404` or unknown URL (`/asdf`) | 404 page renders with Home CTA |

### Steps

- [ ] **Step 1: Navigate + snapshot each URL** using `mcp__playwright__browser_navigate` then `mcp__playwright__browser_snapshot`. For each page, record a one-line pass/fail and one screenshot (`qa/smoke-public-<page>.png`).

- [ ] **Step 2: Click every link + button per the table above**, using `mcp__playwright__browser_click` on each element. After each click, capture `mcp__playwright__browser_console_messages` for errors and `mcp__playwright__browser_network_requests` for failed requests (status ≥ 400).

- [ ] **Step 3: Submit the contact form** with valid data. Verify a new `public.requests` row with `source='contact'`:

```sql
select id, source, name, email, subject, created_at from public.requests where email='smoke-contact-2026-04-22@opawey.test' order by created_at desc limit 1;
```

- [ ] **Step 4: Submit the experiences request form** with valid data. Verify the new `public.requests` row (note: the `source` value may be `experience` or `contact` depending on the current implementation — record whatever it is, that's data for a potential finding).

- [ ] **Step 5: Write the Section 4 block in the journal** with pass/fail per page, list of clicked elements, console / network errors, and any findings added to the punch list.

- [ ] **Step 6: Update status tracker + commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: smoke sweep — public pages"
```

---

## Task 5: Auth flows sweep

### Flows to exercise

| # | Flow | Steps |
|---|------|-------|
| 1 | Register new user (email/password) | `/register` → fill fresh email + password + name → submit → land on /profile/dashboard; auth.users row + public.users row exist. |
| 2 | Register validation errors | empty fields, invalid email, short password → error messages inline |
| 3 | Register existing email | retry with same email → error "already registered" |
| 4 | Google OAuth (skip-if-no-creds) | Click "Continue with Google" → if redirects to accounts.google.com, confirm then return with session established; if provider not configured, record and skip |
| 5 | Login valid | `/login` as `smoke-user-2026-04-22@opawey.test` + `SmokeTest!2026-04-22` → land on /; `supabase.auth.getSession()` non-null |
| 6 | Login invalid password | wrong password → inline error, stay on /login |
| 7 | Login unknown email | unknown → inline error |
| 8 | Login `?next=` honoured | `/login?next=/profile/dashboard` → after valid submit, land on /profile/dashboard |
| 9 | Login `?next=` open-redirect blocked | `/login?next=//evil.com/x`  → after submit, land on `/` (not evil.com) |
| 10 | Login `?next=` non-/ prefix blocked | `/login?next=https%3A%2F%2Fevil.com` → after submit, land on `/` |
| 11 | Forgot password | `/forgot-password` → enter smoke-user email → success message; check Supabase logs or email (if mail provider mocked) — otherwise just confirm no error and success banner |
| 12 | Partner registration — Hotel | `/register-partner` → pick Hotel → fill form → submit → row in `partners` with `type=hotel`, `status=pending` |
| 13 | Partner registration — Agency | same, `type=agency` |
| 14 | Partner registration — Driver | same, `type=driver` |
| 15 | Partner registration validation | empty required fields → inline errors |
| 16 | Logout | from any authenticated page → `/logout` → session cleared, redirect to / |
| 17 | Auth-gated pages unauthenticated | visit `/profile/dashboard`, `/admin`, `/driver`, `/hotel`, `/agency` logged out → redirect to /login (or 200 with an auth overlay that eventually redirects); record behaviour for each |
| 18 | Partner dashboard access control | login as approved hotel → visit `/admin` → expect redirect to / (type!='admin' guard) |
| 19 | Pending partner sign-in | login as `smoke-pending-2026-04-22@opawey.test` → try `/hotel` → expect redirect to /login (since `status !== 'approved'`) |
| 20 | Booking funnel pre-auth redirect | logged out, visit `/book/transfer/passenger` → auto-redirect to `/login?next=%2Fbook%2Ftransfer%2Fpassenger&reason=booking`; same for tour and hourly |

### Steps

- [ ] **Step 1: For each flow above**, execute with Playwright MCP. After each, capture: URL, snapshot digest, console errors, DB row (where applicable via a SQL query).

- [ ] **Step 2: For partner registration flows 12-14**, use fresh emails like `smoke-hotel-reg-2026-04-22@opawey.test` so Task 1's pre-approved accounts aren't disturbed. Delete these test rows at the end of the task to keep the DB clean:

```sql
delete from public.partners where email like 'smoke-%-reg-2026-04-22@opawey.test';
delete from auth.users where email like 'smoke-%-reg-2026-04-22@opawey.test';
```

- [ ] **Step 3: Journal the section.** Write a table: flow # | status | finding-id (if any) | notes.

- [ ] **Step 4: Commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: smoke sweep — auth flows"
```

---

## Task 6: User profile dashboard sweep

Login as `smoke-user-2026-04-22@opawey.test`.

### Pages

| Page | Checks |
|---|---|
| `/profile` | redirects to `/profile/dashboard` (or renders if that's the index); navbar shows user display_name |
| `/profile/dashboard` | stat cards render; number of past/upcoming bookings reflects DB (create one via SQL, reload, verify it counts) |
| `/profile/settings` | avatar upload works (picks an image, uploads to storage `images/` bucket, URL saved to `users.photo_url`); display_name edit saves; password change prompt works (enter new password, submit, log out, log back in with new password, change back) |
| `/profile/transfers` | lists transfers where `uid = current user`; click row — if detail view exists, verify; empty state if no bookings |
| `/profile/trips` | lists tours; same as transfers |
| `/profile/experiences` | lists experience bookings (if `experiences` table is still in use) or experience requests from `requests` — confirm what's rendered and whether it's empty for a new user |

### Steps

- [ ] **Step 1: Pre-create one transfer, one tour, and one experience request** for the user to ensure list pages have data:

```sql
-- Ensure user has smoke data
with u as (select id from auth.users where email='smoke-user-2026-04-22@opawey.test')
insert into public.transfers (uid, "from", "to", date, time, first_name, last_name, email, phone, passengers, total_price, ride_status, payment_method, payment_status)
select id, 'Athens', 'Piraeus', '2026-05-15', '09:00', 'Smoke', 'User', 'smoke-user-2026-04-22@opawey.test', '+30 000', 2, 85.00, 'new', 'cash', 'pending' from u;
```

Same for `public.tours` and `public.requests` (with `source='experience'`).

- [ ] **Step 2: Exercise every element on each page**. Record findings.

- [ ] **Step 3: Journal + commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: smoke sweep — user profile dashboard"
```

---

# Phase 2 — Booking funnels

## Task 7: Transfer booking funnel (all payment methods)

Login as `smoke-user-2026-04-22@opawey.test`.

### Matrix to cover

For each row, complete the full funnel end-to-end and verify a `public.transfers` row is created with the expected shape.

| # | Path | Extras |
|---|------|--------|
| T1 | Transfer one-way, cash-on-site | From: Athens, To: Piraeus, 2 pax, 1 child seat, note "smoke T1" |
| T2 | Transfer one-way, card-on-site | same + different date; card surcharge > 0 |
| T3 | Transfer one-way, Stripe card (test-mode only) | card `4242 4242 4242 4242` |
| T4 | Transfer round-trip, cash-on-site | outward + return dates/times |
| T5 | Transfer with sign-name | "Welcome Mr. Smoke" in sign_name |
| T6 | Partner transfer as hotel | log in as `smoke-hotel-...`, do T1 — expect `partner_id` populated |
| T7 | Partner transfer as agency | same for agency |

### Steps per matrix row

- [ ] Open `/book/transfer/` and fill step 1 (vehicle choice if shown).
- [ ] Continue to `/book/transfer/passenger`; fill form.
- [ ] Continue to `/book/transfer/payment`; select payment method.
- [ ] Click "Complete Booking".
- [ ] Expect success panel with a reference ID.
- [ ] SQL verify:
  ```sql
  select id, booking_type, "from", "to", payment_method, payment_status, total_price, base_price, card_surcharge, ride_status, uid, partner_id, first_name, last_name, sign_name, child_seats, notes, driver_notes, released_to_drivers, created_at from public.transfers order by created_at desc limit 1;
  ```
  Confirm:
  - `booking_type = 'transfer'`
  - `uid` matches current user
  - `partner_id` set for hotel/agency tests, null for regular user
  - `payment_method` matches (`cash-onsite` or `card-onsite` or `stripe`)
  - `payment_status = 'paid'` if Stripe else `'pending'`
  - `ride_status = 'new'`
  - `released_to_drivers = false`
  - `total_price` non-zero
  - `card_surcharge > 0` only for card-onsite
  - `first_name`/`last_name`/`sign_name`/`child_seats`/`driver_notes` populated from form

### Steps (overall)

- [ ] **Step 1: Run matrix rows T1–T7.** For each, capture a screenshot of the success panel (`qa/smoke-T<N>-success.png`).
- [ ] **Step 2: Abandonment test** — start T1 but close browser at the payment step. Re-open `/book/transfer/payment` → expect the form to repopulate from query params OR redirect to `/book/transfer/` (either is acceptable; record behaviour).
- [ ] **Step 3: Back-button test** — on payment step, click browser Back → expect passenger page re-rendered with prior inputs intact.
- [ ] **Step 4: Mobile viewport** — resize via `mcp__playwright__browser_resize` to 390×844; re-run T1; record any layout breakage.
- [ ] **Step 5: Journal + commit**

---

## Task 8: Hourly booking funnel

Login as `smoke-user-2026-04-22@opawey.test`.

### Matrix

| # | Path |
|---|------|
| H1 | 2 hours, pickup Athens, 2 pax, cash-on-site |
| H2 | 4 hours, card-on-site |
| H3 | 6 hours, Stripe test card |
| H4 | 12 hours maximum, cash-on-site |
| H5 | As agency, 2 hours, card-on-site |

### Steps per row

Same pattern as Task 7. Verify the row in `public.transfers` has `booking_type='hourly'`, `hours` set, `per_hour` > 0, `"from"` = `"to"` (both = pickup).

- [ ] **Step 1: Run matrix rows H1–H5.**
- [ ] **Step 2: Journal + commit**

---

## Task 9: Tour booking funnel

Login as `smoke-user-2026-04-22@opawey.test`.

### Matrix

| # | Path |
|---|------|
| R1 | Pick a Day Tour from catalog, cash-on-site |
| R2 | Pick a Day Tour, card-on-site |
| R3 | Pick a Day Tour, Stripe test card |
| R4 | Pick a Multi-day Tour (any catalog row with `category='multiday-tour'`), cash-on-site |
| R5 | As hotel, Day Tour, card-on-site |
| R6 | As agency, Day Tour, Stripe test card |

If the catalog has no Multi-day Tour, create one via SQL before running:

```sql
insert into public.tours_catalog (title, description, price, price_sedan, price_van, price_minibus, duration, category, entrance_ticket_per_person, entrance_ticket_count, hotel_option, images, published)
values ('Smoke Multi-Day', 'Seed multi-day tour for smoke test', 500, 500, 800, 1100, '3 days · 2 nights', 'multiday-tour', 15.00, 3, 'include-booking', '["https://images.unsplash.com/photo-1600&w=800"]'::jsonb, true)
on conflict do nothing;
```

### Steps

- [ ] **Step 1: Ensure catalog has both Day Tour and Multi-day Tour entries.** If not, insert one (above).
- [ ] **Step 2: Run matrix rows R1–R6.**
- [ ] **Step 3: Verify tour rows**:
  ```sql
  select id, tour, tour_name, name, email, pickup, passengers, participants, total_price, payment_method, payment_status, ride_status, released_to_drivers, partner_id, uid, special_requests, notes, created_at from public.tours order by created_at desc limit 10;
  ```
  Confirm the shape matches the fix from commit `950e471` — `name` single-field, `tour` populated, `vehicle` populated, no first_name/last_name columns (they'd show NULL or not return).
- [ ] **Step 4: Journal + commit**

---

## Task 10: Contact + experience request forms

Logout (or run unauthenticated).

### Flows

| # | Flow |
|---|------|
| C1 | `/contact` valid submission → `requests.source='contact'` |
| C2 | `/contact` empty submission → validation messages |
| C3 | `/contact` as authenticated user → `user_id` populated |
| E1 | `/experiences` request form valid submission → new `requests` row with `source` = whatever the code writes (record it), plus `experience_id`/`experience_name` populated |
| E2 | `/experiences` empty submission → inline errors |

### Steps

- [ ] **Step 1: Run C1-C3 and E1-E2.**
- [ ] **Step 2: Verify DB rows.**
- [ ] **Step 3: Journal + commit**

---

# Phase 3 — Role dashboards

## Task 11: Admin dashboard — bookings area

Login as `smoke-admin-2026-04-22@opawey.test`.

### Pages

#### `/admin` (home calendar)

- [ ] Navigate, snapshot.
- [ ] Click prev/next month — grid updates; month label correct.
- [ ] Click a day cell that has bookings (there should be some from Phase 2) — day bookings list populates.
- [ ] Click a day cell with zero bookings — empty state.
- [ ] Legend dots visible (Transfer blue, Tour emerald, Experience violet, Request amber).
- [ ] Count badges on day cells match real data (verify by manual SQL count).
- [ ] Mobile burger → sidebar toggle.

#### `/admin/requests`

- [ ] All tab shows requests from Phase 2.
- [ ] Click New / Answered / Follow up / Discarded / Tour / Contact tabs — list filters correctly.
- [ ] Tab counts update dynamically.
- [ ] Actions dropdown on a row: Mark as Answered → status updates; refresh, confirm.
- [ ] Mark as Follow up → status updates.
- [ ] Discard → moves to Discarded tab.
- [ ] Restore (on a Discarded row) → moves back to New.
- [ ] Delete → confirmation modal → Yes → row gone (verify via SQL).
- [ ] Search (if present).

#### `/admin/transfers`

- [ ] Table shows Phase 2 transfer rows.
- [ ] Click "Add Booking" → modal opens with Google Places autocomplete on From/To.
- [ ] Fill modal + submit → new row with `added_by_admin=true`.
- [ ] Driver inline-edit: click driver cell → input appears → type "Smoke Driver" → blur → row saves (verify via SQL `driver` column).
- [ ] Ride Status select: change to 'assigned' → DB update (verify); back to 'new'.
- [ ] Payment Status select: change to 'paid' → DB update; back to 'pending'.
- [ ] Release toggle: click amber "Release" → turns emerald "Released"; click again → back to amber (verify `released_to_drivers` in DB toggled).
- [ ] Click non-form-control cell on a row → detail modal opens.
- [ ] Modal shows: customer, from/to, date/time, payment method, price breakdown, notes, driver notes, sign name, release state.
- [ ] Close modal via X, overlay, and Escape.
- [ ] Clicking driver-edit span does NOT open detail modal (regression of fix `fab49de`).

#### `/admin/tours`

Same checks as transfers adapted to tour columns. Extra:
- [ ] Detail modal renders `special_requests` + `notes` + `vehicle`.
- [ ] Add Booking modal's tour dropdown populated from `tours_catalog` (published=true rows).

#### `/admin/experiences`

Same as tours. Extra: verify Add Booking modal populates from `experiences_catalog`.

### Steps

- [ ] **Step 1: Walk through each page above.**
- [ ] **Step 2: Journal + commit**

---

## Task 12: Admin dashboard — management area

### Pages

#### `/admin/partners`

- [ ] Search box: type part of hotel's email → filters.
- [ ] Type filter: All / Hotel / Agency / Driver → results update.
- [ ] Status filter: All / Pending / Approved / Rejected → results update.
- [ ] Sort by Type header → asc/desc toggles.
- [ ] Sort by Status / Registered headers.
- [ ] Column header reads "Discount / Commission".
- [ ] For an agency row: click discount cell → inline edit appears → save 15 → persists (verify SQL).
- [ ] For a hotel row: commission cell shows `€10.00`; click → inline edit → save 12.50 → persists.
- [ ] For a driver row: discount cell still shows % (drivers aren't hotels).
- [ ] Pending partner row: Approve action → confirmation modal → Yes → status flips to approved (SQL verify).
- [ ] Approve a fresh pending (from Task 1's pending account — but note the approval will affect later tests; document).
- [ ] Reject action on another → status=rejected.
- [ ] Click row (outside buttons/inputs) → PartnerDetailModal opens.
- [ ] Modal shows type badge, status, discount (if agency) OR commission_eur (if hotel), contact fields, booking counts.
- [ ] For driver row, modal shows payment_data section (bank name/IBAN/SWIFT if set).
- [ ] Close modal via X, overlay, Escape.
- [ ] Delete action → confirmation → deletes (only run on a non-critical test partner).

#### `/admin/users`

- [ ] Search box filters by name/email.
- [ ] Role filter: All / User / Admin.
- [ ] Actions on a non-admin user: Make Admin → confirmation → `public.users.type='admin'`.
- [ ] Actions on an admin: Remove Admin → back to 'user'.
- [ ] Delete action on a disposable user → deletes from auth.users + public.users.
- [ ] Avoid deleting the main test admin / test user.

#### `/admin/sales`

- [ ] Page renders without errors.
- [ ] Charts/tables populate (or "no data" state is clean).
- [ ] Any filters (date range, type) work.

#### `/admin/settings`

- [ ] Form renders.
- [ ] Save a harmless change → persists (check via SQL or re-open).

#### `/admin/prices`

- [ ] Page renders; any editable pricing tiers save correctly.

### Steps

- [ ] **Step 1: Walk through each page.**
- [ ] **Step 2: Journal + commit**

---

## Task 13: Admin dashboard — catalog area

### Pages

#### `/admin/new-entry`

- [ ] Four card links render: Transfers, Tours, Experiences, Vehicles.
- [ ] Each card click resolves to the respective manage-* page.

#### `/admin/manage-transfers`

- [ ] Add transfer form: title, description, price, image upload/URL.
- [ ] Submit → new row.
- [ ] Edit modal opens, saves.
- [ ] Delete confirmation works.
- [ ] Published toggle switches.

#### `/admin/manage-tours`

- [ ] Add tour form: title, category dropdown (4 options), prices (sedan/van/minibus), entrance ticket + count, hotel option shows ONLY when category is Multi-day or Experience multi-day, images gallery (file upload multiple, URL paste, max 10, cover badge on first).
- [ ] Submit valid → new row in `tours_catalog`; grid card shows.
- [ ] Submit with no images → blocked with "Please add at least one image."
- [ ] Edit modal: gallery rehydrates, category/entrance/hotel values repopulate; hotel wrap respects the category.
- [ ] Toggle Live/Hidden.
- [ ] Delete works.
- [ ] URL paste with invalid URL (e.g. "not a url") → rejected with browser `reportValidity` (regression of fix `01ebef7`).
- [ ] Opening edit modal twice on same row does not duplicate the hotel-toggle listener (regression of fix `01ebef7`) — verify by monitoring `change` event firing once via `console.log` or `dispatchEvent`.

#### `/admin/manage-experiences`

- [ ] **Parity gap is expected** (Task 7 was deferred). Walk through what IS there; likely missing category/entrance/hotel fields — log as findings (not fixes — those are follow-up work, but should be logged for visibility).
- [ ] Add/Edit/Delete/Toggle as-is.

#### `/admin/manage-vehicles`

- [ ] Add vehicle form: name, type/slug, max_passengers, image.
- [ ] Submit → new row in `public.vehicles`.
- [ ] Edit modal saves.
- [ ] Delete works.
- [ ] Active toggle.

### Steps

- [ ] **Step 1: Walk through each page.**
- [ ] **Step 2: Journal + commit**

---

## Task 14: Driver dashboard — rides area

Login as the approved driver (preferred: `driver@itdev.gr` if password is known; fallback `smoke-driver-2026-04-22@opawey.test` from Task 1). If the original driver's password is unknown, use the smoke driver.

### Pages

#### `/driver` (home)

- [ ] Stats / calendar render.
- [ ] Any quick-action buttons work.

#### `/driver/upcoming`

- [ ] Lists rides where `driver_uid = current` and `ride_status in ('new','assigned','pickup','onboard')`.
- [ ] Click a ride → detail (/driver/ride?id=…).

#### `/driver/past`

- [ ] Lists completed rides. Empty state if none.

#### `/driver/available`

- [ ] Lists rides with `ride_status='new'`, `released_to_drivers=true`, `driver_uid is null` (per fix `6814ce5`).
- [ ] Reject → card fades out locally (no DB change — regression check).
- [ ] Accept → confirmation modal → Yes → DB: `driver_uid = current`, `ride_status='assigned'`; toast "Ride accepted successfully!"; card removed from list; appears in /driver/upcoming.
- [ ] Newly-accepted ride triggers notification badge update on admin (cross-role, covered in Task 18).

#### `/driver/ride?id=…`

- [ ] Ride detail page renders for a valid id.
- [ ] Status progression buttons (pickup → onboard → completed) work and update DB.
- [ ] Notes can be added.

### Steps

- [ ] **Step 1: Pre-seed a released-ride** via admin (Task 11 release toggle) OR SQL:
  ```sql
  update public.transfers set released_to_drivers=true, ride_status='new', driver_uid=null where created_at > now() - interval '1 day' limit 3;
  ```
- [ ] **Step 2: Walk through each page.**
- [ ] **Step 3: Journal + commit**

---

## Task 15: Driver dashboard — account area

### Pages

#### `/driver/profile`

- [ ] Profile form loads with current values.
- [ ] Edit display_name / phone / num_vehicles / primary_car_type / car_types → save → SQL verify.

#### `/driver/vehicles`

- [ ] "Add Vehicle" modal: brand, model, year, color, **category (lowercase-value options from fix `8a322ec`)**, max_pax, max_luggage, plate.
- [ ] Submit with category "Sedan" → succeeds (value `sedan` sent, passes CHECK) — regression.
- [ ] Submit without category → succeeds (null accepted).
- [ ] Edit modal repopulates, saves.
- [ ] Activate/Deactivate toggle.
- [ ] Delete with confirmation.
- [ ] Error surfacing: force a conflict (e.g. duplicate plate if UNIQUE exists) and observe `[<code>] <message>` pill (regression).

#### `/driver/drivers`

- [ ] Sub-driver add form.
- [ ] List renders sub-drivers.
- [ ] Edit / delete.

#### `/driver/billing`

- [ ] Payment report renders; date filters; totals per month.

#### `/driver/payment-data`

- [ ] Payment method radio (bank / stripe) toggles sections.
- [ ] Save bank details → `public.payment_data.upsert` on partner_id → SQL verify.
- [ ] Save stripe id.
- [ ] Reload → values repopulate.

#### `/driver/settings`

- [ ] Settings form saves.

### Steps

- [ ] **Step 1: Walk through each page.**
- [ ] **Step 2: Journal + commit**

---

## Task 16: Hotel dashboard

Login as `smoke-hotel-2026-04-22@opawey.test`.

### `/hotel`

- [ ] Calendar renders.
- [ ] Reservations table shows rows where `partner_id = this hotel`.
- [ ] Hotel Commission column shows `€10.00` (the value set in Task 1) per row — regression of `d033e37`.
- [ ] Payment + ride status badges render correctly.
- [ ] Calendar month nav works.
- [ ] Day click shows bookings for that day.

### `/hotel/profile`

- [ ] Profile form loads with Task 1 setup values (hotel_name="Smoke Hotel").
- [ ] Edit hotel_name / contact / VAT / website → save → SQL verify.
- [ ] Avatar (if present) uploads.

### Steps

- [ ] **Step 1: Seed at least one transfer with `partner_id = smoke-hotel uid`** so /hotel has data. If empty, create via admin dashboard (Task 11) or SQL.
- [ ] **Step 2: Walk through both pages.**
- [ ] **Step 3: Journal + commit**

---

## Task 17: Agency dashboard

Login as `smoke-agency-2026-04-22@opawey.test`.

### `/agency`

- [ ] Calendar renders.
- [ ] Reservations table shows `partner_id = this agency` rows.
- [ ] Agency Price column shows `total_price * (1 - discount/100)` = 90% of total (Task 1 sets discount=10).
- [ ] Payment status badge (Pending/Partial/Paid) renders correctly.

### `/agency/profile`

- [ ] Profile form loads with Task 1 setup values (agency_name="Smoke Agency").
- [ ] Edit fields → save → SQL verify.

### Steps

- [ ] **Step 1: Seed a transfer with `partner_id = smoke-agency uid`**. If empty, do it via admin dashboard or SQL.
- [ ] **Step 2: Walk through both pages.**
- [ ] **Step 3: Journal + commit**

---

## Task 18: Cross-role notifications regression

This test exercises the notification-badge pipeline end-to-end. Requires TWO browser contexts (Playwright MCP supports multiple tabs via `mcp__playwright__browser_tabs`).

### Scenarios

#### S1 — Admin sees new booking live

- [ ] Tab A: login as admin, land on `/admin` (any admin page). Record Transfers-tab badge count.
- [ ] Tab B: login as regular user. Run transfer booking T1 end-to-end.
- [ ] Tab A: within ~3 seconds, Transfers-tab badge increments by 1 (Realtime).
- [ ] Admin toggles the new ride's release → no badge count change (release doesn't affect admin's count, only driver's).

#### S2 — Driver sees released ride live

- [ ] Tab A: login as admin.
- [ ] Tab B: login as driver, land on `/driver`. Record Available Rides badge.
- [ ] Tab A: release a new transfer in /admin/transfers.
- [ ] Tab B: within ~3 seconds, Available Rides badge increments.
- [ ] Tab B: accept the ride → badge decrements.

#### S3 — Hotel sees new reservation

- [ ] Tab A: login as admin.
- [ ] Tab B: login as hotel, land on `/hotel/profile` (so Reservations badge is relevant).
- [ ] Tab A: create a transfer with `partner_id = smoke-hotel uid` (admin Add Booking — or SQL).
- [ ] Tab B: Reservations badge shows 1 (new since last visit watermark).
- [ ] Tab B: click Reservations → navigate to /hotel. Badge clears. Refresh — stays cleared (localStorage).

#### S4 — Agency same as S3

#### S5 — Partner registration badge

- [ ] Tab A: login as admin, observe Partners badge.
- [ ] Tab B: register a new partner via `/register-partner`.
- [ ] Tab A: Partners badge increments within ~3s.
- [ ] Tab A: approve the partner → badge decrements.

#### S6 — Requests badge

- [ ] Tab A: admin, observe Requests badge.
- [ ] Tab B: submit contact form on /contact.
- [ ] Tab A: Requests badge increments.
- [ ] Tab A: mark as Answered → decrements.

### Steps

- [ ] **Step 1: Walk through S1-S6.**
- [ ] **Step 2: Journal + commit**

---

# Phase 4 — Fix pass

## Task 19 (template, spawned N times — one per finding)

This task definition is reusable. For each open finding `F<N>` in the punch list, run this task. Update the punch list entry as steps progress.

**Files:** vary per finding; recorded in the finding's Fixed-in commit.

- [ ] **Step 1: Open `qa/2026-04-22-full-smoke-test.md` punch list; locate `F<N>`.**
- [ ] **Step 2: Reproduce.** Follow the exact repro steps. Confirm the observed behaviour is still present (don't fix something that's gone stale).
- [ ] **Step 3: Determine root cause.** Read the relevant component/page. For DB-constraint issues, run simulation via management API as in Task 5 of the previous plan. For UI issues, inspect the DOM via `mcp__playwright__browser_snapshot` and the compiled module via `curl http://localhost:<port>/src/pages/.../xxx.astro?astro&type=script&index=0&lang.ts`.
- [ ] **Step 4: Decide scope of fix.** Smallest diff possible. Do NOT bundle unrelated improvements.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Build check.** `npm run build` — must pass.
- [ ] **Step 7: Verify the repro now fails** — re-run the exact repro from Step 2. Capture a "now works" screenshot.
- [ ] **Step 8: Run any adjacent test the fix might have broken.** E.g. if the fix touched `manage-tours.astro`, re-run the Task 13 manage-tours section. If it touched `AdminLayout.astro`, spot-check notification badges on one admin page.
- [ ] **Step 9: Update the punch-list entry** — set Status to `fixed-pending-verify`, fill Fixed-in with the commit SHA.
- [ ] **Step 10: Commit.**

```bash
git add <files>
git commit -m "fix(<scope>): <title> (closes F<N>)

<body explaining root cause and fix>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 11: Commit the journal update** separately.

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: record F<N> as fixed-pending-verify"
```

### Stop criteria for Phase 4

- All findings with severity C or I are `fixed-pending-verify`.
- Findings with severity M may be deferred; document the deferral in the punch list entry (Status = `wontfix` with reason, or keep `open` for backlog).

---

# Phase 5 — Regression

## Task 20: Regression sweep

After Phase 4, re-run the journal sections that contain any `F<N>` marked `fixed-pending-verify`. Do NOT re-run the entire suite — only the areas touched.

### Steps

- [ ] **Step 1: Build the regression set.** For each finding with status `fixed-pending-verify`, identify the Section it originally came from (it's recorded in the `Page:` line). Collect the unique set of Section ids.
- [ ] **Step 2: Re-run each Section in that set.** Use the same procedure as the original Task (journal per-page checks, console errors, SQL verifications). Do it on a fresh browser context with cookies cleared.
- [ ] **Step 3: For each finding confirmed resolved**, update its Status to `verified` in the punch list.
- [ ] **Step 4: For any NEW findings discovered** during regression, add them as `F<N>` entries with a note `Discovered during regression of F<prior-id>`. They become new Phase 4 work — loop back.
- [ ] **Step 5: Stop criterion** — all C / I findings are `verified`, and regression introduced no new C / I findings. M findings remain or are `wontfix`.
- [ ] **Step 6: Write a final summary** at the top of the journal:
  - Total findings: N
  - By severity: C=x, I=y, M=z
  - Resolved: N-<deferred>
  - Deferred / wontfix: <list>
- [ ] **Step 7: Commit.**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "$(cat <<'EOF'
qa: full-scale smoke test complete — regression pass verified

Journal: qa/2026-04-22-full-smoke-test.md
Findings: C=x, I=y, M=z; all C/I verified fixed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (run after writing this plan)

### Spec coverage

The user's request was: "check all the buttons, All the processes … each dashboard … all the books are working … creating book, tour, experience … Collect all the errors, fix them and once you fix them run again smoke test for each fix".

Coverage check:
- "all the buttons" → each sweep task enumerates the interactive elements per page (explicit checklists).
- "each dashboard" → admin (Tasks 11/12/13), driver (14/15), hotel (16), agency (17), user profile (6). ✓
- "all the books are working" → funnels Tasks 7/8/9 cover transfer/hourly/tour × 3 payment methods + partner variants. ✓
- "creating book, tour, experience is working as they should" → admin Add Booking modals (Task 11), catalog creation (Task 13), experience requests (Task 10). ✓
- "Collect all the errors" → centralised punch list with finding template. ✓
- "fix them and … run again smoke test for each fix" → Task 19 template forces repro-first-fix-then-verify; Task 20 regression pass. ✓
- Cross-role notification badges (from the previous plan) are explicitly re-verified in Task 18. ✓

No gap.

### Placeholder scan

Flagged phrases to double-check:
- "if the ride_status … is still in use" — Task 6, referring to `experiences` table being partly superseded by requests. That's an actual data question the tester needs to answer, not a placeholder. ✓
- "Parity gap is expected" — Task 13 manage-experiences. This is an intentional deferral note, not a skipped step. The tester still walks through what's there. ✓
- "If the catalog has no Multi-day Tour, create one via SQL before running" — has exact SQL. ✓
- "add appropriate error handling" — not present. ✓
- "similar to Task N" — not present (fix task template is the ONE place where tasks repeat, and it's explicitly a template to be spawned; code of the repro-fix-verify loop is given once). ✓

### Type consistency

- Finding ids are `F<N>`, consistently.
- Table aliases: `transfers` / `tours` / `experiences` used everywhere.
- Account names match between Task 1 and every downstream task.
- Journal path `qa/2026-04-22-full-smoke-test.md` is identical in every reference.
- Branch name `feat/admin-booking-notifications-2026-04-22` used in headers + every commit block.

Plan is complete.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-22-full-smoke-test.md`.

**Two execution options:**

**1. Subagent-Driven (recommended at this scale)** — I dispatch a fresh subagent per task; reviewer subagents run between tasks; findings roll into the shared journal; fast iteration on fix tasks; main session stays clean.

**2. Inline Execution** — Execute tasks in this session; I drive Playwright MCP directly; journal + fix commits happen here.

**Which approach?**
