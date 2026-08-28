# Transfer Coupon Upgrade (Return Extra + Results-Page Display) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coupons gain an admin-set **extra discount for round-trip transfers**, and customers can enter the coupon on the **transfer results page**, where every vehicle card immediately shows the original price struck through and the discounted total in red (per the reference screenshot) — updating live when the customer adds/removes the return trip — and the coupon carries through automatically to the payment page.

**Architecture:** One new column `coupons.return_extra_value` (same unit as the coupon's `discount_type`, applied on top when a transfer booking is round-trip). `validate_coupon` is dropped and recreated to also return that column (Postgres cannot change a function's return table via `create or replace`). A new pure helper `effectiveCouponValue(coupon, roundTripTransfer)` merges base + extra with a 100% cap for percent coupons. The transfer results page gets a coupon box; applied coupons restyle every vehicle card (`<del>` original + red total), add a coupon row to the sidebar price details, and stash the code in `sessionStorage['opaway:coupon']`, which the transfer payment page auto-applies on load. Booking payload/RPC contracts are unchanged (the client still sends `coupon_code` + computed `coupon_discount`; the RPC re-validates validity server-side, same trust model as today).

**Tech Stack:** Supabase Postgres (idempotent migration, SECURITY DEFINER RPC), Astro 5 pages, Vitest.

## Decisions locked in

- **Extra uses the same unit as the coupon's `discount_type`.** Percent coupon `10` + extra `5` → 15% on round-trip transfers (capped at 100 combined); fixed coupon `€10` + extra `€5` → €15 off. One field, no second type selector.
- **The extra applies only to transfer round trips** (`flow = 'transfer'` with a return selected). Hourly and tour flows ignore it entirely (their pages keep calling the existing math with the base value).
- **Results-page price display** (matches the screenshot): struck-through gray original above, bold red discounted price (`text-red-600`), existing "total price / round trip" caption underneath. When a partner discount is also active, the struck-through figure is the pre-partner original (the biggest "before" price).
- **Coupon composes on top of the partner discount** (applies to the already-partner-discounted total), same as on the payment page today.
- **Carry-through:** on successful apply at results, the code is saved to `sessionStorage['opaway:coupon']`; the transfer payment page pre-fills and auto-applies it on load, and clears the key after a successful cash booking. URL params between steps keep carrying **pre-coupon** totals (unchanged contract); the payment page recomputes the discount itself, now including the return extra since it knows `returnDate`. The middle (passenger) step keeps showing the pre-coupon total — accepted, the final payment step shows the discounted figure.
- **DB `validate_coupon` gains `return_extra_value` in its return table.** This requires `drop function` + `create function` (return-type change); the booking RPCs select columns by name and late-bind, so they are unaffected.
- **Server trust model unchanged:** `coupon_discount` stays client-computed after server-side validity checks (established decision from the original coupons plan).

## Global Constraints

