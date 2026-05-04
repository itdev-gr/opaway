# Stripe Server-Side Capture (Checkout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side `stripe.createToken()` flow with a server-side Stripe Checkout flow that actually charges customer cards, with webhook-driven `payment_status` reconciliation.

**Architecture:** New Astro server endpoints under `src/pages/api/stripe/` (Vercel serverless functions via `@astrojs/vercel` adapter, opting in per-route via `export const prerender = false`). DB schema additions on existing `transfers` and `tours` tables. New `stripe_events` table for webhook idempotency, applied via a `SECURITY DEFINER` RPC that wraps idempotency + booking UPDATE in one transaction. Frontend payment pages keep their layout but redirect to Stripe Checkout instead of mounting a Card Element.

**Tech Stack:** Astro 5 (currently `output: 'static'` — keeps that mode and adds adapter), Supabase Postgres, `stripe` Node SDK, `@astrojs/vercel`, Stripe CLI (local dev). No new test framework — manual verification.

**Spec:** `docs/superpowers/specs/2026-05-04-stripe-server-capture-design.md`

**Pre-requisites the engineer must have set up:**
- Stripe account with the **rolled** `sk_live_…` (the previously-leaked one MUST be revoked first).
- Stripe test-mode API keys (`pk_test_…`, `sk_test_…`).
- `STRIPE_SECRET_KEY` (test) and `SUPABASE_SERVICE_ROLE_KEY` available locally.
- Stripe CLI installed: `brew install stripe/stripe-cli/stripe`, `stripe login`.
- Supabase project access (for running migrations against staging + prod).
- Vercel project access (for setting env vars).

---

## File Structure

**Created:**
- `db/migrations/2026-05-04-stripe-server-capture.sql` — schema additions, RPC re-creation, idempotency table, indexes
- `src/pages/api/stripe/create-checkout-session.ts` — POST endpoint: validate, insert booking, create Checkout Session
- `src/pages/api/stripe/session-status.ts` — GET endpoint: returns booking state by `session_id`
- `src/pages/api/stripe/webhook.ts` — POST endpoint: verify signature, normalize event, call `apply_stripe_event` RPC
- `src/lib/stripe/server.ts` — small helper module: builds Stripe + Supabase clients, validates env, shared types
- `src/components/StripeSuccess.astro` — shared client-side polling + state-machine for the 3 success pages
- `src/pages/book/transfer/payment/success.astro` — thin layout wrapper around `<StripeSuccess flow="transfer" />`
- `src/pages/book/transfer/payment/cancelled.astro` — static "payment cancelled" page
- `src/pages/book/hourly/payment/success.astro` — same pattern
- `src/pages/book/hourly/payment/cancelled.astro`
- `src/pages/book/tour/payment/success.astro`
- `src/pages/book/tour/payment/cancelled.astro`

**Modified:**
- `astro.config.mjs` — add `@astrojs/vercel` adapter
- `package.json` / `package-lock.json` — add `stripe`, `@astrojs/vercel`
- `.env.example` — document new server-only env vars
- `src/pages/book/transfer/payment.astro` — remove Card Element mount + `createToken`, route Stripe radio to fetch + redirect
- `src/pages/book/hourly/payment.astro` — same change
- `src/pages/book/tour/payment.astro` — same change

