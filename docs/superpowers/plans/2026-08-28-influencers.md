# Influencer Referral Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-created influencer profiles, each with a unique referral URL; any booking made after arriving through that URL is attributed to the influencer with an admin-defined commission, and the admin gets a full per-influencer report of attributed bookings and earned commission.

**Architecture:** A new `public.influencers` table (admin-managed, no login/auth account) with a unique `ref_code` and a commission setting (`percent` or `fixed` €). The referral URL is any site URL carrying `?ref=<code>`; a tiny global capture script in `Layout.astro` stores the code in `localStorage` for 30 days (last click wins). The three payment pages send the stored code silently in their booking payloads; the two booking-insert RPCs look up the code server-side, snapshot the commission into the booking row (`influencer_id`, `influencer_code`, `influencer_commission`), and **silently ignore** unknown/inactive codes — attribution must never block a booking. A new `/admin/influencers` page provides CRUD plus the per-influencer report (bookings, revenue, commission).

**Tech Stack:** Supabase Postgres (idempotent migration, SECURITY DEFINER RPCs), Astro 5 (`Layout.astro` global script, admin page browser-side CRUD), Vitest (pure-function TDD for the ref-storage logic).

## Decisions locked in

- **Separate `influencers` table, not a `partners` row.** Influencers don't log in, self-register, or appear in partner flows; `partners.id` doubles as the auth user id, which influencers don't have. Bookings get their own `influencer_*` columns, independent of `partner_id`.
- **Referral URL** = `<site-origin>/?ref=<code>` (works appended to any page URL). Codes are URL-safe: `^[a-zA-Z0-9_-]{3,32}$`, unique case-insensitively. The admin page shows the full URL with a Copy button.
- **Attribution window: 30 days, last click wins.** Stored in `localStorage['opaway:ref']` as `{"code":"…","ts":<ms>}`. The stored ref survives the booking (repeat bookings keep attributing).
- **Commission snapshot at booking time, computed server-side** in the RPCs from the influencer's current settings and the booking's `total_price` (the charged, post-coupon amount): `percent` → `round(total_price * value / 100, 2)`; `fixed` → `round(value, 2)`. Later rate changes never rewrite history.
- **Unknown, inactive, or malformed codes are ignored silently** (booking proceeds unattributed) — the customer never sees referral mechanics, and there is no coupon-style validation UI.
- **Deleting an influencer keeps history:** `influencer_id` is `on delete set null`, but `influencer_code` and `influencer_commission` stay on the booking rows.
- **Report totals** (bookings count, revenue Σ`total_price`, commission Σ`influencer_commission`) exclude bookings with `ride_status = 'cancelled'`; every row still shows its `ride_status`/`payment_status` so the admin can judge individually.
- **Coupons and referrals compose:** a booking can carry both; the commission is computed on the post-coupon `total_price`.

## Global Constraints

- SQL migrations in `db/migrations/YYYY-MM-DD-slug.sql`, **idempotent** (`create table if not exists`, `add column if not exists`, `create or replace function`, guarded constraint adds).
- Applied to the live Supabase project **opaway** (ref `wjqfcijisslzqxesbbox`) via Dashboard SQL Editor or Management API with env `SUPABASE_ACCESS_TOKEN` (custom `User-Agent` header required — Cloudflare blocks defaults). **Never write the token into any repo file.** Management API quirk: multi-statement batches return the FIRST statement's result when the last yields zero rows — wrap checks in `count(*)` or send single statements.
- Indentation: **tabs** in `.astro` files, **2 spaces** in `src/lib/*.ts` and `tests/*.ts`. Admin pages English-only (no `data-i18n-*`). Brand blue `#0C6B95` (hover `#0a5c82`).
- Env access via `import.meta.env.X` only. `src/lib` modules must be importable without env vars (no top-level supabase import in the new lib — the coupons lib lazy-loads for exactly this reason).
- Gates: `npx astro check` — pre-existing baseline of **43 errors**, zero new; `npm test` — currently 41 tests, all green plus the new ones.
- The current live booking RPCs are the versions in `db/migrations/2026-08-26-coupons.sql` (coupon-aware); the re-created versions must preserve ALL of that behavior and only add the influencer block.
- Commit messages end with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BiS87umAz5GGz8pgEjFj98

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-08-28-influencers.sql` | `influencers` table + RLS, booking columns, influencer-aware booking RPCs |
| Create | `src/lib/influencer-ref.ts` | Ref-code capture/storage logic (pure functions + browser wrappers) |
| Create | `tests/influencer-ref.test.ts` | Unit tests for the pure functions |
| Modify | `src/layouts/Layout.astro` | Global `?ref=` capture on every page load |
| Modify | `src/pages/book/transfer/payment.astro` | Send `influencer_code` in both payloads |
| Modify | `src/pages/book/hourly/payment.astro` | Same |
| Modify | `src/pages/book/tour/payment.astro` | Same |
| Create | `src/pages/admin/influencers.astro` | Admin CRUD + per-influencer report |
| Modify | `src/components/AdminLayout.astro` | Nav entry |
| Modify | `qa/2026-08-26-coupons-smoke-test.md` → new file `qa/2026-08-28-influencers-smoke-test.md` | Verification journal (new file, own feature) |

---

### Task 1: Migration — influencers table, booking columns, influencer-aware RPCs

**Files:**
- Create: `db/migrations/2026-08-28-influencers.sql`

**Interfaces:**
- Consumes: current booking RPCs from `db/migrations/2026-08-26-coupons.sql` (coupon-aware — reproduced below with the influencer block added); `public.is_admin()`.
- Produces:
  - table `public.influencers (id uuid, name text, email text, phone text, ref_code text, commission_type text, commission_value numeric, active boolean, created_at timestamptz)`
  - columns `influencer_id uuid`, `influencer_code text`, `influencer_commission numeric not null default 0` on `public.transfers` and `public.tours`
  - booking RPCs accepting an optional payload key `influencer_code` (silently ignored when unknown/inactive)

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-08-28-influencers.sql` with exactly this content:

```sql
-- Influencer referral profiles: admin-created rows with a unique ref_code and
-- an admin-set commission. Bookings arriving with an influencer_code payload
-- key are attributed server-side (id + canonical code + commission snapshot).
-- Unknown/inactive codes are ignored silently — attribution never blocks a
-- booking. Idempotent: safe to re-run.

-- ── 1. Influencers table ─────────────────────────────────────────────────────

create table if not exists public.influencers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  ref_code text not null,
  commission_type text not null default 'percent'
    check (commission_type in ('percent', 'fixed')),
  commission_value numeric not null default 0 check (commission_value >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint influencers_ref_code_shape check (ref_code ~ '^[a-zA-Z0-9_-]{3,32}$'),
  constraint influencers_percent_max check (commission_type <> 'percent' or commission_value <= 100)
);

create unique index if not exists influencers_ref_code_ci on public.influencers (lower(ref_code));

alter table public.influencers enable row level security;

drop policy if exists "Admins manage influencers" on public.influencers;
create policy "Admins manage influencers" on public.influencers
  for all using (public.is_admin()) with check (public.is_admin());
-- Deliberately NO public policies: ref codes are resolved only inside the
-- SECURITY DEFINER booking RPCs below.

-- ── 2. Attribution columns on booking tables ────────────────────────────────

alter table public.transfers add column if not exists influencer_id uuid references public.influencers(id) on delete set null;
alter table public.transfers add column if not exists influencer_code text;
alter table public.transfers add column if not exists influencer_commission numeric not null default 0;

alter table public.tours add column if not exists influencer_id uuid references public.influencers(id) on delete set null;
alter table public.tours add column if not exists influencer_code text;
alter table public.tours add column if not exists influencer_commission numeric not null default 0;

-- ── 3. Booking RPCs, re-created with influencer attribution ─────────────────
-- Based on the live definitions from db/migrations/2026-08-26-coupons.sql
-- (coupon-aware). Additions: influencer declares, the attribution block after
-- the coupon block, and three new insert columns. Nothing else changes.

create or replace function public.create_transfer_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
  v_coupon_id   uuid;
  v_coupon_code text;
  v_inf_id    uuid;
  v_inf_code  text;
  v_inf_type  text;
  v_inf_value numeric;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  begin
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
  exception
    when datetime_field_overflow or invalid_datetime_format then
      -- Shape-valid but calendar-invalid (e.g. 2026-02-30): same contract.
      raise exception 'BOOKING_DATE_PAST';
  end;

  -- Re-validate the coupon server-side and store the canonical id/code.
  if coalesce(safe->>'coupon_code', '') <> '' then
    select vc.id, vc.code into v_coupon_id, v_coupon_code
    from public.validate_coupon(safe->>'coupon_code', coalesce(safe->>'booking_type', 'transfer')) vc;
    if v_coupon_id is null then
      raise exception 'COUPON_INVALID';
    end if;
  end if;

  -- Attribute to an active influencer when a ref code rode along. Unknown or
  -- inactive codes are ignored silently — attribution never blocks a booking.
  if coalesce(safe->>'influencer_code', '') <> '' then
    select i.id, i.ref_code, i.commission_type, i.commission_value
      into v_inf_id, v_inf_code, v_inf_type, v_inf_value
    from public.influencers i
    where lower(i.ref_code) = lower(trim(safe->>'influencer_code'))
      and i.active;
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
    hours, per_hour,
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
    coupon_id, coupon_code, coupon_discount,
    influencer_id, influencer_code, influencer_commission
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
    nullif((safe->>'per_hour')::text, '')::numeric,
    safe->>'stripe_session_id',
    safe->>'stripe_payment_intent_id',
    safe->>'stripe_charge_id',
    v_coupon_id,
    v_coupon_code,
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end,
    v_inf_id,
    v_inf_code,
    case
      when v_inf_id is null then 0
      when v_inf_type = 'fixed' then round(v_inf_value, 2)
      else round(coalesce((safe->>'total_price')::numeric, 0) * v_inf_value / 100, 2)
    end
  );

  return new_id;
end;
$function$;

create or replace function public.create_tour_booking(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid := gen_random_uuid();
  safe   jsonb;
  v_coupon_id   uuid;
  v_coupon_code text;
  v_inf_id    uuid;
  v_inf_code  text;
  v_inf_type  text;
  v_inf_value numeric;
begin
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

  -- Reject missing/malformed/past booking dates (Europe/Athens "today").
  begin
    if (safe->>'date') is null
       or (safe->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (safe->>'date')::date < (now() at time zone 'Europe/Athens')::date then
      raise exception 'BOOKING_DATE_PAST';
    end if;
  exception
    when datetime_field_overflow or invalid_datetime_format then
      -- Shape-valid but calendar-invalid (e.g. 2026-02-30): same contract.
      raise exception 'BOOKING_DATE_PAST';
  end;

  -- Re-validate the coupon server-side and store the canonical id/code.
  if coalesce(safe->>'coupon_code', '') <> '' then
    select vc.id, vc.code into v_coupon_id, v_coupon_code
    from public.validate_coupon(safe->>'coupon_code', 'tour') vc;
    if v_coupon_id is null then
      raise exception 'COUPON_INVALID';
    end if;
  end if;

  -- Attribute to an active influencer when a ref code rode along. Unknown or
  -- inactive codes are ignored silently — attribution never blocks a booking.
  if coalesce(safe->>'influencer_code', '') <> '' then
    select i.id, i.ref_code, i.commission_type, i.commission_value
      into v_inf_id, v_inf_code, v_inf_type, v_inf_value
    from public.influencers i
    where lower(i.ref_code) = lower(trim(safe->>'influencer_code'))
      and i.active;
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
    card_surcharge, partner_id, added_by_admin,
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
    coupon_id, coupon_code, coupon_discount,
    influencer_id, influencer_code, influencer_commission
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
    coalesce((safe->>'added_by_admin')::boolean, false),
    safe->>'stripe_session_id',
    safe->>'stripe_payment_intent_id',
    safe->>'stripe_charge_id',
    v_coupon_id,
    v_coupon_code,
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end,
    v_inf_id,
    v_inf_code,
    case
      when v_inf_id is null then 0
      when v_inf_type = 'fixed' then round(v_inf_value, 2)
      else round(coalesce((safe->>'total_price')::numeric, 0) * v_inf_value / 100, 2)
    end
  );

  return new_id;
end;
$function$;

grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
```

