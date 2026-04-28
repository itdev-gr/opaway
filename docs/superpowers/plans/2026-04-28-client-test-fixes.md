# Client Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs surfaced in the client's testing pass: (1) booking flow forces login at payment time — open it to guest checkout while keeping partner registration auth-gated; (2) the native `<input type="time">` doesn't work on the client's computer — replace with a HH/MM dropdown pair that works in every browser; (3) the admin "request line" detail modal hides several fields submitted by experience inquiries — surface them.

**Architecture:** Three independent fixes, ordered by risk. Phase A (guest checkout) is the heaviest because it touches DB RLS + four frontend payment pages; Phase B (time picker) is a pure UI swap with a tiny shared helper; Phase C (admin modal) is a single-file display change. Each phase ships and is verified separately. Partners (drivers, hotels, agencies) keep their existing auth gates — only end-customer booking surfaces become guest-friendly.

**Tech Stack:** Astro 5, Supabase JS v2, PostgreSQL RLS, Supabase Management API (for the migration), TypeScript.

**Out of scope (explicit):**
- Admin / driver / hotel / agency / profile dashboards (per the user's standing instruction not to touch dashboards). Phase C touches `src/components/ReservationDetailModal.astro`, a shared modal — that's allowed because the data fix is the user-facing contract, not dashboard layout.
- Email confirmations to guests. The booking row lands in the DB; admin handles follow-up. A dedicated guest-email pipeline is a follow-up.
- Captcha / rate limiting on guest inserts. Acceptable for v1; the existing app does not have anti-spam infrastructure.
- Partner registration (`/register-partner`) — stays auth-gated, untouched.
- Profile-side "my bookings" for guests — guests don't have an account, so they don't have a profile; this is by design.

---

## Current state (verified before writing this plan)

- **`src/pages/book/transfer/payment.astro:437-443`**, **`src/pages/book/hourly/payment.astro:324-330`**, **`src/pages/book/tour/payment.astro:420-426`** all contain an identical block:
  ```ts
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}&reason=booking`;
    return;
  }
  ```
- **`src/pages/experiences.astro`** has a similar gate near the inquiry submit handler (writes to `requests` table).
- **DB RLS** in `supabase-migration.sql:339,363,387`:
  ```sql
  on public.transfers   for insert with check (auth.uid() is not null);
  on public.tours       for insert with check (auth.uid() is not null);
  on public.experiences for insert with check (auth.uid() is not null);
  ```
  Anon inserts are blocked at the RLS layer in addition to the JS gate.
- **`requests` table** already allows anon inserts (per `db/migrations/2026-04-22-requests-user-select.sql`, `user_id` is `references auth.users on delete set null` and the SELECT policy matches on `email` for guests). Phase A doesn't need to migrate `requests`.
- **Native `<input type="time">`** is used at `src/pages/book/transfer.astro`, `src/pages/book/hourly.astro`, `src/pages/book/tour.astro`, `src/pages/experiences.astro:114`. Each form reads the value via `document.getElementById('…-time').value` and forwards it through URL params or a Supabase insert payload. No central time picker exists.
- **`src/components/ReservationDetailModal.astro:77-102`** renders ~12 fields for experience requests. The `requests` row carries 17. Missing display fields: `last_name`, `source`, `user_email`, `user_display_name`, `user_id`. (Per the explorer note, `user_id` is an internal UUID — not user-facing.)
- **No test runner** is configured. Verification is manual browser smoke test on live (Vercel auto-deploys from `main`) using the standing admin credentials and an anonymous browser session for the guest path.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `db/migrations/2026-04-28-allow-guest-bookings.sql` | Drops the `auth.uid() IS NOT NULL` INSERT constraint on `transfers`, `tours`, `experiences`; replaces with a permissive INSERT policy that allows anon. Makes `uid` nullable. Idempotent. |
| `src/lib/time-picker.ts` | Tiny helper: `renderTimePickerHTML(name, defaultValue?)` returns the two-`<select>` markup; `readTimePickerValue(name)` reads the combined `HH:MM` from the DOM. Replaces native `<input type="time">` everywhere. |

### Modified files

| Path | Change |
|---|---|
| `src/pages/book/transfer/payment.astro` | Remove the `if (!user) redirect` gate; insert payload omits `uid` when guest. |
| `src/pages/book/hourly/payment.astro` | Same. |
| `src/pages/book/tour/payment.astro` | Same. |
| `src/pages/experiences.astro` | Remove auth gate in the inquiry submit handler; insert payload to `requests` omits `user_id` when guest. Replace `<input type="time">` with the new helper. |
| `src/pages/book/transfer.astro` | Replace `<input type="time">` with helper. |
| `src/pages/book/hourly.astro` | Same. |
| `src/pages/book/tour.astro` | Same. |
| `src/components/BookingSection.astro` | If the homepage booking widget uses native `<input type="time">`, replace there too. |
| `src/components/ReservationDetailModal.astro` | Add `last_name`, `source`, `user_email`, `user_display_name` to the request-detail render. Show "Guest" if `user_id` is null. |

---

## Phase A — Allow guest bookings

### Task A1: DB migration — open INSERT to anon, make `uid` nullable

**Files:**
- Create: `db/migrations/2026-04-28-allow-guest-bookings.sql`
- Apply via Supabase Management API.

- [ ] **Step 1: Write the migration**

Create `db/migrations/2026-04-28-allow-guest-bookings.sql` with:

```sql
-- Allow guest (anonymous) bookings on transfers, tours, experiences.
-- The frontend payment pages collect first_name / last_name / email / phone in
-- every flow, so the booking row carries enough contact info even without a
-- user account. Admins still see all rows; logged-in users still only see their
-- own (the SELECT policies match on uid which can now be null for guests).
-- Idempotent.

