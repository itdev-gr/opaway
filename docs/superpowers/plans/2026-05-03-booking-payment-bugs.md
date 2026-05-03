# Booking & Payment Bugs (smoke-test follow-ups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four blocking / high-severity bugs uncovered by a guest-checkout smoke audit on `https://www.opawey.com` so that an unauthenticated visitor can complete a booking through every payment path without:
- Hitting a silent RLS rejection at insert time;
- Seeing a "Booking confirmed!" screen for a Stripe payment that was never actually charged;
- Being able to pick a Stripe option when Stripe isn't configured;
- Triggering a NaN insert from an empty `returnPrice` parameter;
- And, when something does go wrong, getting a generic "Failed to save booking. Please try again." that hides the real error.

**Architecture:** Three near-identical client-side `payment.astro` files (`book/transfer/payment.astro`, `book/hourly/payment.astro`, `book/tour/payment.astro`) collect form input, optionally tokenize a card via Stripe.js, then `INSERT` directly into `transfers` / `tours` from the browser using the Supabase JS client + the `anon` key. RLS on the booking tables governs whether a guest insert is allowed. We do NOT add any server-side / Edge Function — that's a separate, larger workstream needed for real Stripe capture; in the meantime we mark prepayment bookings as `pending` (not `paid`) so the system never lies to a customer about their payment status. We also harden the three payment pages against the smaller bugs.

**Tech Stack:** Astro 5, Supabase JS client, `@stripe/stripe-js` (browser-side tokenize only — no server-side capture), TypeScript inline scripts.

---

## Audit Findings (this is what the plan fixes)

### P0 — Guest checkout completely broken until DB migration is applied

The repo already contains `db/migrations/2026-04-28-allow-guest-bookings.sql`, which:
1. Drops the `NOT NULL` constraint on `transfers.uid`, `tours.uid`, `experiences.uid`.
2. Drops the legacy "Auth users can create *" INSERT policies.
3. Replaces them with permissive `Anyone insert *` policies for `anon, authenticated`.

**Live status unknown.** The yesterday's frontend fix removed the redirect to `/login` on the passenger step, so a guest reaches the payment screen — but if the migration above has NOT been applied to the production Supabase project, every Complete-Booking click will fail at the database level with `new row violates row-level security policy`. Task 1 is a verification + apply step.

### P0 — Stripe path falsely marks `payment_status: 'paid'`

In all three payment files the click handler does:

```ts
const { error, token } = await stripeInstance.createToken(cardElement);
// …
await saveBooking('stripe', token?.id || '');
```

and `saveBooking()` then writes:

```ts
payment_status: paymentMethod === 'stripe' ? 'paid' : 'pending',
```

`createToken()` only **tokenizes** the card; it does NOT charge anything. A real charge requires either a server-side `charges.create` / `paymentIntents.create` + capture, which this codebase doesn't have. The result: the customer sees "Booking confirmed!", the admin dashboard sees `payment_status = 'paid'`, and zero money has moved. This is a fraud-adjacent UX. Until a Stripe Edge Function is built, the safe behaviour is the same as the on-arrival options: mark the row `pending` and let an operator capture the saved `payment_token` manually. Task 2 covers this.

### P1 — Stripe radio is clickable even when the key is missing