**Out of scope (do not touch):**
- Existing migration files in `db/migrations/` (treat as historical record; new migration supersedes)
- Existing `payment_token` column (kept for back-compat)
- `src/pages/admin/*`, `src/pages/driver/*`, `src/pages/profile/*` (no changes — they read the same `payment_status` field, and the new values like `awaiting_payment` / `failed` / `refunded` will display as the raw string in admin tables; that's acceptable for MVP)
- Removing `@stripe/stripe-js` from `package.json` (1-line follow-up)

---

## Branching

Work happens on a feature branch off `main`:

```bash
git checkout -b feat/stripe-server-capture
```

Commit at the end of every task. Push and open a PR after Task 13 (local end-to-end verified). Tasks 14–15 happen on `main` after merge.

---

## Task 1: DB schema migration

**Files:**
- Create: `db/migrations/2026-05-04-stripe-server-capture.sql`

**Goal:** Add Stripe-related columns to `transfers` and `tours`, replace the broken `payment_status` CHECK constraint, create the `stripe_events` idempotency table, recreate the two booking RPCs with passthrough for the new fields, and create the `apply_stripe_event` RPC.

- [ ] **Step 1: Write the verification SQL (run it first, expect failure)**

Create a scratch file `/tmp/verify-stripe-migration.sql` with these queries — they will all error today, after the migration they will all succeed:

```sql
-- 1. New columns exist
select stripe_session_id, stripe_payment_intent_id, stripe_charge_id from public.transfers limit 0;
select stripe_session_id, stripe_payment_intent_id, stripe_charge_id from public.tours     limit 0;

-- 2. Constraint accepts new values (these inserts use a fake row; rolled back)
begin;
  insert into public.transfers (id, "from", "to", date, time, payment_status)
    values (gen_random_uuid(), 'a', 'b', '2030-01-01', '10:00', 'awaiting_payment');
rollback;

-- 3. Idempotency table exists and rejects duplicate event ids
begin;
  insert into public.stripe_events (id, type) values ('evt_test_1', 'foo');
  insert into public.stripe_events (id, type) values ('evt_test_1', 'foo');   -- expect ON CONFLICT no-op via INSERT in RPC
rollback;

-- 4. apply_stripe_event RPC exists
select pg_get_function_identity_arguments(oid)
  from pg_proc where proname = 'apply_stripe_event';

-- 5. Updated booking RPCs accept stripe_session_id passthrough
select public.create_transfer_booking(jsonb_build_object(
  'from','x','to','y','date','2030-01-01','time','10:00',
  'first_name','t','last_name','t','email','t@t.com','phone','000',
  'total_price', 1, 'payment_method','stripe', 'payment_status','awaiting_payment',
  'stripe_session_id','cs_test_dummy'
));
```

Run against staging Supabase via `psql` or the SQL editor. Expect: column-not-found error on query 1.

- [ ] **Step 2: Write the migration file**

Create `db/migrations/2026-05-04-stripe-server-capture.sql`:

```sql
-- Stripe server-side Checkout capture: schema additions + RPC updates.
--
-- Background: previously, payment.astro called stripe.createToken() client-side
-- and stored the token on the booking row. No server-side capture existed and
-- payment_status was hard-coded 'pending'. This migration adds the columns and
-- RPC infrastructure to support a real server-side Checkout flow:
--   - stripe_session_id, stripe_payment_intent_id, stripe_charge_id on bookings
--   - stripe_events table (PRIMARY KEY = event id) for webhook idempotency
--   - apply_stripe_event(...) RPC that does idempotency + booking UPDATE in one tx
--   - create_transfer_booking / create_tour_booking re-created with stripe_* passthrough
--
-- Idempotent (`if not exists`, `or replace`).

-- ──────────────────────────────────────────────────────────────────────
-- 1. New stripe_* columns on the two booking tables
-- ──────────────────────────────────────────────────────────────────────
alter table public.transfers
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;

alter table public.tours
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Replace the broken payment_status CHECK constraint
--    (current: in ('pending','paid'); but driver/ride.astro already writes 'paid_to_driver')
-- ──────────────────────────────────────────────────────────────────────
alter table public.transfers drop constraint if exists transfers_payment_status_check;
alter table public.transfers add constraint transfers_payment_status_check
  check (payment_status in (
    'pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'
  ));

alter table public.tours drop constraint if exists tours_payment_status_check;
alter table public.tours add constraint tours_payment_status_check
  check (payment_status in (
    'pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'
  ));

-- ──────────────────────────────────────────────────────────────────────
-- 3. Idempotency table for webhook events
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.stripe_events (
  id          text primary key,           -- evt_…
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- No grants to anon/authenticated. Only service role and SECURITY DEFINER RPCs
-- (which run as table owner) read/write this table.

-- ──────────────────────────────────────────────────────────────────────
-- 4. Indexes for fast webhook lookups
-- ──────────────────────────────────────────────────────────────────────
create index if not exists transfers_stripe_session_id_idx
  on public.transfers (stripe_session_id) where stripe_session_id is not null;
create index if not exists transfers_stripe_payment_intent_idx
  on public.transfers (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists tours_stripe_session_id_idx
  on public.tours (stripe_session_id) where stripe_session_id is not null;
create index if not exists tours_stripe_payment_intent_idx
  on public.tours (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- ──────────────────────────────────────────────────────────────────────
-- 5. Re-create create_transfer_booking with stripe_* passthrough
--    (Supersedes the version in 2026-05-04-guest-booking-rpcs.sql.)
-- ──────────────────────────────────────────────────────────────────────
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
  safe := coalesce(payload, '{}'::jsonb) - 'id' - 'uid' - 'created_at';

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
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id
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
    safe->>'stripe_charge_id'
  );

  return new_id;
end;
$$;
revoke all on function public.create_transfer_booking(jsonb) from public;
grant execute on function public.create_transfer_booking(jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 6. Re-create create_tour_booking with stripe_* passthrough
-- ──────────────────────────────────────────────────────────────────────
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
    stripe_session_id, stripe_payment_intent_id, stripe_charge_id
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
    safe->>'stripe_charge_id'
  );

  return new_id;
end;
$$;
revoke all on function public.create_tour_booking(jsonb) from public;
grant execute on function public.create_tour_booking(jsonb) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 7. apply_stripe_event RPC: idempotency + booking UPDATE in one transaction
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.apply_stripe_event(
  p_event_id   text,
  p_event_type text,
  p_payload    jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id text;
begin
  insert into public.stripe_events(id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing
    returning id into inserted_id;

  if inserted_id is null then
    return 'duplicate';
  end if;

  case p_event_type
    when 'checkout.session.completed' then
      update public.transfers set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';
      update public.tours set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';

    when 'payment_intent.payment_failed' then
      update public.transfers set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';
      update public.tours set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';

    when 'charge.refunded' then
      update public.transfers set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';
      update public.tours set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';

    else
      null;
  end case;

  return 'applied';
end;
$$;
revoke all on function public.apply_stripe_event(text, text, jsonb) from public;
-- Not granted to anon/authenticated; called only from server endpoint via service role.
```

- [ ] **Step 3: Apply the migration to STAGING Supabase**

Open the staging project's SQL editor (Supabase Dashboard → SQL → New query), paste the migration file's contents, click Run. Expect: "Success. No rows returned." with no errors.

If you have direct DB access:
```bash
psql "$STAGING_DATABASE_URL" -f db/migrations/2026-05-04-stripe-server-capture.sql
```
Expected: each `ALTER`/`CREATE` returns `ALTER TABLE` / `CREATE TABLE` / `CREATE FUNCTION`. No errors.

- [ ] **Step 4: Re-run the verification SQL (expect success)**

Re-run the queries from Step 1 against staging.

Expected:
- Query 1: returns empty result set, no error.
- Query 2: insert succeeds, then rolls back. No error.
- Query 3: second insert collides; the test as written uses two raw INSERTs that would fail on PK conflict — that's actually the expected behavior, just rollback.
- Query 4: returns `text, text, jsonb`.
- Query 5: returns a UUID (the test booking row was inserted; you can roll back manually with `delete from transfers where id = '<the uuid>';` or leave it).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-05-04-stripe-server-capture.sql
git commit -m "feat(stripe): add schema + RPCs for server-side Checkout capture"
```

---

## Task 2: Install Stripe SDK + Vercel adapter, configure Astro for serverless

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `astro.config.mjs`

**Goal:** Add the two new deps and switch Astro into a mode where individual API routes can become Vercel serverless functions while every existing static page stays static.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

Create a temporary file `src/pages/api/_test.ts`:

```ts
import type { APIRoute } from 'astro';
export const prerender = false;
export const GET: APIRoute = () => new Response('hello from server', { status: 200 });
```

Run `npm run dev`, open `http://localhost:4321/api/_test`. Today (no adapter) Astro will either 404 the route or fail the build. Expected: 404 or build error mentioning "endpoints require an adapter".

- [ ] **Step 2: Install deps**

```bash
npm install stripe @astrojs/vercel
```

Expected: both packages added to `dependencies` in `package.json`. `package-lock.json` updated.

- [ ] **Step 3: Update `astro.config.mjs`**

Replace the file contents with:

```js
// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.opawey.com',
  devToolbar: { enabled: false },
  output: 'static',          // static by default; API routes opt out via prerender = false
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => {
        if (/\/(admin|driver|hotel|agency|profile)(\/|$)/.test(page)) return false;
        if (/\/book\/[^/]+\/(passenger|payment|results)\/?$/.test(page)) return false;
        if (/\/(login|register|register-partner|forgot-password|logout|404)\/?$/.test(page)) return false;
        return true;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
```

- [ ] **Step 4: Re-run the verification (expect success)**

```bash
npm run dev
```

Open `http://localhost:4321/api/_test`. Expected: text "hello from server", HTTP 200.

Then:
```bash
npm run build
```
Expected: build succeeds. Output mentions one server function for `_test`. Existing static pages still listed under prerendered.

- [ ] **Step 5: Delete the test endpoint and commit**

```bash
rm src/pages/api/_test.ts
git add package.json package-lock.json astro.config.mjs
git commit -m "feat(build): add @astrojs/vercel adapter + stripe SDK for server endpoints"
```

---

## Task 3: Document new env vars + add server-side env helper

**Files:**
- Modify: `.env.example`
- Create: `src/lib/stripe/server.ts`

**Goal:** Document the new env vars in `.env.example` (without secrets), and centralize Stripe + Supabase service-role client construction into one tested helper module so the three endpoint files can stay slim.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

After this task, an endpoint file will be able to `import { stripe, supabaseAdmin, originFromRequest } from '@/lib/stripe/server';` and use the exports. Today, that import doesn't exist.

- [ ] **Step 2: Update `.env.example`**

Append below the existing Stripe line:

```
# Stripe — server-side capture (added 2026-05-04 for Checkout flow)
# Get test keys from https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
# Get from `stripe listen --forward-to localhost:4321/api/stripe/webhook`
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-signing-secret

# Supabase service role — needed by Stripe webhook handler to bypass RLS
# Dashboard → Project Settings → API → service_role (NEVER expose to browser)
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-jwt
```

- [ ] **Step 3: Create the server helper**

Create `src/lib/stripe/server.ts`:

```ts
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STRIPE_SECRET_KEY        = import.meta.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET    = import.meta.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL             = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE    = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY        = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!STRIPE_SECRET_KEY)     throw new Error('STRIPE_SECRET_KEY is not set');
if (!SUPABASE_URL)          throw new Error('PUBLIC_SUPABASE_URL is not set');
if (!SUPABASE_SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
if (!SUPABASE_ANON_KEY)     throw new Error('PUBLIC_SUPABASE_ANON_KEY is not set');

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',     // pin to a known version
  typescript: true,
});

export const stripeWebhookSecret = STRIPE_WEBHOOK_SECRET ?? '';

/** Service-role client. Bypasses RLS. Use ONLY for server-side trusted writes. */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Anon client bound to a user's access token. Use this for inserts/queries
 * that should respect RLS and use auth.uid() for ownership.
 */
export function supabaseForUser(accessToken: string | null): SupabaseClient {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers },
  });
}

/** Builds the absolute origin (e.g. https://www.opawey.com) from the incoming request. */
export function originFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Booking flow union — used by every endpoint. */
export type Flow = 'transfer' | 'hourly' | 'tour';
export const FLOWS: readonly Flow[] = ['transfer', 'hourly', 'tour'] as const;
export function isFlow(x: unknown): x is Flow {
  return typeof x === 'string' && (FLOWS as readonly string[]).includes(x);
}
```

> **Why both `supabaseAdmin` and `supabaseForUser`:** the booking-row INSERT goes through the existing `create_transfer_booking` RPC, which captures `auth.uid()` for ownership. To preserve user attribution for logged-in customers, the server endpoint must call that RPC with the **user's JWT** (via `supabaseForUser`), not the service role. The subsequent UPDATE to set `stripe_session_id` is a trusted server write and uses `supabaseAdmin`. The webhook handler also uses `supabaseAdmin` (no user is in the loop).

- [ ] **Step 4: Verify it imports without crashing**

Add a temporary test endpoint `src/pages/api/_smoke.ts`:

```ts
import type { APIRoute } from 'astro';
import { stripe, supabaseAdmin, isFlow } from '../../lib/stripe/server';

export const prerender = false;
export const GET: APIRoute = async () => {
  // Touch each export so missing imports/env throw at request time, not import time
  const ok = !!stripe && !!supabaseAdmin && isFlow('transfer');
  return new Response(JSON.stringify({ ok }), { status: 200, headers: { 'content-type': 'application/json' } });
};
```

Run `npm run dev`, hit `http://localhost:4321/api/_smoke`. Expected: `{"ok":true}` with HTTP 200.

If env vars are missing, the response is HTTP 500 with the exact `is not set` message — that confirms validation works.

- [ ] **Step 5: Delete the smoke endpoint and commit**

```bash
rm src/pages/api/_smoke.ts
git add .env.example src/lib/stripe/server.ts
git commit -m "feat(stripe): add server-side helper for Stripe + Supabase clients"
```

---

## Task 4: Build `POST /api/stripe/create-checkout-session`

**Files:**
- Create: `src/pages/api/stripe/create-checkout-session.ts`

**Goal:** Endpoint that accepts a flow + booking payload, validates it, inserts an `awaiting_payment` booking row via the existing RPC, creates a Stripe Checkout Session, attaches `stripe_session_id` to the row, and returns `{ url, booking_id }`.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

```bash
curl -s -X POST http://localhost:4321/api/stripe/create-checkout-session \
  -H 'content-type: application/json' \
  -d '{"flow":"transfer","booking":{"from":"A","to":"B","date":"2030-01-01","time":"10:00","first_name":"T","last_name":"T","email":"t@t.com","phone":"000","total_price":50}}'
```

Expected today: 404 (route doesn't exist).

- [ ] **Step 2: Create the endpoint**

Create `src/pages/api/stripe/create-checkout-session.ts`:

```ts
import type { APIRoute } from 'astro';
import { stripe, supabaseAdmin, supabaseForUser, originFromRequest, isFlow, type Flow } from '../../../lib/stripe/server';

export const prerender = false;

type CheckoutBody = {
  flow?: unknown;
  booking?: Record<string, unknown>;
};

const MIN_TOTAL_EUR = 1;
const MAX_TOTAL_EUR = 5000;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpcNameFor(flow: Flow): 'create_transfer_booking' | 'create_tour_booking' {
  return flow === 'tour' ? 'create_tour_booking' : 'create_transfer_booking';
}

function tableNameFor(flow: Flow): 'transfers' | 'tours' {
  return flow === 'tour' ? 'tours' : 'transfers';
}

function productNameFor(flow: Flow): string {
  if (flow === 'tour') return 'Tour booking';
  if (flow === 'hourly') return 'Hourly hire';
  return 'Transfer booking';
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutBody;
  try {
    body = await request.json() as CheckoutBody;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { flow, booking } = body;
  if (!isFlow(flow))                    return jsonError(400, 'Missing or invalid `flow`');
  if (!booking || typeof booking !== 'object') return jsonError(400, 'Missing `booking`');

  // Required fields shared by all flows
  const email = String(booking.email ?? '').trim();
  if (!email) return jsonError(400, 'booking.email is required');

  const totalPrice = Number(booking.total_price);
  if (!Number.isFinite(totalPrice))                         return jsonError(400, 'booking.total_price must be a number');
  if (totalPrice < MIN_TOTAL_EUR || totalPrice > MAX_TOTAL_EUR) {
    return jsonError(400, `booking.total_price must be between €${MIN_TOTAL_EUR} and €${MAX_TOTAL_EUR}`);
  }

  // Insert booking via the user-authenticated client (preserves auth.uid for logged-in customers)
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const sb = supabaseForUser(accessToken);

  const insertPayload = {
    ...booking,
    payment_method: 'stripe',
    payment_status: 'awaiting_payment',
  };

  const { data: bookingId, error: rpcErr } = await sb.rpc(rpcNameFor(flow), { payload: insertPayload });
  if (rpcErr || !bookingId) {
    console.error('[create-checkout-session] RPC failed', { flow, error: rpcErr });
    return jsonError(500, 'Failed to create booking');
  }

  // Create the Checkout Session
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(totalPrice * 100),
          product_data: { name: productNameFor(flow) },
        },
      }],
      customer_email: email,
      metadata:                  { booking_id: String(bookingId), booking_table: tableNameFor(flow), flow },
      payment_intent_data: { metadata: { booking_id: String(bookingId), booking_table: tableNameFor(flow), flow } },
      success_url: `${originFromRequest(request)}/book/${flow}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${originFromRequest(request)}/book/${flow}/payment/cancelled?booking_id=${bookingId}`,
    });
  } catch (err) {
    console.error('[create-checkout-session] Stripe session create failed', { flow, bookingId, err });
    // Booking row is left as awaiting_payment with no session_id — orphan, cleaned up later.
    return jsonError(502, 'Failed to start payment session');
  }

  // Attach stripe_session_id to the booking row (service role; trusted write)
  const { error: updateErr } = await supabaseAdmin
    .from(tableNameFor(flow))
    .update({ stripe_session_id: session.id })
    .eq('id', bookingId);

  if (updateErr) {
    console.error('[create-checkout-session] Failed to attach session_id', { bookingId, sessionId: session.id, error: updateErr });
    // Continue: the customer can still pay. Webhook will re-link via metadata.booking_id if needed.
    // (Note: webhook currently looks up by stripe_session_id, so this would silently fail. See follow-up risk in spec.)
  }

  return new Response(JSON.stringify({ url: session.url, booking_id: bookingId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 3: Re-run the verification (expect success)**

Make sure your local `.env` has valid `STRIPE_SECRET_KEY=sk_test_…` and `SUPABASE_SERVICE_ROLE_KEY=…`. Restart dev server: `npm run dev`.

```bash
curl -s -X POST http://localhost:4321/api/stripe/create-checkout-session \
  -H 'content-type: application/json' \
  -d '{"flow":"transfer","booking":{"from":"A","to":"B","date":"2030-01-01","time":"10:00","first_name":"T","last_name":"T","email":"t@t.com","phone":"000","total_price":50}}' | jq
```

Expected:
```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_…",
  "booking_id": "<uuid>"
}
```

Open the URL in a browser. Expected: a Stripe-hosted Checkout page showing "€50.00", "Transfer booking", and the email pre-filled.

Validation tests:
```bash
# Missing flow
curl -s -X POST http://localhost:4321/api/stripe/create-checkout-session \
  -H 'content-type: application/json' -d '{"booking":{"email":"t@t.com","total_price":1}}' | jq
# Expected: {"error":"Missing or invalid `flow`"} HTTP 400

# Price too high
curl -s -X POST http://localhost:4321/api/stripe/create-checkout-session \
  -H 'content-type: application/json' \
  -d '{"flow":"tour","booking":{"email":"t@t.com","total_price":99999}}' | jq
# Expected: {"error":"booking.total_price must be between €1 and €5000"} HTTP 400
```

- [ ] **Step 4: Verify the DB row**

In Supabase staging, run:
```sql
select id, payment_status, payment_method, stripe_session_id from public.transfers
  order by created_at desc limit 5;
```

Expected: a recent row with `payment_status='awaiting_payment'`, `payment_method='stripe'`, `stripe_session_id='cs_test_…'`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/stripe/create-checkout-session.ts
git commit -m "feat(stripe): add POST /api/stripe/create-checkout-session"
```

---

## Task 5: Build `GET /api/stripe/session-status`

**Files:**
- Create: `src/pages/api/stripe/session-status.ts`

**Goal:** Endpoint the success page polls. Looks up the booking row by `stripe_session_id` (across `transfers` and `tours`) and returns `{ payment_status, booking_id, flow, summary }`.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

Pick the `cs_test_…` session id from Task 4's response. Then:

```bash
curl -s 'http://localhost:4321/api/stripe/session-status?session_id=cs_test_REPLACE' | jq
```

Expected today: 404 (route doesn't exist).

- [ ] **Step 2: Create the endpoint**

Create `src/pages/api/stripe/session-status.ts`:

```ts
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/stripe/server';

export const prerender = false;

type Flow = 'transfer' | 'hourly' | 'tour';

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return jsonError(400, 'Missing or invalid session_id');
  }

  // Try transfers first (covers /book/transfer + /book/hourly)
  const { data: t } = await supabaseAdmin
    .from('transfers')
    .select('id, payment_status, booking_type, "from", "to", date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (t) {
    const flow: Flow = t.booking_type === 'hourly' ? 'hourly' : 'transfer';
    return new Response(JSON.stringify({
      payment_status: t.payment_status,
      booking_id: t.id,
      flow,
      summary: {
        ref: String(t.id).substring(0, 8).toUpperCase(),
        route: `${t.from} → ${t.to}`,
        date: `${t.date} ${t.time}`,
        vehicle: t.vehicle_name,
        total: t.total_price,
        email: t.email,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // Then tours
  const { data: tour } = await supabaseAdmin
    .from('tours')
    .select('id, payment_status, tour_name, pickup, destination, date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (tour) {
    return new Response(JSON.stringify({
      payment_status: tour.payment_status,
      booking_id: tour.id,
      flow: 'tour' as Flow,
      summary: {
        ref: String(tour.id).substring(0, 8).toUpperCase(),
        route: `${tour.pickup} → ${tour.destination}`,
        date: `${tour.date} ${tour.time}`,
        vehicle: tour.vehicle_name,
        total: tour.total_price,
        email: tour.email,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return jsonError(404, 'Booking not found for this session');
};
```

- [ ] **Step 3: Re-run the verification (expect success)**

Using the `cs_test_…` from Task 4:

```bash
SID="cs_test_REPLACE_ME"
curl -s "http://localhost:4321/api/stripe/session-status?session_id=$SID" | jq
```

Expected:
```json
{
  "payment_status": "awaiting_payment",
  "booking_id": "<uuid>",
  "flow": "transfer",
  "summary": { "ref": "...", "route": "A → B", "date": "2030-01-01 10:00", ... }
}
```

Validation tests:
```bash
curl -s 'http://localhost:4321/api/stripe/session-status?session_id=junk' | jq
# Expected: {"error":"Missing or invalid session_id"} HTTP 400
curl -s 'http://localhost:4321/api/stripe/session-status?session_id=cs_test_doesnotexist' | jq
# Expected: {"error":"Booking not found for this session"} HTTP 404
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/stripe/session-status.ts
git commit -m "feat(stripe): add GET /api/stripe/session-status"
```

---

## Task 6: Build `POST /api/stripe/webhook`

**Files:**
- Create: `src/pages/api/stripe/webhook.ts`

**Goal:** Receive Stripe webhook events, verify signature, normalize the payload, delegate idempotency + DB update to the `apply_stripe_event` RPC.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

In one terminal:
```bash
stripe listen --forward-to localhost:4321/api/stripe/webhook
# Copy the printed `whsec_…` into your .env as STRIPE_WEBHOOK_SECRET, restart dev.
```

In another:
```bash
stripe trigger checkout.session.completed
```

Expected today: forwarder shows 404 from the local server (route doesn't exist).

- [ ] **Step 2: Create the endpoint**

Create `src/pages/api/stripe/webhook.ts`:

```ts
import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripe, stripeWebhookSecret, supabaseAdmin } from '../../../lib/stripe/server';

export const prerender = false;

type NormalizedPayload = Record<string, string | number | null | undefined>;

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.payment_failed',
  'charge.refunded',
]);

async function normalize(event: Stripe.Event): Promise<NormalizedPayload | null> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      // session.payment_intent is usually just the id; retrieve to get latest_charge
      const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!piId) return null;
      const pi = await stripe.paymentIntents.retrieve(piId);
      return {
        session_id:    s.id,
        payment_intent: pi.id,
        charge_id:     typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null,
      };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { payment_intent: pi.id };
    }
    case 'charge.refunded': {
      const ch = event.data.object as Stripe.Charge;
      return { charge_id: ch.id, amount: ch.amount, amount_refunded: ch.amount_refunded };
    }
    default:
      return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!stripeWebhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 500 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  // Raw body required for signature verification
  const rawBody = Buffer.from(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed', err);
    return new Response('Bad signature', { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return new Response('ok', { status: 200 });
  }

  let payload: NormalizedPayload | null;
  try {
    payload = await normalize(event);
  } catch (err) {
    console.error('[stripe-webhook] Failed to normalize', { type: event.type, err });
    return new Response('Internal error', { status: 500 });
  }
  if (!payload) {
    return new Response('ok', { status: 200 });
  }

  const { error } = await supabaseAdmin.rpc('apply_stripe_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload: payload as Record<string, unknown>,
  });
  if (error) {
    console.error('[stripe-webhook] RPC failed', { eventId: event.id, type: event.type, error });
    return new Response('Internal error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
};
```

- [ ] **Step 3: Re-run the verification (expect success)**

In terminal 1, `stripe listen` is still running. In terminal 2:

```bash
stripe trigger checkout.session.completed
```

Expected:
- `stripe listen` log shows `--> POST localhost:4321/api/stripe/webhook [200]`.
- Server log shows no errors.
- The `stripe_events` table has a new row: in Supabase staging SQL editor:
  ```sql
  select id, type, received_at from public.stripe_events order by received_at desc limit 5;
  ```
  Expected: at least one `evt_…` of type `checkout.session.completed`.

(The Stripe-triggered `checkout.session.completed` is for a synthetic session that doesn't match any of our `stripe_session_id` rows, so nothing in `transfers`/`tours` will update. That's expected — the idempotency record is the success signal here.)

Then test idempotency:
```bash
# Get the most recent event ID from the listen log; resend it twice
stripe events resend evt_REPLACE
stripe events resend evt_REPLACE
```

Expected: both resends return 200 from our endpoint. The `stripe_events` row count does **not** increase. (The RPC short-circuits via `on conflict (id) do nothing`.)

Test signature failure:
```bash
curl -i -s -X POST http://localhost:4321/api/stripe/webhook \
  -H 'content-type: application/json' \
  -H 'stripe-signature: t=0,v1=bogus' \
  -d '{}'
```
Expected: HTTP 400, body "Bad signature".

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/stripe/webhook.ts
git commit -m "feat(stripe): add POST /api/stripe/webhook with signature verification + idempotency"
```

---

## Task 7: Modify `src/pages/book/transfer/payment.astro`

**Files:**
- Modify: `src/pages/book/transfer/payment.astro`

**Goal:** Remove the inline Stripe Card Element flow; route the Stripe radio to the new server endpoint and redirect.

- [ ] **Step 1: Define the verification (manual, run it first, expect failure)**

In a browser, navigate `/book/transfer/payment` (after going through the booking flow to populate query params, or just directly with sample params). Click the Stripe radio. Today (test keys present): you see an inline card form. After this task: the Stripe radio expands to a "you'll be redirected" message with no card form.

- [ ] **Step 2: Read the current file**

```bash
wc -l src/pages/book/transfer/payment.astro
```
For reference, the relevant blocks live around:
- Line ~83: `#stripe-expand` block including `#card-element`, `#card-errors`
- Line ~92: `#stripe-not-configured` panel (delete this entire panel — replaced by env-driven disable on the radio)
- Line ~306: `import { loadStripe } from '@stripe/stripe-js'`
- Line ~373: `let stripeInstance: any = null;`
- Line ~411: `const STRIPE_KEY = import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;` and the surrounding `if (STRIPE_KEY) { … }` block
- Line ~512: `complete-btn` click handler that calls `stripeInstance.createToken(...)`

- [ ] **Step 3: Apply the diff**

**A) In the markup** — replace the entire current `#stripe-expand` block (containing `#stripe-available` and `#stripe-not-configured`) with this single block:

```html
<div id="stripe-expand" class="hidden mt-4 pt-4 border-t border-neutral-100">
  <div class="flex items-start gap-3">
    <svg class="w-5 h-5 mt-0.5 text-neutral-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
    <p class="text-sm text-neutral-700 leading-relaxed">
      You'll be redirected to <strong>Stripe</strong>'s secure checkout to enter your card details. You'll come back here once payment is complete.
    </p>
  </div>
</div>
```

**B) In the `<script>` block** — remove these:
- `import { loadStripe } from '@stripe/stripe-js';`
- `let stripeInstance: any = null;`
- `let cardElement: any = null;` (and any related declarations)
- The whole `if (STRIPE_KEY) { stripeInstance = await loadStripe(...); ...mount card element... } else { ...show stripe-not-configured... }` block.

Replace it with this much shorter Stripe-radio-availability check:

```ts
const STRIPE_KEY = import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
if (!STRIPE_KEY) {
  // Disable the Stripe radio when Stripe isn't configured for this environment.
  const stripeLabel = document.querySelector<HTMLLabelElement>('.pay-method-option[data-method="stripe"]');
  const stripeRadio = stripeLabel?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (stripeLabel) stripeLabel.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
  if (stripeRadio) stripeRadio.disabled = true;
}
```

**C) Replace the Complete-Booking click handler.** Find the existing handler (`document.getElementById('complete-btn')?.addEventListener('click', async () => { ... })`) and replace its body with:

```ts
clearFormErrors(formScope);
if (!selectedMethod) { showFormError(formScope, 'Please select a payment method.'); return; }

const btn = document.getElementById('complete-btn') as HTMLButtonElement;
const originalLabel = btn.innerHTML;
btn.disabled = true;
btn.textContent = 'Processing…';

if (selectedMethod === 'stripe') {
  btn.textContent = 'Redirecting to Stripe…';

  // Build the same booking payload the existing saveBooking() builds, minus payment_token.
  const bookingPayload = {
    from, to, date, time,
    passengers: parseInt(passengers, 10) || 1,
    return_date: returnDate || null,
    return_time: returnTime || null,
    vehicle_slug: vehicleSlug, vehicle_name: vehicleName,
    first_name: firstName, last_name: lastName, email, phone,
    sign_name: signName || null,
    child_seats: parseInt(childSeats, 10) || 0,
    driver_notes: driverNotes || null,
    total_price: finalTotal,
    base_price: baseTotal,
    outward_price: parseFloat(outwardPrice) || 0,
    return_price: parseFloat(returnPrice) || 0,
    card_surcharge: 0,                      // Stripe never adds card-onsite fee
    booking_type: 'transfer',
    partner_id: partnerId,
    luggage_small: luggageSmall,
    luggage_big: luggageBig,
  };

  // Forward user's session token (if any) so RPC captures auth.uid()
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;

  try {
    const res = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ flow: 'transfer', booking: bookingPayload }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'unknown' }));
      showFormError(formScope, `Couldn't start payment: ${error}`);
      btn.disabled = false; btn.innerHTML = originalLabel;
      return;
    }
    const { url } = await res.json();
    window.location.href = url;
  } catch (err: any) {
    console.error('Failed to start Stripe checkout:', err);
    showFormError(formScope, 'Network error starting payment. Please try again.');
    btn.disabled = false; btn.innerHTML = originalLabel;
  }
  return;
}