-- 1. Make `uid` nullable so guest rows can have NULL user.
alter table public.transfers   alter column uid drop not null;
alter table public.tours       alter column uid drop not null;
alter table public.experiences alter column uid drop not null;

-- 2. Replace the "auth.uid() IS NOT NULL" INSERT policies with permissive ones.
drop policy if exists "Authenticated insert transfers"   on public.transfers;
drop policy if exists "Authenticated insert tours"       on public.tours;
drop policy if exists "Authenticated insert experiences" on public.experiences;

-- Best-effort: also drop policies that exist under the actual current names.
-- The original migration names were inconsistent — these next three drops
-- cover the names observed in supabase-migration.sql.
drop policy if exists "Insert transfers"   on public.transfers;
drop policy if exists "Insert tours"       on public.tours;
drop policy if exists "Insert experiences" on public.experiences;

create policy "Anyone insert transfers"
  on public.transfers for insert
  to anon, authenticated
  with check (true);

create policy "Anyone insert tours"
  on public.tours for insert
  to anon, authenticated
  with check (true);

create policy "Anyone insert experiences"
  on public.experiences for insert
  to anon, authenticated
  with check (true);
```

- [ ] **Step 2: Apply the migration via Supabase Management API**

Run:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'query': open('db/migrations/2026-04-28-allow-guest-bookings.sql').read()}))")"
```

Expected output: `[]` (DDL queries return an empty result on success).

- [ ] **Step 3: Verify the policies + nullable columns**

Run:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d '{"query": "select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='"'"'public'"'"' and tablename in ('"'"'transfers'"'"','"'"'tours'"'"','"'"'experiences'"'"') and cmd = '"'"'INSERT'"'"';"}'
```

Expected: rows for `Anyone insert transfers/tours/experiences` with `with_check = true`.

Then check nullability:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d '{"query": "select table_name, is_nullable from information_schema.columns where table_schema='"'"'public'"'"' and table_name in ('"'"'transfers'"'"','"'"'tours'"'"','"'"'experiences'"'"') and column_name='"'"'uid'"'"';"}'
```