- SQL migrations in `db/migrations/YYYY-MM-DD-slug.sql`, **idempotent** (`add column if not exists`, guarded constraint adds, `drop function if exists` + `create function`, re-grants).
- Applied to the live Supabase project **opaway** (ref `wjqfcijisslzqxesbbox`) via Dashboard SQL Editor or Management API with env `SUPABASE_ACCESS_TOKEN` (custom `User-Agent` header required). **Never write the token into any repo file.** API quirk: multi-statement batches return the FIRST statement's result when the last yields zero rows — single statements or `count(*)` wraps.
- Indentation: **tabs** in `.astro`, **2 spaces** in `src/lib/*.ts` / `tests/*.ts`. Customer-facing text: English with `data-i18n-el`/`data-i18n-es` attributes; euro/ellipsis characters inside payment/results **script code** follow each file's existing escape conventions. Admin pages English-only.
- Brand blue `#0C6B95`; discounted price red is `text-red-600`.
- Gates: `npx astro check` — pre-existing baseline of **43 errors**, zero new; `npm test` — currently 48 tests green, plus the new ones.
- The current live `validate_coupon` is the groups-aware version from `db/migrations/2026-08-26-coupon-customer-groups.sql`; the recreated version must preserve its entire WHERE clause and add only the new return column.
- Commit messages end with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BiS87umAz5GGz8pgEjFj98

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-08-28-coupon-return-extra.sql` | `return_extra_value` column + constraints + recreated `validate_coupon` |
| Modify | `src/lib/coupons.ts` | `AppliedCoupon.return_extra_value`, `effectiveCouponValue()`, mapping in `validateCoupon()` |
| Modify | `tests/coupons.test.ts` | Tests for `effectiveCouponValue` |
| Modify | `src/pages/admin/coupons.astro` | "Extra round-trip discount" field, validation, insert, label |
| Modify | `src/pages/book/transfer/results.astro` | Coupon box, card/sidebar discounted display, sessionStorage save |
| Modify | `src/pages/book/transfer/payment.astro` | Return-extra math, auto-apply carried coupon, clear on success |
| Create | `qa/2026-08-28-coupon-return-extra-smoke-test.md` | Verification journal |

---

### Task 1: Migration — return_extra_value + recreated validate_coupon

**Files:**
- Create: `db/migrations/2026-08-28-coupon-return-extra.sql`

**Interfaces:**
- Consumes: live `validate_coupon(p_code, p_flow)` (groups-aware version in `db/migrations/2026-08-26-coupon-customer-groups.sql`).
- Produces: column `coupons.return_extra_value numeric not null default 0`; `validate_coupon` returning `table (id uuid, code text, discount_type text, discount_value numeric, return_extra_value numeric)`, still granted to `anon, authenticated`. Booking RPCs unchanged (they select `vc.id, vc.code` by name).

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-08-28-coupon-return-extra.sql` with exactly this content:

```sql
-- Coupon extra discount for round-trip transfers: return_extra_value is
-- added on top of discount_value (same unit as discount_type) when a
-- transfer booking includes a return leg. validate_coupon() now returns it;
-- a return-table change requires drop + create (create or replace cannot
-- alter the return type). Idempotent: safe to re-run.

alter table public.coupons add column if not exists return_extra_value numeric not null default 0;

do $$ begin
  alter table public.coupons
    add constraint coupons_return_extra_nonneg check (return_extra_value >= 0);
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.coupons
    add constraint coupons_percent_total_max
    check (discount_type <> 'percent' or discount_value + return_extra_value <= 100);
exception
  when duplicate_object then null;
end $$;

drop function if exists public.validate_coupon(text, text);

create function public.validate_coupon(p_code text, p_flow text)
returns table (id uuid, code text, discount_type text, discount_value numeric, return_extra_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select coalesce(
      (select p.type
       from public.partners p
       where p.id = auth.uid() and p.status = 'approved'),
      'retail'
    ) as grp
  )
  select c.id, c.code, c.discount_type, c.discount_value, c.return_extra_value
  from public.coupons c, caller
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;
```

- [ ] **Step 2: Apply to the live project** (SQL Editor, or the Management API pattern with the file content as `query`). Expected: empty result, no error. Apply a second time — no error (idempotent: the drop-if-exists/create pair re-runs cleanly).

- [ ] **Step 3: Verify with SQL** (single statements):

1. `insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, return_extra_value) values ('QA_RT10', 'percent', 10, current_date, current_date + 30, 5) on conflict do nothing;`
2. `select * from public.validate_coupon('qa_rt10', 'transfer');` → exactly one row with **five** columns, `discount_value = 10`, `return_extra_value = 5`.
3. Backward compat: `select return_extra_value from public.validate_coupon('TEST10', 'transfer');` → one row, `return_extra_value = 0`. (If `TEST10` was deleted from prod, run the same against any existing active coupon, or skip with a note.)
4. Constraint: `insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, return_extra_value) values ('QA_RT_BAD', 'percent', 98, current_date, current_date + 30, 5);` → error mentioning `coupons_percent_total_max`.
5. Booking RPC regression (they call validate_coupon internally): `select public.create_transfer_booking('{"date":"2026-09-25","time":"10:00","from":"A","to":"B","email":"qa-rt@test.local","total_price":40.5,"coupon_code":"QA_RT10","coupon_discount":4.5}'::jsonb);` → uuid; the row has `coupon_code='QA_RT10'`.

Cleanup: delete the `qa-rt@test.local` transfers row and the `QA_RT10` coupon (QA_RT_BAD never persisted); verify with `count(*)` = 0 for each.

