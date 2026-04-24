# Tour Entrance Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface admin-configured entrance-ticket price/count as an optional add-on on `/book/tour/passenger`, recompute totals live, forward to payment, and persist on the `tours` booking row.

**Architecture:** Passenger page fetches `entrance_ticket_per_person` + `entrance_ticket_count` alongside the existing `tours_catalog` lookup. When price > 0, a radio-driven ticket block is revealed with a number input; sidebar Price details gets a "Tour" / "Entrance tickets" / "Total" breakdown that updates live. The selected count + unit price are forwarded via URL to `/book/tour/payment`, which recomputes `baseTotal` inclusive of tickets (so the card-on-site 5% fee applies to the combined total) and writes two new columns on the insert.

**Tech Stack:** Astro 5 inline `<script>`, Supabase JS v2, Tailwind v4 utility classes. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-24-tour-entrance-tickets-design.md`

**Smoke account:** `smoke-user-2026-04-22@opawey.test` / `SmokeTest!2026-04-22` — seed via `scripts/smoke/create-test-accounts.mjs` if rotated. Smoke admin: `smoke-admin-2026-04-22@opawey.test`.

**Smoke tour:** "Smoke Multi Day" (`tourId = d8d51bd2-aa7b-4ae3-b4dd-b2f652f0aa4e`, as seen in the reference URL). If it lacks `entrance_ticket_per_person`, the first admin step in Task 6 Step 2 configures it.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `db/migrations/2026-04-24-tours-entrance-tickets.sql` | Create | Add `entrance_tickets_count integer NOT NULL DEFAULT 0` + `entrance_tickets_total numeric NOT NULL DEFAULT 0` to `public.tours`. |
| `src/pages/book/tour/passenger.astro` | Modify | Fetch ticket config, render block, wire radio + input, update sidebar live, forward URL. |
| `src/pages/book/tour/payment.astro` | Modify | Read URL, render three-row sidebar breakdown, recompute `baseTotal`, add columns to insert. |
| `src/components/ReservationDetailModal.astro` | Modify | One-line `field('Entrance tickets', ...)` in `renderTourOrExperience`. |
| `qa/2026-04-22-full-smoke-test.md` | Append | Section 24 with pass/fail table. |

---

## Task 1: Branch setup

**Files:** none (git only).

- [ ] **Step 1: Checkout main and pull**

```bash
cd /Users/marios/Desktop/Cursor/opaway
git checkout main
git pull --ff-only origin main
```

Expected: "Already up to date." or clean fast-forward.

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feat/tour-entrance-tickets
git status
```

Expected: "Switched to a new branch 'feat/tour-entrance-tickets'", working tree clean (ignore `.claude/settings.local.json` noise).

---

## Task 2: SQL migration + apply to prod

**Files:**
- Create: `db/migrations/2026-04-24-tours-entrance-tickets.sql`

- [ ] **Step 1: Write the migration SQL**

Write this to `db/migrations/2026-04-24-tours-entrance-tickets.sql`:

```sql
alter table public.tours
  add column if not exists entrance_tickets_count integer not null default 0,
  add column if not exists entrance_tickets_total numeric not null default 0;
```

- [ ] **Step 2: Apply to prod via Supabase Management API**

The PAT is in `.supabase-pat` (gitignored). Run:

```bash
PAT=$(cat /Users/marios/Desktop/Cursor/opaway/.supabase-pat)
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"alter table public.tours add column if not exists entrance_tickets_count integer not null default 0, add column if not exists entrance_tickets_total numeric not null default 0;"}'
```

Expected response: `[]` (empty array) or `null` — both indicate success for DDL.

- [ ] **Step 3: Verify columns exist**

```bash
PAT=$(cat /Users/marios/Desktop/Cursor/opaway/.supabase-pat)
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'tours' and column_name in ('entrance_tickets_count','entrance_tickets_total') order by column_name;\"}"
```

Expected:
```
[{"column_name":"entrance_tickets_count","data_type":"integer","is_nullable":"NO","column_default":"0"},
 {"column_name":"entrance_tickets_total","data_type":"numeric","is_nullable":"NO","column_default":"0"}]
```