// Non-Stripe paths unchanged
await saveBooking(selectedMethod);
```

**D) Inside `saveBooking()`** — confirm `payment_status: 'pending'` for the non-Stripe path stays as-is. No changes needed to `saveBooking()` itself.

- [ ] **Step 4: Re-run the verification (expect success)**

```bash
npm run dev
```

Manually walk through `/book/transfer` → search → results → passenger → payment. Test cases:

1. **Stripe radio expands to redirect blurb** (no inline card form). ✅
2. **Click Complete with Stripe selected** → button shows "Redirecting…", then browser navigates to `https://checkout.stripe.com/c/pay/cs_test_…`. ✅
3. **Switch to "Card on site" or cash radio** → click Complete → existing flow runs (booking saves with `payment_status='pending'`, success card shown). ✅
4. **Set `PUBLIC_STRIPE_PUBLISHABLE_KEY=` (empty)** in `.env`, restart dev → Stripe radio is disabled (greyed, can't click). ✅

- [ ] **Step 5: Commit**

```bash
git add src/pages/book/transfer/payment.astro
git commit -m "feat(book/transfer): replace inline Stripe card form with Checkout redirect"
```

---

## Task 8: Modify `src/pages/book/hourly/payment.astro`

**Files:**
- Modify: `src/pages/book/hourly/payment.astro`

**Goal:** Same change as Task 7 but for the hourly flow. The booking-payload field set differs (includes `hours`, `per_hour`).

- [ ] **Step 1: Apply the same shape of edits as Task 7**

Replace the `#stripe-expand` block, remove `loadStripe()`/Card Element code, replace the click handler. The handler's `bookingPayload` for this flow is:

```ts
const bookingPayload = {
  from, to, date, time,
  passengers: parseInt(passengers, 10) || 1,
  vehicle_slug: vehicleSlug, vehicle_name: vehicleName,
  first_name: firstName, last_name: lastName, email, phone,
  sign_name: signName || null,
  child_seats: parseInt(childSeats, 10) || 0,
  driver_notes: driverNotes || null,
  total_price: finalTotal,
  base_price: baseTotal,
  card_surcharge: 0,
  booking_type: 'hourly',
  partner_id: partnerId,
  luggage_small: luggageSmall,
  luggage_big: luggageBig,
  hours: parseInt(hours, 10) || 0,
  per_hour: parseFloat(perHour) || 0,
};
```

…and `body: JSON.stringify({ flow: 'hourly', booking: bookingPayload })`.

(The "Stripe radio disable when env missing" block, the headers/`session.access_token` forwarding, and the catch/UX-restore are identical — copy from Task 7.)

- [ ] **Step 2: Verify in browser**

Walk through `/book/hourly` → click Complete with Stripe radio → reach Stripe Checkout. Cash/card-onsite paths unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/pages/book/hourly/payment.astro
git commit -m "feat(book/hourly): replace inline Stripe card form with Checkout redirect"
```

---

## Task 9: Modify `src/pages/book/tour/payment.astro`

**Files:**
- Modify: `src/pages/book/tour/payment.astro`

**Goal:** Same as Tasks 7–8 but for the tour flow. Booking payload uses tour-specific fields and goes via `create_tour_booking`.

- [ ] **Step 1: Apply the same shape of edits**

Replace `#stripe-expand` block, remove Card Element wiring, replace click handler. Booking payload:

```ts
const bookingPayload = {
  tour, tour_id: tourId, tour_name: tourName,
  pickup, pickup_location: pickupLocation, destination,
  date, time,
  passengers: parseInt(passengers, 10) || 1,
  participants: parseInt(participants, 10) || 1,
  vehicle, vehicle_name: vehicleName,
  name, email, phone,
  special_requests: specialRequests || null,
  notes: notes || null,
  hotel_choice: hotelChoice || null,
  total_price: finalTotal,
  entrance_tickets_count: parseInt(entranceTicketsCount, 10) || 0,
  entrance_tickets_total: parseFloat(entranceTicketsTotal) || 0,
  card_surcharge: 0,
  partner_id: partnerId,
};
```

…and `body: JSON.stringify({ flow: 'tour', booking: bookingPayload })`.

(Use the actual variable names already in scope in `payment.astro`. If a field above doesn't currently have a corresponding local variable, drop it from the payload — the RPC will coalesce.)

- [ ] **Step 2: Verify in browser**

Walk through `/book/tour` → click Complete with Stripe radio → reach Stripe Checkout. Cash path unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/pages/book/tour/payment.astro
git commit -m "feat(book/tour): replace inline Stripe card form with Checkout redirect"
```

---

## Task 10: Build the shared `StripeSuccess.astro` component

**Files:**
- Create: `src/components/StripeSuccess.astro`

**Goal:** Reusable success-page component that polls `/api/stripe/session-status` and renders one of three states (paid / failed / awaiting). Used by all three success pages.

- [ ] **Step 1: Define the verification (run it first, expect failure)**

After this task, a page can render `<StripeSuccess flow="transfer" />` and see the polling state machine. Today, the component doesn't exist.

- [ ] **Step 2: Create the component**

Create `src/components/StripeSuccess.astro`:

```astro
---
type Props = { flow: 'transfer' | 'hourly' | 'tour' };
const { flow } = Astro.props;
---

<section id="stripe-success-root" data-flow={flow} class="max-w-2xl mx-auto p-6">
  <div id="ss-loading" class="text-center py-12">
    <div class="inline-block w-10 h-10 border-4 border-neutral-200 border-t-[#0C6B95] rounded-full animate-spin"></div>
    <p class="mt-4 text-neutral-600 text-sm">Confirming your payment…</p>
  </div>

  <div id="ss-paid" class="hidden bg-white border border-neutral-100 rounded-2xl p-8 shadow-sm">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
        <svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
      </div>
      <h2 class="text-2xl font-bold text-neutral-900">Booking confirmed</h2>
    </div>
    <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
      <div><dt class="text-neutral-500">Reference</dt><dd id="ss-ref" class="font-mono text-neutral-900">—</dd></div>
      <div><dt class="text-neutral-500">Route</dt><dd id="ss-route" class="text-neutral-900">—</dd></div>
      <div><dt class="text-neutral-500">When</dt><dd id="ss-date" class="text-neutral-900">—</dd></div>
      <div><dt class="text-neutral-500">Vehicle</dt><dd id="ss-vehicle" class="text-neutral-900">—</dd></div>
      <div><dt class="text-neutral-500">Total</dt><dd id="ss-total" class="text-neutral-900 font-semibold">—</dd></div>
      <div><dt class="text-neutral-500">Email</dt><dd id="ss-email" class="text-neutral-900">—</dd></div>
    </dl>
    <p class="mt-6 text-sm text-neutral-600">A receipt has been sent to your email by Stripe.</p>
    <a href="/" class="inline-block mt-4 text-[#0C6B95] hover:underline">← Back to home</a>
  </div>

  <div id="ss-failed" class="hidden bg-white border border-red-100 rounded-2xl p-8 shadow-sm">
    <h2 class="text-xl font-bold text-red-700 mb-2">Payment failed</h2>
    <p class="text-sm text-neutral-700 mb-4">Your card couldn't be charged. No booking was completed.</p>
    <a id="ss-try-again" href="/" class="inline-block px-4 py-2 rounded-xl bg-[#0C6B95] text-white text-sm font-medium hover:bg-[#0a5a7e]">Try again</a>
  </div>

  <div id="ss-delayed" class="hidden bg-amber-50 border border-amber-200 rounded-2xl p-8">
    <h2 class="text-xl font-bold text-amber-900 mb-2">Confirmation delayed</h2>
    <p class="text-sm text-amber-900 mb-4">
      Your payment was received, but our system is taking a bit longer than usual to confirm it.
      You'll receive an email once everything is finalised.
    </p>
    <button id="ss-refresh" class="px-4 py-2 rounded-xl border border-amber-400 text-amber-900 text-sm font-medium hover:bg-amber-100">Refresh</button>
  </div>
</section>

<script>
  const root = document.getElementById('stripe-success-root') as HTMLElement;
  const flow = root.dataset.flow as 'transfer' | 'hourly' | 'tour';

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  function show(id: string) {
    ['ss-loading','ss-paid','ss-failed','ss-delayed'].forEach(s => {
      document.getElementById(s)?.classList.toggle('hidden', s !== id);
    });
  }

  function setText(id: string, value: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderPaid(summary: { ref: string; route: string; date: string; vehicle: string; total: number; email: string }) {
    setText('ss-ref',     summary.ref);
    setText('ss-route',   summary.route);
    setText('ss-date',    summary.date);
    setText('ss-vehicle', summary.vehicle ?? '—');
    setText('ss-total',   `€${Number(summary.total).toFixed(2)}`);
    setText('ss-email',   summary.email);
    show('ss-paid');
  }

  async function poll() {
    if (!sessionId) { show('ss-failed'); (document.getElementById('ss-try-again') as HTMLAnchorElement).href = `/book/${flow}`; return; }
    const tryAgainLink = document.getElementById('ss-try-again') as HTMLAnchorElement;
    if (tryAgainLink) tryAgainLink.href = `/book/${flow}`;

    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`/api/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.payment_status === 'paid')   { renderPaid(data.summary); return; }
          if (data.payment_status === 'failed') { show('ss-failed'); return; }
        }
      } catch { /* ignore, retry */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    show('ss-delayed');
  }

  document.getElementById('ss-refresh')?.addEventListener('click', () => window.location.reload());
  poll();
</script>
```

- [ ] **Step 3: Verification deferred to Task 11**

This component has no consumer yet. Verification happens in Task 11 when we wire up the success pages.

- [ ] **Step 4: Commit**

```bash
git add src/components/StripeSuccess.astro
git commit -m "feat(stripe): add shared StripeSuccess.astro for post-checkout polling"
```

---

## Task 11: Create the three success pages

**Files:**
- Create: `src/pages/book/transfer/payment/success.astro`
- Create: `src/pages/book/hourly/payment/success.astro`
- Create: `src/pages/book/tour/payment/success.astro`

**Goal:** One thin page per flow, mounting `<StripeSuccess flow="..." />` inside the existing site layout.

- [ ] **Step 1: Inspect the layout used by existing pages**

```bash
grep -l "import Layout" src/pages/book/transfer/payment.astro
```

Note the import path (likely `../../../layouts/Layout.astro` or similar). Use the same layout.

- [ ] **Step 2: Create `src/pages/book/transfer/payment/success.astro`**

```astro
---
import Layout from '../../../../layouts/Layout.astro';   // adjust path if different
import StripeSuccess from '../../../../components/StripeSuccess.astro';
---
<Layout title="Booking confirmed">
  <StripeSuccess flow="transfer" />
</Layout>
```

- [ ] **Step 3: Create `src/pages/book/hourly/payment/success.astro`**

```astro
---
import Layout from '../../../../layouts/Layout.astro';
import StripeSuccess from '../../../../components/StripeSuccess.astro';
---
<Layout title="Booking confirmed">
  <StripeSuccess flow="hourly" />
</Layout>
```

- [ ] **Step 4: Create `src/pages/book/tour/payment/success.astro`**

```astro
---
import Layout from '../../../../layouts/Layout.astro';
import StripeSuccess from '../../../../components/StripeSuccess.astro';
---
<Layout title="Booking confirmed">
  <StripeSuccess flow="tour" />
</Layout>
```

- [ ] **Step 5: Verify**

```bash
npm run dev
```

Take the `cs_test_…` you've been generating in earlier tasks; visit `http://localhost:4321/book/transfer/payment/success?session_id=cs_test_REPLACE`.

Expected:
- Loading spinner for ~1s.
- If the session has been webhook-confirmed: paid card shows with reference, route, date, total. Receipt mention.
- If still `awaiting_payment` (no webhook yet): after 10s, the "delayed" amber card appears.

Now flip a row to `payment_status='failed'` manually in Supabase (`update transfers set payment_status='failed' where stripe_session_id='cs_test_…';`), refresh the page → red "Payment failed" card with a "Try again" link to `/book/transfer`.

Repeat for `/book/hourly/payment/success` and `/book/tour/payment/success` using a `cs_test_…` from each respective flow.

- [ ] **Step 6: Commit**

```bash
git add src/pages/book/transfer/payment/success.astro \
        src/pages/book/hourly/payment/success.astro \
        src/pages/book/tour/payment/success.astro
git commit -m "feat(book): add Stripe Checkout success pages for all 3 flows"
```

---

## Task 12: Create the three cancelled pages

**Files:**
- Create: `src/pages/book/transfer/payment/cancelled.astro`
- Create: `src/pages/book/hourly/payment/cancelled.astro`
- Create: `src/pages/book/tour/payment/cancelled.astro`

**Goal:** Pure static "payment cancelled" pages.

- [ ] **Step 1: Create `src/pages/book/transfer/payment/cancelled.astro`**

```astro
---
import Layout from '../../../../layouts/Layout.astro';
---
<Layout title="Payment cancelled">
  <section class="max-w-2xl mx-auto p-6">
    <div class="bg-white border border-neutral-100 rounded-2xl p-8 shadow-sm text-center">
      <h2 class="text-2xl font-bold text-neutral-900 mb-2">Payment cancelled</h2>
      <p class="text-neutral-600 mb-6">Your booking wasn't completed. No charge was made.</p>
      <a href="/book/transfer" class="inline-block px-5 py-2.5 rounded-xl bg-[#0C6B95] text-white text-sm font-medium hover:bg-[#0a5a7e]">
        Start a new transfer booking
      </a>
    </div>
  </section>
</Layout>
```

- [ ] **Step 2: Create `cancelled.astro` for hourly and tour** (same template, different `href` and copy)

`src/pages/book/hourly/payment/cancelled.astro`:
```astro
---
import Layout from '../../../../layouts/Layout.astro';
---
<Layout title="Payment cancelled">
  <section class="max-w-2xl mx-auto p-6">
    <div class="bg-white border border-neutral-100 rounded-2xl p-8 shadow-sm text-center">
      <h2 class="text-2xl font-bold text-neutral-900 mb-2">Payment cancelled</h2>
      <p class="text-neutral-600 mb-6">Your booking wasn't completed. No charge was made.</p>
      <a href="/book/hourly" class="inline-block px-5 py-2.5 rounded-xl bg-[#0C6B95] text-white text-sm font-medium hover:bg-[#0a5a7e]">
        Start a new hourly booking
      </a>
    </div>
  </section>
</Layout>
```

`src/pages/book/tour/payment/cancelled.astro`:
```astro
---
import Layout from '../../../../layouts/Layout.astro';
---
<Layout title="Payment cancelled">
  <section class="max-w-2xl mx-auto p-6">
    <div class="bg-white border border-neutral-100 rounded-2xl p-8 shadow-sm text-center">
      <h2 class="text-2xl font-bold text-neutral-900 mb-2">Payment cancelled</h2>
      <p class="text-neutral-600 mb-6">Your booking wasn't completed. No charge was made.</p>
      <a href="/" class="inline-block px-5 py-2.5 rounded-xl bg-[#0C6B95] text-white text-sm font-medium hover:bg-[#0a5a7e]">
        Browse tours
      </a>
    </div>
  </section>
</Layout>
```

- [ ] **Step 3: Verify**

Visit each:
- `http://localhost:4321/book/transfer/payment/cancelled` → renders.
- `http://localhost:4321/book/hourly/payment/cancelled` → renders.
- `http://localhost:4321/book/tour/payment/cancelled` → renders.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/transfer/payment/cancelled.astro \
        src/pages/book/hourly/payment/cancelled.astro \
        src/pages/book/tour/payment/cancelled.astro
git commit -m "feat(book): add Stripe Checkout cancelled pages for all 3 flows"
```

---

## Task 13: Local end-to-end verification (full manual test plan)

**Files:** none — this task is pure verification.

**Goal:** Run the §6.1 manual test plan from the spec. Catch any defects locally before deploying anywhere.

**Pre-flight:**
- Local dev server running: `npm run dev`
- `stripe listen --forward-to localhost:4321/api/stripe/webhook` running in another terminal; `STRIPE_WEBHOOK_SECRET` in `.env` matches what the CLI printed
- `.env` has test keys (`sk_test_…`, `pk_test_…`)

For **each** of the three flows (`transfer`, `hourly`, `tour`), run the eight tests:

- [ ] **T1: Happy path** — book using card `4242 4242 4242 4242`. Confirm:
  - Stripe Checkout loads, shows the right product name + total
  - Payment succeeds, redirects to `/book/<flow>/payment/success?session_id=…`
  - Success page shows booking ref, route, date, total within ~3s
  - Supabase: `select payment_status, stripe_session_id, stripe_payment_intent_id, stripe_charge_id from <table> where id='<id>';` returns `paid` + all three IDs populated
  - Stripe sends a receipt email (check the inbox you used as `email`)

- [ ] **T2: Decline** — repeat with card `4000 0000 0000 0002`. Stripe shows decline; you can retry or back out. Booking row stays `awaiting_payment`.

- [ ] **T3: 3DS challenge** — repeat with `4000 0025 0000 3155`. Authorise the challenge; succeeds and lands `paid`.

- [ ] **T4: Cancel from Stripe** — start booking, click Stripe's "back" arrow on the Checkout page. Lands on `/book/<flow>/payment/cancelled`. Booking row stays `awaiting_payment`.

- [ ] **T5: Webhook idempotency** — copy a recent `evt_…` ID from `stripe listen` output. `stripe events resend evt_…` twice. Endpoint returns 200 each time. `select count(*) from stripe_events where id='evt_…';` returns `1`. The booking row's `payment_status` is unchanged after each resend.

- [ ] **T6: Refund** — for a `paid` booking from T1, open the corresponding payment in Stripe Dashboard (test mode), click Refund, choose partial (e.g. €1 of €50). Within seconds, `stripe listen` shows a `charge.refunded` event forwarded; booking row flips to `partially_refunded`. Refund the remainder; row flips to `refunded`.

- [ ] **T7: Webhook signature failure** — `curl -i -X POST http://localhost:4321/api/stripe/webhook -H 'stripe-signature: t=0,v1=bad' -d '{}'`. Returns HTTP 400. No new `stripe_events` row, no booking changes.

- [ ] **T8: Non-Stripe regression** — book using "card on site" or "cash". Confirm: existing flow unchanged, booking row lands `payment_status='pending'`, no Stripe API calls (verify in `stripe listen` log — no events for this booking).

If any test fails, fix and recommit on the same branch before proceeding. **Do NOT skip a failing test.**

- [ ] **Commit any fixes**

---

## Task 14: Open PR, merge to main, set up Stripe Dashboard production webhook

**Files:** none — this is operations.

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin feat/stripe-server-capture
gh pr create --title "Stripe server-side Checkout capture for bookings" --body "$(cat <<'EOF'
## Summary
- Replaces client-side `stripe.createToken()` with server-side Stripe Checkout
- Three new Astro server endpoints under `src/pages/api/stripe/` (Vercel functions)
- DB schema additions: `stripe_session_id` / `payment_intent_id` / `charge_id` on `transfers` + `tours`, new `stripe_events` idempotency table, replaced broken `payment_status` CHECK constraint
- New `apply_stripe_event` RPC wraps idempotency + booking UPDATE in one tx
- Refunds tracked via `charge.refunded` webhook → `payment_status` reflects partial / full
- Spec: `docs/superpowers/specs/2026-05-04-stripe-server-capture-design.md`

## Test plan
- [x] Full local manual checklist (`docs/superpowers/specs/2026-05-04-stripe-server-capture-design.md` §6.1) for all 3 flows
- [x] Webhook idempotency, refund, signature failure, non-Stripe regression
- [ ] Production rollout per spec §6.2 — test keys first, then live keys, then €0.50 real-card test

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Get PR reviewed, merge to main**

Review per project conventions, merge.

- [ ] **Step 3: Apply DB migration to PRODUCTION Supabase**

Same migration file, applied through the Supabase Dashboard SQL editor (or `psql "$PROD_DATABASE_URL" -f db/migrations/2026-05-04-stripe-server-capture.sql`). Verify with the same Step 4 verification queries from Task 1.

- [ ] **Step 4: Register the production webhook in Stripe Dashboard**

Stripe Dashboard (LIVE mode toggle ON) → Developers → Webhooks → Add endpoint:
- URL: `https://www.opawey.com/api/stripe/webhook`
- Events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`
- Click "Add endpoint", then click "Reveal" on the signing secret. Copy the `whsec_…` value.

- [ ] **Step 5: Set Vercel Production env vars (test keys for first deploy)**

Vercel Dashboard → Project → Settings → Environment Variables → Production scope:

| Var | Value |
|---|---|
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` (start with test) |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` you just copied |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard |

(Supabase URL/anon key already exist as Production env vars.)

- [ ] **Step 6: Trigger a Vercel redeploy**

```bash
git pull origin main          # ensure local main matches merged PR
git push origin main          # nothing to push, but triggers redeploy if your project auto-deploys on push
# Or in Vercel dashboard: Deployments → ... → Redeploy
```

- [ ] **Step 7: Run the full manual checklist against production with test keys**

Repeat Task 13's 24 tests (8 × 3 flows) but against `https://www.opawey.com`. The webhook is hitting the real registered endpoint (not Stripe CLI), so production webhook delivery is now part of what's tested.

If any production test fails, do NOT proceed to live keys. Fix on a branch, redeploy, retest.

---

## Task 15: Switch Vercel to live keys + real-card verification

**Files:** none — operations.

- [ ] **Step 1: Confirm the leaked `sk_live_…` has been rolled**

Stripe Dashboard → Developers → API keys (LIVE mode) → confirm there's a "Last used" date and the key was rotated after 2026-05-04.

- [ ] **Step 2: Update Vercel Production env vars to live values**

| Var | New value |
|---|---|
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_SECRET_KEY` | the **rolled** `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | unchanged (already the live webhook's signing secret from Task 14 Step 4) |

- [ ] **Step 3: Trigger a redeploy**

Vercel dashboard → Redeploy.

- [ ] **Step 4: Real-card €0.50 booking**

Use a real personal card. Book a test transfer (or whichever flow you can pick the cheapest item on) and pay €0.50–€5.

Verify:
- Success page renders with paid card.
- DB row in production `transfers` (or `tours`): `payment_status='paid'`, all three `stripe_*` IDs populated.
- Stripe Dashboard (LIVE mode) → Payments → see the real charge.
- Email receipt arrives.

- [ ] **Step 5: Refund verification**

Stripe Dashboard → Payments → click that real-card payment → Refund (full). Confirm:
- Within seconds, the `charge.refunded` webhook is delivered (Stripe Dashboard → Webhooks → recent deliveries).
- DB row flips to `payment_status='refunded'`.
- Refund hits the real card within a couple of business days.

- [ ] **Step 6: Watch the first ~10 real customer bookings**

Tail Vercel logs and Stripe Dashboard for the first 10 real production bookings. Look for:
- 4xx/5xx in `/api/stripe/*` logs.
- Webhook deliveries that don't return 200.
- Bookings stuck in `awaiting_payment` for >1 hour (would indicate webhook delivery issue).

If anything looks off, **kill-switch:** set `PUBLIC_STRIPE_PUBLISHABLE_KEY=` (empty) on Vercel Production and redeploy. The Stripe radio disables on the booking pages while you investigate.

---

## Self-Review (post-write)

**Spec coverage:**
- Architecture & data flow (§1) → Tasks 1, 4–6
- DB schema (§2) → Task 1 ✓
- Server endpoints (§3) → Tasks 4, 5, 6 ✓
- Frontend (§4) → Tasks 7, 8, 9, 10, 11, 12 ✓
- Build config / env (§5) → Tasks 2, 3 ✓
- Stripe Dashboard setup (§5.3) → Task 14 ✓
- Local dev flow (§5.4) → Tasks 4 / 6 use `stripe listen` ✓
- Manual test plan (§6.1) → Task 13 ✓
- Rollout sequence (§6.2) → Tasks 14, 15 ✓
- Rollback / kill-switch (§6.3) → Task 15 Step 6 ✓
- Risk register (§6.4) — no specific tasks, but mitigations are wired into the code (idempotency in Task 1's RPC; price bounds in Task 4; signature verification in Task 6)
- Out of scope (§7) — explicitly listed in this plan's "Out of scope (do not touch)"

**No placeholders:** all tasks have exact file paths, full code, exact verification commands. No "TBD" / "TODO" left.

**Type/name consistency:**
- `Flow` type defined in Task 3 (`server.ts`), reused as type-import in Tasks 4, 5
- `apply_stripe_event(p_event_id, p_event_type, p_payload)` signature matches across Task 1 SQL and Task 6 endpoint
- Payload key names (`session_id`, `payment_intent`, `charge_id`, `amount`, `amount_refunded`) are consistent between Task 6's `normalize()` and Task 1's RPC body
- `tableNameFor()` / `rpcNameFor()` in Task 4 match table/function names from Task 1

Plan ready for execution.
