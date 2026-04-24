# Luggage Counts on Transfer + Hourly Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the customer's luggage count (Small + Big, with `-` / `+` counters) on the home-page booking widget and on both the Transfer and Hourly booking entry pages; flow the two numbers through the wizard URL params to the DB.

**Architecture:** One reusable `LuggageCounters.astro` component rendering two labelled counter blocks, plus a tiny `src/lib/luggage-counters.ts` module exposing `initLuggageCounters(rootId)` to wire the `-` / `+` buttons and `getLuggageCounts(rootId)` to read back the current values. The component mounts three times on the step-1 surface (home widget's Transfer tab, home widget's Hourly tab, `/book/transfer` dedicated form, `/book/hourly` dedicated form). Values ride through every wizard URL as `luggageSmall` / `luggageBig` and land in two new `transfers` table columns.

**Tech Stack:** Astro 5 (file-based routing, inline `<script>`), Tailwind v4, Supabase JS v2, Supabase Management API (for the migration via `.supabase-pat`).

**Out of scope (explicit):**
- Tour / experience funnels — user scoped this to transfer + hourly.
- Vehicle-fit validation (e.g. "Sedan holds 3 bags, you picked 6"). The `vehicles.max_luggage` column exists but we're not blocking a vehicle pick on it in v1. Add later if needed — the data will be there once this plan ships.
- Price impact — luggage doesn't change fares.
- Admin Add-Booking modals on `/admin/{transfers,hourly}` — admin can still use the free-text notes field. In-scope only for customer-initiated bookings.

---

## Current state (verified before writing this plan)

- `src/components/BookingSection.astro` (655 lines) is the home-page booking widget — has three tabs (Transfer / Hourly / Tour) with independent forms.
- `src/pages/book/transfer.astro` (460 lines) is the dedicated transfer entry page with its own step-1 form (not a shim over BookingSection).
- `src/pages/book/hourly.astro` (322 lines) — same shape for hourly.
- The wizard passes data via URL params: `from`, `to`, `date`, `time`, `passengers`, `return_date`, `return_time`, `vehicleSlug`, etc.
- `transfers` schema has `passengers int`, `child_seats int default 0`, `driver_notes text` — so integer-count columns are a well-established pattern.
- Passenger page (`/book/transfer/passenger`) currently has a notes field whose placeholder literally reads `"Luggage info, special requests..."` — i.e. today users are expected to free-text their luggage. This plan replaces that hack with structured numbers.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `db/migrations/2026-04-24-transfers-luggage-counts.sql` | Adds `luggage_small int default 0` and `luggage_big int default 0` to `public.transfers`. Idempotent. |
| `src/lib/luggage-counters.ts` | `initLuggageCounters(rootId, opts?)` wires `-` / `+` buttons; `getLuggageCounts(rootId)` reads current values. Pure DOM, no Supabase. |
| `src/components/LuggageCounters.astro` | Renders the two-card (Small / Big) widget with `-` number `+` controls. Takes `rootId` prop so multiple instances (home widget's transfer tab, hourly tab, and dedicated pages) coexist without ID collisions. |

### Modified files

| Path | Change |
|---|---|
| `src/components/BookingSection.astro` | Mount `<LuggageCounters />` inside the Transfer tab form AND the Hourly tab form. Call `initLuggageCounters` for both on mount. On Search/Continue, append `luggageSmall` / `luggageBig` to the outgoing URL. |
| `src/pages/book/transfer.astro` | Same — mount `<LuggageCounters />` inside the dedicated step-1 form, init, append to outgoing URL. |
| `src/pages/book/hourly.astro` | Same. |
| `src/pages/book/transfer/results.astro` | Read `luggageSmall` / `luggageBig` from URL, forward them to the passenger step. No UI. |
| `src/pages/book/hourly/results.astro` | Same. |
| `src/pages/book/transfer/passenger.astro` | Read from URL, display as read-only summary next to the existing trip-type / passenger line, forward to payment. Update the notes placeholder to drop the "Luggage info" phrase (no longer free-texted). |
| `src/pages/book/hourly/passenger.astro` | Same (read + forward + optional display). |
| `src/pages/book/transfer/payment.astro` | Read from URL, include `luggage_small` / `luggage_big` in the insert payload. |
| `src/pages/book/hourly/payment.astro` | Same. |
| `src/components/ReservationDetailModal.astro` | Surface the two numbers in the transfer renderer so admin can see them. |

---

## Phase A — Schema, helper, component

### Task 1: Migration for luggage columns

**Files:**
- Create: `db/migrations/2026-04-24-transfers-luggage-counts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Luggage counts for transfer + hourly bookings. Two integer counts
-- (small carry-on vs big checked). Collected via a +/- counter widget
-- at the first booking step. Idempotent.

alter table public.transfers
  add column if not exists luggage_small integer not null default 0,
  add column if not exists luggage_big   integer not null default 0;

-- No backfill: existing rows stay at 0, which matches the UX of
-- "customer didn't specify" for legacy bookings.
```

- [ ] **Step 2: Apply the migration**

```bash
export SUPABASE_ACCESS_TOKEN="$(cat .supabase-pat)"
python3 -c "
import json, pathlib
sql = pathlib.Path('db/migrations/2026-04-24-transfers-luggage-counts.sql').read_text()
print(json.dumps({'query': sql}))
" > /tmp/sb_mig.json
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @/tmp/sb_mig.json
```

Expect `[]`.

- [ ] **Step 3: Verify**

```bash
cat > /tmp/q.json <<'EOF'
{"query": "select column_name, data_type, column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='transfers' and column_name in ('luggage_small','luggage_big') order by column_name;"}
EOF
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @/tmp/q.json | python3 -m json.tool
```

Expect two rows with `data_type = integer`, `column_default = 0`, `is_nullable = NO`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-04-24-transfers-luggage-counts.sql
git commit -m "$(cat <<'EOF'
db: add luggage_small + luggage_big to transfers

Captures the customer's luggage from the booking funnel (both
transfer and hourly — both kinds share this table). int NOT NULL
DEFAULT 0 so existing rows stay at 0 and the UI always has a
sensible starting value. Idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `initLuggageCounters` + `getLuggageCounts` helper