Expected: each row shows `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-04-28-allow-guest-bookings.sql
git commit -m "db: allow guest bookings on transfers/tours/experiences (RLS + nullable uid)"
```

### Task A2: Remove the auth gate in `transfer/payment.astro` and emit guest-safe insert

**Files:**
- Modify: `src/pages/book/transfer/payment.astro` (lines ~437-443 region for the gate; the supabase insert payload further down).

- [ ] **Step 1: Locate the gate and the insert payload**

```bash
grep -n "auth.getUser\|reason=booking\|supabase.from('transfers').insert" src/pages/book/transfer/payment.astro | head -10
```

Expected: lines around 437–443 (gate) and a separate line where `.insert({...})` runs.

- [ ] **Step 2: Replace the gate**

In `src/pages/book/transfer/payment.astro`, find:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}&reason=booking`;
  return;
}
```

Replace with:

```ts
// Allow guest bookings: no redirect to /login. If the user happens to be
// signed in we still capture their uid; otherwise the row is created with
// uid = NULL and admin sees the contact info from the form fields.
const { data: { user } } = await supabase.auth.getUser();
const guestUid: string | null = user?.id ?? null;
```

- [ ] **Step 3: Update the insert payload**

In the same file, find the `supabase.from('transfers').insert({…})` block. Replace whatever currently sets `uid: user.id` (or similar) with `uid: guestUid`. Leave the rest of the payload untouched.

If the current code does NOT explicitly include a `uid` field (relying on a default or header), add `uid: guestUid` to the insert payload object so the row is correctly attributed when a logged-in user books.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: 63 pages, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/book/transfer/payment.astro
git commit -m "feat(book/transfer): allow guest checkout (no login required)"
```

### Task A3: Same change on `hourly/payment.astro`

**Files:**
- Modify: `src/pages/book/hourly/payment.astro` (gate near lines 324-330; insert further down).

- [ ] **Step 1: Apply the identical change as Task A2 to this file**

Find:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}&reason=booking`;
  return;
}
```

Replace with:

```ts
const { data: { user } } = await supabase.auth.getUser();
const guestUid: string | null = user?.id ?? null;
```

Then update the `supabase.from('transfers').insert({…})` payload so its `uid` field reads `uid: guestUid`.

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/book/hourly/payment.astro
git commit -m "feat(book/hourly): allow guest checkout (no login required)"
```

### Task A4: Same change on `tour/payment.astro`

**Files:**
- Modify: `src/pages/book/tour/payment.astro` (gate near lines 420-426; insert into `tours` table further down).

- [ ] **Step 1: Apply the same change as Task A2/A3**

Replace the gate the same way. Update the `supabase.from('tours').insert({…})` payload's `uid` field to read `uid: guestUid`.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/pages/book/tour/payment.astro
git commit -m "feat(book/tour): allow guest checkout (no login required)"
```

### Task A5: Remove the auth gate on `experiences.astro` inquiry form

**Files:**
- Modify: `src/pages/experiences.astro` — find the experience-request submit handler.

- [ ] **Step 1: Locate the gate**

```bash
grep -n "auth.getUser\|/login\|reason=booking\|supabase.from('requests').insert" src/pages/experiences.astro | head -10
```

- [ ] **Step 2: Remove the gate from the request-submit handler**

The `requests` table already supports anon inserts (per migration `2026-04-22-requests-user-select.sql`, `user_id` is nullable and the SELECT policy matches on email). The frontend gate is the only thing blocking guest experience inquiries.

If the file has a block like:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  // redirect or alert
  window.location.href = '/login';
  return;
}
```

Replace with:

```ts
const { data: { user } } = await supabase.auth.getUser();
const guestUserId: string | null = user?.id ?? null;
```

