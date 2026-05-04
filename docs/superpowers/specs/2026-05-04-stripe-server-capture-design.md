# Stripe Server-Side Capture (Checkout) for Bookings

**Date:** 2026-05-04
**Status:** Approved — ready for plan
**Scope:** Replace the current client-side `stripe.createToken()` flow with a server-side Stripe Checkout flow that actually charges customer cards. Applies to all three booking flows (`/book/transfer`, `/book/hourly`, `/book/tour`). Non-Stripe payment methods (cash, card-on-site) are left unchanged.

---

## Goal

Today, every booking made with the "Stripe" radio is **tokenized but never charged** — `stripe.createToken(cardElement)` produces a single-use token that's stored on the booking row and (the comment at `src/pages/book/transfer/payment.astro:475-477` says) "an operator captures the saved payment_token from the Stripe dashboard." That manual flow is fragile (Stripe card tokens expire in ~24h, and it requires a human in the loop).

This spec replaces that with a real online-payment flow: the customer is redirected to Stripe-hosted Checkout, payment completes immediately, and a webhook confirms the result back to our DB. Refunds remain a Stripe Dashboard operation; the webhook keeps `payment_status` in sync.

## Background

- **Stack:** Astro 5, fully static (no SSR adapter today), deployed on Vercel. Supabase for DB, with `SECURITY DEFINER` RPCs for guest bookings (`db/migrations/2026-05-04-guest-booking-rpcs.sql`).
- **Three booking tables:** `transfers` (used by `/book/transfer` *and* `/book/hourly`) and `tours` (used by `/book/tour`). Each has its own `payment_status text` column.
- **Existing client wiring:** all three `payment.astro` pages mount `@stripe/stripe-js` Card Element, call `createToken`, then insert via the `create_transfer_booking` / `create_tour_booking` RPC with `payment_status: 'pending'` and the token in `payment_token`.
- **No server-side Stripe code exists** anywhere in the repo — no `STRIPE_SECRET_KEY` reference, no Stripe Node SDK, no API endpoints, no edge functions, no webhook handler.
- **The `sk_live_…` key has already been compromised** (leaked in a chat). It must be rolled in the Stripe Dashboard before any of this code goes live; the rolled value is what gets stored in `STRIPE_SECRET_KEY`.

## Decisions (locked in during brainstorming)

| Question | Decision | Rationale |
|---|---|---|
| Where does the server code live? | **Astro server endpoint on Vercel** (`src/pages/api/stripe/*.ts`) | Same repo, single dev loop, the Vercel adapter + per-route `prerender = false` is a 2-line config change. |
| Custom UI vs hosted page? | **Stripe Checkout** (hosted page, redirect) | ~150 lines of server code total instead of rewriting 3 frontend payment pages; Apple Pay / Google Pay / SCA all handled by Stripe; less compliance surface. |
| Capture timing? | **Charge immediately** on Checkout completion | Card auths expire in ~7 days; bookings can be weeks ahead. Refund-on-cancel is one-click in Stripe. |
| Refund flow? | **Stripe Dashboard only** for now (webhook syncs `payment_status`) | Zero new admin UI; can graduate to in-app later without changing the webhook. |
| Non-Stripe payment options? | **Untouched** — only the Stripe radio gets the new flow | Keeps scope tight. |

---

## 1. Architecture & data flow

```
Browser (payment.astro)
   │  user fills passenger info, picks "Stripe" radio, clicks Complete Booking
   ▼
POST /api/stripe/create-checkout-session    ← new Astro server endpoint
   │  validates input
   │  INSERTs booking row with payment_status='awaiting_payment'
   │  creates Stripe Checkout Session (mode=payment, EUR, line item from booking total)
   │  stores stripe_session_id on the booking row
   │  returns { url, booking_id }
   ▼
Browser redirects to Stripe Checkout (Stripe-hosted page)
   │  user pays
   ▼
Stripe redirects to /book/<flow>/payment/success?session_id=cs_…
   │  client polls /api/stripe/session-status?session_id=…
   │  shows booking confirmation when payment_status='paid'
   │
   │  meanwhile, in parallel: Stripe → POST /api/stripe/webhook
                                  verifies signature
                                  on checkout.session.completed → payment_status='paid'
                                  on charge.refunded            → payment_status='refunded' / 'partially_refunded'
                                  on payment_intent.payment_failed → 'failed'
                                  idempotency: insert event_id into stripe_events; conflict ⇒ skip
```