If the PAT check returns `"message":"Unauthorized"`, stop and escalate — the PAT needs to be refreshed before proceeding.

- [ ] **Step 4: Commit**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add db/migrations/2026-04-24-tours-entrance-tickets.sql && git commit -m "$(cat <<'EOF'
db: add entrance_tickets columns to tours

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: passenger.astro — fetch + UI + sidebar + forward

**Files:**
- Modify: `src/pages/book/tour/passenger.astro` (lines 82-101 are the existing hidden hotel-option block; lines 181-188 are the sidebar Price details; lines 236-248 are the URL param parse; lines 249-266 have the existing tour-catalog fetch; lines 267-277 have the setText block; lines 304-343 have the Continue handler).

Total: five edits in this file.

- [ ] **Step 1: Add URL-level state initialization**

At the top of the `<script>` block right after `const discount = params.get('discount') || '';` (currently around line 247), add:

```ts
	let ticketUnitPrice = 0;
	let ticketDefaultCount = 0;
	let tourSubtotal = parseFloat(totalPrice) || 0;
```

(`let` because we set them after fetching the catalog row.)

- [ ] **Step 2: Extend the catalog fetch and reveal the block**

Replace the existing catalog-fetch IIFE (currently lines 250-266, starts with `(async () => { if (!tourId) return;`) with this version — same shape but fetches ticket fields, sets defaults, and reveals the block:

```ts
	/* ── Reveal hotel-option + entrance-tickets blocks when the catalog row opts in ── */
	(async () => {
		if (!tourId) return;
		const { data: tourRow } = await supabase
			.from('tours_catalog')
			.select('category, hotel_option, entrance_ticket_per_person, entrance_ticket_count')
			.eq('id', tourId)
			.maybeSingle();
		if (!tourRow) return;

		// Hotel option (unchanged behavior)
		const wantsHotel = tourRow.hotel_option === 'self-book' || tourRow.hotel_option === 'include-booking';
		if (wantsHotel) {
			document.getElementById('hotel-option-block')?.classList.remove('hidden');
			const radio = document.querySelector<HTMLInputElement>(`input[name="hotel-choice"][value="${tourRow.hotel_option}"]`);
			if (radio) radio.checked = true;
		}

		// Entrance tickets
		ticketUnitPrice = Number(tourRow.entrance_ticket_per_person ?? 0) || 0;
		const perPerson = Number(tourRow.entrance_ticket_count ?? 0) || 0;
		const pax = parseInt(participants, 10) || 1;
		ticketDefaultCount = perPerson > 0 ? perPerson * pax : pax;

		if (ticketUnitPrice > 0) {
			const block = document.getElementById('entrance-tickets-block');
			block?.classList.remove('hidden');
			setText('et-unit-price', `€${ticketUnitPrice.toFixed(2)} per ticket`);
			const countInput = document.getElementById('et-count') as HTMLInputElement;
			countInput.value = String(ticketDefaultCount);
			recomputeTicketsAndSidebar();
		}
	})();
```

- [ ] **Step 3: Add the Entrance tickets template block**

Find the closing `</div>` of the existing `#hotel-option-block` (currently at line 101 — the outermost `</div>` that closes `<div id="hotel-option-block"...`). Immediately AFTER that closing `</div>` and BEFORE the `<!-- Special Requests -->` comment (currently at line 103-104), insert:

```astro
						<!-- Entrance tickets (shown only when the catalog row has a non-zero price) -->
						<div id="entrance-tickets-block" class="border-t border-neutral-100 pt-6 mb-6 hidden">
							<div class="flex items-baseline justify-between mb-3">
								<p class="block text-sm font-medium text-neutral-700">Entrance tickets</p>
								<span id="et-unit-price" class="text-xs text-neutral-500">—</span>
							</div>
							<div class="flex flex-col gap-2 mb-4" role="radiogroup" aria-label="Entrance tickets choice">
								<label class="flex items-start gap-3 px-4 py-3 border border-neutral-200 rounded-xl cursor-pointer hover:bg-neutral-50 has-[:checked]:border-[#0C6B95] has-[:checked]:bg-sky-50">
									<input type="radio" name="tickets-choice" value="include" class="mt-0.5 text-[#0C6B95] focus:ring-[#0C6B95]/20" checked />
									<span class="flex-1">
										<span class="block text-sm font-medium text-neutral-800">Include entrance tickets</span>
										<span class="block text-xs text-neutral-500 mt-0.5">We'll add the tickets to your total and pre-arrange them.</span>
									</span>
								</label>
								<label class="flex items-start gap-3 px-4 py-3 border border-neutral-200 rounded-xl cursor-pointer hover:bg-neutral-50 has-[:checked]:border-[#0C6B95] has-[:checked]:bg-sky-50">
									<input type="radio" name="tickets-choice" value="skip" class="mt-0.5 text-[#0C6B95] focus:ring-[#0C6B95]/20" />
									<span class="flex-1">
										<span class="block text-sm font-medium text-neutral-800">No tickets needed</span>
										<span class="block text-xs text-neutral-500 mt-0.5">You'll arrange tickets on your own.</span>
									</span>
								</label>
							</div>
							<div id="et-count-wrap" class="flex items-center gap-3">
								<label for="et-count" class="text-sm text-neutral-600">Number of tickets</label>
								<input id="et-count" type="number" min="0" max="99" step="1" value="0" class="w-24 px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
								<span class="text-sm text-neutral-500 ml-auto">Subtotal: <span id="et-subtotal" class="font-semibold text-neutral-800">€0.00</span></span>
							</div>
						</div>
```

Preserve tab indentation to match surrounding blocks.

- [ ] **Step 4: Extend the sidebar Price details**

Replace the existing sidebar Price details block (currently lines 181-188):

```astro
							<!-- Price details -->
							<div class="border-t border-neutral-100 pt-4 space-y-2">
								<h4 class="text-sm font-bold text-neutral-800">Price details</h4>
								<div class="flex justify-between text-sm">
									<span class="font-semibold text-neutral-900">Total</span>
									<span id="sb-total" class="font-bold text-neutral-900">—</span>
								</div>
							</div>
```

With this expanded version:

```astro
							<!-- Price details -->
							<div class="border-t border-neutral-100 pt-4 space-y-2">
								<h4 class="text-sm font-bold text-neutral-800">Price details</h4>
								<div class="flex justify-between text-sm text-neutral-500">
									<span>Tour</span>
									<span id="sb-tour-subtotal">—</span>
								</div>
								<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
									<span>Entrance tickets</span>
									<span id="sb-tickets-subtotal">—</span>
								</div>
								<div class="flex justify-between text-sm pt-1 border-t border-neutral-100">
									<span class="font-semibold text-neutral-900">Total</span>
									<span id="sb-total" class="font-bold text-neutral-900">—</span>
								</div>
							</div>
```

- [ ] **Step 5: Replace the sidebar setText block with a helper + initial population**

Replace the current setText sidebar block (currently lines 269-277, starts with `const setText = ...` through `setText('sb-total', ...);`) with:

```ts
	const setText = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };

	setText('sb-tour-name', tourName);
	setText('sb-pickup', pickup);
	setText('sb-date', date);
	setText('sb-time', time);
	setText('sb-participants', participants);
	setText('sb-vehicle-name', vehicleName);
	setText('sb-tour-subtotal', `€ ${tourSubtotal.toFixed(2)}`);
	setText('sb-total', `€ ${tourSubtotal.toFixed(2)}`);

	/* ── Recompute tickets subtotal + sidebar Total live ── */
	function recomputeTicketsAndSidebar() {
		const includeRadio = document.querySelector<HTMLInputElement>('input[name="tickets-choice"][value="include"]');
		const countInput = document.getElementById('et-count') as HTMLInputElement | null;
		const countWrap = document.getElementById('et-count-wrap');
		const wantsTickets = includeRadio?.checked === true;
		const count = wantsTickets ? Math.max(0, parseInt(countInput?.value || '0', 10) || 0) : 0;
		const subtotal = count * ticketUnitPrice;

		if (countWrap) countWrap.classList.toggle('hidden', !wantsTickets);
		setText('et-subtotal', `€${subtotal.toFixed(2)}`);

		const ticketsRow = document.getElementById('sb-tickets-row');
		ticketsRow?.classList.toggle('hidden', count === 0);
		setText('sb-tickets-subtotal', `€ ${subtotal.toFixed(2)}`);
		setText('sb-total', `€ ${(tourSubtotal + subtotal).toFixed(2)}`);
	}

	document.addEventListener('change', (e) => {
		const target = e.target as HTMLElement;
		if (target instanceof HTMLInputElement && (target.name === 'tickets-choice' || target.id === 'et-count')) {
			recomputeTicketsAndSidebar();
		}
	});
	document.addEventListener('input', (e) => {
		const target = e.target as HTMLElement;
		if (target instanceof HTMLInputElement && target.id === 'et-count') {
			recomputeTicketsAndSidebar();
		}
	});
```