**Files:**
- Create: `src/lib/luggage-counters.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/luggage-counters.ts
//
// Wires the `-` / `+` buttons inside a `<LuggageCounters rootId="…" />`
// instance, and reads back the two integer counts (small + big). The
// markup lives in src/components/LuggageCounters.astro — this module
// is purely DOM. Safe to call multiple times on the same page when
// there are multiple instances (each with a unique rootId).

export interface LuggageCounterOptions {
    /** Upper bound per bag type. Default 20 (generous — minibus capacity). */
    max?: number;
}

export interface LuggageCounts {
    small: number;
    big: number;
}

function clampInt(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function resolveRoot(rootOrId: string | HTMLElement): HTMLElement | null {
    if (typeof rootOrId === 'string') return document.getElementById(rootOrId);
    return rootOrId;
}

/**
 * Wire the -/+ buttons inside a LuggageCounters widget. Each bag-type
 * block inside `root` is expected to look like:
 *
 *   <div data-luggage="small">
 *     <button data-action="minus">-</button>
 *     <span data-value>0</span>
 *     <button data-action="plus">+</button>
 *   </div>
 *
 * After this call, clicking minus/plus updates the visible count and
 * toggles disabled state at 0 / max.
 */
export function initLuggageCounters(rootOrId: string | HTMLElement, opts: LuggageCounterOptions = {}): void {
    const root = resolveRoot(rootOrId);
    if (!root) return;
    const max = opts.max ?? 20;

    root.querySelectorAll<HTMLElement>('[data-luggage]').forEach(group => {
        const minus = group.querySelector<HTMLButtonElement>('[data-action="minus"]');
        const plus  = group.querySelector<HTMLButtonElement>('[data-action="plus"]');
        const value = group.querySelector<HTMLElement>('[data-value]');
        if (!minus || !plus || !value) return;

        let count = clampInt(Number(value.textContent?.trim() ?? '0'), 0, max);

        const render = () => {
            value.textContent = String(count);
            minus.disabled = count <= 0;
            plus.disabled = count >= max;
            minus.setAttribute('aria-disabled', minus.disabled ? 'true' : 'false');
            plus.setAttribute('aria-disabled', plus.disabled ? 'true' : 'false');
        };

        minus.addEventListener('click', (e) => { e.preventDefault(); if (count > 0)   { count -= 1; render(); } });
        plus.addEventListener('click',  (e) => { e.preventDefault(); if (count < max) { count += 1; render(); } });

        render();
    });
}

/** Read the current small/big counts from a LuggageCounters widget. */
export function getLuggageCounts(rootOrId: string | HTMLElement): LuggageCounts {
    const root = resolveRoot(rootOrId);
    if (!root) return { small: 0, big: 0 };
    const read = (kind: 'small' | 'big'): number => {
        const el = root.querySelector<HTMLElement>(`[data-luggage="${kind}"] [data-value]`);
        const n = Number((el?.textContent ?? '0').trim());
        return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    };
    return { small: read('small'), big: read('big') };
}

/** Write counts back (e.g. restoring from URL params on a back-nav). */
export function setLuggageCounts(rootOrId: string | HTMLElement, counts: Partial<LuggageCounts>): void {
    const root = resolveRoot(rootOrId);
    if (!root) return;
    const write = (kind: 'small' | 'big', n: number) => {
        const el = root.querySelector<HTMLElement>(`[data-luggage="${kind}"] [data-value]`);
        if (el) el.textContent = String(clampInt(n, 0, 99));
    };
    if (counts.small != null) write('small', counts.small);
    if (counts.big != null)   write('big',   counts.big);
    // Re-run init so min/max disabled state re-applies. Idempotent because
    // the markup doesn't accumulate listeners — initLuggageCounters always
    // reads current DOM + attaches fresh handlers. However, callers should
    // invoke this BEFORE initLuggageCounters to keep listeners attached
    // exactly once. This function only updates the visible number; it does
    // NOT re-attach handlers.
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -3
```