Cancel path: if the user clicks "back" on Stripe Checkout, Stripe redirects them to `/book/<flow>/payment/cancelled`. The `awaiting_payment` row stays in the DB; user can start a new booking. Cleanup of stale `awaiting_payment` rows is **out of scope** (see §7).

**Key design call:** the booking row is INSERTed *before* redirecting to Stripe, with `payment_status='awaiting_payment'`. The alternative (let the webhook create the row) is cleaner regarding orphans but breaks the success page (it has nothing to show until the webhook fires asynchronously). Pre-insert lets the success page show booking details instantly using the `session_id` lookup.

---

## 2. DB schema changes

New migration file: `db/migrations/2026-05-04-stripe-server-capture.sql`.

### A) New columns on `transfers` and `tours`

```sql
alter table public.transfers
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;

alter table public.tours
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text;
```

### B) Replace the broken `payment_status` CHECK constraint

The current constraint on `transfers` (`supabase-migration.sql:90`) is `in ('pending','paid')`, but `src/pages/driver/ride.astro:461` already writes `'paid_to_driver'` — the constraint is silently being violated, dropped at some point, or only present on a stale migration. Apply a single uniform constraint to both tables:

```sql
alter table public.transfers drop constraint if exists transfers_payment_status_check;
alter table public.transfers add constraint transfers_payment_status_check
  check (payment_status in ('pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'));

alter table public.tours drop constraint if exists tours_payment_status_check;
alter table public.tours add constraint tours_payment_status_check
  check (payment_status in ('pending','awaiting_payment','paid','paid_to_driver','failed','refunded','partially_refunded'));
```

Status semantics:
- `pending` — non-Stripe (cash / card-on-site), unchanged from today.
- `awaiting_payment` — Stripe Checkout Session created, customer hasn't completed payment yet.
- `paid` — webhook confirmed `checkout.session.completed`.
- `paid_to_driver` — kept for the existing driver-collected-cash flow.
- `failed` — webhook saw `payment_intent.payment_failed`.
- `refunded` / `partially_refunded` — webhook saw `charge.refunded`.

### C) New `stripe_events` table for webhook idempotency

```sql
create table if not exists public.stripe_events (
  id          text primary key,           -- evt_…
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- No grants to anon/authenticated; service role bypasses RLS.
```

### D) Indexes

```sql
create index if not exists transfers_stripe_session_id_idx
  on public.transfers (stripe_session_id) where stripe_session_id is not null;
create index if not exists transfers_stripe_payment_intent_idx
  on public.transfers (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists tours_stripe_session_id_idx
  on public.tours (stripe_session_id) where stripe_session_id is not null;
create index if not exists tours_stripe_payment_intent_idx
  on public.tours (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
```

### E) Update both booking RPCs

Extend `create_transfer_booking` and `create_tour_booking` (`db/migrations/2026-05-04-guest-booking-rpcs.sql`) to passthrough three new fields from the payload: `stripe_session_id`, `stripe_payment_intent_id`, `stripe_charge_id`. Add the columns to the `INSERT` column list and the corresponding `safe->>'…'` lines to the `VALUES` block. The existing `coalesce(safe->>'payment_status', 'pending')` line works as-is — the server endpoint passes `'awaiting_payment'`.

### F) New RPC `apply_stripe_event`

A SECURITY DEFINER function that does idempotency + the booking UPDATE in one transaction:

```sql
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
  insert into stripe_events(id, type) values(p_event_id, p_event_type)
    on conflict (id) do nothing
    returning id into inserted_id;

  if inserted_id is null then
    return 'duplicate';
  end if;

  case p_event_type
    when 'checkout.session.completed' then
      update transfers set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';
      update tours set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';

    when 'payment_intent.payment_failed' then
      update transfers set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';
      update tours set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent';

    when 'charge.refunded' then
      update transfers set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';
      update tours set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';

    else
      -- ignore, event already recorded
      null;
  end case;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_event(text, text, jsonb) from public;
-- not granted to anon/authenticated; called only from server endpoint via service role.
```

### G) Existing `payment_token` column

Stays for backward compatibility with historical rows. The new flow does not write to it. Other payment methods (cash, card-on-site) never wrote to it. Removing the column is a separate cleanup (out of scope).

### H) Out of scope

Unifying `transfers` and `tours` into one bookings table — out of scope for this spec.

---

## 3. Server endpoints

Three new files under `src/pages/api/stripe/`. All export `prerender = false` so Astro treats them as Vercel serverless functions. They use the `stripe` Node SDK and a Supabase client built with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).

### 3.1 `POST /api/stripe/create-checkout-session`

Called by the browser when the user clicks "Complete Booking" with the Stripe radio selected.

```ts
// Request
{
  flow: 'transfer' | 'hourly' | 'tour',
  booking: { /* same payload shape as today's RPC call */ }
}
// Response (200)
{ url: 'https://checkout.stripe.com/c/pay/cs_…', booking_id: 'uuid' }
// Response (4xx)
{ error: 'reason' }
```

Steps server-side:
1. Validate `flow ∈ {transfer, hourly, tour}`, required booking fields, and **price bounds** (€1 ≤ `total_price` ≤ €5000). Full server-side price recomputation is out of scope (see §7).
2. Insert via the existing RPC (`create_transfer_booking` for transfer/hourly, `create_tour_booking` for tour) with `payment_method='stripe'`, `payment_status='awaiting_payment'`. The RPC returns the new `booking_id`.
3. Create the Stripe Checkout Session:
   ```ts
   const session = await stripe.checkout.sessions.create({
     mode: 'payment',
     payment_method_types: ['card'],   // Apple Pay / Google Pay enabled at the dashboard level
     line_items: [{
       quantity: 1,
       price_data: {
         currency: 'eur',
         unit_amount: Math.round(total_price * 100),
         product_data: { name: flow === 'tour' ? 'Tour booking' : flow === 'hourly' ? 'Hourly hire' : 'Transfer booking' },
       },
     }],
     customer_email: booking.email,
     metadata:                  { booking_id, booking_table: flow === 'tour' ? 'tours' : 'transfers', flow },
     payment_intent_data: { metadata: { booking_id, booking_table: flow === 'tour' ? 'tours' : 'transfers', flow } },
     success_url: `${origin}/book/${flow}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url:  `${origin}/book/${flow}/payment/cancelled?booking_id=${booking_id}`,
   });
   ```
4. UPDATE the booking row with `stripe_session_id = session.id` (via service-role client, since the booking row was just created by the RPC and we have the id).
5. Return `{ url: session.url, booking_id }`.

### 3.2 `GET /api/stripe/session-status?session_id=cs_…`

Called by the success page (it polls briefly while the webhook lands).

```ts
// Response (200)
{
  payment_status: 'awaiting_payment' | 'paid' | 'failed',
  booking_id: 'uuid',
  flow: 'transfer' | 'hourly' | 'tour',
  summary: { ref: '…', route: '…', date: '…', total: 0 }
}
```

Looks up the row by `stripe_session_id` (search `transfers` then `tours` — globally unique session IDs make table-of-record disambiguation safe). No Stripe API call — pure DB read. Webhook is the source of truth.

### 3.3 `POST /api/stripe/webhook`

Called by Stripe. Reads the **raw body** (required for signature verification — must bypass Astro's body parser; use `await request.arrayBuffer()` then `Buffer.from(...)`). Verifies via `stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`.

For each event, build a normalized payload and call the RPC:

```ts
const event = stripe.webhooks.constructEvent(rawBody, sig, secret);