- [ ] **Step 6: Extend the Continue handler to forward ticket URL params**

Find the Continue button handler's URL builder (currently lines 333-342, starts with `const p = new URLSearchParams({`). Before the `window.location.href = ...` line, insert:

```ts
		const includeRadio = document.querySelector<HTMLInputElement>('input[name="tickets-choice"][value="include"]');
		const countInput = document.getElementById('et-count') as HTMLInputElement | null;
		const ticketCount = (includeRadio?.checked && countInput) ? Math.max(0, parseInt(countInput.value || '0', 10) || 0) : 0;

		if (ticketCount > 0 && ticketUnitPrice > 0) {
			p.set('ticketCount', String(ticketCount));
			p.set('ticketUnitPrice', ticketUnitPrice.toFixed(2));
		}
```

Leave the existing `window.location.href = \`/book/tour/payment?${p.toString()}\`;` line untouched.

- [ ] **Step 7: Build to verify no type errors**

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run build 2>&1 | tail -5
```

Expected: `[build] 63 page(s) built in <Ns>` with zero errors or warnings.

- [ ] **Step 8: Commit**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add src/pages/book/tour/passenger.astro && git commit -m "$(cat <<'EOF'
feat(book): entrance tickets option on tour passenger step

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: payment.astro — read URL, sidebar, recompute, persist

**Files:**
- Modify: `src/pages/book/tour/payment.astro` (lines 238-244 are the sidebar Price details; lines 286-305 are the URL param parse; lines 327-337 have the existing sb-total + baseTotal; lines 416-440 have the insert).

- [ ] **Step 1: Add URL param reads for tickets**

At the URL param parse block near lines 286-305, find the line `const hotelChoiceRaw = params.get('hotelChoice') || '';`. Immediately after that line, add:

```ts
	const ticketCount = Math.max(0, parseInt(params.get('ticketCount') || '0', 10) || 0);
	const ticketUnitPrice = Math.max(0, parseFloat(params.get('ticketUnitPrice') || '0') || 0);
	const ticketsSubtotal = Math.round(ticketCount * ticketUnitPrice * 100) / 100;
```

- [ ] **Step 2: Extend the sidebar Price details template**

Replace the current block at lines 238-244:

```astro
						<div class="border-t border-neutral-100 pt-4 space-y-2">
							<h4 class="text-sm font-bold text-neutral-800">Price details</h4>
							<div class="flex justify-between text-sm">
								<span class="font-semibold text-neutral-900">Total</span>
								<span id="sb-total" class="font-bold text-neutral-900">—</span>
							</div>
						</div>
```

With this expanded version:

```astro
						<div class="border-t border-neutral-100 pt-4 space-y-2">
							<h4 class="text-sm font-bold text-neutral-800">Price details</h4>
							<div class="flex justify-between text-sm text-neutral-500">
								<span>Tour</span>
								<span id="sb-tour-subtotal">—</span>
							</div>
							<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
								<span>Entrance tickets</span>
								<span id="sb-tickets-subtotal">—</span>
							</div>
							<div class="flex justify-between text-sm pt-1 border-t border-neutral-100">
								<span class="font-semibold text-neutral-900">Total</span>
								<span id="sb-total" class="font-bold text-neutral-900">—</span>
							</div>
						</div>