Expected: `63 page(s) built in …` with `Complete!` (the commission dashboard bumped the count to 63 last feature; no new page here).

- [ ] **Step 3: Commit**

```bash
git add src/lib/luggage-counters.ts
git commit -m "feat(lib): luggage counter helper (init + get + set)

Shared DOM helper for <LuggageCounters> instances. initLuggageCounters
wires -/+ buttons with 0..max clamping; getLuggageCounts reads the
two integer counts; setLuggageCounts restores values from URL params.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `<LuggageCounters />` Astro component

**Files:**
- Create: `src/components/LuggageCounters.astro`

- [ ] **Step 1: Write the component**

```astro
---
interface Props {
    /** Unique id for the root wrapper so multiple instances on one page don't collide. */
    rootId: string;
    /** Optional label above the two cards. Default "Luggage". */
    label?: string;
}
const { rootId, label = 'Luggage' } = Astro.props;
---

<div id={rootId} class="flex flex-col gap-2.5">
    <span class="block text-sm font-medium text-neutral-700">{label}</span>

    <div class="grid grid-cols-2 gap-3">

        <!-- Small (carry-on) -->
        <div data-luggage="small" class="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
            <div class="flex flex-col leading-tight">
                <span class="text-sm font-semibold text-neutral-800">Small</span>
                <span class="text-[11px] text-neutral-400">Carry-on</span>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" data-action="minus" aria-label="Decrease small luggage"
                    class="w-7 h-7 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" /></svg>
                </button>
                <span data-value class="w-6 text-center text-sm font-semibold tabular-nums">0</span>
                <button type="button" data-action="plus" aria-label="Increase small luggage"
                    class="w-7 h-7 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
            </div>
        </div>

        <!-- Big (checked) -->
        <div data-luggage="big" class="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
            <div class="flex flex-col leading-tight">
                <span class="text-sm font-semibold text-neutral-800">Big</span>
                <span class="text-[11px] text-neutral-400">Checked</span>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" data-action="minus" aria-label="Decrease big luggage"
                    class="w-7 h-7 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" /></svg>
                </button>
                <span data-value class="w-6 text-center text-sm font-semibold tabular-nums">0</span>
                <button type="button" data-action="plus" aria-label="Increase big luggage"
                    class="w-7 h-7 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
            </div>
        </div>

    </div>
