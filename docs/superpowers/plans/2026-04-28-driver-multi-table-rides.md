# Driver Pages Show Tours & Experiences (Multi-Table Rides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make released tours and experiences appear alongside transfers on every driver dashboard surface. Today the four driver pages (`/driver/available`, `/driver/upcoming`, `/driver/past`, `/driver/index`) only query the `transfers` table, so a tour or experience that admin releases or assigns is invisible to the driver. After this plan, drivers see all three booking types in one merged list, can accept any of them, and the per-kind state transitions (`ride_status`, `driver_uid`, `driver`) write to the correct table.

**Architecture:** Add a single shared helper `src/lib/driver-rides.ts` that runs three parallel Supabase queries (one per table), normalizes each row into a `UnifiedRide` shape with a `_kind` discriminator (`'transfer' | 'tour' | 'experience'`) and a `_table` source pointer (`'transfers' | 'tours' | 'experiences'`), and merges the results sorted by `created_at`. Each driver page calls one of three helper functions (`fetchAvailableRides()` for /available, `fetchAssignedRides(userId)` for /upcoming and /index, `fetchCompletedRides(userId)` for /past) and renders the merged list. The accept handler on /available reads `ride._table` and writes to that table; the existing /driver/ride detail page already supports `?type=` so no change there.

**Tech Stack:** Astro 5, Supabase JS v2, TypeScript.

**Out of scope (explicit):**
- The `/driver/ride` detail page — already reads `?type=transfers|tours|experiences` from URL and queries the right table.
- Schema changes — `released_to_drivers`, `driver_uid`, `driver`, `ride_status` exist on all three tables.
- New UI affordances per booking type — render keeps the same card shape using whichever fields each row provides (transfers have `from`/`to`/`vehicle_name`; tours have `tour_name`/`pickup_location`; experiences have `experience_name`/`pickup_location`). The card adapts via simple `_kind` switching, no separate components.
- Admin pages (admin/transfers, admin/tours, admin/experiences) — already release rides correctly per their own tables.
- The `requests` table (experience inquiries) — those aren't bookings and don't go through the driver flow.

---

## Current state (verified before writing this plan)

- `src/pages/driver/available.astro:211` — queries only `transfers`:
  ```ts
  .from('transfers').select('*').eq('ride_status', 'new').eq('released_to_drivers', true)
  ```
- `src/pages/driver/upcoming.astro:136` — queries only `transfers`:
  ```ts
  .from('transfers').eq('driver_uid', user.id).in('ride_status', ['assigned', 'pickup', 'onboard'])
  ```
- `src/pages/driver/past.astro:145` — queries only `transfers` (filtered to `ride_status='completed'`).
- `src/pages/driver/index.astro:116` — queries only `transfers` for the dashboard widgets.
- `src/pages/driver/ride.astro:275, 296, 440, 526` — already uses `params.get('type') || 'transfers'` so the detail page works for any of the three; **no change needed there**.
- The accept handler on `/driver/available` (`available.astro:268`) writes to `transfers` only:
  ```ts
  .from('transfers').update({ driver_uid, driver, ride_status: 'assigned' }).eq('id', rideId)
  ```
  Tours/experiences need the same write to their respective tables.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `src/lib/driver-rides.ts` | `UnifiedRide` interface + 3 fetcher functions: `fetchAvailableRides()`, `fetchAssignedRides(driverUid)`, `fetchCompletedRides(driverUid)`. Each runs `Promise.all` over the three tables, normalizes the rows, attaches `_kind` and `_table`, and returns a merged list sorted by `created_at` desc. |

### Modified files

| Path | Change |
|---|---|
| `src/pages/driver/available.astro` | Replace the single-table query with `fetchAvailableRides()`. Card render switches per `_kind` (transfer card vs tour card vs experience card). Accept handler reads `ride._table` and updates the correct table. |
| `src/pages/driver/upcoming.astro` | Replace the single-table query with `fetchAssignedRides(user.id)`. Card render adapts per `_kind`. |
| `src/pages/driver/past.astro` | Same — use `fetchCompletedRides(user.id)`. |
| `src/pages/driver/index.astro` | The dashboard reads counts/aggregates of bookings; switch to the helper so tours/experiences are counted. |