```

- [ ] **Step 3: Populate the new sidebar rows**

Find the existing sidebar populator line `setText('sb-total', \`€ ${totalPrice}\`);` (currently around line 327). Replace that single line with:

```ts
	const tourSubtotalNumber = parseFloat(totalPrice) || 0;
	setText('sb-tour-subtotal', `€ ${tourSubtotalNumber.toFixed(2)}`);
	if (ticketsSubtotal > 0) {
		document.getElementById('sb-tickets-row')?.classList.remove('hidden');
		setText('sb-tickets-subtotal', `€ ${ticketsSubtotal.toFixed(2)}`);
	}
	const combinedBase = tourSubtotalNumber + ticketsSubtotal;
	setText('sb-total', `€ ${combinedBase.toFixed(2)}`);
```

- [ ] **Step 4: Fold tickets into baseTotal**

Find the line `const baseTotal = parseFloat(totalPrice);` (currently line 333). Replace it with:

```ts
	const baseTotal = (parseFloat(totalPrice) || 0) + ticketsSubtotal;
```

This makes the card-on-site 5% fee and the `finalTotal` calculation naturally include tickets.

- [ ] **Step 5: Add ticket columns to the insert payload**

Find the `supabase.from('tours').insert({...})` call (currently lines 416-440). Find the tail lines:

```ts
			total_price: finalTotal,
			ride_status: 'new',
```

Right before `ride_status: 'new',`, insert:

```ts
			entrance_tickets_count: ticketCount,
			entrance_tickets_total: ticketsSubtotal,
```

So the relevant portion becomes:

```ts
			total_price: finalTotal,
			entrance_tickets_count: ticketCount,
			entrance_tickets_total: ticketsSubtotal,
			ride_status: 'new',
```

- [ ] **Step 6: Build to verify no type errors**

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run build 2>&1 | tail -5
```

Expected: `[build] 63 page(s) built in <Ns>` with zero errors or warnings.

- [ ] **Step 7: Commit**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add src/pages/book/tour/payment.astro && git commit -m "$(cat <<'EOF'
feat(book): persist entrance tickets on tour booking insert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ReservationDetailModal — surface Entrance tickets row

**Files:**
- Modify: `src/components/ReservationDetailModal.astro` (`renderTourOrExperience` function, currently around lines 76-101).

- [ ] **Step 1: Insert the Entrance tickets field call**

Find the `renderTourOrExperience` function's template. The current block includes `${field('Participants', r.participants ?? r.passengers)}`. Immediately after that `field('Participants', ...)` call, insert the new field call:

```ts
			${field('Entrance tickets', (r.entrance_tickets_count || 0) > 0 ? `${r.entrance_tickets_count} × €${(Number(r.entrance_tickets_total) / Number(r.entrance_tickets_count)).toFixed(2)} = €${Number(r.entrance_tickets_total).toFixed(2)}` : '')}
```

(The `field` helper returns empty string for null/empty values, so a booking with `entrance_tickets_count = 0` will produce no visible row.)

- [ ] **Step 2: Build to verify**

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run build 2>&1 | tail -3
```

Expected: `[build] 63 page(s) built` clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add src/components/ReservationDetailModal.astro && git commit -m "$(cat <<'EOF'
feat(modal): show entrance tickets row in tour reservation detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Playwright smoke + DB verify + journal + push/merge

**Files:**
- Modify: `qa/2026-04-22-full-smoke-test.md` (append Section 24).

- [ ] **Step 1: Start dev server**

```bash
cd /Users/marios/Desktop/Cursor/opaway && lsof -iTCP:4322 -sTCP:LISTEN -t 2>/dev/null || (nohup npx astro dev --port 4322 > /tmp/opaway-dev.log 2>&1 & disown)
```

Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:4322/` returns `200`. Expected: listening on 4322.

- [ ] **Step 2: Ensure the smoke tour has entrance ticket config**

If the smoke tour "Smoke Multi Day" (id `d8d51bd2-aa7b-4ae3-b4dd-b2f652f0aa4e`) does not already have `entrance_ticket_per_person` set, set it to €12.00 with `entrance_ticket_count = 1` (per-person):

```bash
PAT=$(cat /Users/marios/Desktop/Cursor/opaway/.supabase-pat)
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"update public.tours_catalog set entrance_ticket_per_person = 12, entrance_ticket_count = 1 where id = 'd8d51bd2-aa7b-4ae3-b4dd-b2f652f0aa4e' returning id, entrance_ticket_per_person, entrance_ticket_count;\"}"
```

Expected: one row with `entrance_ticket_per_person = 12` and `entrance_ticket_count = 1`. If no row matches, escalate — the test tour may have been deleted.

- [ ] **Step 3: Playwright — zero-price tour hides the block**

Find a tour with `entrance_ticket_per_person = 0`:

```bash
PAT=$(cat /Users/marios/Desktop/Cursor/opaway/.supabase-pat)
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"select id, name, entrance_ticket_per_person from public.tours_catalog where (entrance_ticket_per_person is null or entrance_ticket_per_person = 0) limit 1;\"}"
```

If at least one row returns, note the id. Navigate `/book/tour/passenger?tourId=<id>&tourName=TEST&participants=2&totalPrice=100.00` via Playwright.

Via `mcp__playwright__browser_evaluate`, check:

```js
() => ({
  blockHidden: document.getElementById('entrance-tickets-block')?.classList.contains('hidden'),
  ticketsRow: document.getElementById('sb-tickets-row')?.classList.contains('hidden'),
  total: document.getElementById('sb-total')?.textContent,
})
```

Expected: `blockHidden = true`, `ticketsRow = true`, `total` equals `€ 100.00`. If no zero-price tour exists, skip this check and note in journal.

- [ ] **Step 4: Playwright — priced tour shows block pre-selected**

Log in as `smoke-user-2026-04-22@opawey.test` / `SmokeTest!2026-04-22`. Navigate the reference URL:

```
http://localhost:4322/book/tour/passenger?tourId=d8d51bd2-aa7b-4ae3-b4dd-b2f652f0aa4e&tourName=Smoke+Multi+Day&pickup=&date=2026-04-24&time=22%3A09&participants=2&vehicleSlug=sedan&vehicleName=Sedan&vehicleImage=%2Fcar.avif&totalPrice=500.00&bookingType=tour
```

Via `browser_evaluate`, verify:

```js
() => ({
  blockVisible: !document.getElementById('entrance-tickets-block')?.classList.contains('hidden'),
  unitPriceLabel: document.getElementById('et-unit-price')?.textContent,
  includeChecked: (document.querySelector('input[name="tickets-choice"][value="include"]') as HTMLInputElement).checked,
  countDefault: (document.getElementById('et-count') as HTMLInputElement).value,
  tourSubtotal: document.getElementById('sb-tour-subtotal')?.textContent,
  ticketsRowVisible: !document.getElementById('sb-tickets-row')?.classList.contains('hidden'),
  ticketsSubtotal: document.getElementById('sb-tickets-subtotal')?.textContent,
  total: document.getElementById('sb-total')?.textContent,
})
```

Expected: `blockVisible=true`, `unitPriceLabel=€12.00 per ticket`, `includeChecked=true`, `countDefault="2"` (1 per person × 2 participants), `tourSubtotal=€ 500.00`, `ticketsRowVisible=true`, `ticketsSubtotal=€ 24.00`, `total=€ 524.00`.

- [ ] **Step 5: Playwright — toggle off clears tickets**

Click the "No tickets needed" radio:

```js
() => {
  const r = document.querySelector('input[name="tickets-choice"][value="skip"]') as HTMLInputElement;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    ticketsRowHidden: document.getElementById('sb-tickets-row')?.classList.contains('hidden'),
    total: document.getElementById('sb-total')?.textContent,
    countWrapHidden: document.getElementById('et-count-wrap')?.classList.contains('hidden'),
  };
}
```

Expected: `ticketsRowHidden=true`, `total="€ 500.00"`, `countWrapHidden=true`.

- [ ] **Step 6: Playwright — live input update with count=3**

Switch back to "Include entrance tickets" and set count to 3:

```js
() => {
  const r = document.querySelector('input[name="tickets-choice"][value="include"]') as HTMLInputElement;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
  const c = document.getElementById('et-count') as HTMLInputElement;
  c.value = '3';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    ticketsSubtotal: document.getElementById('sb-tickets-subtotal')?.textContent,
    total: document.getElementById('sb-total')?.textContent,
  };
}
```

Expected: `ticketsSubtotal="€ 36.00"`, `total="€ 536.00"`.

- [ ] **Step 7: Playwright — continue to payment preserves state**

Fill first/last/email/phone (use auth-autofilled email, first "Smoke", last "User", phone "6931234567"). Click Continue. On `/book/tour/payment`, verify URL contains `ticketCount=3&ticketUnitPrice=12.00` (or equivalent) and the sidebar matches:

```js
() => ({
  url: location.search,
  tourSubtotal: document.getElementById('sb-tour-subtotal')?.textContent,
  ticketsSubtotal: document.getElementById('sb-tickets-subtotal')?.textContent,
  total: document.getElementById('sb-total')?.textContent,
})
```

Expected: URL contains both params, `tourSubtotal=€ 500.00`, `ticketsSubtotal=€ 36.00`, `total=€ 536.00`.

- [ ] **Step 8: Playwright — complete with Cash on-site**

Click "Cash on-site" radio, then "Complete Booking". Wait for success panel. Capture the 8-char `#success-ref` value.