let payload: Record<string, unknown> = {};
switch (event.type) {
  case 'checkout.session.completed': {
    const s = event.data.object as Stripe.Checkout.Session;
    // session.payment_intent may be just the id; retrieve to get latest_charge
    const pi = typeof s.payment_intent === 'string'
      ? await stripe.paymentIntents.retrieve(s.payment_intent)
      : s.payment_intent!;
    payload = { session_id: s.id, payment_intent: pi.id, charge_id: pi.latest_charge };
    break;
  }
  case 'payment_intent.payment_failed': {
    const pi = event.data.object as Stripe.PaymentIntent;
    payload = { payment_intent: pi.id };
    break;
  }
  case 'charge.refunded': {
    const ch = event.data.object as Stripe.Charge;
    payload = { charge_id: ch.id, amount: ch.amount, amount_refunded: ch.amount_refunded };
    break;
  }
  default:
    return new Response('ok', { status: 200 });   // log + ignore
}

await supabase.rpc('apply_stripe_event', {
  p_event_id: event.id,
  p_event_type: event.type,
  p_payload: payload,
});
return new Response('ok', { status: 200 });
```

Subscribed events at the Stripe Dashboard: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`. Anything else returns 200 OK without RPC call.

Notes:
- The RPC issues UPDATEs against **both** `transfers` and `tours`. Stripe session/PI/charge IDs are globally unique, so exactly one of the two UPDATEs will match a row and the other is a no-op. This avoids a per-event "which table?" lookup with negligible overhead.
- The `booking_table` metadata field on the Checkout Session is recorded for diagnostic / future-routing use, but the webhook handler does not consult it.

---

## 4. Frontend changes

### 4.1 Modify the three `payment.astro` pages

`src/pages/book/transfer/payment.astro`, `src/pages/book/hourly/payment.astro`, `src/pages/book/tour/payment.astro`.

**Remove:**
- The `import { loadStripe } from '@stripe/stripe-js';` and the `loadStripe()` call.
- The `stripeInstance.elements()` mount, the `#card-element` container, the `#card-errors` element, the `#stripe-not-configured` panel.
- The `stripeInstance.createToken(cardElement)` call inside the Complete Booking handler.

**Replace** the Stripe radio's expanded area with a short blurb:

```html
<div id="stripe-expand" class="hidden mt-4 pt-4 border-t border-neutral-100">
  <p class="text-sm text-neutral-700">
    You'll be redirected to Stripe's secure checkout to enter your card details.
    You'll come back here once payment is complete.
  </p>
  <!-- "Powered by Stripe" lockup, optional -->
</div>
```

**Rewrite** the Complete Booking click handler:

```ts
if (selectedMethod === 'stripe') {
  const btn = document.getElementById('complete-btn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Redirecting…';
  const res = await fetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flow: /* 'transfer' | 'hourly' | 'tour' */, booking: bookingPayload }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'unknown' }));
    showFormError(formScope, `Couldn't start payment: ${error}`);
    btn.disabled = false; btn.innerHTML = /* original label */;
    return;
  }
  const { url } = await res.json();
  window.location.href = url;
} else {
  await saveBooking(selectedMethod);   // unchanged path for cash / card-on-site
}
```

**Keep** the `PUBLIC_STRIPE_PUBLISHABLE_KEY` env check as a UI-only feature flag: if it's missing, the Stripe radio stays disabled. The publishable key isn't read at runtime anymore (no `stripe.js` instance to initialise) — it's purely a sentinel meaning "Stripe is configured for this environment". Real check is server-side.

### 4.2 New success pages

`src/pages/book/transfer/payment/success.astro`, `src/pages/book/hourly/payment/success.astro`, `src/pages/book/tour/payment/success.astro`.

Each page is mostly static markup mounting a small client script:

1. Read `session_id` from `window.location.search`.
2. Poll `GET /api/stripe/session-status?session_id=…` every 1 s, up to 10 attempts.
3. State machine:
   - `paid` → render booking confirmation card. Reuse the existing `#success-section` markup from the corresponding `payment.astro` (booking ref short-uuid, route, date, vehicle, passenger, total, email).
   - `failed` → red error card + "Try again" link to `/book/<flow>`.
   - Still `awaiting_payment` after 10 s → yellow "Payment received but confirmation is taking longer than usual. You'll get an email shortly." with a manual refresh option.