---

## Phase A — Shared helper

### Task A1: Create `src/lib/driver-rides.ts`

**Files:**
- Create: `src/lib/driver-rides.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/driver-rides.ts` with this exact content:

```ts
// src/lib/driver-rides.ts
//
// Unified driver-side ride loader. Queries the three booking tables
// (transfers, tours, experiences) in parallel and merges results into
// a single chronological list. Each row carries a `_kind` discriminator
// and a `_table` source pointer so callers can render appropriately and
// route updates back to the correct table.
//
// All three tables share these fields used by the driver views:
//   id, date, time, driver_uid, driver, ride_status,
//   released_to_drivers, total_price, created_at
// Plus type-specific fields:
//   transfers: from, to, vehicle_name, passengers, booking_type
//   tours: tour_id, tour_name, pickup_location, participants
//   experiences: experience_id, experience_name, pickup_location, participants

import { supabase } from './supabase';

export type DriverRideKind = 'transfer' | 'tour' | 'experience';
export type DriverRideTable = 'transfers' | 'tours' | 'experiences';

export interface UnifiedRide {
    _kind: DriverRideKind;
    _table: DriverRideTable;
    id: string;
    date: string;
    time: string;
    driver_uid: string;
    ride_status: string;
    released_to_drivers: boolean;
    total_price: number;
    created_at: string;
    // Transfer-only (also populated for hourly via booking_type='hourly')
    from?: string;
    to?: string;
    vehicle_name?: string;
    passengers?: number;
    booking_type?: string;
    // Tour-only
    tour_id?: string;
    tour_name?: string;
    // Experience-only
    experience_id?: string;
    experience_name?: string;
    // Tour + experience common
    pickup_location?: string;
    participants?: number;
}

function normalizeTransfer(row: any): UnifiedRide {
    return {
        _kind: 'transfer',
        _table: 'transfers',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        from: row.from ?? '',
        to: row.to ?? '',
        vehicle_name: row.vehicle_name ?? '',
        passengers: Number(row.passengers) || 0,
        booking_type: row.booking_type ?? 'transfer',
    };
}

function normalizeTour(row: any): UnifiedRide {
    return {
        _kind: 'tour',
        _table: 'tours',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        tour_id: row.tour_id ?? '',
        tour_name: row.tour_name ?? '',
        pickup_location: row.pickup_location ?? '',
        participants: Number(row.participants) || 0,
        vehicle_name: row.vehicle_name ?? '',
    };
}

function normalizeExperience(row: any): UnifiedRide {
    return {
        _kind: 'experience',
        _table: 'experiences',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        experience_id: row.experience_id ?? '',
        experience_name: row.experience_name ?? '',
        pickup_location: row.pickup_location ?? '',
        participants: Number(row.participants) || 0,
        vehicle_name: row.vehicle_name ?? '',
    };
}

function mergeSorted(...lists: UnifiedRide[][]): UnifiedRide[] {
    const all = lists.flat();
    all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return all;
}

/** Rides released by admin that are unassigned and ready for any driver to claim. */
export async function fetchAvailableRides(): Promise<UnifiedRide[]> {
    const [t, u, e] = await Promise.all([
        supabase.from('transfers')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
        supabase.from('tours')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
        supabase.from('experiences')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('available transfers load failed:', t.error);
    if (u.error) console.error('available tours load failed:', u.error);
    if (e.error) console.error('available experiences load failed:', e.error);

    const transfers   = (t.data ?? []).map(normalizeTransfer);
    const tours       = (u.data ?? []).map(normalizeTour);
    const experiences = (e.data ?? []).map(normalizeExperience);

    // Client-side: keep only those without a driver_uid (admin-assigned rides drop out
    // of the available pool — they belong to a specific driver via fetchAssignedRides).
    return mergeSorted(transfers, tours, experiences)
        .filter(r => !r.driver_uid);
}

/** Rides assigned to this driver that are not yet completed/cancelled. */
export async function fetchAssignedRides(driverUid: string): Promise<UnifiedRide[]> {
    if (!driverUid) return [];
    const STATUSES = ['assigned', 'pickup', 'onboard'];
    const [t, u, e] = await Promise.all([
        supabase.from('transfers').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('tours').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('experiences').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('assigned transfers load failed:', t.error);
    if (u.error) console.error('assigned tours load failed:', u.error);
    if (e.error) console.error('assigned experiences load failed:', e.error);

    return mergeSorted(
        (t.data ?? []).map(normalizeTransfer),
        (u.data ?? []).map(normalizeTour),
        (e.data ?? []).map(normalizeExperience),
    );
}

/** Rides this driver has completed or had cancelled. */
export async function fetchCompletedRides(driverUid: string): Promise<UnifiedRide[]> {
    if (!driverUid) return [];
    const STATUSES = ['completed', 'cancelled'];
    const [t, u, e] = await Promise.all([
        supabase.from('transfers').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('tours').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('experiences').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('past transfers load failed:', t.error);
    if (u.error) console.error('past tours load failed:', u.error);
    if (e.error) console.error('past experiences load failed:', e.error);

    return mergeSorted(
        (t.data ?? []).map(normalizeTransfer),
        (u.data ?? []).map(normalizeTour),
        (e.data ?? []).map(normalizeExperience),
    );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 63 pages, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/driver-rides.ts
git commit -m "feat(lib): unified driver-rides loader (transfers + tours + experiences)"
```