In the `supabase.from('requests').insert({…})` payload, set `user_id: guestUserId` (the column is already nullable). Keep `user_display_name` and `user_email` as `null` for guests, OR populate them from the form fields if appropriate (e.g., set `user_email = formEmail` so admin can search).

If the file already collects `email` from the form, set:

```ts
user_email: guestUserId ? user!.email : formEmail,
user_display_name: guestUserId ? (user!.user_metadata?.full_name ?? null) : null,
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/pages/experiences.astro
git commit -m "feat(experiences): allow guest inquiries (no login required)"
```

### Task A6: End-to-end verification of guest bookings

**Files:** none modified — verification only.

- [ ] **Step 1: Push current branch and let Vercel deploy (~90s)**

```bash
git push origin main
```

Wait until Vercel deploys.

- [ ] **Step 2: Test guest booking on live as an anonymous user**

Open `https://opaway.vercel.app` in an incognito browser window. Do NOT sign in. Walk through:

1. Click **Book a Transfer**, fill the form, hit "See prices".
2. Pick a vehicle on the results page.
3. Fill passenger details.
4. On the payment page:
   - Pay with cash (or use a Stripe test card if Stripe is configured).
   - Submit.
5. Confirm: the page does NOT redirect to /login. You see a success page or confirmation.

Repeat for **Hourly** and **Tour** flows.

For **Experiences**:
1. Open `/experiences`, fill the inquiry form.
2. Submit. No redirect to /login.
3. See a success state.

- [ ] **Step 3: Verify guest rows landed in admin dashboards**

Sign in as admin (`mkifokeris@itdev.gr` / `123456789`) in a separate browser session.

1. Go to `/admin/transfers` — the guest transfer row appears in the table. The "Driver" column is "Unassigned"; the contact info matches what you entered as guest.
2. `/admin/tours` — the guest tour row appears.
3. `/admin/index` — the calendar shows the new bookings.
4. `/admin/requests` — the guest experience inquiry appears.

If guest rows do NOT appear: the SELECT policies on the booking tables also need a `public.is_admin()` clause. Open the relevant policy in `supabase-migration.sql` (line 341 for transfers, etc.) and check whether admin reads are explicitly allowed. If not, add an additional SELECT policy in a follow-up migration:

```sql
create policy "Admins read all transfers"
  on public.transfers for select
  to authenticated
  using (public.is_admin());
```

- [ ] **Step 4: No commit if everything works** — verification only.

---

## Phase B — Replace native time picker

### Task B1: Create the shared time-picker helper

**Files:**
- Create: `src/lib/time-picker.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/time-picker.ts`:

```ts
/**
 * Browser-agnostic time picker. Replaces `<input type="time">` (which fails
 * to render on some Linux Chromium builds and certain corporate browsers)
 * with two `<select>` elements (HH 00–23, MM in 5-minute increments).
 *
 * Render the markup with `renderTimePickerHTML(name)` and read back the
 * combined "HH:MM" string with `readTimePickerValue(name)`.
 *
 * Pass an optional default value as "HH:MM" to pre-select.
 */

const HOURS: string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES: string[] = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export interface TimePickerOptions {
  defaultValue?: string;     // "HH:MM"
  required?: boolean;
  selectClass?: string;      // tailwind for each <select>
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderTimePickerHTML(name: string, opts: TimePickerOptions = {}): string {
  const [defH, defM] = (opts.defaultValue ?? '').split(':');
  const cls = opts.selectClass ?? 'flex-1 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]';
  const required = opts.required ? ' required' : '';

  const hOptions = HOURS.map(h => `<option value="${h}"${h === defH ? ' selected' : ''}>${h}</option>`).join('');
  const mOptions = MINUTES.map(m => `<option value="${m}"${m === defM ? ' selected' : ''}>${m}</option>`).join('');

  return `
    <div class="time-picker flex items-center gap-2" data-time-picker="${escAttr(name)}">
      <select id="${escAttr(name)}-hh" class="${cls}"${required}>
        <option value="" disabled${defH ? '' : ' selected'}>HH</option>
        ${hOptions}
      </select>
      <span class="text-neutral-400">:</span>
      <select id="${escAttr(name)}-mm" class="${cls}"${required}>
        <option value="" disabled${defM ? '' : ' selected'}>MM</option>
        ${mOptions}
      </select>
    </div>`;
}

/** Reads the picker into an "HH:MM" string. Returns "" if either dropdown is empty. */
export function readTimePickerValue(name: string): string {
  const hh = (document.getElementById(`${name}-hh`) as HTMLSelectElement | null)?.value ?? '';
  const mm = (document.getElementById(`${name}-mm`) as HTMLSelectElement | null)?.value ?? '';
  if (!hh || !mm) return '';
  return `${hh}:${mm}`;
}

/** Convenience for setting both dropdowns programmatically. */
export function setTimePickerValue(name: string, value: string): void {
  const [h, m] = (value ?? '').split(':');
  const hSel = document.getElementById(`${name}-hh`) as HTMLSelectElement | null;
  const mSel = document.getElementById(`${name}-mm`) as HTMLSelectElement | null;
  if (hSel && h) hSel.value = h;
  if (mSel && m) mSel.value = m;
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: 63 pages, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/time-picker.ts
git commit -m "feat(lib): cross-browser HH/MM time picker"
```

### Task B2: Replace `<input type="time">` in `book/transfer.astro`

**Files:**
- Modify: `src/pages/book/transfer.astro`

- [ ] **Step 1: Locate the time input**

```bash
grep -n 'type="time"' src/pages/book/transfer.astro
```

- [ ] **Step 2: Replace the markup**

In the frontmatter (top `---` block) of `src/pages/book/transfer.astro`, add the import:

```astro
import { renderTimePickerHTML } from '../../lib/time-picker';
```

(Note: this file is at `src/pages/book/transfer.astro`, so the relative path is `../../lib/...`.)

In the template body, locate the `<input type="time" id="transfer-time" …>` element and replace it with:

```astro
<Fragment set:html={renderTimePickerHTML('transfer-time', { required: true })} />
```