The Stripe option always renders. When `PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset there's an inline amber warning under the (still selectable) radio, and clicking Complete just produces the generic error `"Stripe is not loaded yet."`. Task 3 fixes this by disabling the radio + label when the key is missing.

### P2 — Empty `returnPrice` becomes `NaN` at insert time

`book/transfer/payment.astro:463` does:

```ts
return_price: parseFloat(returnPrice),
```

For a one-way booking, `returnPrice` is the empty string. `parseFloat('')` returns `NaN`. PostgreSQL's `numeric` column rejects `NaN` → the row insert fails with a vague Postgres error → the user sees the same generic toast. Task 4 hardens every `parseFloat` / `parseInt` call across the three payment files.

### P2 — Generic error toast hides the real failure

```ts
showFormError(formScope, 'Failed to save booking. Please try again.');
```

If the failure is RLS (Task 1) or NaN (Task 4) or a missing column, the user sees the same opaque message and nobody knows what went wrong. Task 5 surfaces `error.message` from Supabase when present.

---

## File Structure

Files modified by this plan (no new files — except a single SQL migration verification step):

- `db/migrations/2026-04-28-allow-guest-bookings.sql` — already in repo, **manual run on production required**.
- `src/pages/book/transfer/payment.astro` — Tasks 2, 3, 4, 5.
- `src/pages/book/hourly/payment.astro` — Tasks 2, 3, 4, 5.
- `src/pages/book/tour/payment.astro` — Tasks 2, 3, 4, 5.

No schema changes other than the existing migration. No new dependencies. Tour-specific extra tweak: `book/tour/payment.astro` currently does NOT save `payment_token` or `card_surcharge` columns even though it accepts those payment methods — Task 2 also adds those two fields to the tour insert so the three flows behave consistently.

---

## Task 1: Confirm the guest-bookings RLS migration is live

**Files:**
- Read-only check: `db/migrations/2026-04-28-allow-guest-bookings.sql`

This is a verification step, not a code change.

- [ ] **Step 1: Open Supabase SQL editor for the project**

Browser: `https://supabase.com/dashboard/project/<project-id>/sql`. Run:

```sql
select policyname, cmd, qual, with_check
from   pg_policies
where  schemaname = 'public'
  and  tablename  in ('transfers','tours','experiences')
  and  cmd        = 'INSERT';
```

Expected output: three rows, one per table, each with policyname `Anyone insert <table>` and `with_check = true`.

If instead you see policy names containing `Auth users can create …` and `with_check` containing `auth.uid()`, the migration has NOT been applied → continue with Step 2. Otherwise skip to Task 2.

- [ ] **Step 2: Apply the migration in the Supabase SQL editor**