To avoid copy-paste, factor the polling + state machine into a shared component `src/components/StripeSuccess.astro` that takes `flow` as a prop. Each per-flow page is then ~10 lines: layout shell + `<StripeSuccess flow="transfer" />`.

### 4.3 New cancelled pages

`src/pages/book/transfer/payment/cancelled.astro`, `src/pages/book/hourly/payment/cancelled.astro`, `src/pages/book/tour/payment/cancelled.astro`.

Pure static. Message: *"Payment cancelled. Your booking wasn't completed. You can try again from the home page."* Plus a button back to `/book/<flow>`. The orphaned `awaiting_payment` row stays in the DB (cleanup is out of scope).

We deliberately **don't** offer a "Retry payment" flow that reuses the same booking row, because it adds a second endpoint, a second state to manage, and an attack surface (someone who knows a `booking_id` could create unlimited Checkout Sessions for it).

### 4.4 `@stripe/stripe-js` dep

Left in `package.json` even though no page uses it after this change. Removing the dep is a 1-line follow-up, not blocking this project.

---

## 5. Build config, env vars, Stripe Dashboard setup

### 5.1 Astro config — `astro.config.mjs`

Add the Vercel adapter; keep `output: 'static'` (default in Astro 5). Each API endpoint opts into server-rendering with `export const prerender = false`. Every existing `.astro` page is unaffected.

```js
import vercel from '@astrojs/vercel';

export default defineConfig({
  // ...existing config...
  output: 'static',
  adapter: vercel(),
});
```

New deps: `@astrojs/vercel`, `stripe`.

### 5.2 Env vars

| Var | Where it's used | Local `.env` | Vercel Production | Vercel Preview |
|---|---|---|---|---|
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | UI feature flag (Stripe radio enable/disable) | `pk_test_…` | `pk_live_…` | `pk_test_…` |
| `STRIPE_SECRET_KEY` | server endpoints | `sk_test_…` | `sk_live_…` (the rolled one) | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | webhook signature verification | `whsec_…` from `stripe listen` | `whsec_…` from prod webhook | not configured (preview skips webhook tests) |
| `SUPABASE_SERVICE_ROLE_KEY` | server endpoints (bypass RLS) | from Supabase dashboard | same | same |
| `PUBLIC_SUPABASE_URL` | already exists | — | — | — |
| `PUBLIC_SUPABASE_ANON_KEY` | already exists | — | — | — |

`STRIPE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only — Astro's `import.meta.env` exposes them only to server-side code (no `PUBLIC_` prefix → never shipped to the browser).

`.gitignore` already ignores `.env` and `.env.local`. Confirmed.

### 5.3 Stripe Dashboard one-time setup (manual, not code)

1. **Roll the leaked `sk_live_…`** in Dashboard → Developers → API keys.
2. **Add webhook endpoint:** Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://www.opawey.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`
   - Copy the resulting `whsec_…` into `STRIPE_WEBHOOK_SECRET` on Vercel Production.
3. **Enable customer email receipts:** Settings → Emails → "Successful payments". No code work.
4. **Enable Apple Pay / Google Pay** (recommended): Settings → Payment methods. Domain verification for Apple Pay is required and Stripe walks you through it.
5. **Branding:** upload a logo and set the business name so Checkout matches your brand.
6. **Statement descriptor:** set so card statements read "OPAWEY" (or similar) — otherwise customers chargeback unrecognised charges.

### 5.4 Local dev flow

```bash
brew install stripe/stripe-cli/stripe   # one-time
stripe login
stripe listen --forward-to localhost:4321/api/stripe/webhook
# CLI prints `whsec_…` → paste into .env as STRIPE_WEBHOOK_SECRET
npm run dev
```