- [ ] **Step 2: Apply to the live project** (SQL Editor, or the Management API pattern from Global Constraints with the file's content as `query`). Expected: empty result, no error. Apply a second time — still no error (idempotency).

- [ ] **Step 3: Verify attribution behavior with SQL** (single statements or `count(*)`-wrapped, per the API quirk):

```sql
insert into public.influencers (name, ref_code, commission_type, commission_value)
values ('QA Influencer', 'qa_inf_pct', 'percent', 10),
       ('QA Influencer Fixed', 'qa_inf_fix', 'fixed', 7),
       ('QA Influencer Off', 'qa_inf_off', 'percent', 10)
on conflict do nothing;
update public.influencers set active = false where ref_code = 'qa_inf_off';
```

Then, each as its own statement, using date `'2026-09-20'`:

1. `select public.create_transfer_booking('{"date":"2026-09-20","time":"10:00","from":"A","to":"B","email":"qa-inf@test.local","total_price":45,"influencer_code":"QA_INF_PCT"}'::jsonb);` → uuid. Then `select influencer_code, influencer_commission, influencer_id is not null as has_id from public.transfers where email='qa-inf@test.local';` → `qa_inf_pct` (canonical casing), `4.50`, `true`.
2. `select public.create_tour_booking('{"date":"2026-09-20","time":"10:00","tour_name":"QA","email":"qa-inf@test.local","total_price":95,"influencer_code":"qa_inf_fix"}'::jsonb);` → uuid; the tours row has `influencer_commission = 7.00`.
3. Inactive code: transfer booking with `"influencer_code":"qa_inf_off"` → succeeds; row has `influencer_id null`, `influencer_code null`, `influencer_commission 0`.
4. Unknown code: `"influencer_code":"does_not_exist"` → succeeds, unattributed (same nulls/0).
5. Coupon + referral compose: transfer booking with `"coupon_code":"TEST10","coupon_discount":4.5,"total_price":40.5,"influencer_code":"qa_inf_pct"` → row has both `coupon_code='TEST10'` AND `influencer_commission = 4.05` (10% of the discounted 40.50). (If `TEST10` no longer exists in prod, create an equivalent all-services percent-10 coupon for this check and delete it after.)
6. Duplicate ref_code guard: inserting an influencer with `ref_code = 'QA_INF_PCT'` (different case) → unique violation (23505). Shape guard: `ref_code = 'bad code!'` → check-constraint violation (`influencers_ref_code_shape`).

Cleanup: `delete from public.transfers where email='qa-inf@test.local'; delete from public.tours where email='qa-inf@test.local'; delete from public.influencers where ref_code like 'qa_inf_%';` and verify with a final `select count(*)` = 0 for each.

- [ ] **Step 4: Regression gate**

Run: `npm test` → all green (41). No client code changed in this task.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-08-28-influencers.sql
git commit -m "feat(db): influencer profiles with server-side referral attribution"
```

---

### Task 2: Ref-capture library with tests + global capture in Layout

**Files:**
- Create: `src/lib/influencer-ref.ts`
- Test: `tests/influencer-ref.test.ts`
- Modify: `src/layouts/Layout.astro` (the global `<script>` block at the bottom, lines ~95-182)

**Interfaces:**
- Consumes: nothing from other tasks (no supabase import — the module must load without env vars).
- Produces (used by Task 3): `getStoredRefCode(): string | null`; also `captureRefFromUrl(): void` (used only by Layout), pure helpers `refFromSearch(search: string): string | null` and `parseStoredRef(raw: string | null, nowMs: number): string | null`, constants `REF_STORAGE_KEY = 'opaway:ref'` and `REF_TTL_MS` (30 days in ms).

- [ ] **Step 1: Write the failing tests**

Create `tests/influencer-ref.test.ts` (2-space indent):

```ts
import { describe, it, expect } from 'vitest';
import { refFromSearch, parseStoredRef, REF_TTL_MS } from '../src/lib/influencer-ref';

describe('refFromSearch', () => {
  it('extracts the ref param', () => {
    expect(refFromSearch('?ref=maria123')).toBe('maria123');
  });

  it('trims whitespace and ignores other params', () => {
    expect(refFromSearch('?utm_source=ig&ref=%20maria%20')).toBe('maria');
  });

  it('returns null when absent or empty', () => {
    expect(refFromSearch('')).toBeNull();
    expect(refFromSearch('?foo=1')).toBeNull();
    expect(refFromSearch('?ref=')).toBeNull();
    expect(refFromSearch('?ref=%20%20')).toBeNull();
  });

  it('rejects absurdly long values', () => {
    expect(refFromSearch(`?ref=${'x'.repeat(65)}`)).toBeNull();
    expect(refFromSearch(`?ref=${'x'.repeat(64)}`)).toBe('x'.repeat(64));
  });
});

describe('parseStoredRef', () => {
  const now = 1_800_000_000_000;
  const stored = (code: string, ts: number) => JSON.stringify({ code, ts });

  it('returns the code while inside the TTL window', () => {
    expect(parseStoredRef(stored('maria', now - 1000), now)).toBe('maria');
    expect(parseStoredRef(stored('maria', now - REF_TTL_MS), now)).toBe('maria');
  });

  it('expires strictly after the TTL', () => {
    expect(parseStoredRef(stored('maria', now - REF_TTL_MS - 1), now)).toBeNull();
  });

  it('returns null for null, garbage, or malformed payloads', () => {
    expect(parseStoredRef(null, now)).toBeNull();
    expect(parseStoredRef('not json', now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: '', ts: now }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: 'x' }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ ts: now }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: 'x', ts: 'soon' }), now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/influencer-ref.test.ts`
Expected: FAIL — cannot resolve `../src/lib/influencer-ref`.

- [ ] **Step 3: Implement the library**

Create `src/lib/influencer-ref.ts` (2-space indent):

```ts
// Influencer referral capture. A visit to any page with ?ref=<code> stores
// the code for REF_TTL_MS (last click wins); the payment pages read it back
// and send it with the booking payload, where the RPC resolves and snapshots
// the commission server-side. No supabase import here — this module must be
// loadable without env vars (same rule as the pure coupon helpers).

export const REF_STORAGE_KEY = 'opaway:ref';
export const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function refFromSearch(search: string): string | null {
  const code = new URLSearchParams(search).get('ref')?.trim() ?? '';
  if (!code || code.length > 64) return null;
  return code;
}

export function parseStoredRef(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const code = typeof parsed?.code === 'string' ? parsed.code.trim() : '';
    const ts = typeof parsed?.ts === 'number' ? parsed.ts : NaN;
    if (!code || !Number.isFinite(ts)) return null;
    if (nowMs - ts > REF_TTL_MS) return null;
    return code;
  } catch {
    return null;
  }
}

export function captureRefFromUrl(): void {
  try {
    const code = refFromSearch(window.location.search);
    if (!code) return;
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, ts: Date.now() }));
  } catch {
    // localStorage unavailable (private mode etc.) — attribution is best-effort.
  }
}