- [ ] **Step 4: Regression gate** — `npm test` → 48/48 (no client changes in this task).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-08-28-coupon-return-extra.sql
git commit -m "feat(db): coupon return_extra_value for round-trip transfers"
```

---

### Task 2: Lib — effectiveCouponValue + AppliedCoupon.return_extra_value (TDD)

**Files:**
- Modify: `src/lib/coupons.ts`
- Test: `tests/coupons.test.ts`

**Interfaces:**
- Consumes: RPC now returns `return_extra_value` (Task 1).
- Produces (used by Tasks 4-5): `AppliedCoupon` gains `return_extra_value: number`; new export `effectiveCouponValue(coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value' | 'return_extra_value'>, roundTripTransfer: boolean): number`; `validateCoupon()` maps the new field. `couponDiscountAmount` unchanged (hourly/tour pages keep working untouched — they pass the coupon object whose extra field is simply ignored by the existing `Pick`).

- [ ] **Step 1: Write the failing tests**

In `tests/coupons.test.ts`, extend the import line to include the new export:

```ts
import { couponDiscountAmount, couponStatusOn, effectiveCouponValue } from '../src/lib/coupons';
```

and append this describe block at the end of the file:

```ts
describe('effectiveCouponValue', () => {
  const pct = { discount_type: 'percent' as const, discount_value: 10, return_extra_value: 5 };

  it('adds the round-trip extra for transfer round trips', () => {
    expect(effectiveCouponValue(pct, true)).toBe(15);
  });

  it('ignores the extra for one-way bookings', () => {
    expect(effectiveCouponValue(pct, false)).toBe(10);
  });

  it('caps combined percent at 100', () => {
    expect(effectiveCouponValue({ ...pct, discount_value: 98 }, true)).toBe(100);
  });

  it('sums fixed euro amounts without a cap', () => {
    expect(effectiveCouponValue({ discount_type: 'fixed', discount_value: 10, return_extra_value: 5 }, true)).toBe(15);
  });

  it('treats a zero extra as no change', () => {
    expect(effectiveCouponValue({ ...pct, return_extra_value: 0 }, true)).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/coupons.test.ts`
Expected: FAIL — `effectiveCouponValue` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/coupons.ts`:

(a) In the `AppliedCoupon` interface, after `discount_value: number;` add:

```ts
  return_extra_value: number;
```

(b) After the `couponDiscountAmount` function, add:

```ts
// Effective discount value for a booking: the base value plus, for round-trip
// transfers, the coupon's return extra (same unit as discount_type). Percent
// totals are capped at 100.
export function effectiveCouponValue(
  coupon: Pick<AppliedCoupon, 'discount_type' | 'discount_value' | 'return_extra_value'>,
  roundTripTransfer: boolean,
): number {
  const v = coupon.discount_value + (roundTripTransfer ? (coupon.return_extra_value || 0) : 0);
  return coupon.discount_type === 'percent' ? Math.min(v, 100) : v;
}
```

(c) In `validateCoupon`'s returned object, after `discount_value: Number(row.discount_value),` add:

```ts
    return_extra_value: Number(row.return_extra_value ?? 0),
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all suites green (48 pre-existing + 5 new = 53).

- [ ] **Step 5: Type-gate the untouched pages** — `npx astro check` → 43 baseline, zero new. (The hourly/tour pages construct `AppliedCoupon` from `validateCoupon`, which now supplies the new field — no page edits needed.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/coupons.ts tests/coupons.test.ts
git commit -m "feat: effectiveCouponValue with round-trip transfer extra"
```

---

### Task 3: Admin coupons page — extra round-trip field

**Files:**
- Modify: `src/pages/admin/coupons.astro`

**Interfaces:**
- Consumes: column `return_extra_value` (Task 1).
- Produces: admins can set the extra at creation; the Discount column shows it.

Locate anchors by quoted code (tabs).

- [ ] **Step 1: Add the form field**

Directly **after** the closing `</div>` of the first `grid grid-cols-1 md:grid-cols-2 gap-4 mb-4` block (the one containing the `cp-code` input and the `cp-type`/`cp-value` subgrid) and **before** the second grid (the one containing `cp-from`), insert:

```html
			<div class="mb-4">
				<label for="cp-return-extra" class="block text-sm font-medium text-neutral-700 mb-1">Extra round-trip discount — transfers only <span class="text-neutral-400">(optional)</span></label>
				<input id="cp-return-extra" type="number" min="0" step="0.01" placeholder="0"
					class="w-full md:w-64 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				<p class="text-xs text-neutral-400 mt-1">Added on top of the discount when a transfer booking includes a return trip. Same unit as the discount type (percent or &euro;).</p>
			</div>
```

- [ ] **Step 2: Extend the script**

(a) In the `CouponRow` type, after `discount_value: number;` add:

```ts
		return_extra_value: number;
```

(b) Replace the `discountLabel` function:

```ts
	function discountLabel(c: CouponRow): string {
		const base = c.discount_type === 'percent' ? `${c.discount_value}%` : `€${Number(c.discount_value).toFixed(2)}`;
		const extra = Number(c.return_extra_value) > 0
			? (c.discount_type === 'percent' ? ` (+${c.return_extra_value}% RT)` : ` (+€${Number(c.return_extra_value).toFixed(2)} RT)`)
			: '';
		return base + extra;
	}
```

(c) In the create handler, directly after the `const discountValue = ...` line add:

```ts
		const returnExtra = parseFloat((document.getElementById('cp-return-extra') as HTMLInputElement).value) || 0;
```

(d) Directly after the existing percent-cap validation line (`if (discountType === 'percent' && discountValue > 100) { ... }`) add:

```ts
		if (returnExtra < 0) { setStatus('Extra round-trip discount cannot be negative.', 'text-red-500'); return; }
		if (discountType === 'percent' && discountValue + returnExtra > 100) { setStatus('Discount plus round-trip extra cannot exceed 100%.', 'text-red-500'); return; }
```

(e) In the `supabase.from('coupons').insert({...})` object, after `discount_value: discountValue,` add:

```ts
			return_extra_value: returnExtra,
```

- [ ] **Step 3: Gates** — `npx astro check` (43 baseline, zero new); `npm test` (53/53).

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/coupons.astro
git commit -m "feat(admin): extra round-trip discount field on coupons"
```

---

### Task 4: Transfer results page — coupon box + discounted card/sidebar display

**Files:**
- Modify: `src/pages/book/transfer/results.astro`

**Interfaces:**
- Consumes: `validateCoupon`, `couponDiscountAmount`, `effectiveCouponValue`, type `AppliedCoupon` from `src/lib/coupons.ts` (Task 2).
- Produces: `sessionStorage['opaway:coupon']` = the applied code (consumed by Task 5); the screenshot-style price display.

Locate anchors by quoted code.

- [ ] **Step 1: Insert the coupon box markup**

In the template, directly **after** the closing `</div>` of the `<!-- Route info bar -->` block (`id="route-info"`) and **before** `<!-- Vehicle cards -->`, insert (tabs):

```html
					<!-- Coupon code -->
					<div class="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4">
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

- [ ] **Step 2: Add the sidebar coupon row**

In the `<!-- Price details -->` block, directly **after** the closing `</div>` of the `id="sb-return-price-row"` row, insert:

```html
							<div id="sb-coupon-row" class="hidden flex justify-between text-sm text-emerald-700">
								<span><span data-i18n-el="Κουπόνι" data-i18n-es="Cupón">Coupon</span> <span id="sb-coupon-code" class="font-mono"></span></span>
								<span id="sb-coupon-amount">—</span>
							</div>
```

- [ ] **Step 3: Script — import and coupon state**

At the top of the `<script>` block, directly after the line `import { calculatePrice, loadPricing, type PricingData } from '../../../lib/pricing';` add:

```ts
	import { validateCoupon, couponDiscountAmount, effectiveCouponValue, type AppliedCoupon } from '../../../lib/coupons';
```

Directly after the line `let partnerDiscount = 0;` add:

```ts
	let appliedCoupon: AppliedCoupon | null = null;

	function couponAmountFor(total: number): number {
		if (!appliedCoupon) return 0;
		return couponDiscountAmount(total, {
			discount_type: appliedCoupon.discount_type,
			discount_value: effectiveCouponValue(appliedCoupon, hasReturn),
		});
	}
```

(`hasReturn` is a `let` declared later in the same module scope; `couponAmountFor` is only invoked after initialization, so this is safe — same pattern the file already uses for `setReturnState`/`renderVehicles`.)

- [ ] **Step 4: Script — coupon wiring**

At the END of the `<script>` block (after the `/* ── Init ── */` `Promise.all(...)` block), add:

```ts
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

	function couponSummaryLabel(c: AppliedCoupon, roundTrip: boolean): string {
		const base = c.discount_type === 'percent' ? `${c.discount_value}%` : `€${c.discount_value.toFixed(2)}`;
		const extra = roundTrip && c.return_extra_value > 0
			? (c.discount_type === 'percent' ? ` + ${c.return_extra_value}% round-trip extra` : ` + €${c.return_extra_value.toFixed(2)} round-trip extra`)
			: '';
		return `${base} off${extra}`;
	}

	function refreshCouponStatus() {
		if (!appliedCoupon) return;
		setCouponStatus(`Coupon "${appliedCoupon.code}" applied: ${couponSummaryLabel(appliedCoupon, hasReturn)}`, true);
	}

	couponBtn?.addEventListener('click', async () => {
		const codeValue = (couponInput?.value || '').trim();
		if (!codeValue) {
			appliedCoupon = null;
			try { sessionStorage.removeItem('opaway:coupon'); } catch {}
			couponStatusEl?.classList.add('hidden');
			renderVehicles();
			updateSidebarPrices();
			return;
		}
		couponBtn.disabled = true;
		const applyLabel = couponBtn.textContent || 'Apply';
		couponBtn.textContent = 'Checking…';
		const coupon = await validateCoupon(codeValue, 'transfer');
		couponBtn.disabled = false;
		couponBtn.textContent = applyLabel;
		appliedCoupon = coupon;
		if (coupon) {
			try { sessionStorage.setItem('opaway:coupon', coupon.code); } catch {}
			refreshCouponStatus();
		} else {
			try { sessionStorage.removeItem('opaway:coupon'); } catch {}
			setCouponStatus('Invalid or expired coupon code.', false);
		}
		renderVehicles();
		updateSidebarPrices();
	});

	// Restore a previously applied coupon (e.g. browser-Back from a later step).
	try {
		const carried = sessionStorage.getItem('opaway:coupon') || '';
		if (carried && couponInput && couponBtn) {
			couponInput.value = carried;
			couponBtn.click();
		}
	} catch { /* sessionStorage unavailable — skip */ }
```

- [ ] **Step 5: Script — restyle the card price block**

Inside `renderVehicles()`, directly after the line `const showOriginal = partnerDiscount > 0 && price.originalTotal !== price.totalPrice;` add:

```ts
			const couponAmount = couponAmountFor(price.totalPrice);
			const finalTotal = Math.round((price.totalPrice - couponAmount) * 100) / 100;
			const strikeFrom = showOriginal ? price.originalTotal : price.totalPrice;
```

Then replace the card's price block

```html
					<!-- Price -->
					<div class="flex flex-col items-end justify-center shrink-0 pl-2">
						${showOriginal ? `<del class="text-neutral-400 text-sm">&euro;${price.originalTotal.toFixed(2)}</del>` : ''}
						<span class="text-xl font-bold text-neutral-900">&euro;${price.totalPrice.toFixed(2)}</span>
						<span class="text-[10px] text-neutral-400" data-i18n-el="${hasReturn ? 'με επιστροφή' : 'τελική τιμή'}" data-i18n-es="${hasReturn ? 'con vuelta' : 'precio final'}">${hasReturn ? 'round trip' : 'total price'}</span>
					</div>
```

with:

```html
					<!-- Price -->
					<div class="flex flex-col items-end justify-center shrink-0 pl-2">
						${couponAmount > 0
							? `<del class="text-neutral-400 text-sm">&euro;${strikeFrom.toFixed(2)}</del>
							<span class="text-xl font-bold text-red-600">&euro;${finalTotal.toFixed(2)}</span>`
							: `${showOriginal ? `<del class="text-neutral-400 text-sm">&euro;${price.originalTotal.toFixed(2)}</del>` : ''}
							<span class="text-xl font-bold text-neutral-900">&euro;${price.totalPrice.toFixed(2)}</span>`}
						<span class="text-[10px] text-neutral-400" data-i18n-el="${hasReturn ? 'με επιστροφή' : 'τελική τιμή'}" data-i18n-es="${hasReturn ? 'con vuelta' : 'precio final'}">${hasReturn ? 'round trip' : 'total price'}</span>
					</div>
```

(`data-total="${price.totalPrice}"` on the card and the Continue-button URL params stay PRE-coupon — the payment page recomputes the discount itself.)

- [ ] **Step 6: Script — sidebar shows the coupon**

Replace the body of `updateSidebarPrices()`:

```ts
	function updateSidebarPrices() {
		if (!selectedVehicleSlug) return;
		const price = calculatePrice({
			vehicleSlug: selectedVehicleSlug,
			distanceKm: pricingDistanceKm,
			durationMinutes: routeDurationMin,
			passengers,
			isReturn: hasReturn,
			discount: partnerDiscount,
			time,
		}, pricingData);
		const couponAmount = couponAmountFor(price.totalPrice);
		const finalTotal = Math.round((price.totalPrice - couponAmount) * 100) / 100;
		setText('sb-total', `€ ${finalTotal.toFixed(2)}`);
		const totalEl = document.getElementById('sb-total');
		totalEl?.classList.toggle('text-red-600', couponAmount > 0);
		totalEl?.classList.toggle('text-neutral-900', couponAmount <= 0);
		setText('sb-outward', `€ ${price.outwardPrice.toFixed(2)}`);
		setText('sb-return-price', hasReturn ? `€ ${price.returnPrice.toFixed(2)}` : '—');
		const couponRow = document.getElementById('sb-coupon-row');
		if (couponRow) {
			couponRow.classList.toggle('hidden', couponAmount <= 0);
			if (couponAmount > 0 && appliedCoupon) {
				setText('sb-coupon-code', appliedCoupon.code);
				setText('sb-coupon-amount', `-€ ${couponAmount.toFixed(2)}`);
			}
		}
	}
```

- [ ] **Step 7: Script — live update when the return toggles**

In `setReturnState(...)`, directly after the existing lines

```ts
		renderVehicles();
		updateSidebarPrices();
```

add:

```ts
		refreshCouponStatus();
```

(Function declarations hoist, so calling `refreshCouponStatus` from `setReturnState` is safe even though it is defined later in the module.)

- [ ] **Step 8: Gates** — `npx astro check` (43 baseline, zero new); `npm test` (53/53).

- [ ] **Step 9: Commit**

```bash
git add src/pages/book/transfer/results.astro
git commit -m "feat(transfer): coupon entry and discounted price display on results page"
```

---

### Task 5: Transfer payment page — return extra + auto-apply carried coupon

**Files:**
- Modify: `src/pages/book/transfer/payment.astro`

**Interfaces:**
- Consumes: `effectiveCouponValue` (Task 2); `sessionStorage['opaway:coupon']` written by the results page (Task 4). The page already has `hasReturn`, the coupon input/listener (`coupon-input` / `coupon-apply-btn`), `recomputeTotals()`, and `saveBooking()`.
- Produces: nothing new. Hourly/tour payment pages are NOT touched (no return extra, no carry-over for them).

Locate anchors by quoted code.

- [ ] **Step 1: Extend the import**

Change the line

```ts
	import { validateCoupon, couponDiscountAmount, type AppliedCoupon } from '../../../lib/coupons';
```

to:

```ts
	import { validateCoupon, couponDiscountAmount, effectiveCouponValue, type AppliedCoupon } from '../../../lib/coupons';
```

- [ ] **Step 2: Use the effective value in the recompute**

In `recomputeTotals()`, replace the line

```ts
		couponDiscount = appliedCoupon ? couponDiscountAmount(preCouponTotal, appliedCoupon) : 0;
```

with:

```ts
		couponDiscount = appliedCoupon
			? couponDiscountAmount(preCouponTotal, {
				discount_type: appliedCoupon.discount_type,
				discount_value: effectiveCouponValue(appliedCoupon, hasReturn),
			})
			: 0;
```

- [ ] **Step 3: Auto-apply the carried coupon**

Directly after the `couponBtn?.addEventListener('click', async () => { ... });` block (after its closing `});`), add:

```ts
	// Auto-apply a coupon carried over from the results page.
	try {
		const carried = sessionStorage.getItem('opaway:coupon') || '';
		if (carried && couponInput && couponBtn && !couponInput.value) {
			couponInput.value = carried;
			couponBtn.click();
		}
	} catch { /* sessionStorage unavailable — skip */ }
