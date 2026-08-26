# Discount Coupons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-managed discount coupons: each coupon has its own code/name, a validity period, can be closed (deactivated) at any time, and applies either to all services or to an admin-selected subset of services (transfer / hourly / tour). Customers enter the code on the payment page and the discount is applied to the booking total.

**Architecture:** A new `coupons` table in Supabase Postgres with RLS (admin-only writes, no public reads). Customer validation goes exclusively through a `validate_coupon()` SECURITY DEFINER RPC, and the two booking-insert RPCs (`create_transfer_booking`, `create_tour_booking`) re-validate the coupon server-side at insert time and persist `coupon_id` / `coupon_code` / `coupon_discount` on the booking row. Discount *math* runs client-side in a new pure module `src/lib/coupons.ts` (same trust model as the existing client-computed `total_price`). A new admin page `/admin/coupons` follows the existing `manage-tours.astro` browser-side CRUD pattern.

**Tech Stack:** Astro 5 (static output, `prerender = false` API routes), Supabase (Postgres 15, RLS, plpgsql RPCs), Stripe Checkout, Tailwind v4, Vitest.

## Decisions locked in (from client requirements + codebase reality)

- **"Name" = the code.** The coupon's name is the code the customer types (e.g. `SUMMER25`). One field, unique case-insensitively.
- **"Services" = booking flows.** The site's payable services are exactly the three flows `transfer | hourly | tour` (`src/lib/stripe/server.ts:46-49`). Ferries are a third-party iframe and experiences are quote-only — no payment, so no coupon. Selection is stored as a `flows text[]` on the coupon (no join table needed).
- **Discount type:** each coupon is either `percent` (1–100) or `fixed` (€ amount). Both are cheap in one table and clients invariably ask for both.
- **Validity** is judged by the *redemption* date (today in Europe/Athens, matching the existing `BOOKING_DATE_PAST` logic), inclusive of both `valid_from` and `valid_until`.
- **"Close" = `active` boolean toggle** (reopenable), mirroring the `published` toggle in `manage-tours.astro:519`. Delete is also provided.
- **Floor of €1.00:** a coupon never takes the payable total below €1 (Stripe checkout endpoint rejects totals `< MIN_TOTAL_EUR = 1`, `create-checkout-session.ts:13`).
- **Coupon stacks on top of the partner discount** — the payment pages receive a `totalPrice` URL param that already includes any partner discount; the coupon applies to that number.
- **Server-side enforcement scope:** the RPCs verify the coupon is *valid* (exists, active, in period, applies to the flow) and store the canonical id/code, raising `COUPON_INVALID` otherwise. The euro amount itself remains client-computed — consistent with the existing system where `total_price` is client-supplied everywhere (`create-checkout-session.ts:52`).

## Global Constraints

- Indentation: **tabs** in `.astro` files, **2 spaces** in `src/lib/*.ts`, `src/pages/api/*.ts`, and `tests/*.ts`.
- Env access via `import.meta.env.X` only — never `process.env`.
- Every API route starts with `export const prerender = false;`.
- SQL migrations live in `db/migrations/YYYY-MM-DD-slug.sql` and must be **idempotent** (`create table if not exists`, `add column if not exists`, `create or replace function`, `drop policy if exists`).
- Migrations are applied to the live Supabase project **opaway** (ref `wjqfcijisslzqxesbbox`) via the Supabase Dashboard SQL Editor, or via the Management API using the operator-provided token in env var `SUPABASE_ACCESS_TOKEN`. **Never write that token into any file in this repo.**
- Customer-facing UI text: English in markup, with `data-i18n-el="…"` / `data-i18n-es="…"` attributes (and `data-i18n-placeholder-el/-es` for placeholders). Admin pages are English-only, no i18n attributes.
- Brand blue is `#0C6B95` (hover `#0a5c82`).
- Error-code contract for RPC validation failures: `raise exception 'COUPON_INVALID'` (mirrors `BOOKING_DATE_PAST`).
- Run `npx astro check` as the type gate for `.astro`/API changes; `npm test` for `tests/**/*.test.ts`.

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-08-26-coupons.sql` | `coupons` table + RLS, booking columns, `validate_coupon()`, re-created booking RPCs |
| Create | `src/lib/coupons.ts` | Types, pure discount/status math, `validateCoupon()` RPC wrapper |
| Create | `tests/coupons.test.ts` | Unit tests for the pure math |
| Create | `src/pages/admin/coupons.astro` | Admin CRUD page (create / close-reopen / delete / list) |
| Modify | `src/components/AdminLayout.astro:42-50` | Nav entry for Coupons |
| Modify | `src/pages/api/stripe/create-checkout-session.ts:77-81` | Map `COUPON_INVALID` RPC failure to HTTP 400 |
| Modify | `src/pages/book/transfer/payment.astro` | Coupon input UI, recomputed totals, payload fields |
| Modify | `src/pages/book/hourly/payment.astro` | Same for hourly |
| Modify | `src/pages/book/tour/payment.astro` | Same for tour |
| Create | `qa/2026-08-26-coupons-smoke-test.md` | Manual end-to-end verification journal |

---

### Task 0: Initialize git

The project directory is **not currently a git repository** (there is a `.gitignore` but no `.git`). The plan's commit steps need one.

**Files:** none (repo metadata only)

- [ ] **Step 1: Init and baseline commit**

```bash
cd /Users/marios/Desktop/Projects/opaway-main
git init
git add -A
git commit -m "chore: baseline before discount-coupons feature"
```

- [ ] **Step 2: Verify `.env` and secrets are ignored**

Run: `git status --ignored | head -30` and confirm no `.env*` file (other than `.env.example`) or `node_modules` is tracked. If `.env` shows as tracked, stop and remove it from the index with `git rm --cached .env` before continuing.

---

### Task 1: Database migration — coupons table, booking columns, RPCs

**Files:**
- Create: `db/migrations/2026-08-26-coupons.sql`

**Interfaces:**
- Consumes: existing `public.is_admin()` helper (`supabase-migration.sql:275-282`); live definitions of `create_transfer_booking(payload jsonb)` / `create_tour_booking(payload jsonb)` (below, copied from the live DB — they supersede `db/migrations/2026-07-16-block-past-booking-dates.sql`).
- Produces:
  - table `public.coupons(id uuid, code text, discount_type text, discount_value numeric, valid_from date, valid_until date, active boolean, applies_to_all boolean, flows text[], created_at timestamptz)`
  - columns `coupon_id uuid`, `coupon_code text`, `coupon_discount numeric` on `public.transfers` and `public.tours`
  - RPC `public.validate_coupon(p_code text, p_flow text) returns table(id uuid, code text, discount_type text, discount_value numeric)` — 0 rows means invalid; callable by `anon` + `authenticated`
  - booking RPCs now accept optional `coupon_code` + `coupon_discount` keys in the payload and `raise exception 'COUPON_INVALID'` when a non-empty `coupon_code` fails validation

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-08-26-coupons.sql` with exactly this content:

```sql
-- Discount coupons: admin-managed codes with a validity period, applying to
-- all payable flows or a selected subset ('transfer' | 'hourly' | 'tour').
-- Customers validate codes only through validate_coupon(); booking RPCs
-- re-validate at insert time and raise 'COUPON_INVALID' on failure.
-- Idempotent: safe to re-run.

-- ── 1. Coupons table ─────────────────────────────────────────────────────────

create table if not exists public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code text not null,
  discount_type text not null default 'percent'
    check (discount_type in ('percent', 'fixed')),
  discount_value numeric not null check (discount_value > 0),
  valid_from date not null,
  valid_until date not null,
  active boolean not null default true,
  applies_to_all boolean not null default true,
  flows text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint coupons_valid_period check (valid_until >= valid_from),
  constraint coupons_percent_max check (discount_type <> 'percent' or discount_value <= 100),
  constraint coupons_flows_known check (flows <@ array['transfer','hourly','tour'])
);

create unique index if not exists coupons_code_ci on public.coupons (lower(code));

alter table public.coupons enable row level security;

drop policy if exists "Admins manage coupons" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());
-- Deliberately NO public SELECT policy: customers cannot enumerate codes.
-- Validation happens only through validate_coupon() below.

-- ── 2. Coupon columns on booking tables ──────────────────────────────────────

alter table public.transfers add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.transfers add column if not exists coupon_code text;
alter table public.transfers add column if not exists coupon_discount numeric not null default 0;

alter table public.tours add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.tours add column if not exists coupon_code text;
alter table public.tours add column if not exists coupon_discount numeric not null default 0;

-- ── 3. Validation RPC (used by the payment pages AND the booking RPCs) ──────

create or replace function public.validate_coupon(p_code text, p_flow text)
returns table (id uuid, code text, discount_type text, discount_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.code, c.discount_type, c.discount_value
  from public.coupons c
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all or p_flow = any (c.flows));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;

-- ── 4. Booking RPCs, re-created with coupon validation + columns ────────────
-- Based on the live definitions (which match db/migrations/2026-07-16-block-past-booking-dates.sql)
-- plus: coupon validation after the date checks, and three new insert columns.

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
    coupon_id, coupon_code, coupon_discount
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
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end
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
    coupon_id, coupon_code, coupon_discount
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
    case when v_coupon_id is null then 0 else coalesce((safe->>'coupon_discount')::numeric, 0) end
  );

  return new_id;
end;
$function$;

grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration to the live project**

Preferred: paste the file into the Supabase Dashboard SQL Editor for project `wjqfcijisslzqxesbbox` and run it. Alternatively, with the operator-provided token exported as `SUPABASE_ACCESS_TOKEN` (never committed):

```bash
python3 - <<'EOF'
import json, os, urllib.request
sql = open('db/migrations/2026-08-26-coupons.sql').read()
req = urllib.request.Request(
  'https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query',
  data=json.dumps({'query': sql}).encode(),
  headers={'Authorization': f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
           'Content-Type': 'application/json'},
  method='POST')
print(urllib.request.urlopen(req).read().decode()[:500])
EOF
```

Expected: an empty-result response (`[]` or similar), no error object.

- [ ] **Step 3: Verify with SQL**

Run this query the same way (SQL Editor or the snippet above with `query` set to it):

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, applies_to_all, flows)
values ('PLANTEST10', 'percent', 10, current_date, current_date + 30, false, array['transfer'])
on conflict do nothing;

select 'valid transfer' as label, * from public.validate_coupon('plantest10', 'transfer')
union all
select 'wrong flow', * from public.validate_coupon('PLANTEST10', 'tour');
```

Expected: exactly **one** row, labeled `valid transfer`, with `discount_type = 'percent'`, `discount_value = 10` (case-insensitive match worked; `tour` correctly rejected). Then clean up:

```sql
delete from public.coupons where code = 'PLANTEST10';
```

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-08-26-coupons.sql
git commit -m "feat(db): coupons table, validate_coupon RPC, coupon-aware booking RPCs"
```

---

### Task 2: Coupon library with unit tests

**Files:**
- Create: `src/lib/coupons.ts`
- Test: `tests/coupons.test.ts`

**Interfaces:**
- Consumes: `supabase` anon client from `src/lib/supabase.ts`; RPC `validate_coupon(p_code, p_flow)` from Task 1.
- Produces (used by Tasks 4, 6, 7, 8):
  - `type CouponFlow = 'transfer' | 'hourly' | 'tour'`
  - `interface AppliedCoupon { id: string; code: string; discount_type: 'percent' | 'fixed'; discount_value: number }`
  - `couponDiscountAmount(total: number, coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value'>): number` — euro discount, 2-decimal rounded, clamped so at least €1 remains payable
  - `couponStatusOn(coupon: { active: boolean; valid_from: string; valid_until: string }, todayISO: string): 'active' | 'scheduled' | 'expired' | 'closed'`
  - `validateCoupon(code: string, flow: CouponFlow): Promise<AppliedCoupon | null>`

- [ ] **Step 1: Write the failing tests**

Create `tests/coupons.test.ts` (2-space indent):

```ts
import { describe, it, expect } from 'vitest';
import { couponDiscountAmount, couponStatusOn } from '../src/lib/coupons';

describe('couponDiscountAmount', () => {
  it('percent: 10% of €50.00 is €5.00', () => {
    expect(couponDiscountAmount(50, { discount_type: 'percent', discount_value: 10 })).toBe(5);
  });

  it('percent: rounds to 2 decimals (15% of €33.33 → €5.00)', () => {
    expect(couponDiscountAmount(33.33, { discount_type: 'percent', discount_value: 15 })).toBe(5);
  });

  it('fixed: €10 off €50.00 is €10.00', () => {
    expect(couponDiscountAmount(50, { discount_type: 'fixed', discount_value: 10 })).toBe(10);
  });

  it('fixed: clamps so at least €1.00 stays payable (€20 off €8 → €7 discount)', () => {
    expect(couponDiscountAmount(8, { discount_type: 'fixed', discount_value: 20 })).toBe(7);
  });

  it('percent: 100% clamps so at least €1.00 stays payable (€40 → €39 discount)', () => {
    expect(couponDiscountAmount(40, { discount_type: 'percent', discount_value: 100 })).toBe(39);
  });

  it('total at or below €1 yields no discount', () => {
    expect(couponDiscountAmount(1, { discount_type: 'percent', discount_value: 50 })).toBe(0);
    expect(couponDiscountAmount(0, { discount_type: 'fixed', discount_value: 5 })).toBe(0);
  });

  it('non-positive or non-finite inputs yield no discount', () => {
    expect(couponDiscountAmount(50, { discount_type: 'fixed', discount_value: -3 })).toBe(0);
    expect(couponDiscountAmount(NaN, { discount_type: 'percent', discount_value: 10 })).toBe(0);
  });
});

describe('couponStatusOn', () => {
  const coupon = { active: true, valid_from: '2026-08-01', valid_until: '2026-08-31' };

  it('closed wins over everything when active=false', () => {
    expect(couponStatusOn({ ...coupon, active: false }, '2026-08-15')).toBe('closed');
  });

  it('scheduled before valid_from', () => {
    expect(couponStatusOn(coupon, '2026-07-31')).toBe('scheduled');
  });

  it('active inside the period, inclusive of both bounds', () => {
    expect(couponStatusOn(coupon, '2026-08-01')).toBe('active');
    expect(couponStatusOn(coupon, '2026-08-31')).toBe('active');
  });

  it('expired after valid_until', () => {
    expect(couponStatusOn(coupon, '2026-09-01')).toBe('expired');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/coupons.test.ts`
Expected: FAIL — cannot resolve `../src/lib/coupons`.

- [ ] **Step 3: Implement the library**

Create `src/lib/coupons.ts` (2-space indent):

```ts
import { supabase } from './supabase';

export type CouponFlow = 'transfer' | 'hourly' | 'tour';

export interface AppliedCoupon {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
}

// Stripe checkout rejects totals under €1 (see create-checkout-session.ts
// MIN_TOTAL_EUR), so a coupon never discounts below this floor.
export const MIN_PAYABLE_TOTAL_EUR = 1;

export function couponDiscountAmount(
  total: number,
  coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value'>,
): number {
  if (!Number.isFinite(total) || total <= MIN_PAYABLE_TOTAL_EUR) return 0;
  const raw = coupon.discount_type === 'percent'
    ? total * (Math.min(coupon.discount_value, 100) / 100)
    : coupon.discount_value;
  const max = total - MIN_PAYABLE_TOTAL_EUR;
  return Math.round(Math.min(Math.max(raw, 0), max) * 100) / 100;
}

export type CouponStatus = 'active' | 'scheduled' | 'expired' | 'closed';

export function couponStatusOn(
  coupon: { active: boolean; valid_from: string; valid_until: string },
  todayISO: string,
): CouponStatus {
  if (!coupon.active) return 'closed';
  if (todayISO < coupon.valid_from) return 'scheduled';
  if (todayISO > coupon.valid_until) return 'expired';
  return 'active';
}

// Today's date (YYYY-MM-DD) in the business timezone, matching the server's
// validity check in validate_coupon().
export function athensTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });
}

export async function validateCoupon(code: string, flow: CouponFlow): Promise<AppliedCoupon | null> {
  const { data, error } = await supabase.rpc('validate_coupon', { p_code: code, p_flow: flow });
  if (error) {
    console.error('validate_coupon failed:', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    code: String(row.code),
    discount_type: row.discount_type === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all files, including the pre-existing `pricing`, `booking-date`, `booking-filters` suites.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coupons.ts tests/coupons.test.ts
git commit -m "feat: coupon discount math, status helper, and validate_coupon client wrapper"
```

---

### Task 3: Checkout endpoint — surface COUPON_INVALID as HTTP 400

**Files:**
- Modify: `src/pages/api/stripe/create-checkout-session.ts:77-81`

**Interfaces:**
- Consumes: the RPC failure `COUPON_INVALID` raised by the booking RPCs (Task 1). The endpoint needs no other change — the coupon fields ride inside `booking` and the client-discounted `total_price` already reaches `unit_amount` at line 92.
- Produces: HTTP 400 with body `{"error":"COUPON_INVALID"}` when the coupon fails server-side validation (the payment pages map this to a friendly message in Tasks 6–8).

- [ ] **Step 1: Apply the edit**

In `src/pages/api/stripe/create-checkout-session.ts`, replace:

```ts
  const { data: bookingId, error: rpcErr } = await sb.rpc(rpcNameFor(flow), { payload: insertPayload });
  if (rpcErr || !bookingId) {
    console.error('[create-checkout-session] RPC failed', { flow, error: rpcErr });
    return jsonError(500, 'Failed to create booking');
  }
```

with:

```ts
  const { data: bookingId, error: rpcErr } = await sb.rpc(rpcNameFor(flow), { payload: insertPayload });
  if (rpcErr || !bookingId) {
    if (rpcErr?.message?.includes('COUPON_INVALID')) return jsonError(400, 'COUPON_INVALID');
    console.error('[create-checkout-session] RPC failed', { flow, error: rpcErr });
    return jsonError(500, 'Failed to create booking');
  }
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: no new errors versus a run before the change (repo may have pre-existing warnings; only the delta matters).

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/stripe/create-checkout-session.ts
git commit -m "feat(stripe): return 400 COUPON_INVALID when booking RPC rejects a coupon"
```

---

### Task 4: Admin coupons page + nav entry

**Files:**
- Create: `src/pages/admin/coupons.astro`
- Modify: `src/components/AdminLayout.astro:42-50` (Management nav group)

**Interfaces:**
- Consumes: `AdminLayout` component (props `activeSection`, `docTitle`; auth overlay element `#admin-auth-check`); `supabase` anon client (RLS `is_admin()` policy from Task 1 authorizes writes); `couponStatusOn` + `athensTodayISO` from `src/lib/coupons.ts` (Task 2).
- Produces: page `/admin/coupons` — create form, list with status badges, Close/Reopen toggle, Delete with confirm modal.

- [ ] **Step 1: Add the nav entry**

In `src/components/AdminLayout.astro`, inside the `Management` group items array (currently `users` / `partners` / `sales` / `settings`), insert one line after the `partners` entry:

```ts
			{ key: 'coupons',             label: 'Coupons',      href: '/admin/coupons',             icon: 'chart'    },
```

(Uses the existing `chart` icon — already referenced by `prices` and `sales`, so no new icon SVG is needed.)

- [ ] **Step 2: Create the page**

Create `src/pages/admin/coupons.astro` (tabs, English-only, no i18n attributes — admin convention):

```astro
---
import AdminLayout from '../../components/AdminLayout.astro';
---

<AdminLayout activeSection="coupons" docTitle="Coupons — Admin">
	<div class="max-w-5xl">
		<h1 class="text-2xl font-bold text-neutral-900 mb-1">Coupons</h1>
		<p class="text-sm text-neutral-500 mb-6">Create discount codes, set their validity period, and choose which services they apply to.</p>

		<!-- ── Create form ── -->
		<form id="coupon-form" class="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-8">
			<h2 class="text-base font-bold text-neutral-900 mb-4">New coupon</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
				<div>
					<label for="cp-code" class="block text-sm font-medium text-neutral-700 mb-1">Name / code</label>
					<input id="cp-code" type="text" required placeholder="e.g. SUMMER25"
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					<p class="text-xs text-neutral-400 mt-1">This is what the customer types at checkout. Case-insensitive, must be unique.</p>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="cp-type" class="block text-sm font-medium text-neutral-700 mb-1">Discount type</label>
						<select id="cp-type"
							class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]">
							<option value="percent">Percent (%)</option>
							<option value="fixed">Fixed (&euro;)</option>
						</select>
					</div>
					<div>
						<label for="cp-value" class="block text-sm font-medium text-neutral-700 mb-1">Value</label>
						<input id="cp-value" type="number" min="0.01" step="0.01" required placeholder="10"
							class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					</div>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
				<div>
					<label for="cp-from" class="block text-sm font-medium text-neutral-700 mb-1">Valid from</label>
					<input id="cp-from" type="date" required
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				</div>
				<div>
					<label for="cp-until" class="block text-sm font-medium text-neutral-700 mb-1">Valid until</label>
					<input id="cp-until" type="date" required
						class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				</div>
			</div>

			<div class="mb-5">
				<span class="block text-sm font-medium text-neutral-700 mb-2">Applies to</span>
				<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
					<label class="flex items-center gap-2 text-sm text-neutral-700">
						<input type="radio" name="cp-scope" value="all" checked class="w-4 h-4 text-[#0C6B95]" />
						All services
					</label>
					<label class="flex items-center gap-2 text-sm text-neutral-700">
						<input type="radio" name="cp-scope" value="selected" class="w-4 h-4 text-[#0C6B95]" />
						Selected services:
					</label>
					<div id="cp-flows" class="flex items-center gap-4 opacity-40 pointer-events-none">
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="transfer" class="cp-flow w-4 h-4 rounded text-[#0C6B95]" /> Transfers
						</label>
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="hourly" class="cp-flow w-4 h-4 rounded text-[#0C6B95]" /> Hourly
						</label>
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="tour" class="cp-flow w-4 h-4 rounded text-[#0C6B95]" /> Tours
						</label>
					</div>
				</div>
			</div>

			<div class="flex items-center gap-4">
				<button type="submit"
					class="px-6 py-2.5 bg-[#0C6B95] hover:bg-[#0a5c82] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
					Create coupon
				</button>
				<p id="cp-status" class="text-sm"></p>
			</div>
		</form>

		<!-- ── List ── -->
		<div class="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-neutral-50 text-left text-neutral-500">
							<th class="px-5 py-3 font-medium">Code</th>
							<th class="px-5 py-3 font-medium">Discount</th>
							<th class="px-5 py-3 font-medium">Period</th>
							<th class="px-5 py-3 font-medium">Services</th>
							<th class="px-5 py-3 font-medium">Status</th>
							<th class="px-5 py-3 font-medium text-right">Actions</th>
						</tr>
					</thead>
					<tbody id="coupon-rows">
						<tr><td colspan="6" class="px-5 py-8 text-center text-neutral-400">Loading…</td></tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- ── Delete confirm modal ── -->
	<div id="delete-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
			<h3 class="text-base font-bold text-neutral-900 mb-2">Delete coupon?</h3>
			<p class="text-sm text-neutral-500 mb-5">This permanently deletes <strong id="delete-modal-code"></strong>. Existing bookings keep their recorded discount.</p>
			<div class="flex justify-end gap-3">
				<button id="delete-cancel" type="button" class="px-4 py-2 text-sm font-semibold rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50">Cancel</button>
				<button id="delete-confirm" type="button" class="px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white">Delete</button>
			</div>
		</div>
	</div>
</AdminLayout>

<script>
	import { supabase } from '../../lib/supabase';
	import { couponStatusOn, athensTodayISO, type CouponStatus } from '../../lib/coupons';

	type CouponRow = {
		id: string;
		code: string;
		discount_type: 'percent' | 'fixed';
		discount_value: number;
		valid_from: string;
		valid_until: string;
		active: boolean;
		applies_to_all: boolean;
		flows: string[];
		created_at: string;
	};

	const rowsEl = document.getElementById('coupon-rows') as HTMLTableSectionElement;
	const statusEl = document.getElementById('cp-status');
	let pendingDeleteId: string | null = null;

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

	const STATUS_BADGE: Record<CouponStatus, string> = {
		active:    'bg-green-100 text-green-700',
		scheduled: 'bg-amber-100 text-amber-700',
		expired:   'bg-neutral-100 text-neutral-500',
		closed:    'bg-red-100 text-red-700',
	};

	function servicesLabel(c: CouponRow): string {
		if (c.applies_to_all) return 'All services';
		const names: Record<string, string> = { transfer: 'Transfers', hourly: 'Hourly', tour: 'Tours' };
		return c.flows.map((f) => names[f] ?? f).join(', ') || '—';
	}

	function discountLabel(c: CouponRow): string {
		return c.discount_type === 'percent' ? `${c.discount_value}%` : `€${Number(c.discount_value).toFixed(2)}`;
	}

	async function loadCoupons() {
		const { data, error } = await supabase
			.from('coupons')
			.select('*')
			.order('created_at', { ascending: false });

		if (error) {
			rowsEl.innerHTML = `<tr><td colspan="6" class="px-5 py-8 text-center text-red-500">Error loading coupons: [${error.code}] ${escapeHtml(error.message)}</td></tr>`;
			return;
		}
		const coupons = (data ?? []) as CouponRow[];
		if (!coupons.length) {
			rowsEl.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-neutral-400">No coupons yet.</td></tr>';
			return;
		}

		const today = athensTodayISO();
		rowsEl.innerHTML = coupons.map((c) => {
			const status = couponStatusOn(c, today);
			return `
				<tr class="border-t border-neutral-100">
					<td class="px-5 py-3 font-semibold text-neutral-900">${escapeHtml(c.code)}</td>
					<td class="px-5 py-3">${discountLabel(c)}</td>
					<td class="px-5 py-3 whitespace-nowrap">${c.valid_from} → ${c.valid_until}</td>
					<td class="px-5 py-3">${escapeHtml(servicesLabel(c))}</td>
					<td class="px-5 py-3"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[status]}">${status}</span></td>
					<td class="px-5 py-3 text-right whitespace-nowrap">
						<button data-toggle="${c.id}" data-active="${c.active}" class="px-3 py-1.5 text-xs font-semibold rounded-lg border ${c.active ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-green-300 text-green-700 hover:bg-green-50'}">
							${c.active ? 'Close' : 'Reopen'}
						</button>
						<button data-delete="${c.id}" data-code="${escapeHtml(c.code)}" class="ml-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
							Delete
						</button>
					</td>
				</tr>`;
		}).join('');

		rowsEl.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
			btn.addEventListener('click', async () => {
				btn.disabled = true;
				const { error: err } = await supabase
					.from('coupons')
					.update({ active: btn.dataset.active !== 'true' })
					.eq('id', btn.dataset.toggle);
				if (err) setStatus(`Error updating coupon: [${err.code}] ${err.message}`, 'text-red-500');
				await loadCoupons();
			});
		});

		rowsEl.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
			btn.addEventListener('click', () => {
				pendingDeleteId = btn.dataset.delete ?? null;
				const codeEl = document.getElementById('delete-modal-code');
				if (codeEl) codeEl.textContent = btn.dataset.code ?? '';
				document.getElementById('delete-modal')?.classList.remove('hidden');
			});
		});
	}

	/* ── Scope radio enables/disables the flow checkboxes ── */
	const flowsBox = document.getElementById('cp-flows');
	document.querySelectorAll<HTMLInputElement>('input[name="cp-scope"]').forEach((radio) => {
		radio.addEventListener('change', () => {
			const selected = (document.querySelector('input[name="cp-scope"]:checked') as HTMLInputElement)?.value === 'selected';
			flowsBox?.classList.toggle('opacity-40', !selected);
			flowsBox?.classList.toggle('pointer-events-none', !selected);
		});
	});

	/* ── Create ── */
	document.getElementById('coupon-form')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const code = (document.getElementById('cp-code') as HTMLInputElement).value.trim();
		const discountType = (document.getElementById('cp-type') as HTMLSelectElement).value as 'percent' | 'fixed';
		const discountValue = parseFloat((document.getElementById('cp-value') as HTMLInputElement).value);
		const validFrom = (document.getElementById('cp-from') as HTMLInputElement).value;
		const validUntil = (document.getElementById('cp-until') as HTMLInputElement).value;
		const appliesToAll = (document.querySelector('input[name="cp-scope"]:checked') as HTMLInputElement)?.value === 'all';
		const flows = appliesToAll
			? []
			: Array.from(document.querySelectorAll<HTMLInputElement>('.cp-flow:checked')).map((c) => c.value);

		if (!code) { setStatus('Enter a coupon name/code.', 'text-red-500'); return; }
		if (!Number.isFinite(discountValue) || discountValue <= 0) { setStatus('Discount value must be greater than 0.', 'text-red-500'); return; }
		if (discountType === 'percent' && discountValue > 100) { setStatus('Percent discount cannot exceed 100.', 'text-red-500'); return; }
		if (!validFrom || !validUntil || validUntil < validFrom) { setStatus('Set a valid period (end date not before start date).', 'text-red-500'); return; }
		if (!appliesToAll && !flows.length) { setStatus('Pick at least one service, or choose "All services".', 'text-red-500'); return; }

		const { error } = await supabase.from('coupons').insert({
			code,
			discount_type: discountType,
			discount_value: discountValue,
			valid_from: validFrom,
			valid_until: validUntil,
			applies_to_all: appliesToAll,
			flows,
			active: true,
		});

		if (error) {
			const msg = error.code === '23505'
				? `A coupon named "${code}" already exists.`
				: `Error creating coupon: [${error.code}] ${error.message}`;
			setStatus(msg, 'text-red-500');
			return;
		}

		setStatus(`Coupon "${code}" created.`, 'text-green-600');
		(e.target as HTMLFormElement).reset();
		flowsBox?.classList.add('opacity-40', 'pointer-events-none');
		await loadCoupons();
	});

	/* ── Delete modal ── */
	document.getElementById('delete-cancel')?.addEventListener('click', () => {
		pendingDeleteId = null;
		document.getElementById('delete-modal')?.classList.add('hidden');
	});
	document.getElementById('delete-confirm')?.addEventListener('click', async () => {
		if (!pendingDeleteId) return;
		const { error } = await supabase.from('coupons').delete().eq('id', pendingDeleteId);
		if (error) setStatus(`Error deleting coupon: [${error.code}] ${error.message}`, 'text-red-500');
		pendingDeleteId = null;
		document.getElementById('delete-modal')?.classList.add('hidden');
		await loadCoupons();
	});

	/* ── Wait for the AdminLayout auth gate, then load ── */
	const authEl = document.getElementById('admin-auth-check');
	if (authEl) {
		if (authEl.classList.contains('hidden')) loadCoupons();
		else {
			const observer = new MutationObserver(() => {
				if (authEl.classList.contains('hidden')) { observer.disconnect(); loadCoupons(); }
			});
			observer.observe(authEl, { attributes: true, attributeFilter: ['class'] });
		}
	} else {
		loadCoupons();
	}
</script>
```

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as an admin, open `/admin/coupons`, and check:
1. "Coupons" appears in the sidebar under Management.
2. Create `TEST10`, percent, 10, today → today+30, All services → appears in the list with a green **active** badge.
3. Create a second coupon with scope "Selected services" + only **Tours** → Services column shows `Tours`.
4. Creating another coupon named `test10` (lowercase) fails with the duplicate message.
5. Close `TEST10` → badge turns red **closed**; Reopen restores it.
6. Delete the tours coupon via the modal → row disappears.
7. Leave `TEST10` **active** — Tasks 6–8 use it.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/coupons.astro src/components/AdminLayout.astro
git commit -m "feat(admin): coupons management page (create, close/reopen, delete)"
```

---

### Task 5: Coupon input on the transfer payment page

**Files:**
- Modify: `src/pages/book/transfer/payment.astro` (markup ~line 124; script lines 299-302, 363-373, 429-455, 498-523, 535-539)

**Interfaces:**
- Consumes: `validateCoupon`, `couponDiscountAmount`, `AppliedCoupon` from `src/lib/coupons.ts`; RPC payload keys `coupon_code`, `coupon_discount` (Task 1); 400 `COUPON_INVALID` from the checkout endpoint (Task 3).
- Produces: the UI pattern (markup ids `coupon-input`, `coupon-apply-btn`, `coupon-status`; `recomputeTotals()`) that Tasks 6 and 7 replicate.

- [ ] **Step 1: Insert the coupon markup**

In the template, directly **after** the `</div>` that closes the `space-y-3 mb-6` payment-methods container (after the card-onsite `</label>`, ~line 124) and **before** the `<!-- Form-level error banner -->` comment, insert (tabs):

```html
						<!-- Coupon code -->
						<div class="mb-6">
							<label for="coupon-input" class="block text-sm font-semibold text-neutral-900 mb-2" data-i18n-el="Κουπόνι έκπτωσης" data-i18n-es="Cupón de descuento">Discount coupon</label>
							<div class="flex gap-2">
								<input id="coupon-input" type="text" placeholder="Coupon code" data-i18n-placeholder-el="Κωδικός κουπονιού" data-i18n-placeholder-es="Código de cupón"
									class="flex-1 rounded-xl border border-neutral-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
								<button id="coupon-apply-btn" type="button"
									class="px-5 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
									data-i18n-el="Εφαρμογή" data-i18n-es="Aplicar">Apply</button>
							</div>
							<p id="coupon-status" class="hidden mt-2 text-sm"></p>
						</div>