- [ ] **Step 9: SQL verify the booking row**

Use the 8-char ref (lowercase) captured in Step 8:

```bash
REF=<8char-from-step-8-lowercased>
PAT=$(cat /Users/marios/Desktop/Cursor/opaway/.supabase-pat)
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"select id, total_price, entrance_tickets_count, entrance_tickets_total, booking_type from public.tours where id::text like '${REF}%' limit 1;\"}"
```

Expected: `entrance_tickets_count=3`, `entrance_tickets_total=36`, `total_price=536`, `booking_type=tour`.

- [ ] **Step 10: Playwright — admin modal renders the Entrance tickets row**

Log out. Log in as smoke admin. Navigate `/admin/tours`. Find the new booking row (by ref or recency). Click a cell to open the detail modal:

```js
() => {
  const body = document.getElementById('res-detail-body');
  const text = body?.textContent?.replace(/\s+/g, ' ').trim();
  return {
    hasEntrance: /Entrance tickets/i.test(text || ''),
    entranceLine: text?.match(/Entrance tickets\s+([\d× €.,]+)/)?.[0],
  };
}
```

Expected: `hasEntrance=true`, `entranceLine` matches `Entrance tickets 3 × €12.00 = €36.00` (formatting may vary slightly).

Also open a control tour booking with `entrance_tickets_count = 0` (any pre-existing tour booking from before this feature) and verify `hasEntrance=false`.