```

- [ ] **Step 4: Clear the carried coupon after a successful cash booking**

In `saveBooking()`, directly after the line `document.getElementById('success-section')?.classList.remove('hidden');` add:

```ts
			try { sessionStorage.removeItem('opaway:coupon'); } catch {}
```

- [ ] **Step 5: Gates** — `npx astro check` (43 baseline, zero new); `npm test` (53/53).

- [ ] **Step 6: Commit**

```bash
git add src/pages/book/transfer/payment.astro
git commit -m "feat(transfer): round-trip coupon extra and auto-apply carried coupon at payment"
```

---

### Task 6: Verification sweep + journal

**Files:**
- Create: `qa/2026-08-28-coupon-return-extra-smoke-test.md`

- [ ] **Step 1: Automated gates** — `npm test` (53/53) and `npx astro check` (43 baseline). Record outputs.

- [ ] **Step 2: DB-level checks** (Management API; single statements or `count(*)` wraps; clean up all `QA_RT%` artifacts afterwards and prove it):

1. Create `QA_RT10` (percent 10, valid today→+30, `return_extra_value = 5`, all services/groups). `select * from public.validate_coupon('QA_RT10','transfer')` → one row, 5 columns, `return_extra_value = 5`.
2. `validate_coupon('QA_RT10','hourly')` → still returns the row (flow targeting unchanged; the extra is a client-side transfer-only concern) — journal this as expected behavior.
3. Guest booking with the coupon still works end-to-end: `create_transfer_booking` with `"coupon_code":"QA_RT10","coupon_discount":6.75,"total_price":38.25` (simulating 15% off a €45 round trip) → uuid; row stores `coupon_discount = 6.75`.
4. Constraint: inserting a percent coupon with `discount_value + return_extra_value > 100` → error mentioning `coupons_percent_total_max`.
5. Cleanup + create/refresh a demo coupon for manual QA and LEAVE it: code `RT15`, percent 10, `return_extra_value = 5`, valid today→+30, all services/groups (skip if it exists).

- [ ] **Step 3: Journal** — write `qa/2026-08-28-coupon-return-extra-smoke-test.md` in the established style (token-free SQL, observed output, PASS/FAIL; a FAIL stops the task → report BLOCKED). Browser-only items as NOT RUN with concrete steps:
  1. Transfer results page: apply `RT15` → every card shows struck-through original + red total ~10% lower; caption still reads "total price".
  2. Click "Add return" → cards update live to 15% off; the green status line gains "+ 5% round-trip extra"; sidebar shows the coupon row and red total.
  3. Continue → passenger → payment: the coupon arrives pre-applied (input pre-filled, green line, discounted totals) with 15% off when the return is selected.
  4. Complete a cash round-trip booking; the transfers row's `coupon_discount` equals 15% of the pre-coupon total; `sessionStorage['opaway:coupon']` is cleared after success.
  5. Admin `/admin/coupons`: create a coupon with an extra; the Discount column shows e.g. `10% (+5% RT)`; percent 98 + extra 5 is rejected client-side.

- [ ] **Step 4: Commit**

```bash
git add qa/2026-08-28-coupon-return-extra-smoke-test.md
git commit -m "test: coupon return-extra smoke journal"
```

---

## Out of scope (deliberately)

- Coupon entry on the hourly/tour results-equivalents — the request is transfer-specific; those flows keep their payment-page-only coupon entry.
- Return-extra for hourly/tour (they have no round-trip concept in this sense).
- Editing `return_extra_value` on an existing coupon — same close-and-recreate lifecycle as other coupon fields.
- Showing the discounted price on the middle (passenger) step — the selection step and the payment step both show it; the passenger step keeps the pre-coupon total (documented decision).
- Per-route (from→to specific) coupon targeting — the discount applies to whatever transfer route is being booked; the request's "στο book που πάει από-προς" is the booked route's price, which is what the discount already applies to.