```

- [ ] **Step 2: Add the import**

After the existing imports at lines 300-302 add:

```ts
	import { validateCoupon, couponDiscountAmount, type AppliedCoupon } from '../../../lib/coupons';
```

- [ ] **Step 3: Replace the payment-method state block with recomputable totals**

Replace lines 363-373 (`/* ── Payment method state ── */` through `setText('card-fee-amount', …)`):

```ts
	/* ── Payment method state ── */
	const preCouponTotal = parseFloat(totalPrice);
	let appliedCoupon: AppliedCoupon | null = null;
	let couponDiscount = 0;
	let baseTotal = preCouponTotal;
	let cardOnsiteFee = 0;
	let cardOnsiteTotal = 0;
	let selectedMethod = '';

	function recomputeTotals() {
		couponDiscount = appliedCoupon ? couponDiscountAmount(preCouponTotal, appliedCoupon) : 0;
		baseTotal = Math.round((preCouponTotal - couponDiscount) * 100) / 100;
		cardOnsiteFee = Math.round(baseTotal * 0.05 * 100) / 100;
		cardOnsiteTotal = Math.round((baseTotal + cardOnsiteFee) * 100) / 100;
		setText('method-stripe-price', `€${baseTotal.toFixed(2)}`);
		setText('method-cash-price', `€${baseTotal.toFixed(2)}`);
		setText('method-card-price', `€${cardOnsiteTotal.toFixed(2)}`);
		setText('card-fee-amount', `+€${cardOnsiteFee.toFixed(2)}`);
		const displayTotal = selectedMethod === 'card-onsite' ? cardOnsiteTotal : baseTotal;
		setText('os-total', `€${displayTotal.toFixed(2)}`);
		setText('sb-total', `€ ${displayTotal.toFixed(2)}`);
	}
	recomputeTotals();

	/* ── Coupon ── */
	const couponInput = document.getElementById('coupon-input') as HTMLInputElement | null;
	const couponBtn = document.getElementById('coupon-apply-btn') as HTMLButtonElement | null;
	const couponStatusEl = document.getElementById('coupon-status');

	function setCouponStatus(msg: string, ok: boolean) {
		if (!couponStatusEl) return;
		couponStatusEl.textContent = msg;
		couponStatusEl.classList.remove('hidden', 'text-green-600', 'text-red-600');
		couponStatusEl.classList.add(ok ? 'text-green-600' : 'text-red-600');
	}

	couponBtn?.addEventListener('click', async () => {
		const codeValue = (couponInput?.value || '').trim();
		if (!codeValue) {
			appliedCoupon = null;
			recomputeTotals();
			couponStatusEl?.classList.add('hidden');
			return;
		}
		couponBtn.disabled = true;
		couponBtn.textContent = 'Checking…';
		const coupon = await validateCoupon(codeValue, 'transfer');
		couponBtn.disabled = false;
		couponBtn.textContent = 'Apply';
		appliedCoupon = coupon;
		recomputeTotals();
		if (coupon) setCouponStatus(`Coupon "${coupon.code}" applied: -€${couponDiscount.toFixed(2)}`, true);
		else setCouponStatus('Invalid or expired coupon code.', false);
	});