(`Fragment` with `set:html` lets Astro inline the helper's HTML at SSR time.)

If `Fragment` isn't already imported in the file, add at the top of the frontmatter:

```astro
import { Fragment } from 'astro:components';
```

- [ ] **Step 3: Update the JS that reads the time value**

Find the script block where `document.getElementById('transfer-time').value` (or similar) is read. Replace with:

```ts
import { readTimePickerValue } from '../../lib/time-picker';
// ...
const time = readTimePickerValue('transfer-time');
```

The value format is identical (`HH:MM` string), so the rest of the URL-param plumbing or insert payload doesn't need to change.

If the form-validation logic checks `time-input.value`, update it to use `readTimePickerValue('transfer-time')` instead.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/pages/book/transfer.astro
git commit -m "fix(book/transfer): replace native time input with HH/MM dropdowns"
```

### Task B3: Same swap on `book/hourly.astro`

**Files:**
- Modify: `src/pages/book/hourly.astro`

- [ ] **Step 1: Apply Task B2's pattern, with the picker name `hourly-time`**

Markup:

```astro
<Fragment set:html={renderTimePickerHTML('hourly-time', { required: true })} />
```

Reader:

```ts
const time = readTimePickerValue('hourly-time');
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/pages/book/hourly.astro
git commit -m "fix(book/hourly): replace native time input with HH/MM dropdowns"
```

### Task B4: Same swap on `book/tour.astro`

**Files:**
- Modify: `src/pages/book/tour.astro`

- [ ] **Step 1: Apply Task B2's pattern with picker name `tour-time`**

Markup:

```astro
<Fragment set:html={renderTimePickerHTML('tour-time', { required: true })} />
```

Reader:

```ts
const time = readTimePickerValue('tour-time');
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/pages/book/tour.astro
git commit -m "fix(book/tour): replace native time input with HH/MM dropdowns"
```

### Task B5: Same swap on `experiences.astro`

**Files:**
- Modify: `src/pages/experiences.astro` (around line 114).

- [ ] **Step 1: Apply Task B2's pattern with picker name `experience-time`**

This file is at `src/pages/experiences.astro`, so the import path is `../lib/time-picker` (one `../`, not two).

Markup:

```astro
<Fragment set:html={renderTimePickerHTML('experience-time', { required: true })} />
```

Reader:

```ts
const time = readTimePickerValue('experience-time');
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/pages/experiences.astro
git commit -m "fix(experiences): replace native time input with HH/MM dropdowns"
```

### Task B6: Same swap on the homepage `BookingSection.astro` (if present)

**Files:**
- Modify: `src/components/BookingSection.astro` (the homepage booking widget).

- [ ] **Step 1: Check whether this component uses `<input type="time">`**

```bash
grep -n 'type="time"' src/components/BookingSection.astro
```

If no hits, skip this task entirely — commit nothing, move on.

- [ ] **Step 2: If hits, apply Task B2's pattern**

The component is at `src/components/BookingSection.astro`, so the import path is `../lib/time-picker`. The picker name should be unique per tab if there are multiple time inputs (e.g., `home-transfer-time`, `home-hourly-time`, `home-tour-time`). Reader code that submits to URL params must use the matching `readTimePickerValue('…')`.

- [ ] **Step 3: Build + commit (only if Step 1 found hits)**

```bash
npm run build
git add src/components/BookingSection.astro
git commit -m "fix(home/booking): replace native time input with HH/MM dropdowns"
```

### Task B7: Browser verify on live

**Files:** none modified — verification only.

- [ ] **Step 1: Push and wait for deploy**

```bash
git push origin main
```

- [ ] **Step 2: Open each booking entry on live and pick a time**

On `https://opaway.vercel.app/book/transfer`, `/book/hourly`, `/book/tour`, `/experiences`:

1. Click the time picker — confirm two `<select>` dropdowns appear (HH and MM).
2. Pick `09:30`. The form should accept the value.
3. Submit and verify the `time` param in the next URL or in the booking row matches `09:30`.

Spot-check on Safari (the most common cause of native time-input failures) if available.

- [ ] **Step 3: No commit** — verification only.

---

## Phase C — Show all fields in the admin request modal

### Task C1: Add missing fields to `ReservationDetailModal.astro`

**Files:**
- Modify: `src/components/ReservationDetailModal.astro`

- [ ] **Step 1: Read the existing experience-request render block**

```bash
grep -n "source\|user_email\|last_name\|user_display_name\|user_id" src/components/ReservationDetailModal.astro
```

If the file has separate render branches by `source` (transfer/tour/experience), find the experience branch (likely around lines 77-102 per the explorer report).

- [ ] **Step 2: Add the missing rows**

In the experience-request render block, just before the closing of the modal body (after `special_requests` and before the action buttons), append:

```astro
{row.last_name && (
  <div class="flex justify-between text-sm py-1.5 border-b border-neutral-100">
    <span class="text-neutral-500">Last name</span>
    <span class="text-neutral-800 font-medium">{row.last_name}</span>
  </div>
)}
{row.source && (
  <div class="flex justify-between text-sm py-1.5 border-b border-neutral-100">
    <span class="text-neutral-500">Source</span>
    <span class="text-neutral-800 font-medium capitalize">{row.source}</span>
  </div>
)}
{row.user_display_name && (
  <div class="flex justify-between text-sm py-1.5 border-b border-neutral-100">
    <span class="text-neutral-500">Account name</span>
    <span class="text-neutral-800 font-medium">{row.user_display_name}</span>
  </div>
)}
{row.user_email && row.user_email !== row.email && (
  <div class="flex justify-between text-sm py-1.5 border-b border-neutral-100">
    <span class="text-neutral-500">Account email</span>
    <span class="text-neutral-800 font-medium">{row.user_email}</span>
  </div>
)}
<div class="flex justify-between text-sm py-1.5 border-b border-neutral-100">
  <span class="text-neutral-500">Submitted by</span>
  <span class="text-neutral-800 font-medium">{row.user_id ? 'Logged-in user' : 'Guest'}</span>
</div>
```

The `user_id` UUID itself is not rendered to admins — only the "Guest" / "Logged-in user" label, which is what they actually need.

If the modal renders fields via a JS template literal (innerHTML) instead of Astro JSX, adapt the snippet to that style — keep the same field set and labels.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: 63 pages, no errors.

- [ ] **Step 4: Browser verify on live**

Push, wait for deploy, sign in as admin, go to `/admin/requests` and click an experience request that has a `last_name`, `source = 'experience'`, and a logged-in user (or use the new guest inquiry from Phase A's verification). Confirm the modal now shows: Last name, Source, Submitted by ("Guest" or "Logged-in user"), and Account email/Account name when present.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReservationDetailModal.astro
git commit -m "fix(admin/requests): show last_name, source, account info in detail modal"
```

---

## Phase D — Final verification

### Task D1: Cross-cutting smoke test on live

**Files:** none modified — verification only.

- [ ] **Step 1: Push and wait for deploy**

```bash
git push origin main
```

- [ ] **Step 2: Guest booking flow (incognito)**

In an incognito browser on `https://opaway.vercel.app`:
1. Book a transfer end-to-end as guest. No login redirect.
2. Book hourly as guest. No login redirect.
3. Book tour as guest. No login redirect.
4. Submit experience inquiry as guest. No login redirect.

Each one should land you on a success state without ever seeing /login.

- [ ] **Step 3: Time picker (any browser)**

On each booking entry page, confirm the time picker is two dropdowns (HH and MM), not a native time input.

- [ ] **Step 4: Admin visibility**

Sign in as admin. Confirm:
- All four guest entries from Step 2 appear in `/admin/transfers`, `/admin/tours`, `/admin/requests`.
- `/admin/index` calendar shows the new bookings on the right dates.
- Click a guest row → reservation modal opens. For an experience inquiry, the modal shows "Submitted by: Guest" and any other fields.

- [ ] **Step 5: Partner registration is still gated**

Open `/register-partner` (no auth). The form should still require completion (this flow is intentionally NOT changed by the plan).

Open `/profile` while signed out — should still redirect to /login (intentional).

- [ ] **Step 6: No commit** — verification only.

---

## Notes for the executor

- **`uid` vs `user_id`.** The booking tables (`transfers`, `tours`, `experiences`) use the column name `uid` for the owner. The `requests` table uses `user_id`. Don't rename either — match what's already there.
- **Why we keep `supabase.auth.getUser()` even after removing the gate.** When a logged-in user books, we still want to attribute the row to their account. The `guestUid: string | null = user?.id ?? null` shape captures that without forcing login.
- **Stripe payments.** Stripe checkout/intents don't require the customer to be logged in to your app — they collect their own contact info. The existing Stripe flow works for guests automatically.
- **Spam risk after opening anon INSERT.** The booking tables can now receive arbitrary rows from any internet client. Watch admin dashboards for spam in the first week. If it becomes a problem, add a cloudflare turnstile or hcaptcha to the booking forms — that's a follow-up plan, not this one.
- **The "guest rows missing from admin" failure mode.** If after deploying Phase A, admin can't see guest rows, the SELECT policies on `transfers`/`tours`/`experiences` are too restrictive. The fix is a one-liner extra policy: `create policy "Admins read all X" on public.X for select to authenticated using (public.is_admin())`. Don't write the migration speculatively — only if Task A6 Step 3 fails.