---

## Phase B — `/driver/available` (the bug the client reported)

### Task B1: Wire helper into `/driver/available.astro` + per-kind accept

**Files:**
- Modify: `src/pages/driver/available.astro`

- [ ] **Step 1: Read the file end-to-end**

```bash
sed -n '1,300p' src/pages/driver/available.astro
```

Note the structure: there's a `Ride` interface, `allRides` state, `loadRides()` function, `renderRides()` function, accept-confirm modal. The accept logic does `supabase.from('transfers').update(...).eq('id', rideId)`.

- [ ] **Step 2: Add the import + extend the in-page Ride interface**

In the `<script>` block, alongside the existing `import { supabase } from '../../lib/supabase';`, add:

```ts
import { fetchAvailableRides, type UnifiedRide, type DriverRideTable } from '../../lib/driver-rides';
```

Find the local `interface Ride { ... }` (or similar) used by the page. Replace with `type Ride = UnifiedRide;` so the rest of the code uses the unified shape:

```ts
type Ride = UnifiedRide;
```

(Delete the old local interface — it's now imported via `UnifiedRide`.)

- [ ] **Step 3: Replace the single-table query in `loadRides()`**

Find the block (line 197-240 area):

```ts
{
    // Load partner name
    const { data: partnerData } = await supabase
        .from('partners')
        .select('*')
        .eq('id', user.id)
        .single();
    if (partnerData) {
        partnerName = partnerData.full_name || partnerData.name || '';
    }

    // Load all rides with status 'new'
    const { data: rows, error } = await supabase
        .from('transfers')
        .select('*')
        .eq('ride_status', 'new')
        .eq('released_to_drivers', true)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Driver available rides load failed:', error);
        document.getElementById('rides-list')!.innerHTML =
            `<div class="flex items-center justify-center py-12 text-neutral-400 text-sm">Could not load rides.</div>`;
        return;
    }

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

    renderRides(getVisibleRides());
}
```

Replace with:

```ts
{
    // Load partner name
    const { data: partnerData } = await supabase
        .from('partners')
        .select('*')
        .eq('id', user.id)
        .single();
    if (partnerData) {
        partnerName = partnerData.full_name || partnerData.name || '';
    }

    // Load available rides across all 3 tables (transfers + tours + experiences).
    try {
        allRides = await fetchAvailableRides();
    } catch (err) {
        console.error('Driver available rides load failed:', err);
        document.getElementById('rides-list')!.innerHTML =
            `<div class="flex items-center justify-center py-12 text-neutral-400 text-sm">Could not load rides.</div>`;
        return;
    }
    renderRides(getVisibleRides());
}
```

- [ ] **Step 4: Update `renderRides()` to handle all 3 kinds**

Find `renderRides()`. The old version reads `r.from`, `r.to`, `r.vehicle_name`, `r.passengers`. With the unified shape, transfers still have these; tours have `tour_name` + `pickup_location` + `participants`; experiences have `experience_name` + `pickup_location` + `participants`.

Locate the card markup (a template literal that produces the HTML for one ride). Find where `${r.from}`, `${r.to}`, `${r.vehicle_name}` are interpolated. Replace the route line with a kind-switch:

```ts
const route = r._kind === 'transfer'
    ? `${escHtml(r.from || '—')} → ${escHtml(r.to || '—')}`
    : r._kind === 'tour'
        ? `${escHtml(r.tour_name || 'Tour')} — Pickup: ${escHtml(r.pickup_location || '—')}`
        : `${escHtml(r.experience_name || 'Experience')} — Pickup: ${escHtml(r.pickup_location || '—')}`;
```

(If the file already has an `escHtml` helper, use it. If not, use the simpler `r.from` direct interpolation but keep it consistent with what's already there.)

Replace the `${r.from} → ${r.to}` interpolation in the card template with `${route}`.

For passenger count: `r.passengers || r.participants || 0` works for all 3 kinds because tours/experiences populate `participants` and transfers populate `passengers`.

For vehicle: `r.vehicle_name` is already populated for transfers and (per normalization) defaulted to `''` for tours/experiences. If you want a kind-specific badge, add a small `_kind`-aware label:

```ts
const kindLabel = r._kind === 'transfer' ? 'Transfer' : r._kind === 'tour' ? 'Tour' : 'Experience';
```

And insert `${kindLabel}` into the card so the driver knows which type they're looking at. Adapt to the existing card layout — keep small.

- [ ] **Step 5: Update the accept handler to write to the correct table**

Find the accept-confirm click handler (around line 256-285 area):

```ts
document.getElementById('confirm-accept')?.addEventListener('click', async () => {
    if (!pendingAcceptId) return;
    const rideId = pendingAcceptId;
    // ...
    const { error } = await supabase
        .from('transfers')
        .update({
            driver_uid: user.id,
            driver: partnerName,
            ride_status: 'assigned',
        })
        .eq('id', rideId);
    // ...
});
```

The accept handler currently knows only the `rideId`, not its table. Change `pendingAcceptId` to also carry the table. Find the place where `pendingAcceptId` is set (when the driver clicks "Accept" on a card → opens the confirm modal) and capture the table too:

Search for `pendingAcceptId =` — it's likely set when a card's Accept button is clicked, with the ride id pulled from a `data-id` attribute. Update both the data attribute on the card and the click handler:

In the card markup, add `data-table="${r._table}"` next to the existing `data-id` on the Accept button.

In the click handler that sets `pendingAcceptId`, capture both:

```ts
let pendingAcceptId: string | null = null;
let pendingAcceptTable: DriverRideTable | null = null;

// ... inside the card-button click handler:
pendingAcceptId = btn.dataset.id ?? null;
pendingAcceptTable = (btn.dataset.table as DriverRideTable | undefined) ?? null;
```

Then in the confirm-accept handler, use `pendingAcceptTable`:

```ts
if (!pendingAcceptId || !pendingAcceptTable) return;
const rideId = pendingAcceptId;
const table = pendingAcceptTable;
// ...
const { error } = await supabase
    .from(table)
    .update({
        driver_uid: user.id,
        driver: partnerName,
        ride_status: 'assigned',
    })
    .eq('id', rideId);
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: 63 pages, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/driver/available.astro
git commit -m "fix(driver/available): show released tours + experiences, accept-by-table"
```

DO NOT push.

---

## Phase C — `/driver/upcoming`, `/driver/past`, `/driver/index`

### Task C1: `/driver/upcoming.astro`

**Files:**
- Modify: `src/pages/driver/upcoming.astro`

- [ ] **Step 1: Survey**

```bash
grep -n "from('transfers')\|driver_uid\|loadRides\|allRides" src/pages/driver/upcoming.astro | head -20
```

- [ ] **Step 2: Add the import + replace the query**

Add import at top of `<script>`:

```ts
import { fetchAssignedRides, type UnifiedRide } from '../../lib/driver-rides';
```

Find the load function (around line 130-148):

```ts
async function loadRides() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    {
        const { data: rows, error } = await supabase
            .from('transfers')
            .select('*')
            .eq('driver_uid', user.id)
            .in('ride_status', ['assigned', 'pickup', 'onboard'])
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Driver upcoming rides load failed:', error);
            document.getElementById('rides-list')!.innerHTML =
                `<div class="flex items-center justify-center py-12 text-neutral-400 text-sm">Could not load rides.</div>`;
            return;
        }

        allRides = (rows || []).map((data: any) => ({
            // ... mapping
        }));
        // render
    }
}
```

Replace with:

```ts
async function loadRides() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        allRides = await fetchAssignedRides(user.id);
    } catch (err) {
        console.error('Driver upcoming rides load failed:', err);
        document.getElementById('rides-list')!.innerHTML =
            `<div class="flex items-center justify-center py-12 text-neutral-400 text-sm">Could not load rides.</div>`;
        return;
    }
    // ... existing render call (e.g., renderRides(getVisibleRides()) or similar)
}
```

If the file has a local `Ride` interface, replace with `type Ride = UnifiedRide;` (matching Task B1).

- [ ] **Step 3: Update `renderRides()` to handle all 3 kinds**

Same pattern as Task B1 Step 4: kind-switch the route line. Use:

```ts
const route = r._kind === 'transfer'
    ? `${r.from || '—'} → ${r.to || '—'}`
    : `${(r.tour_name || r.experience_name || 'Booking')} — ${r.pickup_location || '—'}`;
```

Substitute `${route}` for the existing `${r.from} → ${r.to}` interpolation. Keep all other card fields unchanged.

The link to the detail page must include the right `?type=`:

```ts
const detailHref = `/driver/ride?id=${r.id}&type=${r._table}`;
```

If the existing card already has a link like `/driver/ride?id=${r.id}` (without `&type=`), update it to include `&type=${r._table}`. The /driver/ride page defaults to `transfers` if no type — fine for transfers, broken for tours/experiences.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/driver/upcoming.astro
git commit -m "fix(driver/upcoming): show assigned tours + experiences"
```

### Task C2: `/driver/past.astro`

**Files:**
- Modify: `src/pages/driver/past.astro`

- [ ] **Step 1: Survey**

```bash
grep -n "from('transfers')\|driver_uid\|loadRides\|allRides" src/pages/driver/past.astro | head -20
```

- [ ] **Step 2: Apply the same pattern as Task C1**

Add the import:

```ts
import { fetchCompletedRides, type UnifiedRide } from '../../lib/driver-rides';
```

Replace the supabase query block with:

```ts
try {
    allRides = await fetchCompletedRides(user.id);
} catch (err) {
    console.error('Driver past rides load failed:', err);
    document.getElementById('rides-list')!.innerHTML =
        `<div class="flex items-center justify-center py-12 text-neutral-400 text-sm">Could not load rides.</div>`;
    return;
}
```

Replace the local `Ride` interface with `type Ride = UnifiedRide;`. Update `renderRides()`'s route line and detail href the same way as C1.

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/driver/past.astro
git commit -m "fix(driver/past): show completed tours + experiences"
```

### Task C3: `/driver/index.astro`

**Files:**
- Modify: `src/pages/driver/index.astro`

- [ ] **Step 1: Survey**

```bash
grep -n "from('transfers')\|driver_uid\|loadDashboard\|allRides\|count" src/pages/driver/index.astro | head -20
```

- [ ] **Step 2: Replace queries**

This page likely shows aggregate counts (today's rides, upcoming count, past count). It probably calls `supabase.from('transfers')...` once or twice for these aggregates.

Add the import:

```ts
import { fetchAssignedRides, type UnifiedRide } from '../../lib/driver-rides';
```

Find the load function. Replace the single-table queries with the helper:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return;
const assigned = await fetchAssignedRides(user.id);
// ... compute aggregates from `assigned` instead of from a single supabase.from('transfers') result
```

If the page shows BOTH upcoming AND past counts, also call `fetchCompletedRides(user.id)` — but only if the dashboard renders past info. If it doesn't, leave it.

If the dashboard's query was originally specific to certain `ride_status` values not covered by `fetchAssignedRides` (which uses `['assigned', 'pickup', 'onboard']`), check the original status set and adapt — either widen `fetchAssignedRides`'s status set, OR add a new fetcher in the helper. Likely the existing set covers the dashboard's needs.

- [ ] **Step 3: Update any rendering that references `r.from`, `r.to`, `r.vehicle_name`, `r.passengers`**

If the dashboard renders ride cards (e.g., "next ride" preview), apply the same kind-switching as Task B1 Step 4.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/driver/index.astro
git commit -m "fix(driver/index): include tours + experiences in dashboard counts"
```

DO NOT push (Task D1 pushes everything).

---

## Phase D — Live verification

### Task D1: Push + browser test on live

**Files:** none modified.

- [ ] **Step 1: Push the branch + merge to main**

```bash
git push -u origin <branch-name>
git checkout main
git pull origin main
git merge --ff-only <branch-name>
git push origin main
```

Wait ~90 seconds for Vercel.

- [ ] **Step 2: As admin, release a test tour**

Sign in as admin (`mkifokeris@itdev.gr` / `123456789`). Navigate to `/admin/tours`. Find an unassigned tour with `released_to_drivers=false`. Click "Release" — the button should toggle to "Released" (green).

(If no unassigned tour exists, create a guest tour booking on `/book/tour` first to seed one.)

Note the tour's id from the row.

- [ ] **Step 3: As driver, verify the tour appears on /driver/available**

Sign out. Sign in as a driver (e.g., `driver@itdev.gr`). Navigate to `/driver/available`. The released tour should appear in the list with the correct heading (tour name + pickup) and an "Accept" button.

If no tour appears: open DevTools, check for query errors (RLS denied? Should not be). Report and stop.

- [ ] **Step 4: Click Accept on the tour**

Confirm the modal. Submit. The tour should disappear from `/driver/available`.

Verify via Supabase Management API that the tour row was updated:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-verify/1.0" \
  -d '{"query": "select id, ride_status, driver_uid, driver from public.tours where id = '"'"'<tour-id-from-step-2>'"'"';"}'
```

Expected: `ride_status='assigned'`, `driver_uid` matches the driver's user id, `driver` matches the partner name.

- [ ] **Step 5: Verify the tour appears on /driver/upcoming**

Navigate to `/driver/upcoming`. The accepted tour should appear with the same details + a link to `/driver/ride?id=...&type=tours`.

Click into the detail page — should load (the detail page already supports tours via `?type=`).

- [ ] **Step 6: No commit** — verification only.

---

## Notes for the executor

- **Detail page link.** `/driver/ride` requires `?type=tours|transfers|experiences`. The driver pages must include `&type=${r._table}` in their card hrefs. If you forget this, tours/experiences will route to `/driver/ride?id=X` which defaults to `transfers` and the lookup will fail.
- **Card UI consistency.** All three kinds render through the same card template, just with a kind-switched route line and (optionally) a small kind badge. This is intentionally simple — no per-kind component split. If product later wants type-specific cards, that's a separate UX task.
- **Edge case: tours/experiences without a `vehicle_name`.** Tours and experiences carry a `vehicle_name` field on the booking (drivers operate vehicles for both), but it may be empty. Render `r.vehicle_name || '—'` to avoid undefined display.
- **`fetchAssignedRides` and the dashboard widget.** `/driver/index` may include states beyond `assigned/pickup/onboard` (e.g., a "today's pickups" card might filter further by `date`). Read the existing logic carefully and don't lose any filtering — just swap the data source from a single-table query to the merged helper output.
- **Spam risk after Phase A's guest checkout (already shipped).** Released bookings now include guest-submitted tour/experience requests. The driver list could grow in unexpected ways if guest spam appears. Out of scope here — flag if it manifests.