```

(`selectMethod()` at lines 376-397 needs no change — it re-reads `baseTotal` / `cardOnsiteTotal`, which are now `let` variables kept current by `recomputeTotals()`.)

- [ ] **Step 4: Add coupon fields to both payloads**

In `saveBooking()`'s RPC payload (after the `luggage_big: luggageBig,` line, ~455) add:

```ts
					coupon_code: appliedCoupon?.code ?? null,
					coupon_discount: couponDiscount,
```

In the Stripe `bookingPayload` (after its `luggage_big: luggageBig,` line, ~522) add:

```ts
				coupon_code: appliedCoupon?.code ?? null,
				coupon_discount: couponDiscount,
```

- [ ] **Step 5: Friendly message for COUPON_INVALID on Stripe checkout**

In the `!res.ok` branch of the Stripe fetch (lines 535-540), replace:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, `Couldn't start payment: ${error}`);
```

with:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, error === 'COUPON_INVALID'
						? 'The coupon is no longer valid. Remove it or try another code.'
						: `Couldn't start payment: ${error}`);
```

- [ ] **Step 6: Verify**

Run `npx astro check` (no new errors), then in `npm run dev` walk a transfer booking to the payment page and check:
1. Applying `TEST10` (from Task 4) shows the green line and reduces all three method prices by 10%.
2. Applying `NOPE123` shows the red invalid message and prices return to full.
3. Complete a **cash** booking with `TEST10`; in Supabase Table Editor confirm the new `transfers` row has `coupon_id` set, `coupon_code = 'TEST10'`, `coupon_discount > 0`, and the discounted `total_price`.
4. (If Stripe test keys are configured) start a Stripe checkout with the coupon and confirm the Stripe-hosted page shows the discounted amount. Cancel — no need to pay.

- [ ] **Step 7: Commit**

```bash
git add src/pages/book/transfer/payment.astro
git commit -m "feat(transfer): coupon code input with server-validated discount"
```

---

### Task 6: Coupon input on the hourly payment page

**Files:**
- Modify: `src/pages/book/hourly/payment.astro` (markup: after the payment-methods container, before the error banner; script lines 261-270, 302-337, 384-399, 411-416)

**Interfaces:**
- Consumes: same lib exports as Task 5; flow string is `'hourly'`; the RPC is still `create_transfer_booking` (hourly rides live in `transfers` with `booking_type: 'hourly'` — the RPC validates against that flow automatically).
- Produces: nothing new.

- [ ] **Step 1: Insert the coupon markup**

In the template, directly **after** the `</div>` that closes the payment-method options container (after the card-onsite `</label>`) and **before** the form-level error banner `<div data-form-error …>`, insert (tabs):

```html
						<!-- Coupon code -->
						<div class="mb-6">
							<label for="coupon-input" class="block text-sm font-semibold text-neutral-900 mb-2" data-i18n-el="Κουπόνι έκπτωσης" data-i18n-es="Cupón de descuento">Discount coupon</label>
							<div class="flex gap-2">
								<input id="coupon-input" type="text" placeholder="Coupon code" data-i18n-placeholder-el="Κωδικός κουπονιού" data-i18n-placeholder-es="Código de cupón"
									class="flex-1 rounded-xl border border-neutral-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
								<button id="coupon-apply-btn" type="button"
									class="px-5 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
									data-i18n-el="Εφαρμογή" data-i18n-es="Aplicar">Apply</button>
							</div>
							<p id="coupon-status" class="hidden mt-2 text-sm"></p>
						</div>
