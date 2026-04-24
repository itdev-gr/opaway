# Tour Entrance Ticket Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional admin-set ticket name (e.g. "Knossos Entry Ticket") that flows from `tours_catalog` through the customer booking flow onto the `tours` booking row and into the admin reservation modal. Falls back to "Entrance tickets" when unset.

**Architecture:** Two nullable text columns — one on `tours_catalog` (admin-edited) and one on `tours` (booking-time snapshot so renames don't rewrite history). The name is fetched in the passenger step alongside the existing catalog fields, forwarded through URL params to the payment step, and persisted on the booking insert. Everywhere the label "Entrance tickets" appears today, a `(name || 'Entrance tickets')` fallback replaces the static text.

**Tech Stack:** Astro pages with inline `<script>` (vanilla TS), Supabase JS client, Tailwind CSS, Supabase Postgres.

---

## Spec reference

`docs/superpowers/specs/2026-04-24-tour-entrance-ticket-name-design.md`

## File map

| File | Type | Responsibility |
|---|---|---|
| `db/migrations/2026-04-24-tours-entrance-ticket-name.sql` | Create | Add `tours_catalog.entrance_ticket_name` and `tours.entrance_tickets_name` (both nullable text). |
| `src/pages/admin/manage-tours.astro` | Modify | Name input in Add form + Edit modal; wire into insert/update/edit-load/row-mapper/CatalogItem interface. |
| `src/pages/book/tour/passenger.astro` | Modify | Add ID to block heading; fetch + apply name label to heading and sidebar row; forward `ticketName` in URL. |
| `src/pages/book/tour/payment.astro` | Modify | Parse `ticketName`; apply to both order-summary and sidebar row labels; insert `entrance_tickets_name` on `tours` row. |
| `src/components/ReservationDetailModal.astro` | Modify | Use snapshotted `r.entrance_tickets_name` as the field label when present. |

---

## Task 1: Database migration

**Files:**
- Create: `db/migrations/2026-04-24-tours-entrance-ticket-name.sql`

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-04-24-tours-entrance-ticket-name.sql` with exactly this content:

```sql
alter table public.tours_catalog
  add column if not exists entrance_ticket_name text;

alter table public.tours
  add column if not exists entrance_tickets_name text;
```

- [ ] **Step 2: Apply the migration to the dev/prod Supabase project**

Apply using whatever method the repo uses for other `db/migrations/*.sql` files (e.g. pasting into the Supabase SQL editor, or a CLI invocation consistent with prior migrations like `2026-04-24-tours-entrance-tickets.sql`). Ask the user which method they use for this repo before running.

- [ ] **Step 3: Verify schema**

Run in Supabase SQL editor (or equivalent):

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where (table_name = 'tours_catalog' and column_name = 'entrance_ticket_name')
   or (table_name = 'tours' and column_name = 'entrance_tickets_name');
```

Expected: two rows, both `text`, both `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-04-24-tours-entrance-ticket-name.sql
git commit -m "db: add entrance_ticket_name to tours_catalog and tours"
```

---

## Task 2: Admin — Add Tour form input + submit wiring

**Files:**
- Modify: `src/pages/admin/manage-tours.astro`

- [ ] **Step 1: Add the name input to the Add form**

In `src/pages/admin/manage-tours.astro`, locate the `<!-- Entrance ticket -->` block (currently around line 107). Insert a new full-width block **immediately before** the existing `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` that holds the price/count inputs:

```html
				<!-- Entrance ticket name -->
				<div>
					<label class="block text-xs font-semibold text-neutral-600 mb-1.5 uppercase tracking-wider">Ticket name</label>
					<input id="f-entrance-name" type="text" maxlength="80" placeholder="e.g. Knossos Entry Ticket" class="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] shadow-sm" />
					<p class="text-xs text-neutral-400 mt-1.5">Optional. Shown to customers next to the ticket price.</p>
				</div>
```

- [ ] **Step 2: Update the Add form submit handler**

Still in `src/pages/admin/manage-tours.astro`, find the `form.addEventListener('submit', async (e) => {` block (currently around line 594). After the line that reads `entranceCount`:

```ts
		const entranceCount = parseInt((document.getElementById('f-entrance-count') as HTMLInputElement).value) || 0;
```

Add on the next line:

```ts
		const entranceName  = (document.getElementById('f-entrance-name')  as HTMLInputElement).value.trim();
```

- [ ] **Step 3: Include the name in the insert payload**

In the same submit handler, find the `supabase.from('tours_catalog').insert({` call. After the `entrance_ticket_count: entranceCount,` line, add:

```ts
					entrance_ticket_name: entranceName || null,
```

- [ ] **Step 4: Include the name in the in-memory catalog push**

In the same handler, find the `items.unshift({ ... entrancePrice, entranceCount, ... })` call (currently around line 640). Change:

```ts
				entrancePrice, entranceCount,
```

to:

```ts
				entrancePrice, entranceCount, entranceName,
```

- [ ] **Step 5: Verify the form posts correctly**

Start the dev server if it isn't running:

```bash
./start-dev.sh
```

Navigate to `http://localhost:4321/admin/manage-tours` as an admin. Fill out the Add form including a "Ticket name" value, submit. Then run in SQL:

```sql
select title, entrance_ticket_name from public.tours_catalog order by created_at desc limit 1;
```

Expected: the name you typed appears. If you left the name blank on a different submission, the column is `null` (not an empty string).

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/manage-tours.astro
git commit -m "feat(admin): ticket name input on add-tour form"
```

---

## Task 3: Admin — CatalogItem interface, row mapper, and Edit modal input

**Files:**
- Modify: `src/pages/admin/manage-tours.astro`

- [ ] **Step 1: Extend the CatalogItem interface**

In `src/pages/admin/manage-tours.astro`, find the `interface CatalogItem` (around line 342). Change:

```ts
		entrancePrice: number; entranceCount: number;
```

to:

```ts
		entrancePrice: number; entranceCount: number; entranceName: string;
```

- [ ] **Step 2: Map the column when loading the catalog**

In the same file, find the row-mapper in `items = (data ?? []).map((d: any) => { ... })` (around line 561). After:

```ts
					entrancePrice: Number(d.entrance_ticket_per_person ?? 0),
					entranceCount: Number(d.entrance_ticket_count ?? 0),
```

Add on the next line:

```ts
					entranceName: d.entrance_ticket_name || '',
```

- [ ] **Step 3: Add the name input to the Edit modal**

Find the `<!-- Edit Entrance ticket -->` block (currently around line 284). Insert a new full-width block **immediately before** the `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` that holds the edit price/count:

```html
					<!-- Edit Entrance ticket name -->
					<div>
						<label class="block text-xs font-semibold text-neutral-600 mb-1.5 uppercase tracking-wider">Ticket name</label>
						<input id="e-entrance-name" type="text" maxlength="80" placeholder="e.g. Knossos Entry Ticket" class="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] shadow-sm" />
						<p class="text-xs text-neutral-400 mt-1.5">Optional. Shown to customers next to the ticket price.</p>
					</div>
```

- [ ] **Step 4: Populate the input on modal open**

Find `function openEditModal(id: string)` (around line 693). After:

```ts
			(document.getElementById('e-entrance-price') as HTMLInputElement).value  = String(item.entrancePrice ?? 0);
			(document.getElementById('e-entrance-count') as HTMLInputElement).value  = String(item.entranceCount ?? 0);
```

Add on the next line:

```ts
			(document.getElementById('e-entrance-name')  as HTMLInputElement).value  = item.entranceName || '';
```

- [ ] **Step 5: Read the name in the Edit save handler and include in update payload**

Find `document.getElementById('edit-save')?.addEventListener('click', async () => {` (around line 737). After:

```ts
		const entranceCount = parseInt((document.getElementById('e-entrance-count') as HTMLInputElement).value) || 0;
```

Add on the next line:

```ts
		const entranceName  = (document.getElementById('e-entrance-name')  as HTMLInputElement).value.trim();
```

Then find the `supabase.from('tours_catalog').update({ ... })` call. After `entrance_ticket_count: entranceCount,`, add:

```ts
				entrance_ticket_name: entranceName || null,
```

- [ ] **Step 6: Include the name in the in-memory Object.assign**

Still in the same save handler, find `Object.assign(item, { ... entrancePrice, entranceCount, ... })` (around line 791). Change:

```ts
				entrancePrice, entranceCount,
```

to:

```ts
				entrancePrice, entranceCount, entranceName,
```

- [ ] **Step 7: Verify the edit flow**

Reload `/admin/manage-tours`. Click Edit on the tour created in Task 2. The "Ticket name" input should be pre-filled with the existing value. Change it to a new value, save. Run:

```sql
select title, entrance_ticket_name from public.tours_catalog where id = '<that tour id>';
```

Expected: column reflects the new name. Also clear the field, save, and confirm it becomes `null`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/admin/manage-tours.astro
git commit -m "feat(admin): ticket name in edit modal + catalog mapping"
```

---

## Task 4: Customer — passenger.astro (fetch + label + URL forward)

**Files:**
- Modify: `src/pages/book/tour/passenger.astro`

- [ ] **Step 1: Add an ID to the block heading**

In `src/pages/book/tour/passenger.astro`, find the entrance-tickets block heading (currently around line 106):

```html
									<p class="block text-sm font-medium text-neutral-700">Entrance tickets</p>
```

Change it to:

```html
									<p id="et-heading" class="block text-sm font-medium text-neutral-700">Entrance tickets</p>
```

- [ ] **Step 2: Add an ID to the sidebar row label**

Find the sidebar tickets row (currently around line 217-220):

```html
								<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
									<span>Entrance tickets</span>
									<span id="sb-tickets-subtotal">—</span>
								</div>
```

Change the label `<span>` to have an ID:

```html
								<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
									<span id="sb-tickets-label">Entrance tickets</span>
									<span id="sb-tickets-subtotal">—</span>
								</div>
```

- [ ] **Step 3: Fetch the name from the catalog**

Find the catalog fetch (around line 293-297):

```ts
		const { data: tourRow } = await supabase
			.from('tours_catalog')
			.select('category, hotel_option, entrance_ticket_per_person, entrance_ticket_count')
			.eq('id', tourId)
			.maybeSingle();
```

Change the `.select(...)` to include the new column:

```ts
		const { data: tourRow } = await supabase
			.from('tours_catalog')
			.select('category, hotel_option, entrance_ticket_per_person, entrance_ticket_count, entrance_ticket_name')
			.eq('id', tourId)
			.maybeSingle();
```

- [ ] **Step 4: Resolve the label and apply it**

Still inside the same `async` IIFE, find the block that reveals the entrance-tickets UI (currently around line 314-321, starting with `if (ticketUnitPrice > 0) {`). Replace the entire `if` body with:

```ts
		if (ticketUnitPrice > 0) {
			const rawName = (tourRow.entrance_ticket_name || '').trim();
			ticketName = rawName;
			const ticketLabel = rawName || 'Entrance tickets';
			setText('et-heading', ticketLabel);
			setText('sb-tickets-label', ticketLabel);
			const block = document.getElementById('entrance-tickets-block');
			block?.classList.remove('hidden');
			setText('et-unit-price', `€${ticketUnitPrice.toFixed(2)} per ticket`);
			const countInput = document.getElementById('et-count') as HTMLInputElement;
			countInput.value = String(ticketDefaultCount);
			recomputeTicketsAndSidebar();
		}
```

(The new lines are: capturing the trimmed admin-set name, stashing it in `ticketName` for URL forwarding, resolving the `ticketLabel` display string, and the two `setText` calls.)

- [ ] **Step 5: Declare the ticketName state**

Find the `let ticketUnitPrice = 0;` declaration (around line 286). Add a new line immediately after:

```ts
	let ticketName = '';
```

Final block should look like:

```ts
	let ticketUnitPrice = 0;
	let ticketName = '';
	let ticketDefaultCount = 0;
```

- [ ] **Step 6: Forward the name through the URL on Continue**

Find the Continue handler's URL-forwarding block (around line 430-437):

```ts
		const includeRadio = document.querySelector<HTMLInputElement>('input[name="tickets-choice"][value="include"]');
		const countInput = document.getElementById('et-count') as HTMLInputElement | null;
		const ticketCount = (includeRadio?.checked && countInput) ? Math.max(0, parseInt(countInput.value || '0', 10) || 0) : 0;

		if (ticketCount > 0 && ticketUnitPrice > 0) {
			p.set('ticketCount', String(ticketCount));
			p.set('ticketUnitPrice', ticketUnitPrice.toFixed(2));
		}
```

Change to:

```ts
		const includeRadio = document.querySelector<HTMLInputElement>('input[name="tickets-choice"][value="include"]');
		const countInput = document.getElementById('et-count') as HTMLInputElement | null;
		const ticketCount = (includeRadio?.checked && countInput) ? Math.max(0, parseInt(countInput.value || '0', 10) || 0) : 0;

		if (ticketCount > 0 && ticketUnitPrice > 0) {
			p.set('ticketCount', String(ticketCount));
			p.set('ticketUnitPrice', ticketUnitPrice.toFixed(2));
			if (ticketName) p.set('ticketName', ticketName);
		}
```

- [ ] **Step 7: Verify**

In the browser, navigate to a full tour search → select a tour that has a ticket name set (the one you edited in Task 3) → arrive at `/book/tour/passenger`. Confirm:
1. Block heading reads the ticket name (e.g. "Knossos Entry Ticket"), not "Entrance tickets".
2. Sidebar "Price details" row also reads the ticket name.
3. Click Continue. The URL on `/book/tour/payment` includes `&ticketName=Knossos%20Entry%20Ticket`.

Repeat with a tour that has no ticket name set (or where you cleared it). Confirm both labels fall back to "Entrance tickets" and the URL does NOT include `ticketName`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/book/tour/passenger.astro
git commit -m "feat(book): show ticket name on passenger step and forward in URL"
```

---

## Task 5: Customer — payment.astro (parse + label + insert)

**Files:**
- Modify: `src/pages/book/tour/payment.astro`

- [ ] **Step 1: Add IDs to both "Entrance tickets" labels**

In `src/pages/book/tour/payment.astro`, find the order-summary tickets row (currently around line 72-75):

```html
							<div id="os-tickets-row" class="hidden flex items-center justify-between text-sm text-neutral-500">
								<span>Entrance tickets</span>
								<span id="os-tickets-subtotal">—</span>
							</div>
```

Change the label `<span>` to have an ID:

```html
							<div id="os-tickets-row" class="hidden flex items-center justify-between text-sm text-neutral-500">
								<span id="os-tickets-label">Entrance tickets</span>
								<span id="os-tickets-subtotal">—</span>
							</div>
```

Then find the sidebar tickets row (currently around line 252-255):

```html
								<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
									<span>Entrance tickets</span>
									<span id="sb-tickets-subtotal">—</span>
								</div>
```

Change similarly:

```html
								<div id="sb-tickets-row" class="hidden flex justify-between text-sm text-neutral-500">
									<span id="sb-tickets-label">Entrance tickets</span>
									<span id="sb-tickets-subtotal">—</span>
								</div>
```

- [ ] **Step 2: Parse ticketName from URL and resolve the label**

Find the ticket URL-param parsing block (around line 320-322):

```ts
	const ticketCount = Math.max(0, parseInt(params.get('ticketCount') || '0', 10) || 0);
	const ticketUnitPrice = Math.max(0, parseFloat(params.get('ticketUnitPrice') || '0') || 0);
	const ticketsSubtotal = Math.round(ticketCount * ticketUnitPrice * 100) / 100;
```

Change to:

```ts
	const ticketCount = Math.max(0, parseInt(params.get('ticketCount') || '0', 10) || 0);
	const ticketUnitPrice = Math.max(0, parseFloat(params.get('ticketUnitPrice') || '0') || 0);
	const ticketsSubtotal = Math.round(ticketCount * ticketUnitPrice * 100) / 100;
	const ticketName = (params.get('ticketName') || '').trim();
	const ticketLabel = ticketName || 'Entrance tickets';
```

- [ ] **Step 3: Apply the label to the order summary**

Find the `if (ticketsSubtotal > 0) { ... }` block (around line 342-345):

```ts
	if (ticketsSubtotal > 0) {
		document.getElementById('os-tickets-row')?.classList.remove('hidden');
		setText('os-tickets-subtotal', `€${ticketsSubtotal.toFixed(2)}`);
	}
```

Change to:

```ts
	if (ticketsSubtotal > 0) {
		document.getElementById('os-tickets-row')?.classList.remove('hidden');
		setText('os-tickets-label', ticketLabel);
		setText('os-tickets-subtotal', `€${ticketsSubtotal.toFixed(2)}`);
	}
```

- [ ] **Step 4: Apply the label to the sidebar**

Immediately after the `if (ticketsSubtotal > 0) { ... }` block edited in Step 3, add one unconditional line at the same indentation level:

```ts
	setText('sb-tickets-label', ticketLabel);
```

Setting it unconditionally is safe: when `ticketsSubtotal === 0`, `#sb-tickets-row` stays hidden so the label never renders. The value is kept in sync for the case where the row is later revealed by the existing subtotal pipeline.

- [ ] **Step 5: Persist the name on the tours booking row**

Find the `supabase.from('tours').insert({ ... })` call (around line 449-475). After the lines:

```ts
				entrance_tickets_count: ticketCount,
				entrance_tickets_total: ticketsSubtotal,
```

Add:

```ts
				entrance_tickets_name: ticketName || null,
```

- [ ] **Step 6: Verify the payment flow**

In the browser, continue the flow you started in Task 4 Step 7. On `/book/tour/payment`:
1. Order-summary "Entrance tickets" row reads the ticket name (e.g. "Knossos Entry Ticket").
2. Right sidebar "Entrance tickets" row reads the same ticket name.

Complete the booking with "Cash on-site" (or whichever method is simplest). Then verify:

```sql
select id, tour_name, entrance_tickets_name, entrance_tickets_count, entrance_tickets_total
from public.tours
order by created_at desc
limit 1;
```

Expected: `entrance_tickets_name` equals the forwarded name. Do a second booking with a tour that has no name set — `entrance_tickets_name` is `null`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/book/tour/payment.astro
git commit -m "feat(book): show ticket name on payment step and persist on booking"
```

---

## Task 6: Admin reservation detail modal

**Files:**
- Modify: `src/components/ReservationDetailModal.astro`

- [ ] **Step 1: Use the snapshotted name as the field label**

In `src/components/ReservationDetailModal.astro`, find the entrance-tickets field call (currently line 89):

```ts
			${field('Entrance tickets', (r.entrance_tickets_count || 0) > 0 ? `${r.entrance_tickets_count} × €${(Number(r.entrance_tickets_total) / Number(r.entrance_tickets_count)).toFixed(2)} = €${Number(r.entrance_tickets_total).toFixed(2)}` : '')}
```

Replace with:

```ts
			${field((r.entrance_tickets_name || '').trim() || 'Entrance tickets', (r.entrance_tickets_count || 0) > 0 ? `${r.entrance_tickets_count} × €${(Number(r.entrance_tickets_total) / Number(r.entrance_tickets_count)).toFixed(2)} = €${Number(r.entrance_tickets_total).toFixed(2)}` : '')}
```

- [ ] **Step 2: Verify**

In the admin UI, open the reservation detail modal for the booking you just made in Task 5. The field label should read the ticket name (e.g. "Knossos Entry Ticket") followed by `3 × €X = €Y`. Open an older booking that predates this feature (`entrance_tickets_name IS NULL`) with a non-zero count — the label should fall back to "Entrance tickets". Open a day-tour booking with `count = 0` — the row should not render at all (that's already the existing `field`-helper behavior).

- [ ] **Step 3: Commit**

```bash
git add src/components/ReservationDetailModal.astro
git commit -m "feat(admin): use snapshotted ticket name in reservation modal"
```

---

## Task 7: Full end-to-end verification

This replays the spec's 8-step test plan on the real app to confirm everything composes cleanly.

**Files:** (none — verification only)

- [ ] **Step 1: Admin can save a name**

In `/admin/manage-tours`, pick any existing priced tour (e.g. the "Smoke Multi Day" tour if present), click Edit, set Ticket name to `Knossos Entry Ticket`, Save.

```sql
select entrance_ticket_name from public.tours_catalog where id = '<that id>';
```

Expected: `Knossos Entry Ticket`.

- [ ] **Step 2: Admin can clear a name**

Edit the same tour, empty the Ticket name field, Save.

```sql
select entrance_ticket_name from public.tours_catalog where id = '<that id>';
```

Expected: `null`.

- [ ] **Step 3: Passenger block heading uses the name**

Re-set Ticket name to `Knossos Entry Ticket`. Navigate `/book/tour/passenger?tourId=<that id>&...` (via the normal search/results flow). Inspect: block heading reads `Knossos Entry Ticket`. Sidebar row reads `Knossos Entry Ticket`.

- [ ] **Step 4: Passenger block falls back when name is blank**

Find a priced tour in the DB with `entrance_ticket_name IS NULL`:

```sql
select id, title from public.tours_catalog where entrance_ticket_per_person > 0 and entrance_ticket_name is null limit 1;
```

Navigate to its passenger page. Block heading reads `Entrance tickets`. Sidebar row reads `Entrance tickets`.

- [ ] **Step 5: Payment sidebar uses the forwarded name**

Continue from Step 3 to `/book/tour/payment`. URL should carry `ticketName=Knossos%20Entry%20Ticket`. Payment order-summary row reads `Knossos Entry Ticket`. Right sidebar row reads `Knossos Entry Ticket`.

- [ ] **Step 6: Booking row snapshots the name**

Complete the booking with Cash on-site.

```sql
select id, tour_name, entrance_tickets_name, entrance_tickets_count, entrance_tickets_total, total_price
from public.tours
order by created_at desc limit 1;
```

Expected: `entrance_tickets_name = 'Knossos Entry Ticket'`, count and total nonzero.

- [ ] **Step 7: Admin modal uses the snapshotted name**

In the admin reservations view, open the just-completed booking's detail modal. The row label reads `Knossos Entry Ticket: 3 × €12.00 = €36.00` (or whatever the count/price are). Open an older booking with `entrance_tickets_name IS NULL` and nonzero count — label falls back to `Entrance tickets`.

- [ ] **Step 8: Rename-after-booking preserves the snapshot**

In `/admin/manage-tours`, edit the tour from Step 1 and rename Ticket name to `Knossos Palace Ticket`, Save. Re-open the *already-persisted* booking from Step 6 in the admin modal — it still reads `Knossos Entry Ticket`. Start a *new* booking on that tour → passenger heading now reads `Knossos Palace Ticket`, and the new booking's `tours.entrance_tickets_name` column stores `Knossos Palace Ticket`.

- [ ] **Step 9: Commit if any follow-up fixes were needed**

If Steps 1-8 all passed without code changes, nothing to commit. If any fix was made during verification, commit it with:

```bash
git add <changed files>
git commit -m "fix: <specific issue found during verification>"
```

- [ ] **Step 10: Mark the plan complete**

Report back to the user with:
1. Summary of commits made (`git log --oneline main..HEAD`).
2. Any deviations from the plan.
3. The reference ID of the test booking created in Step 6, so they can inspect it in the admin UI.

---

## Out of scope (do not implement here)

- Tour card / results page / tour detail page ticket-name display.
- Experiences and transfers.
- Commission / discount / partner pricing logic changes.
- Backfill of existing rows.