Copy the contents of `db/migrations/2026-04-28-allow-guest-bookings.sql` (it's already in the repo, idempotent) into the SQL editor and run it. Re-run Step 1's query and verify the policies are now the `Anyone insert *` ones.

- [ ] **Step 3: Smoke-test from the browser console (no logged-in session)**

Open `https://www.opawey.com/` in an incognito window, then DevTools → Console:

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const sb = createClient(
  // copy these two from /src/lib/supabase.ts (PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_ANON_KEY)
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY
);
const { data, error } = await sb.from('transfers').insert({
  from: 'TEST', to: 'TEST', date: '2026-12-31', time: '10:00',
  passengers: 1, vehicle_slug: 'sedan', vehicle_name: 'Sedan',
  first_name: 'Smoke', last_name: 'Test', email: 'smoke@test.invalid',
  phone: '+30 6900000000', total_price: 0, base_price: 0,
  outward_price: 0, return_price: 0, ride_status: 'new',
  payment_status: 'pending', payment_method: 'cash',
  uid: null, booking_type: 'transfer'
}).select().single();
console.log({ data, error });
```

Expected: `error` is `null`, `data` contains the inserted row id.
If `error.code === '42501'` (insufficient privilege), the migration is NOT live — re-run Step 2.

- [ ] **Step 4: Clean up the test row**

In the Supabase SQL editor:

```sql
delete from public.transfers where email = 'smoke@test.invalid';
```

Expected: `DELETE 1`.

---

## Task 2: Stop falsely marking Stripe payments as `paid`

**Files:**
- Modify: `src/pages/book/transfer/payment.astro:466`
- Modify: `src/pages/book/hourly/payment.astro:351`
- Modify: `src/pages/book/tour/payment.astro:454`, plus add `payment_token` + `card_surcharge` to the tour insert (lines 433–459).

The fix is to drop the `paymentMethod === 'stripe' ? 'paid' : 'pending'` ternary and always insert `'pending'`. The `payment_token` is still saved so an operator can manually capture the charge from the Stripe dashboard. When a server-side capture flow is built later, it can flip the row to `'paid'` and emit a confirmation email.

- [ ] **Step 1: Transfer payment — change payment_status to always `'pending'`**

In `src/pages/book/transfer/payment.astro` find:

```ts
				payment_status: paymentMethod === 'stripe' ? 'paid' : 'pending',
```

Replace with:

```ts
				// Stripe.createToken() only tokenizes — no server-side capture exists yet,
				// so every booking lands as 'pending' and an operator captures the saved
				// payment_token from the Stripe dashboard.
				payment_status: 'pending',
```

- [ ] **Step 2: Hourly payment — same change**

In `src/pages/book/hourly/payment.astro` find:

```ts
				payment_status: paymentMethod === 'stripe' ? 'paid' : 'pending',
```

Replace with:

```ts
				// See note in transfer/payment.astro: no server-side Stripe capture yet.
				payment_status: 'pending',
```

- [ ] **Step 3: Tour payment — same change + add the missing two columns**

In `src/pages/book/tour/payment.astro`, find the `await supabase.from('tours').insert({ … })` block (around line 433) and:

a. Replace the existing `payment_status` line with the same `'pending'`-always assignment.
b. Add `payment_token` and `card_surcharge` lines after `payment_method`. The block becomes:

```ts
			const { data: inserted, error } = await supabase.from('tours').insert({
				tour: tourName,
				tour_id: tourId,
				tour_name: tourName,
				pickup: pickup,
				pickup_location: pickup,
				destination: tourName,
				date, time,
				passengers: parseInt(participants, 10),
				participants: parseInt(participants, 10),
				vehicle: vehicleName,
				vehicle_name: vehicleName,
				name: `${firstName} ${lastName}`.trim(),
				email, phone,
				special_requests: driverNotes || null,
				notes: driverNotes || null,
				hotel_choice: hotelChoice,
				total_price: finalTotal,
				entrance_tickets_count: ticketCount,
				entrance_tickets_total: ticketsSubtotal,
				ride_status: 'new',
				// See note in transfer/payment.astro: no server-side Stripe capture yet.
				payment_status: 'pending',
				payment_method: paymentMethod,
				payment_token: paymentToken || null,
				card_surcharge: paymentMethod === 'card-onsite' ? cardOnsiteFee : 0,
				uid: guestUid,
				partner_id: partnerId,
				added_by_admin: false,
			}).select().single();
```

- [ ] **Step 4: Verify — `payment_status: 'paid'` is gone everywhere in the booking flow**

Run: `grep -rn "payment_status:.*paid" src/pages/book/`
Expected: no output.

---

## Task 3: Disable Stripe radio + label when `PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing

**Files:**
- Modify: `src/pages/book/transfer/payment.astro:411-429`
- Modify: `src/pages/book/hourly/payment.astro` (equivalent block — see Step 2)
- Modify: `src/pages/book/tour/payment.astro` (equivalent block — see Step 3)

The current code shows an inline amber warning but leaves the radio selectable. We add a small helper that disables the input + dims the label when the key is missing.

- [ ] **Step 1: Transfer payment — disable Stripe option when key missing**

In `src/pages/book/transfer/payment.astro`, find the existing block:

```ts
	if (STRIPE_KEY) {
		document.getElementById('stripe-available')?.classList.remove('hidden');
		(async () => {
			stripeInstance = await loadStripe(STRIPE_KEY);
			if (!stripeInstance) return;
			const elements = stripeInstance.elements();
			cardElement = elements.create('card', { style: { base: { fontSize: '16px', color: '#1a1a1a', '::placeholder': { color: '#a3a3a3' } } } });
			cardElement.mount('#card-element');
			const errorsEl = document.getElementById('card-errors')!;
			cardElement.on('change', (event: any) => {
				if (event.error) { errorsEl.textContent = event.error.message; errorsEl.classList.remove('hidden'); }
				else { errorsEl.classList.add('hidden'); }
			});
		})();
	} else {
		document.getElementById('stripe-not-configured')?.classList.remove('hidden');
	}
```

Replace the entire `if (STRIPE_KEY) { … } else { … }` with:

```ts
	if (STRIPE_KEY) {
		document.getElementById('stripe-available')?.classList.remove('hidden');
		(async () => {
			stripeInstance = await loadStripe(STRIPE_KEY);
			if (!stripeInstance) return;
			const elements = stripeInstance.elements();
			cardElement = elements.create('card', { style: { base: { fontSize: '16px', color: '#1a1a1a', '::placeholder': { color: '#a3a3a3' } } } });
			cardElement.mount('#card-element');
			const errorsEl = document.getElementById('card-errors')!;
			cardElement.on('change', (event: any) => {
				if (event.error) { errorsEl.textContent = event.error.message; errorsEl.classList.remove('hidden'); }
				else { errorsEl.classList.add('hidden'); }
			});
		})();
	} else {
		document.getElementById('stripe-not-configured')?.classList.remove('hidden');
		// Disable the Stripe radio so users can't pick an unusable method.
		const stripeLabel = document.querySelector<HTMLLabelElement>('.pay-method-option[data-method="stripe"]');
		const stripeRadio = stripeLabel?.querySelector<HTMLInputElement>('input[type="radio"]');
		if (stripeLabel) {
			stripeLabel.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
		}
		if (stripeRadio) {
			stripeRadio.disabled = true;
		}
	}
```

- [ ] **Step 2: Hourly payment — same change**

In `src/pages/book/hourly/payment.astro`, find the equivalent `if (STRIPE_KEY) { … } else { … }` block (search for `STRIPE_KEY = import.meta.env`) and apply the identical replacement (the only difference between files is the variable name for the card element — `cardEl` here vs `cardElement` in transfer; preserve that local name).

- [ ] **Step 3: Tour payment — same change**

In `src/pages/book/tour/payment.astro`, find the equivalent `if (STRIPE_KEY) { … } else { … }` block and apply the identical replacement, preserving the local card-element variable name as it is in that file (`cardElement`).

- [ ] **Step 4: Verify all three pages disable the radio**

Run: `grep -n "opacity-50.*cursor-not-allowed.*pointer-events-none" src/pages/book/*/payment.astro`
Expected: 3 matches, one per file.

---

## Task 4: Sanitize numeric parsing across the three payment pages

**Files:**
- Modify: `src/pages/book/transfer/payment.astro:452, 458, 462, 463` (parseInt + parseFloat calls)
- Modify: `src/pages/book/hourly/payment.astro:341, 342, 348` (parseInt + parseFloat calls)
- Modify: `src/pages/book/tour/payment.astro:441, 442` (parseInt calls)

`parseInt('')` returns `NaN`; `parseFloat('')` returns `NaN`. Postgres `numeric`/`int` columns reject `NaN`, killing the insert with a vague Postgres error. Wrapping with `… || 0` defaults to zero, which is the right semantic everywhere these fields are missing (no return leg → 0; no luggage → 0; etc.).

- [ ] **Step 1: Transfer payment — guard parseInt + parseFloat**

In `src/pages/book/transfer/payment.astro`, find this block inside `saveBooking()`:

```ts
				passengers: parseInt(passengers, 10),
				return_date: returnDate || null,
				return_time: returnTime || null,
				vehicle_slug: vehicleSlug, vehicle_name: vehicleName,
				first_name: firstName, last_name: lastName, email, phone,
				sign_name: signName || null,
				child_seats: parseInt(childSeats, 10),
				driver_notes: driverNotes || null,
				total_price: finalTotal,
				base_price: baseTotal,
				outward_price: parseFloat(outwardPrice),
				return_price: parseFloat(returnPrice),
```

Replace the four parseInt/parseFloat lines with NaN-safe versions:

```ts
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
```

(`passengers || 1` because the `passengers` column defaults to 1; the others default to 0.)

- [ ] **Step 2: Hourly payment — guard parseInt + parseFloat**

In `src/pages/book/hourly/payment.astro`, find inside `saveBooking()`:

```ts
				hours: parseInt(hours, 10),
				passengers: parseInt(passengers, 10),
```

…and:

```ts
				per_hour: parseFloat(perHour),
```

Replace with:

```ts
				hours: parseInt(hours, 10) || 1,
				passengers: parseInt(passengers, 10) || 1,
```

…and:

```ts
				per_hour: parseFloat(perHour) || 0,
```

- [ ] **Step 3: Tour payment — guard parseInt**

In `src/pages/book/tour/payment.astro`, find:

```ts
				passengers: parseInt(participants, 10),
				participants: parseInt(participants, 10),
```

Replace with:

```ts
				passengers: parseInt(participants, 10) || 1,
				participants: parseInt(participants, 10) || 1,
```

- [ ] **Step 4: Verify no bare parseInt/parseFloat survive in saveBooking**

Run: `grep -nE "parseInt\([a-zA-Z]+, 10\)$|parseFloat\([a-zA-Z]+\)$" src/pages/book/`
Expected: no output (every parseInt/parseFloat in the three saveBooking blocks now ends in `|| 0` or `|| 1`).

---

## Task 5: Surface real Supabase error messages in the form-error toast

**Files:**
- Modify: `src/pages/book/transfer/payment.astro:488-490` (catch block in saveBooking)
- Modify: `src/pages/book/hourly/payment.astro:371-373` (catch block in saveBooking)
- Modify: `src/pages/book/tour/payment.astro:472-474` (catch block in saveBooking)

The current catch is:

```ts
} catch (err) {
	console.error('Save booking failed:', err);
	showFormError(formScope, 'Failed to save booking. Please try again.');
	btn.disabled = false;
	btn.innerHTML = `…`;
}
```

If `err` is a Supabase `PostgrestError` it has a `.message` we can show. We still log the full error to the console for ops. We keep the generic fallback when there's no message.

- [ ] **Step 1: Transfer payment — useful error message**

In `src/pages/book/transfer/payment.astro`, replace the catch line:

```ts
		} catch (err) {
			console.error('Save booking failed:', err);
			showFormError(formScope, 'Failed to save booking. Please try again.');
```

with:

```ts
		} catch (err: any) {
			console.error('Save booking failed:', err);
			const detail = err?.message || err?.error_description || '';
			showFormError(formScope, detail
				? `Failed to save booking: ${detail}`
				: 'Failed to save booking. Please try again.');
```

- [ ] **Step 2: Hourly payment — same change**

Apply the identical replacement to `src/pages/book/hourly/payment.astro`'s catch block in `saveBooking()`.

- [ ] **Step 3: Tour payment — same change**

Apply the identical replacement to `src/pages/book/tour/payment.astro`'s catch block in `saveBooking()`.

- [ ] **Step 4: Verify**

Run: `grep -n 'Failed to save booking:' src/pages/book/`
Expected: 3 matches (one per payment file).

---

## Task 6: Build, commit, push

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: build succeeds, 63 pages built, no TypeScript errors.

- [ ] **Step 2: Commit**

```bash
git add src/pages/book/transfer/payment.astro \
        src/pages/book/hourly/payment.astro \
        src/pages/book/tour/payment.astro \
        docs/superpowers/plans/2026-05-03-booking-payment-bugs.md
git commit -m "fix(book/payment): stop marking Stripe as paid, guard NaN, disable unconfigured Stripe, surface real errors"
```

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Smoke-verify on the deployed site (incognito)**

Wait ~60 s for Vercel, then walk through `/book/transfer` as a guest:
1. Pick a vehicle → continue → fill passenger form → continue.
2. On payment, confirm: if the env doesn't have `PUBLIC_STRIPE_PUBLISHABLE_KEY`, the Stripe option is dimmed and unclickable. The "Cash on-site" and "Card on-site" radios are still selectable.
3. Pick "Cash on-site" → Complete Booking. You should see the green "Booking confirmed!" success card and a row in the admin dashboard with `payment_status = 'pending'`.
4. Repeat for `/book/hourly` and `/book/tour`.

If any flow surfaces a red error toast, note the exact `Failed to save booking: …` suffix — that's the real Postgres / RLS error and will tell you whether Task 1's migration step needs revisiting.

---

## Self-Review Checklist

- [ ] Task 1 explains how to verify the RLS migration is live AND what to do if it isn't.
- [ ] Task 2 deletes the `payment_status: 'paid'` ternary in **all three** payment files; tour also gains the `payment_token` and `card_surcharge` columns it was missing.
- [ ] Task 3 disables the Stripe radio in **all three** files when the key is missing.
- [ ] Task 4 wraps **every** parseInt / parseFloat in the three saveBooking blocks with `|| 0` (or `|| 1` for `passengers` / `hours`).
- [ ] Task 5 surfaces the real `err.message` in the user-facing toast in all three catch blocks.
- [ ] Task 6 builds, commits with one message, pushes, and smoke-tests the deploy.
- [ ] No new files except this plan. No new dependencies. No backend service introduced.
- [ ] An explicit out-of-scope follow-up is documented (server-side Stripe capture is a separate, larger workstream — this plan only stops the system from lying to customers in the meantime).