```

- [ ] **Step 2: Add the import** next to the existing lib imports at the top of the `<script>` block:

```ts
	import { validateCoupon, couponDiscountAmount, type AppliedCoupon } from '../../../lib/coupons';
```

- [ ] **Step 3: Replace the payment-method state block**

Replace lines 261-270 (`// Payment method state` through `setText('card-fee-amount', …)`) with:

```ts
	// Payment method state
	const preCouponTotal = parseFloat(totalPrice);
	let appliedCoupon: AppliedCoupon | null = null;
	let couponDiscount = 0;
	let baseTotal = preCouponTotal;
	let cardOnsiteFee = 0;
	let cardOnsiteTotal = 0;
	let selectedMethod = '';

	function recomputeTotals() {
		couponDiscount = appliedCoupon ? couponDiscountAmount(preCouponTotal, appliedCoupon) : 0;
		baseTotal = Math.round((preCouponTotal - couponDiscount) * 100) / 100;
		cardOnsiteFee = Math.round(baseTotal * 0.05 * 100) / 100;
		cardOnsiteTotal = Math.round((baseTotal + cardOnsiteFee) * 100) / 100;
		setText('method-stripe-price', `€${baseTotal.toFixed(2)}`);
		setText('method-cash-price', `€${baseTotal.toFixed(2)}`);
		setText('method-card-price', `€${cardOnsiteTotal.toFixed(2)}`);
		setText('card-fee-amount', `+€${cardOnsiteFee.toFixed(2)}`);
		const displayTotal = selectedMethod === 'card-onsite' ? cardOnsiteTotal : baseTotal;
		setText('os-total', `€${displayTotal.toFixed(2)}`);
		setText('sb-total', `€ ${displayTotal.toFixed(2)}`);
	}
	recomputeTotals();

	// Coupon
	const couponInput = document.getElementById('coupon-input') as HTMLInputElement | null;
	const couponBtn = document.getElementById('coupon-apply-btn') as HTMLButtonElement | null;
	const couponStatusEl = document.getElementById('coupon-status');

	function setCouponStatus(msg: string, ok: boolean) {
		if (!couponStatusEl) return;
		couponStatusEl.textContent = msg;
		couponStatusEl.classList.remove('hidden', 'text-green-600', 'text-red-600');
		couponStatusEl.classList.add(ok ? 'text-green-600' : 'text-red-600');
	}

	couponBtn?.addEventListener('click', async () => {
		const codeValue = (couponInput?.value || '').trim();
		if (!codeValue) {
			appliedCoupon = null;
			recomputeTotals();
			couponStatusEl?.classList.add('hidden');
			return;
		}
		couponBtn.disabled = true;
		couponBtn.textContent = 'Checking…';
		const coupon = await validateCoupon(codeValue, 'hourly');
		couponBtn.disabled = false;
		couponBtn.textContent = 'Apply';
		appliedCoupon = coupon;
		recomputeTotals();
		if (coupon) setCouponStatus(`Coupon "${coupon.code}" applied: -€${couponDiscount.toFixed(2)}`, true);
		else setCouponStatus('Invalid or expired coupon code.', false);
	});
```