- [ ] **Step 11: Append journal Section 24**

Open `qa/2026-04-22-full-smoke-test.md`. Find the last section (Section 23 from hotel-discount work). Append after it:

```md

---

### Section 24 — Tour entrance tickets

Branch: `feat/tour-entrance-tickets`
Date: 2026-04-24
Spec: `docs/superpowers/specs/2026-04-24-tour-entrance-tickets-design.md`
Plan: `docs/superpowers/plans/2026-04-24-tour-entrance-tickets.md`
Dev server: http://localhost:4322

End-to-end test booking: tour ref `<8-char ref>` (`<full uuid>`), tour `Smoke Multi Day` @ €500.00 + 3 tickets × €12 = €536.00, cash on-site.

| Check | Result |
|---|---|
| Zero-price tour — entrance-tickets block stays hidden | pass |
| Priced tour (€12) — block visible, "Include" pre-checked, count defaulted to 2 (1 × 2 pax) | pass |
| Price label shows `€12.00 per ticket` | pass |
| Sidebar shows Tour €500.00 row | pass |
| Sidebar shows Entrance tickets €24.00 row | pass |
| Sidebar Total shows €524.00 | pass |
| Toggle "No tickets" — tickets row hides, Total back to €500.00, input hidden | pass |
| Toggle back + set count=3 — tickets subtotal €36.00, Total €536.00 (live) | pass |
| Continue → payment URL carries `ticketCount=3` + `ticketUnitPrice=12.00` | pass |
| Payment sidebar breakdown matches (Tour €500.00 / Entrance tickets €36.00 / Total €536.00) | pass |
| Booked tour row: `entrance_tickets_count=3`, `entrance_tickets_total=36`, `total_price=536` (SQL-verified) | pass |
| Admin reservation modal shows `Entrance tickets 3 × €12.00 = €36.00` for new booking | pass |
| Admin reservation modal hides Entrance tickets row on legacy 0-count booking | pass |
| Build (`npm run build`) — 63 pages, 0 errors, 0 warnings | pass |

No findings. Feature ready to merge.
```

