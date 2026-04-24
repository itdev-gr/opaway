# Driver Available Rides — Show Total Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each ride's total customer price on every card in the driver's Available Rides dashboard, rendered between the existing "Details" column (vehicle type badge + passenger count) and the Accept / Reject action buttons.

**Architecture:** Single-file UI change to `src/pages/driver/available.astro`. No schema work — `transfers.total_price` already exists, and the card's `select('*')` query already returns it. We (a) add `total_price` to the in-memory `Ride` interface and mapping, (b) add a new 6th column in the card grid showing the formatted price (matching `past.astro`'s `€X.XX` style), and (c) bump `md:grid-cols-5` to `md:grid-cols-6`. No new component — the card is page-local and every other driver-list page already inlines its own markup the same way.

**Tech Stack:** Astro 5 (file-based pages, inline `<script>`), Tailwind v4, Supabase JS v2.

**Out of scope (explicit):**
- Driver payout (80%) breakdown — that already lives on the ride detail page (`/driver/ride`). The available-rides card intentionally shows the *total customer price* so the driver can evaluate the ride at a glance; the full payout math only matters once accepted.
- Currency selection — the rest of the driver UI hard-codes EUR; we follow suit.
- Schema changes — `total_price` is already a column on `public.transfers` (used by `past.astro`, `ride.astro`).
- Layout changes on `/driver/upcoming` or `/driver/past` — those cards already show their own price/payout lines; only the available-rides card is missing it.

---

## Current state (verified before writing this plan)

- `src/pages/driver/available.astro` renders each ride card with `md:grid-cols-5`:
  1. Booking Ref + date/time
  2. Pickup
  3. Dropoff
  4. Details (vehicle badge + `New` badge + passengers)
  5. Actions (Accept / Reject)
- The `Ride` interface (lines 54-63) does **not** include `total_price`, and the mapping at lines 219-228 does **not** copy it across, even though `.select('*')` on `transfers` returns it.
- Pricing precedent:
  - `src/pages/driver/past.astro:78` uses `Number(r.total_price) || 0` and `src/pages/driver/past.astro:129` formats it as `€${payout}` (using template literal + `.toFixed(2)`).
  - `src/pages/driver/ride.astro:485` defines `const fmt = (n: number) => \`€${n.toFixed(2)}\`;` and at line 466 falls back `d.base_price ?? d.total_price ?? 0`.
- The card grid is built as a single template literal string inside `renderRides()` (lines 88-149). Adding a column = adding one more `<div>` block and changing one Tailwind class on the wrapping grid.

## File structure (after plan executes)

### Modified files

| Path | Change |
|---|---|
| `src/pages/driver/available.astro` | `Ride` interface gains `total_price: number`; mapping copies `Number(data.total_price) \|\| 0`; card grid becomes `md:grid-cols-6`; new 5th column renders the price between Details and Actions. |

### New files

None.

---

## Task 1: Surface `total_price` in the Available Rides card

**Files:**
- Modify: `src/pages/driver/available.astro`

### Step 1: Extend the `Ride` interface

- [ ] **Step 1** — Add a `total_price` field.

In `src/pages/driver/available.astro`, replace the `Ride` interface (currently lines 54-63):

```ts
interface Ride {
    id: string;
    date: string;
    time: string;
    from: string;
    to: string;
    vehicle_name: string;
    passengers: number;
    driver_uid: string;
}
```

with:

```ts
interface Ride {
    id: string;
    date: string;
    time: string;
    from: string;
    to: string;
    vehicle_name: string;
    passengers: number;
    driver_uid: string;
    total_price: number;
}
```

### Step 2: Populate `total_price` in the Supabase-row mapping

- [ ] **Step 2** — Copy `total_price` from the row.

In the same file, find the `.map(...)` block inside `loadRides()` (currently lines 219-228):

```ts
allRides = (rows || [])
    .map((data: any) => ({
        id: data.id,
        date: data.date || '',
        time: data.time || '',
        from: data.from || '',
        to: data.to || '',
        vehicle_name: data.vehicle_name || '',
        passengers: data.passengers || 0,
        driver_uid: data.driver_uid || '',
    }))
    .filter(r => !r.driver_uid || r.driver_uid === '');
```

and replace with:

```ts
allRides = (rows || [])
    .map((data: any) => ({
        id: data.id,
        date: data.date || '',
        time: data.time || '',
        from: data.from || '',
        to: data.to || '',
        vehicle_name: data.vehicle_name || '',
        passengers: data.passengers || 0,
        driver_uid: data.driver_uid || '',
        total_price: Number(data.total_price) || 0,
    }))
    .filter(r => !r.driver_uid || r.driver_uid === '');
```

**Why the `Number(...) || 0` pattern:** `total_price` comes back from Supabase as a numeric (string in some client versions). This matches exactly how `past.astro:162` reads the same column, keeping the two driver list pages symmetric.

### Step 3: Bump the card grid to 6 columns

- [ ] **Step 3** — Change `md:grid-cols-5` → `md:grid-cols-6`.