</div>
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/components/LuggageCounters.astro
git commit -m "feat(ui): LuggageCounters Astro component (small + big, -/+)

Reusable widget: takes rootId (to allow multiple instances per page).
Markup only — the init + read helpers live in src/lib/luggage-counters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Wire into the step-1 surfaces

### Task 4: Home-page BookingSection (Transfer tab + Hourly tab)

**Files:**
- Modify: `src/components/BookingSection.astro`

- [ ] **Step 1: Import the component + helpers**

Near the top of the frontmatter, add:

```astro
import LuggageCounters from './LuggageCounters.astro';
```

In the page's inline `<script>` block, alongside the other imports, add:

```ts
import { initLuggageCounters, getLuggageCounts } from '../lib/luggage-counters';
```

- [ ] **Step 2: Mount LuggageCounters inside the Transfer tab form**

The BookingSection Transfer tab has a form panel with inputs for From / To / Date / Time / Passengers (and a hidden "return trip" expander). Find the block that closes the passengers row / just before the Search button — the natural insertion point is between Passengers and the Search/Continue button.

Add the widget (use the exact ID so the subsequent init call matches):

```astro
<LuggageCounters rootId="home-xfer-luggage" />
```

- [ ] **Step 3: Mount LuggageCounters inside the Hourly tab form**

Same approach in the Hourly tab form — find the block just before the Search button and insert:

```astro
<LuggageCounters rootId="home-hourly-luggage" />
```

- [ ] **Step 4: Wire initLuggageCounters for both in the page script**