This mirrors the prod webhook flow against test keys. Preview deployments don't get a registered webhook for this MVP — engineers test locally for the webhook leg.

---

## 6. Testing & rollout

### 6.1 Manual test plan (run end-to-end for each of the 3 flows)

The repo has no automated test framework; this MVP relies on a manual checklist.

For each flow (`transfer`, `hourly`, `tour`):

- [ ] **Happy path** — book using test card `4242 4242 4242 4242`. Verify redirect to Stripe, payment, redirect back, success page renders, DB row shows `payment_status='paid'` with `stripe_payment_intent_id` and `stripe_charge_id` populated.
- [ ] **Decline** — `4000 0000 0000 0002`. Stripe shows decline; user can retry; no broken state.
- [ ] **3DS challenge** — `4000 0025 0000 3155`. Challenge screen appears; success after.
- [ ] **Cancel from Stripe** — click "back" mid-checkout. Cancelled page renders; booking row stays `awaiting_payment`.
- [ ] **Webhook idempotency** — `stripe events resend evt_…` (or trigger via CLI). Only one DB update; no duplicate processing.
- [ ] **Refund** — pay with test card; partial refund in Stripe Dashboard. `payment_status='partially_refunded'`. Refund the remainder. `'refunded'`.
- [ ] **Webhook signature failure** — POST without valid `Stripe-Signature`. Endpoint returns 400; booking untouched.
- [ ] **Non-Stripe regression** — book using "card on site" / cash. Existing flow unchanged; row lands `payment_status='pending'`.

### 6.2 Rollout sequence

1. Apply DB migration to staging Supabase. Smoke-test the new RPC.
2. Apply same migration to production Supabase.
3. Deploy code to Vercel **with test keys** in Production env.
4. Run the full manual checklist against the production URL with test cards.
5. Switch Vercel Production env to live keys (`STRIPE_SECRET_KEY=sk_live_…`, `PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`, `STRIPE_WEBHOOK_SECRET=` from the live webhook). Trigger a redeploy.
6. **Make one real €0.50–€5 booking** with a real personal card end-to-end. Verify the row, the email receipt, and the funds in the Stripe live balance.
7. Refund that test booking from the Dashboard. Verify the webhook flips `payment_status='refunded'`.
8. Monitor the first ~10 real customer bookings closely (Vercel logs + Stripe Dashboard).

### 6.3 Rollback / kill-switch

If something goes seriously wrong in prod, set `PUBLIC_STRIPE_PUBLISHABLE_KEY=` (empty string) on Vercel Production and redeploy. The Stripe radio disables; cash / card-on-site keep working. Schema additions are nullable / additive — no DB rollback needed.

### 6.4 Risk register

| Risk | Mitigation |
|---|---|
| Client-tampered price (devtools) | Bounds-only validation now (€1–€5000); full server-side pricing is a follow-up. |
| Webhook delay → success page mismatch | Success page polls `session-status` for 10 s, then shows "confirmation delayed" copy. |
| Webhook delivered twice | Idempotency via `stripe_events` PK conflict inside the `apply_stripe_event` transaction. |
| Cold start on webhook endpoint | Stripe retries on non-200 with exponential backoff; cold starts <5 s are well within tolerance. |
| Customer abandons mid-checkout | `awaiting_payment` rows accumulate. Cleanup job out of scope. |
| Live key compromise (already happened) | Rolled before deploy. |

---

## 7. Out of scope

Explicitly **not** part of this project:

- Server-side price recomputation (currently bounds-only validation).
- In-app admin refund button (Stripe Dashboard only).
- Scheduled cleanup of stale `awaiting_payment` rows.
- Unifying `transfers` and `tours` tables.
- Removing `@stripe/stripe-js` from `package.json`.
- Multi-currency, VAT/tax handling, customer accounts, saved cards, subscriptions.
- Disabling `card-on-site` for guests (deferred product call).
- Stable staging webhook (Stripe CLI for local + prod-only webhook is enough at current team size).