export function getStoredRefCode(): string | null {
  try {
    return parseStoredRef(localStorage.getItem(REF_STORAGE_KEY), Date.now());
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the new file plus all pre-existing suites (41 + new).

- [ ] **Step 5: Wire the capture into the global layout script**

In `src/layouts/Layout.astro`, inside the bottom `<script>` block (the in-place translator): add the import as the FIRST line of the script, before the `/** In-place text translator …` comment (tabs):

```ts
	import { captureRefFromUrl } from '../lib/influencer-ref';
```

Then, directly after the existing two listener lines

```ts
	document.addEventListener('astro:page-load', run);
	document.addEventListener('opaway:lang-changed', run);
```

add:

```ts
	// Capture ?ref=<code> influencer referrals on every page view (30-day, last-click-wins).
	document.addEventListener('astro:page-load', captureRefFromUrl);
```

(`astro:page-load` fires on the initial load too — with `ViewTransitions` enabled — so no extra immediate call is needed.)

- [ ] **Step 6: Type gate**

Run: `npx astro check`
Expected: the 43-error baseline, zero new.

- [ ] **Step 7: Commit**

```bash
git add src/lib/influencer-ref.ts tests/influencer-ref.test.ts src/layouts/Layout.astro
git commit -m "feat: capture influencer ?ref codes site-wide with 30-day storage"
```

---

### Task 3: Payment pages send the stored ref code

**Files:**
- Modify: `src/pages/book/transfer/payment.astro`
- Modify: `src/pages/book/hourly/payment.astro`
- Modify: `src/pages/book/tour/payment.astro`

**Interfaces:**
- Consumes: `getStoredRefCode()` from `src/lib/influencer-ref.ts` (Task 2); RPC payload key `influencer_code` (Task 1 — silently ignored when unknown/inactive, so no UI, no validation, no error handling is needed on these pages).
- Produces: nothing new.

Each of the three pages gets the same three tiny edits. Locate anchors by quoted code (line numbers drift).

- [ ] **Step 1: transfer page.** In `src/pages/book/transfer/payment.astro`:

(a) In the `<script>` block's imports, directly after the line

```ts
	import { validateCoupon, couponDiscountAmount, type AppliedCoupon } from '../../../lib/coupons';
```

add:

```ts
	import { getStoredRefCode } from '../../../lib/influencer-ref';
```

and directly after the import block's last line add:

```ts
	const influencerCode = getStoredRefCode();
```

(b) In the `saveBooking()` RPC payload, directly after the line `coupon_discount: couponDiscount,` add:

```ts
					influencer_code: influencerCode,
```

(c) In the Stripe `bookingPayload`, directly after its `coupon_discount: couponDiscount,` line add:

```ts
				influencer_code: influencerCode,
```

- [ ] **Step 2: hourly page.** Apply the identical three edits (same anchors — the coupons import line, the two `coupon_discount: couponDiscount,` payload lines) in `src/pages/book/hourly/payment.astro`.

- [ ] **Step 3: tour page.** Apply the identical three edits in `src/pages/book/tour/payment.astro`.

- [ ] **Step 4: Gates**

Run: `npx astro check` → 43-error baseline, zero new. Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/book/transfer/payment.astro src/pages/book/hourly/payment.astro src/pages/book/tour/payment.astro
git commit -m "feat(booking): attach stored influencer ref code to booking payloads"
```

---

### Task 4: Admin influencers page + nav entry

**Files:**
- Create: `src/pages/admin/influencers.astro`
- Modify: `src/components/AdminLayout.astro` (Management nav group)

**Interfaces:**
- Consumes: `influencers` table (admin RLS from Task 1); `transfers`/`tours` attribution columns (admin read via existing RLS); `supabase` anon client.
- Produces: page `/admin/influencers` — create form; list with copy-URL, click-to-edit rate, Close/Reopen, Delete; expandable per-influencer bookings report with totals.

- [ ] **Step 1: Nav entry**

In `src/components/AdminLayout.astro`, in the `Management` group, insert one line after the `coupons` entry:

```ts
			{ key: 'influencers',         label: 'Influencers',  href: '/admin/influencers',         icon: 'users'    },
```

- [ ] **Step 2: Create the page**

Create `src/pages/admin/influencers.astro` (tabs, English-only):

```astro
---
import AdminLayout from '../../components/AdminLayout.astro';
---

<AdminLayout pageTitle="Influencers" pageDescription="Create influencer profiles, share their referral link, and track the bookings and commission each one brings in." activeSection="influencers" docTitle="Influencers — Admin">
	<div class="max-w-6xl">
		<!-- ── Create form ── -->
		<form id="inf-form" class="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-8">
			<h2 class="text-base font-bold text-neutral-900 mb-4">New influencer</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
				<div>
					<label for="inf-name" class="block text-sm font-medium text-neutral-700 mb-1">Name</label>
					<input id="inf-name" type="text" required placeholder="e.g. Maria K."
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				</div>
				<div>
					<label for="inf-code" class="block text-sm font-medium text-neutral-700 mb-1">Referral code</label>
					<input id="inf-code" type="text" required placeholder="e.g. maria" pattern="[a-zA-Z0-9_-]{3,32}"
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					<p class="text-xs text-neutral-400 mt-1">3-32 letters, numbers, - or _. Becomes the link: <span class="font-mono">/?ref=&lt;code&gt;</span>. Unique, case-insensitive.</p>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
				<div>
					<label for="inf-email" class="block text-sm font-medium text-neutral-700 mb-1">Email <span class="text-neutral-400">(optional)</span></label>
					<input id="inf-email" type="email" placeholder="name@example.com"
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="inf-ctype" class="block text-sm font-medium text-neutral-700 mb-1">Commission</label>
						<select id="inf-ctype"
							class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]">
							<option value="percent">Percent (%)</option>
							<option value="fixed">Fixed (&euro;) per booking</option>
						</select>
					</div>
					<div>
						<label for="inf-cvalue" class="block text-sm font-medium text-neutral-700 mb-1">Value</label>
						<input id="inf-cvalue" type="number" min="0" step="0.01" required placeholder="10"
							class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					</div>
				</div>
			</div>

			<div class="flex items-center gap-4">
				<button type="submit"
					class="px-6 py-2.5 bg-[#0C6B95] hover:bg-[#0a5c82] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
					Create influencer
				</button>
				<p id="inf-status" class="text-sm"></p>
			</div>
		</form>

		<!-- ── List + report ── -->
		<div class="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-neutral-50 text-left text-neutral-500">
							<th class="px-5 py-3 font-medium">Name</th>
							<th class="px-5 py-3 font-medium">Link</th>
							<th class="px-5 py-3 font-medium">Rate</th>
							<th class="px-5 py-3 font-medium">Bookings</th>
							<th class="px-5 py-3 font-medium">Revenue</th>
							<th class="px-5 py-3 font-medium">Commission</th>
							<th class="px-5 py-3 font-medium">Status</th>
							<th class="px-5 py-3 font-medium text-right">Actions</th>
						</tr>
					</thead>
					<tbody id="inf-rows">
						<tr><td colspan="8" class="px-5 py-8 text-center text-neutral-400">Loading…</td></tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- ── Delete confirm modal ── -->
	<div id="inf-delete-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
			<h3 class="text-base font-bold text-neutral-900 mb-2">Delete influencer?</h3>
			<p class="text-sm text-neutral-500 mb-5">This permanently deletes <strong id="inf-delete-name"></strong> and their referral link. Past bookings keep the recorded code and commission.</p>
			<div class="flex justify-end gap-3">
				<button id="inf-delete-cancel" type="button" class="px-4 py-2 text-sm font-semibold rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50">Cancel</button>
				<button id="inf-delete-confirm" type="button" class="px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white">Delete</button>
			</div>
		</div>
	</div>
</AdminLayout>

<script>
	import { supabase } from '../../lib/supabase';

	type Influencer = {
		id: string;
		name: string;
		email: string;
		phone: string;
		ref_code: string;
		commission_type: 'percent' | 'fixed';
		commission_value: number;
		active: boolean;
		created_at: string;
	};

	type AttributedBooking = {
		id: string;
		source: 'transfers' | 'tours';
		influencer_id: string;
		date: string;
		time: string;
		label: string;
		customer: string;
		total_price: number;
		influencer_commission: number;
		ride_status: string;
		payment_status: string;
	};

	const rowsEl = document.getElementById('inf-rows') as HTMLTableSectionElement;
	const statusEl = document.getElementById('inf-status');
	let influencers: Influencer[] = [];
	let bookingsByInf: Record<string, AttributedBooking[]> = {};
	let pendingDeleteId: string | null = null;
	const expanded = new Set<string>();

	function setStatus(msg: string, cls: string) {
		if (!statusEl) return;
		statusEl.textContent = msg;
		statusEl.className = `text-sm ${cls}`;
	}

	function escapeHtml(s: string): string {
		return s.replace(/[&<>"']/g, (c) => (
			{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
		));
	}

	const eur = (n: number) => `€${(Number(n) || 0).toFixed(2)}`;

	function rateLabel(i: Influencer): string {
		return i.commission_type === 'percent' ? `${i.commission_value}%` : `${eur(i.commission_value)}/booking`;
	}

	function refUrl(i: Influencer): string {
		return `${window.location.origin}/?ref=${encodeURIComponent(i.ref_code)}`;
	}

	async function loadData() {
		const [infRes, trRes, toRes] = await Promise.all([
			supabase.from('influencers').select('*').order('created_at', { ascending: false }),
			supabase.from('transfers')
				.select('id, influencer_id, influencer_commission, total_price, date, time, from, to, first_name, last_name, ride_status, payment_status, booking_type')
				.not('influencer_id', 'is', null),
			supabase.from('tours')
				.select('id, influencer_id, influencer_commission, total_price, date, time, tour_name, name, ride_status, payment_status')
				.not('influencer_id', 'is', null),
		]);

		if (infRes.error) {
			rowsEl.innerHTML = `<tr><td colspan="8" class="px-5 py-8 text-center text-red-500">Error loading influencers: [${infRes.error.code}] ${escapeHtml(infRes.error.message)}</td></tr>`;
			return;
		}
		influencers = (infRes.data ?? []) as Influencer[];

		bookingsByInf = {};
		for (const t of (trRes.data ?? []) as any[]) {
			const b: AttributedBooking = {
				id: t.id, source: 'transfers', influencer_id: t.influencer_id,
				date: t.date, time: t.time,
				label: t.booking_type === 'hourly' ? `Hourly — ${t.from}` : `${t.from} → ${t.to}`,
				customer: `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim(),
				total_price: Number(t.total_price) || 0,
				influencer_commission: Number(t.influencer_commission) || 0,
				ride_status: t.ride_status, payment_status: t.payment_status,
			};
			(bookingsByInf[b.influencer_id] ??= []).push(b);
		}
		for (const t of (toRes.data ?? []) as any[]) {
			const b: AttributedBooking = {
				id: t.id, source: 'tours', influencer_id: t.influencer_id,
				date: t.date, time: t.time,
				label: `Tour — ${t.tour_name ?? ''}`,
				customer: (t.name ?? '').trim(),
				total_price: Number(t.total_price) || 0,
				influencer_commission: Number(t.influencer_commission) || 0,
				ride_status: t.ride_status, payment_status: t.payment_status,
			};
			(bookingsByInf[b.influencer_id] ??= []).push(b);
		}
		for (const list of Object.values(bookingsByInf)) {
			list.sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
		}

		render();
	}

	function totalsFor(i: Influencer) {
		const all = bookingsByInf[i.id] ?? [];
		const counted = all.filter((b) => b.ride_status !== 'cancelled');
		return {
			count: counted.length,
			revenue: counted.reduce((s, b) => s + b.total_price, 0),
			commission: counted.reduce((s, b) => s + b.influencer_commission, 0),
			all,
		};
	}

	function bookingsDetailHtml(i: Influencer): string {
		const all = bookingsByInf[i.id] ?? [];
		if (!all.length) return '<p class="px-5 py-4 text-sm text-neutral-400">No bookings from this influencer yet.</p>';
		return `
			<table class="w-full text-xs">
				<thead>
					<tr class="text-left text-neutral-400">
						<th class="px-5 py-2 font-medium">Date</th>
						<th class="px-5 py-2 font-medium">Booking</th>
						<th class="px-5 py-2 font-medium">Customer</th>
						<th class="px-5 py-2 font-medium">Total</th>
						<th class="px-5 py-2 font-medium">Commission</th>
						<th class="px-5 py-2 font-medium">Ride</th>
						<th class="px-5 py-2 font-medium">Payment</th>
					</tr>
				</thead>
				<tbody>
					${all.map((b) => `
						<tr class="border-t border-neutral-100 ${b.ride_status === 'cancelled' ? 'text-neutral-400 line-through' : 'text-neutral-700'}">
							<td class="px-5 py-2 whitespace-nowrap">${escapeHtml(b.date)} ${escapeHtml(b.time ?? '')}</td>
							<td class="px-5 py-2">${escapeHtml(b.label)}</td>
							<td class="px-5 py-2">${escapeHtml(b.customer)}</td>
							<td class="px-5 py-2">${eur(b.total_price)}</td>
							<td class="px-5 py-2 font-semibold">${eur(b.influencer_commission)}</td>
							<td class="px-5 py-2">${escapeHtml(b.ride_status ?? '')}</td>
							<td class="px-5 py-2">${escapeHtml(b.payment_status ?? '')}</td>
						</tr>`).join('')}
				</tbody>
			</table>`;
	}

	function render() {
		if (!influencers.length) {
			rowsEl.innerHTML = '<tr><td colspan="8" class="px-5 py-8 text-center text-neutral-400">No influencers yet.</td></tr>';
			return;
		}

		rowsEl.innerHTML = influencers.map((i) => {
			const t = totalsFor(i);
			const isOpen = expanded.has(i.id);
			return `
				<tr class="border-t border-neutral-100">
					<td class="px-5 py-3">
						<span class="font-semibold text-neutral-900">${escapeHtml(i.name)}</span>
						${i.email ? `<span class="block text-xs text-neutral-400">${escapeHtml(i.email)}</span>` : ''}
					</td>
					<td class="px-5 py-3 whitespace-nowrap">
						<span class="font-mono text-xs text-neutral-600">?ref=${escapeHtml(i.ref_code)}</span>
						<button data-copy="${i.id}" class="ml-1 px-2 py-1 text-xs font-semibold rounded-lg border border-neutral-200 hover:bg-sky-50 text-neutral-600">Copy link</button>
					</td>
					<td class="px-5 py-3 whitespace-nowrap">
						<span class="rate-cell cursor-pointer hover:bg-sky-50 px-2 py-1 rounded-lg" data-rate="${i.id}" title="Click to edit commission">${escapeHtml(rateLabel(i))}</span>
					</td>
					<td class="px-5 py-3">
						<button data-expand="${i.id}" class="px-2.5 py-1 text-xs font-semibold rounded-lg border ${isOpen ? 'border-[#0C6B95] text-[#0C6B95] bg-sky-50' : 'border-neutral-200 text-neutral-700 hover:bg-sky-50'}">
							${t.count} ${isOpen ? '▴' : '▾'}
						</button>
					</td>
					<td class="px-5 py-3">${eur(t.revenue)}</td>
					<td class="px-5 py-3 font-semibold text-emerald-700">${eur(t.commission)}</td>
					<td class="px-5 py-3"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${i.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${i.active ? 'active' : 'closed'}</span></td>
					<td class="px-5 py-3 text-right whitespace-nowrap">
						<button data-toggle="${i.id}" data-active="${i.active}" class="px-3 py-1.5 text-xs font-semibold rounded-lg border ${i.active ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-green-300 text-green-700 hover:bg-green-50'}">
							${i.active ? 'Close' : 'Reopen'}
						</button>
						<button data-delete="${i.id}" data-name="${escapeHtml(i.name)}" class="ml-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
							Delete
						</button>
					</td>
				</tr>
				${isOpen ? `<tr class="border-t border-neutral-100 bg-neutral-50/60"><td colspan="8" class="p-0">${bookingsDetailHtml(i)}</td></tr>` : ''}`;
		}).join('');

		wireRowActions();
	}

	function wireRowActions() {
		rowsEl.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				const inf = influencers.find((x) => x.id === btn.dataset.copy);
				if (!inf) return;
				try {
					await navigator.clipboard.writeText(refUrl(inf));
					btn.textContent = 'Copied!';
					setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
				} catch {
					setStatus(`Link: ${refUrl(inf)}`, 'text-neutral-600');
				}
			});
		});

		rowsEl.querySelectorAll<HTMLButtonElement>('[data-expand]').forEach((btn) => {
			btn.addEventListener('click', () => {
				const id = btn.dataset.expand ?? '';
				if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
				render();
			});
		});

		rowsEl.querySelectorAll<HTMLSpanElement>('.rate-cell').forEach((cell) => {
			cell.addEventListener('click', () => {
				const inf = influencers.find((x) => x.id === cell.dataset.rate);
				if (!inf) return;
				cell.outerHTML = `
					<span class="inline-flex items-center gap-1">
						<select id="rate-type-${inf.id}" class="rounded-lg border border-neutral-200 px-1.5 py-1 text-xs">
							<option value="percent" ${inf.commission_type === 'percent' ? 'selected' : ''}>%</option>
							<option value="fixed" ${inf.commission_type === 'fixed' ? 'selected' : ''}>€</option>
						</select>
						<input id="rate-value-${inf.id}" type="number" min="0" step="0.01" value="${inf.commission_value}"
							class="w-20 rounded-lg border border-neutral-200 px-2 py-1 text-xs" />
						<button id="rate-save-${inf.id}" class="px-2 py-1 bg-[#0C6B95] text-white text-xs rounded-lg hover:bg-[#0a5c82]">Save</button>
					</span>`;
				document.getElementById(`rate-save-${inf.id}`)?.addEventListener('click', async () => {
					const type = (document.getElementById(`rate-type-${inf.id}`) as HTMLSelectElement).value as 'percent' | 'fixed';
					const val = parseFloat((document.getElementById(`rate-value-${inf.id}`) as HTMLInputElement).value);
					if (!Number.isFinite(val) || val < 0) { setStatus('Commission value must be 0 or more.', 'text-red-500'); return; }
					if (type === 'percent' && val > 100) { setStatus('Percent commission cannot exceed 100.', 'text-red-500'); return; }
					const { error } = await supabase.from('influencers')
						.update({ commission_type: type, commission_value: val })
						.eq('id', inf.id);
					if (error) { setStatus(`Error updating commission: [${error.code}] ${error.message}`, 'text-red-500'); return; }
					setStatus(`Commission updated for "${inf.name}". Applies to new bookings only.`, 'text-green-600');
					await loadData();
				});
			});
		});

		rowsEl.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				btn.disabled = true;
				const { error } = await supabase.from('influencers')
					.update({ active: btn.dataset.active !== 'true' })
					.eq('id', btn.dataset.toggle);
				if (error) setStatus(`Error updating influencer: [${error.code}] ${error.message}`, 'text-red-500');
				await loadData();
			});
		});

		rowsEl.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
			btn.addEventListener('click', () => {
				pendingDeleteId = btn.dataset.delete ?? null;
				const nameEl = document.getElementById('inf-delete-name');
				if (nameEl) nameEl.textContent = btn.dataset.name ?? '';
				document.getElementById('inf-delete-modal')?.classList.remove('hidden');
			});
		});
	}

	/* ── Create ── */
	document.getElementById('inf-form')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const name = (document.getElementById('inf-name') as HTMLInputElement).value.trim();
		const refCode = (document.getElementById('inf-code') as HTMLInputElement).value.trim();
		const email = (document.getElementById('inf-email') as HTMLInputElement).value.trim();
		const cType = (document.getElementById('inf-ctype') as HTMLSelectElement).value as 'percent' | 'fixed';
		const cValue = parseFloat((document.getElementById('inf-cvalue') as HTMLInputElement).value);

		if (!name) { setStatus('Enter a name.', 'text-red-500'); return; }
		if (!/^[a-zA-Z0-9_-]{3,32}$/.test(refCode)) { setStatus('Referral code must be 3-32 letters, numbers, - or _.', 'text-red-500'); return; }
		if (!Number.isFinite(cValue) || cValue < 0) { setStatus('Commission value must be 0 or more.', 'text-red-500'); return; }
		if (cType === 'percent' && cValue > 100) { setStatus('Percent commission cannot exceed 100.', 'text-red-500'); return; }

		const { error } = await supabase.from('influencers').insert({
			name,
			ref_code: refCode,
			email,
			commission_type: cType,
			commission_value: cValue,
			active: true,
		});

		if (error) {
			const msg = error.code === '23505'
				? `The referral code "${refCode}" is already taken.`
				: `Error creating influencer: [${error.code}] ${error.message}`;
			setStatus(msg, 'text-red-500');
			return;
		}

		setStatus(`Influencer "${name}" created.`, 'text-green-600');
		(e.target as HTMLFormElement).reset();
		await loadData();
	});

	/* ── Delete modal ── */
	document.getElementById('inf-delete-cancel')?.addEventListener('click', () => {
		pendingDeleteId = null;
		document.getElementById('inf-delete-modal')?.classList.add('hidden');
	});
	document.getElementById('inf-delete-confirm')?.addEventListener('click', async () => {
		if (!pendingDeleteId) return;
		const { error } = await supabase.from('influencers').delete().eq('id', pendingDeleteId);
		if (error) setStatus(`Error deleting influencer: [${error.code}] ${error.message}`, 'text-red-500');
		pendingDeleteId = null;
		document.getElementById('inf-delete-modal')?.classList.add('hidden');
		await loadData();
	});

	/* ── Wait for the AdminLayout auth gate, then load ── */
	const authEl = document.getElementById('admin-auth-check');
	if (authEl) {
		if (authEl.classList.contains('hidden')) loadData();
		else {
			const observer = new MutationObserver(() => {
				if (authEl.classList.contains('hidden')) { observer.disconnect(); loadData(); }
			});
			observer.observe(authEl, { attributes: true, attributeFilter: ['class'] });
		}
	} else {
		loadData();
	}
</script>
```

- [ ] **Step 3: Gates**

Run: `npx astro check` → 43-error baseline, zero new. Run: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/influencers.astro src/components/AdminLayout.astro
git commit -m "feat(admin): influencers page with referral links and per-influencer report"
```

---

### Task 5: Verification sweep + journal

**Files:**
- Create: `qa/2026-08-28-influencers-smoke-test.md`

**Interfaces:** consumes everything above.

- [ ] **Step 1: Run the automated gates** — `npm test` (all suites incl. the new `influencer-ref` one) and `npx astro check` (43 baseline). Record outputs.

- [ ] **Step 2: DB-level regression checks** (Management API, single statements or `count(*)`-wrapped; test email `qa-inf2@test.local`; booking date `'2026-09-20'`):

Setup:

```sql
insert into public.influencers (name, ref_code, commission_type, commission_value)
values ('QA Regression', 'qa_inf2_pct', 'percent', 10) on conflict do nothing;
insert into public.influencers (name, ref_code, commission_type, commission_value, active)
values ('QA Regression Off', 'qa_inf2_off', 'percent', 10, false) on conflict do nothing;
```

1. **Percent attribution:** `select public.create_transfer_booking('{"date":"2026-09-20","time":"10:00","from":"A","to":"B","email":"qa-inf2@test.local","total_price":45,"influencer_code":"QA_INF2_PCT"}'::jsonb);` → uuid; the transfers row for that email has `influencer_code='qa_inf2_pct'` (canonical casing), `influencer_commission=4.50`, `influencer_id` set.
2. **Inactive code ignored silently:** same call with `"influencer_code":"qa_inf2_off"` → booking succeeds; row has `influencer_id null`, `influencer_commission 0`.
3. **Coupon + referral compose:** same call with `"coupon_code":"TEST10","coupon_discount":4.5,"total_price":40.5,"influencer_code":"qa_inf2_pct"` → row has `coupon_code='TEST10'` AND `influencer_commission=4.05` (10% of the discounted 40.50). If `TEST10` no longer exists in prod, create an equivalent all-services percent-10 coupon for this check and delete it afterwards.

Cleanup: delete the `qa-inf2@test.local` rows from `transfers` and the `qa_inf2_%` influencers; verify with final `count(*)` selects showing 0. Then create one demo influencer and LEAVE it in place for manual QA: name `Demo Influencer`, `ref_code = 'demo10'`, percent 10, active (skip if it already exists).

- [ ] **Step 3: Write the journal** `qa/2026-08-28-influencers-smoke-test.md` in the same style as `qa/2026-08-26-coupons-smoke-test.md`: per check — what was run (token-free SQL), observed output, PASS/FAIL. A FAIL stops the task (report BLOCKED instead of committing). List the browser-only items as NOT RUN with concrete steps:
  1. Visit `/?ref=demo10`, navigate to a transfer booking, pay cash → the booking row in Supabase carries `influencer_code='demo10'` and 10% commission; `/admin/influencers` shows it under Demo Influencer with correct totals.
  2. The Copy-link button copies `<origin>/?ref=demo10`.
  3. Click-to-edit Rate cell updates commission for future bookings only.
  4. Close (deactivate) Demo Influencer → a fresh booking via the link is NOT attributed.
  5. A booking made with both `TEST10` coupon and the demo ref link records both, commission computed on the discounted total.

- [ ] **Step 4: Commit**

```bash
git add qa/2026-08-28-influencers-smoke-test.md
git commit -m "test: influencer attribution smoke journal"
```

---

## Out of scope (deliberately)

- Influencer login/dashboard — influencers have no account; the admin runs the report and settles with them offline (same as partner billing is admin-driven today).
- Payout/billing-report generation (like `billing_reports` for partners) — the per-influencer totals on the admin page cover the request; formal statements can come later.
- Multi-touch attribution, click counters, or UTM analytics — last-click 30-day localStorage attribution only.
- Per-flow commission rates (transfer vs tour) — one rate per influencer; matches the request ("το ποσό του commission θα το ορίζει ο admin").
- Editing name/code in place — close + recreate covers it; rate IS editable inline (rates change often).