After the existing tab/form-init code runs (or at the bottom of the `<script>`, whichever matches the file's style — BookingSection already calls several inits for passenger +/- and hours +/-), add:

```ts
initLuggageCounters('home-xfer-luggage');
initLuggageCounters('home-hourly-luggage');
```

- [ ] **Step 5: Append luggage to the outgoing URL on Search (both tabs)**

Find the Transfer tab's Search handler — the code that builds a `URLSearchParams` and navigates to `/book/transfer/results?...`. Just before the `window.location.href = ...` line, add:

```ts
const xferLuggage = getLuggageCounts('home-xfer-luggage');
if (xferLuggage.small > 0) params.set('luggageSmall', String(xferLuggage.small));
if (xferLuggage.big   > 0) params.set('luggageBig',   String(xferLuggage.big));
```

(Use the local name of the `URLSearchParams` instance in that handler. In this file it's likely `params` or `qs` — match whatever is already there.)

Do the same for the Hourly tab's Search handler, using `home-hourly-luggage` as the rootId.

- [ ] **Step 6: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/components/BookingSection.astro
git commit -m "$(cat <<'EOF'
feat(book): luggage counters on home booking widget

Both the Transfer tab and the Hourly tab on BookingSection now render
a LuggageCounters widget between Passengers and the Search button.
Search handlers append ?luggageSmall=N&luggageBig=M to the outgoing
URL when either count is non-zero.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/book/transfer` dedicated step-1 page

**Files:**
- Modify: `src/pages/book/transfer.astro`

- [ ] **Step 1: Import the component + helpers**

At the top of the frontmatter:

```astro
import LuggageCounters from '../../components/LuggageCounters.astro';
```

In the inline `<script>`:

```ts
import { initLuggageCounters, getLuggageCounts } from '../../lib/luggage-counters';
```

- [ ] **Step 2: Mount LuggageCounters in the step-1 form**

Place between the passengers row and the Search button:

```astro
<LuggageCounters rootId="xfer-page-luggage" />
```

- [ ] **Step 3: Wire init + URL append**

In the script, add:

```ts
initLuggageCounters('xfer-page-luggage');
```

Find the Search submit handler that composes the URL to `/book/transfer/results`. Just before the navigation line add:

```ts
const pageLuggage = getLuggageCounts('xfer-page-luggage');
if (pageLuggage.small > 0) params.set('luggageSmall', String(pageLuggage.small));
if (pageLuggage.big   > 0) params.set('luggageBig',   String(pageLuggage.big));
```

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/book/transfer.astro
git commit -m "feat(book): luggage counters on /book/transfer step 1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `/book/hourly` dedicated step-1 page

**Files:**
- Modify: `src/pages/book/hourly.astro`

- [ ] **Step 1: Import the component + helpers**

Frontmatter:

```astro
import LuggageCounters from '../../components/LuggageCounters.astro';
```

Script:

```ts
import { initLuggageCounters, getLuggageCounts } from '../../lib/luggage-counters';
```

- [ ] **Step 2: Mount LuggageCounters in the step-1 form**

Place between passengers and Search:

```astro
<LuggageCounters rootId="hourly-page-luggage" />
```

- [ ] **Step 3: Wire init + URL append**

```ts
initLuggageCounters('hourly-page-luggage');
```

Before the navigation line of the Search handler:

```ts
const hourlyLuggage = getLuggageCounts('hourly-page-luggage');
if (hourlyLuggage.small > 0) params.set('luggageSmall', String(hourlyLuggage.small));
if (hourlyLuggage.big   > 0) params.set('luggageBig',   String(hourlyLuggage.big));
```

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/book/hourly.astro
git commit -m "feat(book): luggage counters on /book/hourly step 1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Pass through the funnel + save to DB

### Task 7: Transfer wizard — forward luggage to payment, save

**Files:**
- Modify: `src/pages/book/transfer/results.astro`
- Modify: `src/pages/book/transfer/passenger.astro`
- Modify: `src/pages/book/transfer/payment.astro`

- [ ] **Step 1: results.astro — read + forward**

Find the existing URL-param block near the top of the inline `<script>` (where `from`, `to`, `date`, etc. are pulled from `window.location.search`). Add:

```ts
const luggageSmall = params.get('luggageSmall') || '0';
const luggageBig   = params.get('luggageBig')   || '0';
```

(Use the local name for the parsed `URLSearchParams` — it's likely `params`.)

Find the Continue handler that composes the URL to `/book/transfer/passenger`. Before the navigation, append these two params to the outgoing `URLSearchParams`:

```ts
if (Number(luggageSmall) > 0) passengerParams.set('luggageSmall', luggageSmall);
if (Number(luggageBig)   > 0) passengerParams.set('luggageBig',   luggageBig);
```

Match the actual local variable name — this file may call the outgoing `URLSearchParams` something like `params` or `passengerParams`. Use whatever is there.

- [ ] **Step 2: passenger.astro — read + display summary + forward**

At the top of the inline `<script>`, add to the URL-param parsing block:

```ts
const luggageSmall = params.get('luggageSmall') || '0';
const luggageBig   = params.get('luggageBig')   || '0';
```

Find the booking-summary sidebar section in the template (look for `id="sb-passengers"` — that's an existing summary item for passenger count). Add a new row right after it:

```astro
<!-- Luggage summary (read-only; to change, go back to step 1) -->
<div id="sb-luggage-row" class="flex items-center justify-between py-1.5 text-sm hidden">
    <span class="text-neutral-500">Luggage</span>
    <span class="text-neutral-800"><span id="sb-luggage-small">0</span> small · <span id="sb-luggage-big">0</span> big</span>
</div>
```

In the script, after existing `setText('sb-passengers', passengers);` (or similar), add:

```ts
setText('sb-luggage-small', luggageSmall);
setText('sb-luggage-big',   luggageBig);
if (Number(luggageSmall) > 0 || Number(luggageBig) > 0) {
    document.getElementById('sb-luggage-row')?.classList.remove('hidden');
}
```

Update the `pax-notes` textarea's placeholder — the current text says `"Luggage info, special requests..."`. Change to:

```html
placeholder="Special requests, dietary needs, accessibility requirements..."
```

(We now capture luggage structurally, so free-texting it in notes is redundant.)

Find the Continue handler that composes the URL to `/book/transfer/payment`. Before the navigation, add:

```ts
if (Number(luggageSmall) > 0) paymentParams.set('luggageSmall', luggageSmall);
if (Number(luggageBig)   > 0) paymentParams.set('luggageBig',   luggageBig);
```

Adjust `paymentParams` to whatever the existing local name is.

- [ ] **Step 3: payment.astro — read + include in insert payload**

At the top of the script's URL-param parse block, add:

```ts
const luggageSmall = parseInt(params.get('luggageSmall') || '0', 10) || 0;
const luggageBig   = parseInt(params.get('luggageBig')   || '0', 10) || 0;
```

Find the `await supabase.from('transfers').insert({ ... })` call. Add two new keys to the payload (alphabetical or next to `child_seats` — match the file's existing style):

```ts
luggage_small: luggageSmall,
luggage_big:   luggageBig,
```

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/book/transfer/results.astro src/pages/book/transfer/passenger.astro src/pages/book/transfer/payment.astro
git commit -m "$(cat <<'EOF'
feat(book): thread luggage counts through transfer wizard

results → passenger → payment all read luggageSmall / luggageBig
from the URL and forward them. Passenger step renders a read-only
"X small · Y big" summary. Payment step writes the two ints to the
new transfers.luggage_small / luggage_big columns.

Also drop the "Luggage info" phrase from the passenger notes
placeholder — luggage is now structured, not free-texted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Hourly wizard — forward luggage to payment, save

**Files:**
- Modify: `src/pages/book/hourly/results.astro`
- Modify: `src/pages/book/hourly/passenger.astro`
- Modify: `src/pages/book/hourly/payment.astro`

- [ ] **Step 1: results.astro — read + forward**

Same pattern as Task 7 Step 1. Read `luggageSmall` / `luggageBig` from `URLSearchParams`. Append to the outgoing URL to `/book/hourly/passenger`:

```ts
const luggageSmall = params.get('luggageSmall') || '0';
const luggageBig   = params.get('luggageBig')   || '0';
// ... later, in the Continue handler, before navigation:
if (Number(luggageSmall) > 0) passengerParams.set('luggageSmall', luggageSmall);
if (Number(luggageBig)   > 0) passengerParams.set('luggageBig',   luggageBig);
```

- [ ] **Step 2: passenger.astro — read + display + forward**

Same pattern as Task 7 Step 2. If the hourly passenger page has a sidebar summary, add:

```astro
<div id="sb-luggage-row" class="flex items-center justify-between py-1.5 text-sm hidden">
    <span class="text-neutral-500">Luggage</span>
    <span class="text-neutral-800"><span id="sb-luggage-small">0</span> small · <span id="sb-luggage-big">0</span> big</span>
</div>
```

In the script:

```ts
const luggageSmall = params.get('luggageSmall') || '0';
const luggageBig   = params.get('luggageBig')   || '0';
setText('sb-luggage-small', luggageSmall);
setText('sb-luggage-big',   luggageBig);
if (Number(luggageSmall) > 0 || Number(luggageBig) > 0) {
    document.getElementById('sb-luggage-row')?.classList.remove('hidden');
}
```

Forward in the Continue handler:

```ts
if (Number(luggageSmall) > 0) paymentParams.set('luggageSmall', luggageSmall);
if (Number(luggageBig)   > 0) paymentParams.set('luggageBig',   luggageBig);
```

If the hourly passenger page also has a placeholder in its notes field mentioning luggage, drop that phrase (mirror Task 7 Step 2's final tweak).

- [ ] **Step 3: payment.astro — read + include in insert payload**

Same as Task 7 Step 3. At the top of the script's URL-param parse block:

```ts
const luggageSmall = parseInt(params.get('luggageSmall') || '0', 10) || 0;
const luggageBig   = parseInt(params.get('luggageBig')   || '0', 10) || 0;
```

In the `supabase.from('transfers').insert({ ... })` call (hourly also saves to `transfers`), add:

```ts
luggage_small: luggageSmall,
luggage_big:   luggageBig,
```

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/book/hourly/results.astro src/pages/book/hourly/passenger.astro src/pages/book/hourly/payment.astro
git commit -m "$(cat <<'EOF'
feat(book): thread luggage counts through hourly wizard

Mirror of the transfer wizard change: results → passenger → payment
forward luggageSmall / luggageBig, passenger step displays a
read-only summary, payment step writes luggage_small / luggage_big
into the transfers row (booking_type='hourly').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Admin visibility

### Task 9: Reservation detail modal shows luggage

**Files:**
- Modify: `src/components/ReservationDetailModal.astro`

- [ ] **Step 1: Surface the two fields in the transfer renderer**

Find `renderTransfer(r: Row)` (around line 45). It's a long template literal with lots of `${field('Label', r.column)}` calls. Add a Luggage row after `field('Child seats', r.child_seats)`:

```ts
${field('Child seats', r.child_seats)}
${field('Luggage', (r.luggage_small || r.luggage_big) ? `${Number(r.luggage_small) || 0} small · ${Number(r.luggage_big) || 0} big` : '')}
```

The ternary keeps the field hidden when both counts are 0 (matches the existing convention — `field()` collapses empty values).

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/components/ReservationDetailModal.astro
git commit -m "feat(admin): reservation detail modal shows luggage counts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — Smoke verify

### Task 10: End-to-end Playwright smoke + journal

**Files:**
- Modify: `qa/2026-04-22-full-smoke-test.md` (append Section 22)

No code changes. Drive the app through a real user path. Requires Playwright MCP (verify connection before starting; if disconnected, block and wait for restart).

- [ ] **Step 1: Transfer funnel**

Log in as `smoke-user-2026-04-22@opawey.test` / `SmokeTest!2026-04-22`.

1. Navigate `/book/transfer`. Widget should render LuggageCounters under Passengers. Click `+` on Small three times → reads `3`. Click `+` on Big twice → reads `2`. Both `-` buttons transition from disabled (at 0) to enabled (after first +). Max-cap check: spam `+` 25 times on Small; stays at 20; `+` becomes disabled.
2. Fill the rest of the step-1 form (Athens → Piraeus, a future date, 2 passengers), hit Search. Inspect URL on `/book/transfer/results` — should contain `luggageSmall=20&luggageBig=2` (because we maxed small earlier; reset to 3 and re-search if needed, or accept the max for this check).
3. Reset Small to 3 via back navigation, re-search with `luggageSmall=3&luggageBig=2`. Pick a vehicle. Continue.
4. On `/book/transfer/passenger`, the booking summary sidebar should show a row "Luggage  3 small · 2 big". Inspect URL — `luggageSmall=3&luggageBig=2` must be present. Fill passenger form. Continue.
5. On `/book/transfer/payment`, URL still has both. Pick Cash on arrival. Complete booking.
6. Expect success panel with a reference ID. Verify via Supabase: `select id, luggage_small, luggage_big, booking_type from public.transfers order by created_at desc limit 1;` → the new row has `luggage_small=3, luggage_big=2, booking_type='transfer'`.

- [ ] **Step 2: Hourly funnel**

1. Navigate `/book/hourly`. Same luggage widget should render. Pick Small=1, Big=4.
2. Complete the funnel (pickup, 3 hours, 2 passengers, any vehicle, card-on-site).
3. SQL verify: latest `transfers` row has `luggage_small=1, luggage_big=4, booking_type='hourly'`.

- [ ] **Step 3: Home widget**

1. Log out, navigate `/`. Scroll to the BookingSection widget.
2. Transfer tab: luggage widget visible. Set Small=2. Search. URL on `/book/transfer/results` carries `luggageSmall=2`.
3. Hourly tab: luggage widget visible. Set Big=3. Search. URL carries `luggageBig=3`.

- [ ] **Step 4: Admin detail modal**

1. Log in as `smoke-admin-2026-04-22@opawey.test`. Navigate `/admin/transfers`.
2. Find the row from Step 1 (the transfer booking with 3 small · 2 big). Click a non-form-control cell to open the detail modal.
3. Modal should show a "Luggage" row reading "3 small · 2 big".
4. Spot-check an older row that was booked before this feature — those rows have `luggage_small=0, luggage_big=0`, so the Luggage row should NOT appear in their detail modal (the field helper hides zero-empty values).

- [ ] **Step 5: Journal update**

Append to `qa/2026-04-22-full-smoke-test.md` under `## Section reports`:

```md
### Section 22 — Luggage counts on transfer + hourly wizards

| Check | Result |
|---|---|
| `/book/transfer` widget renders LuggageCounters | pass/fail |
| `-` disabled at 0 on both Small and Big | pass/fail |
| `+` disabled at max (20) | pass/fail |
| Transfer search URL carries `luggageSmall` / `luggageBig` | pass/fail |
| Passenger sidebar shows "N small · M big" summary | pass/fail |
| Payment saves `luggage_small` / `luggage_big` into transfers row | pass/fail |
| Hourly funnel end-to-end saves luggage correctly | pass/fail |
| Home widget Transfer tab carries luggage to /book/transfer/results | pass/fail |
| Home widget Hourly tab carries luggage to /book/hourly/results | pass/fail |
| Admin ReservationDetailModal shows Luggage row for new rows | pass/fail |
| Admin ReservationDetailModal hides Luggage row on legacy 0/0 rows | pass/fail |

No findings. (or list F<N> with repro + screenshot path if anything fails)
```

Fill in actual results.

- [ ] **Step 6: Commit + push + fast-forward main**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: smoke verify — luggage counts on transfer + hourly wizards

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/luggage-counts
git checkout main
git pull --ff-only origin main
git merge --ff-only feat/luggage-counts
git push origin main
git checkout feat/luggage-counts
```

---

## Self-review

**Spec coverage:**
- "when someone book from the book a transfer and rent by hour to be able to select how many luggage he has" → Tasks 4 (home widget), 5 (`/book/transfer`), 6 (`/book/hourly`) add the picker at step 1.
- "two options. Small and big" → Task 3 (`LuggageCounters.astro`) renders exactly two labelled blocks, "Small" and "Big".
- "then it will have - + to increase or decrease the amount of luggage of each one" → Task 2 (`initLuggageCounters`) wires the buttons with 0..max clamping; Task 3 markup includes both buttons per block.
- "must be implemented to the home page and the individual pages" → Task 4 covers home; Tasks 5 + 6 cover `/book/transfer` and `/book/hourly` dedicated pages.
- Persistence: Tasks 7 + 8 forward through the wizard and Tasks 7 Step 3 + 8 Step 3 write to the DB via Task 1's new columns.
- Operator visibility: Task 9 adds the admin view.

No spec gap.

**Placeholder scan:** Every step is concrete. Tasks 7 and 8 say "match the existing local name" where the `URLSearchParams` variable in each file might differ slightly — the task gives the exact code to add and flags the one local-name adaptation. No TBDs, no "similar to Task N", no "add error handling".

**Type consistency:**
- URL param names: `luggageSmall` / `luggageBig` (camelCase) used in every client-side reference.
- DB column names: `luggage_small` / `luggage_big` (snake_case) used in migration, helper, and insert payloads.
- Component `rootId` convention: `home-xfer-luggage`, `home-hourly-luggage`, `xfer-page-luggage`, `hourly-page-luggage` — four distinct ids, no collisions.
- Helper signature: `initLuggageCounters(rootId, opts?)` + `getLuggageCounts(rootId) → { small, big }` + `setLuggageCounts(rootId, partial)`. Types in Task 2 match usage in Tasks 4/5/6/7/8.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-luggage-counts.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session with checkpoints.

**Which approach?**