(This page's `selectMethod()` needs no change — it re-reads `baseTotal` / `cardOnsiteTotal`, which are now `let` variables kept current by `recomputeTotals()`.)

- [ ] **Step 4: Add coupon fields to both payloads.** In `saveBooking()`'s payload (after `luggage_big: luggageBig,` ~line 336) and in the Stripe `bookingPayload` (after `per_hour: parseFloat(perHour) || 0,` ~line 398) add:

```ts
					coupon_code: appliedCoupon?.code ?? null,
					coupon_discount: couponDiscount,
```

- [ ] **Step 5: Friendly COUPON_INVALID message**

In the `!res.ok` branch of this page's Stripe fetch (~lines 411-414), replace:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, `Couldn't start payment: ${error}`);
```

with:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, error === 'COUPON_INVALID'
						? 'The coupon is no longer valid. Remove it or try another code.'
						: `Couldn't start payment: ${error}`);
```

- [ ] **Step 6: Verify** — `npx astro check`, then in dev: create an hourly-only coupon in `/admin/coupons` (scope Selected → **Hourly** only, e.g. `HOURLY5`, fixed, 5). On the hourly payment page `HOURLY5` applies; on a transfer payment page `HOURLY5` is rejected. Complete a cash hourly booking with it and confirm the `transfers` row has `booking_type='hourly'`, `coupon_code='HOURLY5'`, `coupon_discount=5`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/book/hourly/payment.astro
git commit -m "feat(hourly): coupon code input with server-validated discount"
```

---

### Task 7: Coupon input on the tour payment page

**Files:**
- Modify: `src/pages/book/tour/payment.astro` (markup: after the payment-methods container, before the error banner; script lines 281-284, 346-356, 409-439, 487-509, 521-525)

**Interfaces:**
- Consumes: same lib exports; flow string `'tour'`; RPC `create_tour_booking`. Note: this page's `baseTotal` already includes `ticketsSubtotal` (line 347) — the coupon applies to that combined figure, which is what gets charged.
- Produces: nothing new.

- [ ] **Step 1: Insert the coupon markup**

In the template, directly **after** the `</div>` that closes the payment-method options container (after the card-onsite `</label>`) and **before** the form-level error banner `<div data-form-error …>`, insert (tabs):

```html
						<!-- Coupon code -->
						<div class="mb-6">
							<label for="coupon-input" class="block text-sm font-semibold text-neutral-900 mb-2" data-i18n-el="Κουπόνι έκπτωσης" data-i18n-es="Cupón de descuento">Discount coupon</label>
							<div class="flex gap-2">
								<input id="coupon-input" type="text" placeholder="Coupon code" data-i18n-placeholder-el="Κωδικός κουπονιού" data-i18n-placeholder-es="Código de cupón"
									class="flex-1 rounded-xl border border-neutral-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
								<button id="coupon-apply-btn" type="button"
									class="px-5 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
									data-i18n-el="Εφαρμογή" data-i18n-es="Aplicar">Apply</button>
							</div>
							<p id="coupon-status" class="hidden mt-2 text-sm"></p>
						</div>
```

- [ ] **Step 2: Add the import** next to the imports at lines 282-284:

```ts
	import { validateCoupon, couponDiscountAmount, type AppliedCoupon } from '../../../lib/coupons';
```

- [ ] **Step 3: Replace the payment-method state block**

Replace lines 346-356 (`/* ── Payment method state ── */` through `setText('card-fee-amount', …)`) with the block below. Note the first line: on this page the charged total is tour price **plus** entrance tickets (`ticketsSubtotal` is defined earlier at line 309), and the coupon applies to that combined figure.