In the template literal inside `renderRides()`, find the wrapping `<div class="grid ...">` (currently line 93):

```html
<div class="grid grid-cols-1 md:grid-cols-5 gap-4 p-5 items-center">
```

and replace with:

```html
<div class="grid grid-cols-1 md:grid-cols-6 gap-4 p-5 items-center">
```

### Step 4: Compute the formatted price string

- [ ] **Step 4** — Inside the `rides.map(r => { ... })` callback in `renderRides()`, right after the existing `const ref = r.id.substring(0, 8).toUpperCase();` line (currently line 89), add:

```ts
const priceStr = `€${(r.total_price || 0).toFixed(2)}`;
```

**Why `€`:** identical escape used in `ride.astro:485` — lets us keep the file ASCII-clean and matches established style. `€` is the Euro sign (€).

**Why the `|| 0` guard:** defensive in case the DB row lacks the column on some legacy bookings; `.toFixed()` on `undefined` would throw.

### Step 5: Insert the Price column between Details and Actions

- [ ] **Step 5** — Add a new column block in the card's template literal.

Find the Details column block (currently lines 122-134, the `<!-- Details -->` block ending before `<!-- Actions -->`). Immediately after the closing `</div>` of the Details column and **before** the `<!-- Actions -->` comment, insert this new block:

```html
<!-- Price -->
<div class="flex flex-col gap-1 md:items-end">
    <p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Total</p>
    <p class="text-lg font-bold text-neutral-900">${priceStr}</p>
</div>
```

**Why these Tailwind classes:**
- `md:items-end` mirrors the right-aligned Actions column visually on desktop, so the price reads as a ledger column next to the buttons.
- `text-lg font-bold text-neutral-900` makes the number the most prominent text in the row (bigger than booking-ref/addresses) — drivers scanning the list should spot price first.
- On mobile (`grid-cols-1`) the block stacks naturally like every other column, with a left-aligned label/value.
- `text-xs font-semibold uppercase tracking-wider` on the label matches the "BOOKING REF", "PICKUP", "DROPOFF" labels elsewhere in the same card — visual consistency.

### Step 6: Manually verify in the browser

- [ ] **Step 6** — Start the dev server and eyeball the page.

Run:

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run dev
```

Expected: Astro reports the dev server listening (usually `http://localhost:4321`).

Then in a browser:
1. Log in as a driver partner (or use an existing driver session).
2. Navigate to `/driver/available`.
3. Confirm each card now shows a "TOTAL" label and a `€X.XX` value in a column sitting between the vehicle/passenger column and the Accept/Reject column.
4. Confirm the Accept / Reject buttons still work — click Accept on a test ride, watch the confirm modal appear, cancel, then click Reject and watch the card fade out (proves we didn't break the existing `data-accept` / `data-reject` handler wiring).
5. Resize to mobile (< 768 px) and confirm the card stacks vertically with the Total block still rendering (between passengers and the action buttons).

Expected visual outcome (matching the screenshot the user provided, but with the new column):

```
BOOKING REF | PICKUP | DROPOFF | [Sedan] [New]       | TOTAL  | [Accept] [Reject]
4599A332    | Athens | Piraeus | 2 passengers        | €45.00 |
```

**If the price shows `€0.00` on every card:** the `total_price` column on those rows is genuinely `0` or `null` in the DB — seed a test transfer with a non-zero `total_price` via `/admin/transfers` (or directly in Supabase) and re-check. Do **not** "fix" this by hiding the price on zero — a driver seeing `€0.00` is the correct signal that a ride has no quoted fare yet.

### Step 7: Type check

- [ ] **Step 7** — Confirm TypeScript is happy.

Run:

```bash
cd /Users/marios/Desktop/Cursor/opaway && npx astro check
```

Expected: `0 errors` (warnings are fine if they already existed on `main`). The change is purely additive on the interface, so this should pass cleanly.

### Step 8: Commit

- [ ] **Step 8** — Create the commit.

Run:

```bash
cd /Users/marios/Desktop/Cursor/opaway
git add src/pages/driver/available.astro docs/superpowers/plans/2026-04-24-driver-available-ride-price.md
git commit -m "$(cat <<'EOF'
feat(driver): show total price on Available Rides cards

Adds a "Total" column between the vehicle/passenger details and the
Accept/Reject actions on /driver/available, so drivers can evaluate a
ride's fare before accepting. Sources total_price from the existing
transfers row; no schema change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; `git status` is clean.

---

## Self-review checklist (run by the implementer before handoff)

- [ ] `Ride` interface, the `.map()` mapping, and the template literal all reference `total_price` consistently — no typos like `totalPrice` or `price`.
- [ ] Grid class is `md:grid-cols-6` everywhere it was `md:grid-cols-5`.
- [ ] Price block is *between* the Details block and the Actions block — not inside Details, not after Actions.
- [ ] Mobile (`grid-cols-1`) layout still reads top-to-bottom cleanly.
- [ ] Accept and Reject handlers still trigger — regression check from Step 6.
- [ ] `npx astro check` is green.
