# No Past-Date Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nobody (client, guest, or admin) can create a transfer/tour/hourly/experience booking with a date in the past.

**Architecture:** A shared `booking-date` util (Athens-timezone "today") backs three layers: `min` + submit validation on all 12 date inputs (UX), a 400 guard in the Stripe checkout API, and past-date rejection inside the two `create_*_booking` Postgres RPCs (the real enforcement — both cash and Stripe paths go through them). Admin modals get the client-side layer only (their inserts bypass RPCs; admin bypass is a non-threat).

**Tech Stack:** Astro 5, TypeScript, Supabase (Postgres RPCs via MCP `apply_migration`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-no-past-date-bookings-design.md`

## Global Constraints

- "Today" is **Europe/Athens** everywhere (client and server). Dates are plain `YYYY-MM-DD` strings compared lexicographically.
- Date-level rule only: booking **today is allowed**; no time cutoff, no lead time.
- Do NOT touch `src/pages/book/ferries.astro` or `src/pages/book/hotels.astro`.
- Error copy (plain English, matching existing JS-generated messages, no i18n attrs): past date → `Please select a future date.` ; return-before-pickup → `Return date cannot be before the pickup date.` ; admin modals → `Booking date cannot be in the past.`
- Machine error token (API + RPC): `BOOKING_DATE_PAST`.
- Source files use **tabs** for indentation. Match surrounding style exactly.
- Commit after every task. Do not push until the final task.

---

### Task 1: Shared date util `booking-date.ts` (TDD)

**Files:**
- Create: `src/lib/booking-date.ts`
- Test: `tests/booking-date.test.ts`

**Interfaces:**
- Produces: `todayAthens(): string` (YYYY-MM-DD in Europe/Athens), `isPastBookingDate(date: string): boolean`, `applyMinBookingDate(...ids: string[]): void` (sets `min` on the given `<input type="date">` element ids; safe to call with missing ids). All later tasks import these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/booking-date.test.ts
import { describe, it, expect } from 'vitest';
import { todayAthens, isPastBookingDate } from '../src/lib/booking-date';

describe('todayAthens', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayAthens()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is within one day of the system UTC date (Athens is UTC+2/+3)', () => {
    const utc = new Date().toISOString().slice(0, 10);
    const athens = todayAthens();
    const diffDays = Math.abs(
      (new Date(athens + 'T00:00:00Z').getTime() - new Date(utc + 'T00:00:00Z').getTime()) / 86400000
    );
    expect(diffDays).toBeLessThanOrEqual(1);
  });
});

describe('isPastBookingDate', () => {
  it('flags a clearly past date', () => {
    expect(isPastBookingDate('1999-01-01')).toBe(true);
  });

  it('flags yesterday relative to Athens today', () => {
    const t = new Date(todayAthens() + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - 1);
    expect(isPastBookingDate(t.toISOString().slice(0, 10))).toBe(true);
  });

  it('accepts Athens today', () => {
    expect(isPastBookingDate(todayAthens())).toBe(false);
  });

  it('accepts tomorrow and the far future', () => {
    const t = new Date(todayAthens() + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1);
    expect(isPastBookingDate(t.toISOString().slice(0, 10))).toBe(false);
    expect(isPastBookingDate('2999-12-31')).toBe(false);
  });

  it('treats the empty string as past (blocked)', () => {
    expect(isPastBookingDate('')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/booking-date.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/booking-date'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/booking-date.ts
/**
 * Booking-date rules. The business operates in Greece, so "today" is always
 * computed in Europe/Athens — on the client AND the server (Vercel runs UTC,
 * which would otherwise be up to ~3h lenient around midnight).
 *
 * Booking dates are plain `YYYY-MM-DD` strings end-to-end, so lexicographic
 * comparison is correct and no Date parsing (with its timezone pitfalls) is
 * needed.
 */

/** Today's date as `YYYY-MM-DD` in Europe/Athens. */
export function todayAthens(): string {
	// en-CA locale formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
}

/** True when `date` (YYYY-MM-DD) is before today in Athens. Empty/garbage → true (blocked). */
export function isPastBookingDate(date: string): boolean {
	return date < todayAthens();
}

/** Set `min` = Athens-today on the given `<input type="date">` ids (missing ids are skipped). */
export function applyMinBookingDate(...ids: string[]): void {
	const min = todayAthens();
	for (const id of ids) {
		const el = document.getElementById(id) as HTMLInputElement | null;
		if (el) el.min = min;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/booking-date.test.ts`
Expected: PASS (7 tests). Then run the whole suite: `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking-date.ts tests/booking-date.test.ts
git commit -m "feat: booking-date util — Athens-timezone past-date rules"
```

---

### Task 2: DB migration — reject past dates in the booking RPCs

**Files:**
- Create: `db/migrations/2026-07-16-block-past-booking-dates.sql`

**Interfaces:**
- Consumes: nothing from other tasks (SQL only).
- Produces: `create_transfer_booking` / `create_tour_booking` now `RAISE EXCEPTION 'BOOKING_DATE_PAST'` on missing/malformed/past `date` (and, for transfers, on `return_date` past or before `date`). This is the enforcement point for cash AND Stripe paths (hourly included — it uses `create_transfer_booking`).

- [ ] **Step 1: Write the migration file**

The file re-creates both RPCs from `db/migrations/2026-05-04-guest-booking-rpcs.sql` **verbatim**, inserting only a validation block after the `safe := …` line. Full content:

```sql
-- Block past-date bookings at the RPC layer (spec: 2026-07-16-no-past-date-bookings).
-- "Today" is Europe/Athens — the business timezone. Both RPCs raise
-- BOOKING_DATE_PAST so callers can map the failure. Bodies otherwise
-- identical to 2026-05-04-guest-booking-rpcs.sql. Idempotent.

create or replace function public.create_transfer_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
begin
  -- Strip caller-controlled trust fields; we'll re-attach our own.
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  if (safe->>'date') is null
     or (safe->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
     or (safe->>'date')::date < (now() at time zone 'Europe/Athens')::date then
    raise exception 'BOOKING_DATE_PAST';
  end if;
  if coalesce(safe->>'return_date', '') <> '' then
    if (safe->>'return_date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (safe->>'return_date')::date < (safe->>'date')::date then
      raise exception 'BOOKING_DATE_PAST';
    end if;
  end if;

  insert into public.transfers (
    id, uid,
    "from", "to", date, time,
    passengers, return_date, return_time,
    vehicle_slug, vehicle_name,
    first_name, last_name, email, phone,
    sign_name, child_seats, driver_notes,
    total_price, base_price, outward_price, return_price, card_surcharge,
    ride_status, payment_status, payment_method, payment_token,
    booking_type, partner_id, luggage_small, luggage_big,
    hours, per_hour
  )
  values (
    new_id,
    auth.uid(),
    safe->>'from', safe->>'to', safe->>'date', safe->>'time',
    coalesce((safe->>'passengers')::int, 1),
    safe->>'return_date', safe->>'return_time',
    safe->>'vehicle_slug', safe->>'vehicle_name',
    safe->>'first_name', safe->>'last_name', safe->>'email', safe->>'phone',
    safe->>'sign_name',
    coalesce((safe->>'child_seats')::int, 0),
    safe->>'driver_notes',
    coalesce((safe->>'total_price')::numeric, 0),
    coalesce((safe->>'base_price')::numeric, 0),
    coalesce((safe->>'outward_price')::numeric, 0),
    coalesce((safe->>'return_price')::numeric, 0),
    coalesce((safe->>'card_surcharge')::numeric, 0),
    coalesce(safe->>'ride_status', 'new'),
    coalesce(safe->>'payment_status', 'pending'),
    coalesce(safe->>'payment_method', 'cash'),
    safe->>'payment_token',
    coalesce(safe->>'booking_type', 'transfer'),
    safe->>'partner_id',
    coalesce((safe->>'luggage_small')::int, 0),
    coalesce((safe->>'luggage_big')::int, 0),
    nullif((safe->>'hours')::text, '')::int,
    nullif((safe->>'per_hour')::text, '')::numeric
  );

  return new_id;
end;
$$;

revoke all on function public.create_transfer_booking(jsonb) from public;
grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;

create or replace function public.create_tour_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  if (safe->>'date') is null
     or (safe->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
     or (safe->>'date')::date < (now() at time zone 'Europe/Athens')::date then
    raise exception 'BOOKING_DATE_PAST';
  end if;

  insert into public.tours (
    id, uid,
    tour, tour_id, tour_name,
    pickup, pickup_location, destination,
    date, time,
    passengers, participants,
    vehicle, vehicle_name,
    name, email, phone,
    special_requests, notes, hotel_choice,
    total_price,
    entrance_tickets_count, entrance_tickets_total,
    ride_status, payment_status, payment_method, payment_token,
    card_surcharge, partner_id, added_by_admin
  )
  values (
    new_id,
    auth.uid(),
    safe->>'tour', safe->>'tour_id', safe->>'tour_name',
    safe->>'pickup', safe->>'pickup_location', safe->>'destination',
    safe->>'date', safe->>'time',
    coalesce((safe->>'passengers')::int, 1),
    coalesce((safe->>'participants')::int, 1),
    safe->>'vehicle', safe->>'vehicle_name',
    safe->>'name', safe->>'email', safe->>'phone',
    safe->>'special_requests', safe->>'notes', safe->>'hotel_choice',
    coalesce((safe->>'total_price')::numeric, 0),
    coalesce((safe->>'entrance_tickets_count')::int, 0),
    coalesce((safe->>'entrance_tickets_total')::numeric, 0),
    coalesce(safe->>'ride_status', 'new'),
    coalesce(safe->>'payment_status', 'pending'),
    coalesce(safe->>'payment_method', 'cash'),
    safe->>'payment_token',
    coalesce((safe->>'card_surcharge')::numeric, 0),
    safe->>'partner_id',
    coalesce((safe->>'added_by_admin')::boolean, false)
  );

  return new_id;
end;
$$;

revoke all on function public.create_tour_booking(jsonb) from public;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
```

- [ ] **Step 2: Apply to the live Supabase project via MCP**

Use the Supabase MCP tools (load via ToolSearch if deferred): `mcp__plugin_supabase_supabase__list_projects` to get the project id, then `mcp__plugin_supabase_supabase__apply_migration` with `name: "block_past_booking_dates"` and the file's SQL as `query`.
Expected: success, no error.

- [ ] **Step 3: Verify — past date raises, exception name is right**

Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
select public.create_transfer_booking('{"date":"2020-01-01","email":"t@t.t"}'::jsonb);
```
Expected: ERROR containing `BOOKING_DATE_PAST`. (No row is created — the exception fires before insert.)

```sql
select public.create_tour_booking('{"date":"2020-01-01","email":"t@t.t"}'::jsonb);
```
Expected: ERROR containing `BOOKING_DATE_PAST`.

Also verify return-date rule:
```sql
select public.create_transfer_booking('{"date":"2999-01-02","return_date":"2999-01-01","email":"t@t.t"}'::jsonb);
```
Expected: ERROR containing `BOOKING_DATE_PAST`. Do NOT run a fully-valid payload (it would insert a junk row in production).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-07-16-block-past-booking-dates.sql
git commit -m "feat(db): booking RPCs reject past dates (BOOKING_DATE_PAST)"
```

---

### Task 3: API guard in the Stripe checkout endpoint

**Files:**
- Modify: `src/pages/api/stripe/create-checkout-session.ts:48-55`

**Interfaces:**
- Consumes: `isPastBookingDate` from Task 1.
- Produces: POST with past/malformed `booking.date` (or bad `booking.return_date`) → `400 {"error":"BOOKING_DATE_PAST"}` before any RPC/Stripe call.

- [ ] **Step 1: Add the import**

At the top with the other imports (`../../../lib/stripe/server` line):

```typescript
import { isPastBookingDate } from '../../../lib/booking-date';
```

- [ ] **Step 2: Add the guard**

Directly after the `total_price` range check (currently lines 51–55), insert:

```typescript
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const bookingDate = String(booking.date ?? '').trim();
  if (!DATE_RE.test(bookingDate) || isPastBookingDate(bookingDate)) {
    return jsonError(400, 'BOOKING_DATE_PAST');
  }
  const bookingReturnDate = String(booking.return_date ?? '').trim();
  if (bookingReturnDate && (!DATE_RE.test(bookingReturnDate) || bookingReturnDate < bookingDate)) {
    return jsonError(400, 'BOOKING_DATE_PAST');
  }
```

(Note this file uses 2-space indentation — unlike the .astro files.)

- [ ] **Step 3: Verify build/types**

Run: `npx astro check 2>&1 | tail -5` (accept pre-existing warnings; no NEW errors in this file), then `npm run build`.
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/stripe/create-checkout-session.ts
git commit -m "feat(api): reject past booking dates in create-checkout-session"
```

---

### Task 4: Home widget — BookingSection (transfer / hourly / tours tabs)

**Files:**
- Modify: `src/components/BookingSection.astro` (script section, lines ~560-686)

**Interfaces:**
- Consumes: `applyMinBookingDate`, `isPastBookingDate` from Task 1 (import path from this file: `../lib/booking-date`).

- [ ] **Step 1: Import + set `min` on the four date inputs**

Add to the script's existing imports:

```typescript
import { applyMinBookingDate, isPastBookingDate } from '../lib/booking-date';
```

Immediately after the `wireAutoClear([...])` call (ends line 575), add:

```typescript
	applyMinBookingDate('tf-date', 'tf-return-date', 'hourly-date', 'tours-date');
```

- [ ] **Step 2: Transfer tab — past-date + return-date checks**

Replace line 601:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a pickup date.'); firstErr ??= dateEl; }
```
with:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a pickup date.'); firstErr ??= dateEl; }
		else if (isPastBookingDate(date)) { showFieldError(dateEl, 'Please select a future date.'); firstErr ??= dateEl; }
		if (returnDate && isPastBookingDate(returnDate)) { showFieldError(returnDateEl, 'Please select a future date.'); firstErr ??= returnDateEl; }
		else if (returnDate && date && returnDate < date) { showFieldError(returnDateEl, 'Return date cannot be before the pickup date.'); firstErr ??= returnDateEl; }
```

- [ ] **Step 3: Hourly tab — past-date check**

Replace line 636:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a pickup date.'); firstErr ??= dateEl; }
```
with:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a pickup date.'); firstErr ??= dateEl; }
		else if (isPastBookingDate(date)) { showFieldError(dateEl, 'Please select a future date.'); firstErr ??= dateEl; }
```

- [ ] **Step 4: Tours tab — past-date check**

Replace line 674:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a tour date.'); firstErr ??= dateEl; }
```
with:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a tour date.'); firstErr ??= dateEl; }
		else if (isPastBookingDate(date)) { showFieldError(dateEl, 'Please select a future date.'); firstErr ??= dateEl; }
```

(Note: the transfer and hourly `if (!date)` lines are textually identical — disambiguate by the surrounding handler: transfer is in the `see-prices-btn` handler, hourly in `hourly-see-prices-btn`, tours in `tours-see-prices-btn`.)

- [ ] **Step 5: Build & commit**

Run: `npm run build` — completes.
```bash
git add src/components/BookingSection.astro
git commit -m "feat(home): block past dates in booking widget (all tabs)"
```

---

### Task 5: Transfer search page

**Files:**
- Modify: `src/pages/book/transfer.astro:386-397` (+ init around line 362, + imports)

**Interfaces:**
- Consumes: `applyMinBookingDate`, `isPastBookingDate` from Task 1 (import path: `../../lib/booking-date`).

- [ ] **Step 1: Import + `min`**

Add to the script's imports:
```typescript
import { applyMinBookingDate, isPastBookingDate } from '../../lib/booking-date';
```
After `initLuggageCounters('xfer-page-luggage');` (line 362), add:
```typescript
	applyMinBookingDate('tf-date', 'tf-return-date');
```

- [ ] **Step 2: Replace the local-timezone check with the shared util + add return-date rules**

Replace lines 386-397:
```typescript
		if (!date) {
			showFieldError(dateEl, 'Please select a pickup date.');
			firstErr ??= dateEl;
		} else {
			const selectedDate = new Date(date + 'T00:00:00');
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			if (selectedDate < today) {
				showFieldError(dateEl, 'Please select a future date.');
				firstErr ??= dateEl;
			}
		}
```
with:
```typescript
		if (!date) {
			showFieldError(dateEl, 'Please select a pickup date.');
			firstErr ??= dateEl;
		} else if (isPastBookingDate(date)) {
			showFieldError(dateEl, 'Please select a future date.');
			firstErr ??= dateEl;
		}
		if (returnDate && isPastBookingDate(returnDate)) {
			showFieldError(returnDateEl, 'Please select a future date.');
			firstErr ??= returnDateEl;
		} else if (returnDate && date && returnDate < date) {
			showFieldError(returnDateEl, 'Return date cannot be before the pickup date.');
			firstErr ??= returnDateEl;
		}
```

- [ ] **Step 3: Build & commit**

Run: `npm run build` — completes.
```bash
git add src/pages/book/transfer.astro
git commit -m "feat(transfer): Athens-tz past-date + return-date validation"
```

---

### Task 6: Hourly + tour search pages

**Files:**
- Modify: `src/pages/book/hourly.astro:307-318` (+ init line ~292, + imports)
- Modify: `src/pages/book/tour.astro:426` (+ init line ~409, + imports)

**Interfaces:**
- Consumes: `applyMinBookingDate`, `isPastBookingDate` from Task 1 (import path for both: `../../lib/booking-date`).

- [ ] **Step 1: hourly.astro — import + `min`**

Add to imports: `import { applyMinBookingDate, isPastBookingDate } from '../../lib/booking-date';`
After `initLuggageCounters('hourly-page-luggage');` (line 292), add:
```typescript
	applyMinBookingDate('h-date');
```

- [ ] **Step 2: hourly.astro — replace local-tz check**

Replace lines 307-318:
```typescript
		if (!date) {
			showFieldError(dateEl, 'Please select a pickup date.');
			firstErr ??= dateEl;
		} else {
			const selectedDate = new Date(date + 'T00:00:00');
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			if (selectedDate < today) {
				showFieldError(dateEl, 'Please select a future date.');
				firstErr ??= dateEl;
			}
		}
```
with:
```typescript
		if (!date) {
			showFieldError(dateEl, 'Please select a pickup date.');
			firstErr ??= dateEl;
		} else if (isPastBookingDate(date)) {
			showFieldError(dateEl, 'Please select a future date.');
			firstErr ??= dateEl;
		}
```

- [ ] **Step 3: tour.astro — import + `min` + check**

Add to imports: `import { applyMinBookingDate, isPastBookingDate } from '../../lib/booking-date';`
After the `wireAutoClear([...])` call (ends line 409), add:
```typescript
	applyMinBookingDate('tour-date');
```
Replace line 426:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a tour date.'); firstErr ??= dateEl; }
```
with:
```typescript
		if (!date) { showFieldError(dateEl, 'Please select a tour date.'); firstErr ??= dateEl; }
		else if (isPastBookingDate(date)) { showFieldError(dateEl, 'Please select a future date.'); firstErr ??= dateEl; }
```

- [ ] **Step 4: Build & commit**

Run: `npm run build` — completes.
```bash
git add src/pages/book/hourly.astro src/pages/book/tour.astro
git commit -m "feat(hourly,tour): Athens-tz past-date validation"
```

---

### Task 7: Experiences page

**Files:**
- Modify: `src/pages/experiences.astro:500` (+ init near the `wireAutoClear` call ending line 472, + imports)

**Interfaces:**
- Consumes: `applyMinBookingDate`, `isPastBookingDate` from Task 1 (import path: `../lib/booking-date`).

- [ ] **Step 1: Import + `min`**

Add to the script's imports: `import { applyMinBookingDate, isPastBookingDate } from '../lib/booking-date';`
After the `wireAutoClear([...])` call (ends line 472), add:
```typescript
	applyMinBookingDate('experience-date');
```

- [ ] **Step 2: Add the past-date check**

Replace line 500:
```typescript
		if (!date)        { showFieldError(dateEl, 'Please select an experience date.'); firstErr ??= dateEl; }
```
with:
```typescript
		if (!date)        { showFieldError(dateEl, 'Please select an experience date.'); firstErr ??= dateEl; }
		else if (isPastBookingDate(date)) { showFieldError(dateEl, 'Please select a future date.'); firstErr ??= dateEl; }
```

- [ ] **Step 3: Build & commit**

Run: `npm run build` — completes.
```bash
git add src/pages/experiences.astro
git commit -m "feat(experiences): Athens-tz past-date validation"
```

---

### Task 8: Admin Add-booking modals (transfers / tours / experiences)

**Files:**
- Modify: `src/pages/admin/transfers.astro:435-439` (+ imports)
- Modify: `src/pages/admin/tours.astro:399-403` (+ imports)
- Modify: `src/pages/admin/experiences.astro:399-403` (+ imports)

**Interfaces:**
- Consumes: `applyMinBookingDate`, `isPastBookingDate` from Task 1 (import path for all three: `../../lib/booking-date`).

These modals use a shared `errorEl` + `val()` pattern, NOT `showFieldError` — follow it. In each file: add the import, call `applyMinBookingDate('<date-id>')` at the top level of the client script (right after the existing element lookups / before the submit handler — the DOM is ready because Astro scripts are deferred modules), and add the past-date branch directly after the existing required-fields check.

- [ ] **Step 1: admin/transfers.astro**

Import: `import { applyMinBookingDate, isPastBookingDate } from '../../lib/booking-date';`
Top-level init: `applyMinBookingDate('tf-date');`
After the required-fields block (lines 435-439), add:
```typescript
		if (isPastBookingDate(date)) {
			errorEl.textContent = 'Booking date cannot be in the past.';
			errorEl.classList.remove('hidden');
			return;
		}
```

- [ ] **Step 2: admin/tours.astro**

Import: same (path `../../lib/booking-date`).
Top-level init: `applyMinBookingDate('to-date');`
After the required-fields block (lines 399-403), add:
```typescript
		if (isPastBookingDate(date)) {
			errorEl.textContent = 'Booking date cannot be in the past.';
			errorEl.classList.remove('hidden');
			return;
		}
```

- [ ] **Step 3: admin/experiences.astro**

Import: same (path `../../lib/booking-date`).
Top-level init: `applyMinBookingDate('ex-date');`
After the required-fields block (lines 399-403), add:
```typescript
		if (isPastBookingDate(date)) {
			errorEl.textContent = 'Booking date cannot be in the past.';
			errorEl.classList.remove('hidden');
			return;
		}
```

- [ ] **Step 4: Build & commit**

Run: `npm run build` — completes.
```bash
git add src/pages/admin/transfers.astro src/pages/admin/tours.astro src/pages/admin/experiences.astro
git commit -m "feat(admin): block past dates in manual booking modals"
```

---

### Task 9: Ship + live verification

**Files:** none new (push + verify).

- [ ] **Step 1: Full check + push**

Run: `npm test` (all green) and `npm run build` (completes). The DB migration was already applied in Task 2 — server enforcement is live before the UI deploys, which is the intended order.
```bash
git push origin main
```
Vercel auto-deploys `main`. Poll until live (the deploy lands in ~1 min):
```bash
for i in $(seq 1 40); do
  curl -sL "https://www.opawey.com/book/transfer" | grep -q "booking-date" && { echo DEPLOYED; break; }; sleep 15;
done
```
(The bundled asset name contains the module; if the grep never matches, instead verify by behavior in Step 3.)

- [ ] **Step 2: API tamper test (past date → 400)**

```bash
curl -s -X POST "https://www.opawey.com/api/stripe/create-checkout-session" \
  -H "content-type: application/json" \
  -d '{"flow":"transfer","booking":{"email":"t@t.t","total_price":50,"date":"2020-01-01"}}'
```
Expected: `{"error":"BOOKING_DATE_PAST"}` with HTTP 400 (add `-w '%{http_code}'` to see it). Also send a valid future date with `"total_price":50` and a **bogus flow** first if worried about creating rows — do NOT send a fully valid payload (it would create a real `awaiting_payment` row and a Stripe session).

- [ ] **Step 3: Browser verification (Playwright/Chrome MCP) — each public form rejects yesterday**

For each of: `https://www.opawey.com/` (transfer tab, hourly tab, tours tab), `/book/transfer`, `/book/tour`, `/book/hourly`, `/experiences`:
1. Confirm the date input has `min` = today (Athens): `document.getElementById('<id>').min`.
2. Force yesterday via JS (`el.value = '<yesterday>'` — the `min` attr blocks the picker but not JS) and submit.
3. Expected: inline error "Please select a future date." and NO navigation to results / no insert.
4. On `/book/transfer` also set a valid pickup date + a return date before it → expect "Return date cannot be before the pickup date."
Then one positive check: pick tomorrow on `/book/transfer`, submit → results page loads normally (no booking is created by search).

- [ ] **Step 4: Confirm the RPC guard blocks a tampered direct call**

Already proven at the SQL layer in Task 2 Step 3. Optionally re-prove from the browser (anon key, like an attacker):
```js
// on any page of the live site, in the console context of the app's supabase client
await supabase.rpc('create_transfer_booking', { payload: { date: '2020-01-01', email: 't@t.t' } })
```
Expected: `error.message` contains `BOOKING_DATE_PAST`, `data` null.

- [ ] **Step 5: Report**

Summarize: which layers verified live (API 400, RPC exception, per-form inline errors + min attributes), migration applied, all commits pushed. Note the accepted gap (experiences `requests` insert has client-side blocking only, per spec).