```ts
	/* ── Payment method state ── */
	const preCouponTotal = (parseFloat(totalPrice) || 0) + ticketsSubtotal;
	let appliedCoupon: AppliedCoupon | null = null;
	let couponDiscount = 0;
	let baseTotal = preCouponTotal;
	let cardOnsiteFee = 0;
	let cardOnsiteTotal = 0;
	let selectedMethod = '';

	function recomputeTotals() {
		couponDiscount = appliedCoupon ? couponDiscountAmount(preCouponTotal, appliedCoupon) : 0;
		baseTotal = Math.round((preCouponTotal - couponDiscount) * 100) / 100;
		cardOnsiteFee = Math.round(baseTotal * 0.05 * 100) / 100;
		cardOnsiteTotal = Math.round((baseTotal + cardOnsiteFee) * 100) / 100;
		setText('method-stripe-price', `€${baseTotal.toFixed(2)}`);
		setText('method-cash-price', `€${baseTotal.toFixed(2)}`);
		setText('method-card-price', `€${cardOnsiteTotal.toFixed(2)}`);
		setText('card-fee-amount', `+€${cardOnsiteFee.toFixed(2)}`);
		const displayTotal = selectedMethod === 'card-onsite' ? cardOnsiteTotal : baseTotal;
		setText('os-total', `€${displayTotal.toFixed(2)}`);
		setText('sb-total', `€ ${displayTotal.toFixed(2)}`);
	}
	recomputeTotals();

	/* ── Coupon ── */
	const couponInput = document.getElementById('coupon-input') as HTMLInputElement | null;
	const couponBtn = document.getElementById('coupon-apply-btn') as HTMLButtonElement | null;
	const couponStatusEl = document.getElementById('coupon-status');

	function setCouponStatus(msg: string, ok: boolean) {
		if (!couponStatusEl) return;
		couponStatusEl.textContent = msg;
		couponStatusEl.classList.remove('hidden', 'text-green-600', 'text-red-600');
		couponStatusEl.classList.add(ok ? 'text-green-600' : 'text-red-600');
	}

	couponBtn?.addEventListener('click', async () => {
		const codeValue = (couponInput?.value || '').trim();
		if (!codeValue) {
			appliedCoupon = null;
			recomputeTotals();
			couponStatusEl?.classList.add('hidden');
			return;
		}
		couponBtn.disabled = true;
		couponBtn.textContent = 'Checking…';
		const coupon = await validateCoupon(codeValue, 'tour');
		couponBtn.disabled = false;
		couponBtn.textContent = 'Apply';
		appliedCoupon = coupon;
		recomputeTotals();
		if (coupon) setCouponStatus(`Coupon "${coupon.code}" applied: -€${couponDiscount.toFixed(2)}`, true);
		else setCouponStatus('Invalid or expired coupon code.', false);
	});
```

(This page's `selectMethod()` needs no change — it re-reads `baseTotal` / `cardOnsiteTotal`, which are now `let` variables kept current by `recomputeTotals()`. The `sb-tour-subtotal` / `sb-tickets-subtotal` sidebar lines keep showing the pre-coupon breakdown; only `sb-total` / `os-total` reflect the discount, alongside the green coupon-status line.)

- [ ] **Step 4: Add coupon fields to both payloads.** In `saveBooking()`'s payload (after `added_by_admin: false,` ~line 438) and in the Stripe `bookingPayload` (after `partner_id: partnerId,` ~line 508) add:

```ts
					coupon_code: appliedCoupon?.code ?? null,
					coupon_discount: couponDiscount,
```

- [ ] **Step 5: Friendly COUPON_INVALID message**

In the `!res.ok` branch of this page's Stripe fetch (~lines 521-524), replace:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, `Couldn't start payment: ${error}`);
```

with:

```ts
					const { error } = await res.json().catch(() => ({ error: 'unknown' }));
					showFormError(formScope, error === 'COUPON_INVALID'
						? 'The coupon is no longer valid. Remove it or try another code.'
						: `Couldn't start payment: ${error}`);
```

- [ ] **Step 6: Verify** — `npx astro check`, then in dev: `TEST10` (all-services) applies on a tour payment page; `HOURLY5` (hourly-only, from Task 6) is rejected there. Complete a cash tour booking with `TEST10` and confirm the `tours` row has `coupon_id`, `coupon_code`, `coupon_discount` populated.

- [ ] **Step 7: Commit**

```bash
git add src/pages/book/tour/payment.astro
git commit -m "feat(tour): coupon code input with server-validated discount"
```

---

### Task 8: End-to-end QA sweep + journal

**Files:**
- Create: `qa/2026-08-26-coupons-smoke-test.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the recorded manual-test journal (repo convention: `qa/2026-04-22-full-smoke-test.md`).

- [ ] **Step 1: Run the full automated suite**

Run: `npm test` and `npx astro check`
Expected: all Vitest suites pass; no new check errors.

- [ ] **Step 2: Adversarial manual checks** (dev server + Supabase dashboard)

Work through this list; every line must behave as stated:

1. **Closed coupon rejected end-to-end:** close `TEST10` in `/admin/coupons`, then on a transfer payment page apply `TEST10` → red "Invalid or expired". Reopen it afterwards.
2. **Expired coupon rejected:** create `OLD10` (percent 10) with `valid_from` and `valid_until` both set to yesterday's date (type it into the date inputs — the DB accepts past periods). Apply `OLD10` on a payment page → rejected. Delete `OLD10`.
3. **Scheduled coupon rejected:** create `FUTURE10` valid from tomorrow → rejected today. Delete it.
4. **Tampered client bypass is blocked:** on the payment page, apply a valid code, then close that coupon from another (admin) tab, then click Complete Booking (cash). Expected: the booking fails with `COUPON_INVALID` surfaced in the error banner (the RPC re-validates at insert time) — no booking row is created.
5. **Floor:** create `FREE100` (percent 100), apply to a booking → total shows €1.00, not €0.
6. **Duplicate code guard:** creating `test10` while `TEST10` exists fails with the friendly duplicate message.
7. **Coupon fields on Stripe bookings:** with Stripe test keys, complete a full checkout using a coupon and confirm the booking row (after webhook capture) still holds `coupon_code`/`coupon_discount`, and Stripe charged the discounted amount.

- [ ] **Step 3: Write the journal**

Create `qa/2026-08-26-coupons-smoke-test.md` recording, for each numbered check above: what was done, what was observed, pass/fail. Record failures honestly and fix them before closing the task.

- [ ] **Step 4: Final commit**

```bash
git add qa/2026-08-26-coupons-smoke-test.md
git commit -m "test: coupons end-to-end smoke journal"
```

---

## Out of scope (deliberately)

- Per-catalog-item (individual tour) coupon targeting — flows only, per the requirement's granularity.
- Usage limits (max redemptions, one-per-customer) — not requested.
- Editing a coupon in place — close + recreate covers the requested lifecycle; editing can be added later.
- Showing coupon columns in the admin transfers/tours booking lists — the data is stored and queryable; UI surfacing is a follow-up.
- Server-side recomputation of the full price — the whole system currently trusts the client-computed `total_price`; fixing that is a separate (worthwhile) project.