Replace `<8-char ref>` and `<full uuid>` with the actual values from Step 8/9.

- [ ] **Step 12: Commit journal + push + FF merge to main**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add qa/2026-04-22-full-smoke-test.md && git commit -m "$(cat <<'EOF'
qa: smoke verify — tour entrance tickets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin feat/tour-entrance-tickets
git checkout main
git pull --ff-only origin main
git merge --ff-only feat/tour-entrance-tickets
git push origin main
git checkout feat/tour-entrance-tickets
```

Expected: clean fast-forward, no merge conflicts (only new files + append-only journal + well-scoped edits).

- [ ] **Step 13: Stop dev server**

```bash
kill $(lsof -tiTCP:4322 -sTCP:LISTEN 2>/dev/null) 2>/dev/null
```

---

## Self-review

**1. Spec coverage.**

- Spec "Schema migration" → Task 2 applies the migration to prod via PAT. ✓
- Spec "Trigger: entrance_ticket_per_person > 0 (category-agnostic)" → Task 3 Step 2 gates block reveal on `ticketUnitPrice > 0` only. ✓
- Spec UI — radio group styled like hotel-choice, number input min/max/step, subtotal line — Task 3 Step 3 has the exact markup. ✓
- Spec "Default value = entrance_ticket_count × participants if > 0 else participants" → Task 3 Step 2 (`ticketDefaultCount`). ✓
- Spec "Sidebar three-row breakdown" → Task 3 Step 4 (passenger) + Task 4 Step 2 (payment). ✓
- Spec "Payment recompute final total" → Task 4 Step 4 folds `ticketsSubtotal` into `baseTotal`, so both the card-on-site surcharge and the `finalTotal` cascade correctly. ✓
- Spec "Insert new columns" → Task 4 Step 5 adds both columns to the payload. ✓
- Spec "Admin modal field('Entrance tickets', ...)" → Task 5 has the exact field call. ✓
- Spec testing scenarios 1-7 → Task 6 Steps 3-10 have Playwright + SQL commands for each. ✓
- Spec "Out of scope: experiences, transfers, commission math" → no tasks touch those files. ✓

No spec gaps.

**2. Placeholder scan.**

Intentional runtime substitutions (not placeholders):
- `<8char-from-step-8-lowercased>` / `<8-char ref>` / `<full uuid>` — values captured at runtime in Step 8 and substituted before Step 9 / Step 11.

No TBDs, no "add validation" handwaves, no "similar to Task N" cross-references. Every step has concrete code, commands, and expected output.

**3. Type consistency.**

- URL param names: `ticketCount`, `ticketUnitPrice` (camelCase) — used identically in Task 3 Step 6 (passenger forward) and Task 4 Step 1 (payment read).
- DB column names: `entrance_tickets_count`, `entrance_tickets_total` (snake_case, plural) — used consistently in migration (Task 2), payment insert (Task 4 Step 5), modal read (Task 5), and verification SQL (Task 6 Step 9).
- DOM IDs: `entrance-tickets-block`, `et-count`, `et-unit-price`, `et-subtotal`, `et-count-wrap`, `sb-tour-subtotal`, `sb-tickets-row`, `sb-tickets-subtotal`, `sb-total` — unique, stable across Tasks 3, 4, 6.
- Input name: `tickets-choice` with values `include` / `skip` — used in Task 3 Step 3 (HTML), Step 5 (listener), Step 6 (forward check), Task 6 Step 5/6 (Playwright clicks).
- Branch name `feat/tour-entrance-tickets` — consistent across Tasks 1 + 6.

No inconsistencies.
