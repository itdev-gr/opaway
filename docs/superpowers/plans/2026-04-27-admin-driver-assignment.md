# Admin Driver Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin assign a specific driver to a transfer / tour / experience ride from the admin booking pages, by selecting from a dropdown of approved drivers, and have the assigned driver see the ride in their portal regardless of whether the ride was "released."

**Architecture:** A small shared helper `src/lib/driver-options.ts` queries `partners` for `type='driver' AND status='approved'` and renders an `<option>` list. On the three admin booking pages (`/admin/transfers`, `/admin/tours`, `/admin/experiences`) we replace the existing free-text inline-edit driver cell with a `<select>` populated from that helper. On change, the page does the SAME database write that the driver-self-accept flow already performs (`driver_uid + driver + ride_status='assigned'`), so the assigned ride shows up in `/driver/upcoming` immediately. Selecting "Unassigned" reverses the assignment (`driver_uid='' + driver='' + ride_status='new'`). No driver portal changes are needed — the existing queries (`/driver/upcoming` filters on `driver_uid` and ignores `released_to_drivers`) already match this behavior.

**Tech Stack:** Astro 5, Supabase JS v2, Tailwind v4, TypeScript.

**Out of scope (explicit):**
- Notification to driver (no email/SMS/push infra in app; realtime subscription on `/driver/index` already updates badges).
- Including `driver_staff` (sub-drivers) in the dropdown — v1 uses `partners.type='driver'` only.
- Admin "Add Booking" modal driver field — left for follow-up; the current modal creates a ride that any driver can pick up via release flow, and admin can assign immediately after via the new dropdown.
- Driver-side UI changes — `/driver/upcoming` already correctly filters by `driver_uid` only (no `released_to_drivers` check), and `/driver/available` already excludes rides with a non-empty `driver_uid`. No changes needed.
- Schema changes — `transfers.driver`, `transfers.driver_uid`, `tours.driver`, `tours.driver_uid`, `experiences.driver`, `experiences.driver_uid` already exist. No migration.
- Tests — the project has no test runner; verification is manual browser smoke test on live (Vercel deploy).

---

## Current state (verified before writing this plan)

- **`src/pages/admin/transfers.astro`** — `buildDriverCell()` at line 234 renders a free-text span; click triggers an inline `<input>` edit at lines 362–406; on save, only the `driver` text column is updated. `driver_uid` and `ride_status` are NOT touched.
- **`src/pages/admin/tours.astro`** — same pattern: `buildDriverCell()` at line 209, inline-edit at line 342; `driver` text only.
- **`src/pages/admin/experiences.astro`** — same: line 209, line 342.
- **`src/pages/driver/available.astro`** — query (lines 210–215): `ride_status='new' AND released_to_drivers=true`; client-side filters out rides with a non-empty `driver_uid`. Driver-self-accept (lines 267–274) writes `{driver_uid, driver, ride_status: 'assigned'}` — the canonical assignment shape we will mirror.
- **`src/pages/driver/upcoming.astro`** — query (lines 135–140): `driver_uid = user.id AND ride_status IN ('assigned','pickup','onboard')`. **Does NOT check `released_to_drivers`** — this is exactly what the spec wants ("admin can assign even if not released" → driver should still see it).
- **`partners` table** — schema in `supabase-migration.sql:27-60`: `id` (uuid, refs auth.users), `full_name`, `phone`, `email`, `type` ('driver'), `status` ('approved' is the value to filter on).
- **No existing `driver-options.ts` helper.** This is a green-field shared module.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `src/lib/driver-options.ts` | `fetchApprovedDrivers()` returns `{id, fullName}[]` from `partners` where `type='driver' AND status='approved'` (cached per-page-load via a module-level promise). `renderDriverOptionsHTML(currentUid)` returns `<option>` list as a string, with "Unassigned" as the empty-value default. |

### Modified files

| Path | Change |
|---|---|
| `src/pages/admin/transfers.astro` | Replace `buildDriverCell` to render a `<select>` instead of a click-to-edit span. Replace the `click` handler at line 362 with a `change` handler on `.driver-select` that updates `{driver_uid, driver, ride_status}` on the row. Import the shared helper. |
| `src/pages/admin/tours.astro` | Same change, on `tours` table. |
| `src/pages/admin/experiences.astro` | Same change, on `experiences` table. |

### No driver-portal changes

The existing queries are already correct for the new behavior. Verified above.

---

## The shared write contract

Every assignment write — admin OR driver — uses this exact shape:

| Action | Update payload |
|---|---|
| Assign driver `partnerId` (full_name `partnerName`) | `{ driver_uid: partnerId, driver: partnerName, ride_status: 'assigned' }` |
| Unassign | `{ driver_uid: '', driver: '', ride_status: 'new' }` |

This mirrors `driver/available.astro:267-274` (driver self-accept). Reusing the same shape means admin-assigned rides behave indistinguishably from driver-self-accepted rides downstream — `/driver/upcoming` finds them, `/driver/available` excludes them.

The release flag (`released_to_drivers`) is **never touched** by the assignment write. It remains independently controlled by the admin's "Release" button.

---

## Phase A — Shared helper

### Task 1: Create `src/lib/driver-options.ts`

**Files:**
- Create: `src/lib/driver-options.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/driver-options.ts` with:

```ts
/**
 * Driver dropdown helper for admin assignment UIs.
 *
 * Queries the `partners` table for approved drivers (type='driver',
 * status='approved') and renders a <select>'s <option> list.
 *
 * Caching: one in-flight promise per page load; resolves to a list
 * stable for the lifetime of the page.
 */
import { supabase } from './supabase';

export interface DriverOption {
  id: string;        // partners.id (= auth.users.id)
  fullName: string;  // partners.full_name
}

let cachedPromise: Promise<DriverOption[]> | null = null;

export function fetchApprovedDrivers(): Promise<DriverOption[]> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const { data, error } = await supabase
      .from('partners')
      .select('id, full_name')
      .eq('type', 'driver')
      .eq('status', 'approved')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('fetchApprovedDrivers failed:', error);
      return [];
    }
    return (data ?? []).map((d: any) => ({
      id: String(d.id ?? ''),
      fullName: String(d.full_name ?? '').trim() || 'Unnamed driver',
    }));
  })();
  return cachedPromise;
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Returns the <option> list as a string for embedding in a <select>.
 *
 * The first option is "Unassigned" with empty value. The matching
 * `currentUid` (if any) is rendered with the `selected` attribute.
 */
export function renderDriverOptionsHTML(
  drivers: DriverOption[],
  currentUid: string,
): string {
  const safeCurrent = currentUid || '';
  const unassignedSelected = safeCurrent === '' ? ' selected' : '';
  const head = `<option value=""${unassignedSelected}>Unassigned</option>`;
  const body = drivers.map(d => {
    const sel = d.id === safeCurrent ? ' selected' : '';
    return `<option value="${escAttr(d.id)}"${sel}>${escAttr(d.fullName)}</option>`;
  }).join('');
  return head + body;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: 63 pages built, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/driver-options.ts
git commit -m "feat(lib): driver-options helper for admin assignment dropdowns"
```

---

## Phase B — Admin transfers driver dropdown

### Task 2: Wire the dropdown into `src/pages/admin/transfers.astro`

**Files:**
- Modify: `src/pages/admin/transfers.astro` — import block, `buildDriverCell` (~line 234), the click delegation (~line 362), and `loadTransfers` (so it preloads drivers before rendering).

- [ ] **Step 1: Add the import**

In the main `<script>` block of `src/pages/admin/transfers.astro`, alongside the existing `supabase` import, add:

```ts
import { fetchApprovedDrivers, renderDriverOptionsHTML, type DriverOption } from '../../lib/driver-options';
```

Add a module-level state variable near the other state (e.g., next to `rowsById`):

```ts
let driverOptionsCache: DriverOption[] = [];
```

- [ ] **Step 2: Replace `buildDriverCell` with a select-based renderer**

Replace the existing `buildDriverCell` function (line 234) with:

```ts
const buildDriverCell = (docId: string, driverUid: string) => {
  const optionsHtml = renderDriverOptionsHTML(driverOptionsCache, driverUid);
  return `<select class="driver-select w-full min-w-[140px] px-2 py-1 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 hover:border-[#0C6B95]/40 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20" data-id="${docId}">${optionsHtml}</select>`;
};
```

Note: the second argument changes from `driver` (the text name) to `driverUid` (the auth user id). The selector's `value` is the partner id; the visible label is the partner's `full_name` (rendered by the helper).

- [ ] **Step 3: Update the row template to pass `driver_uid`**

In the `tbody.innerHTML = rows.map(d => { ... })` block (~line 255), where the driver cell is rendered (~line 298):

**Before:**

```ts
const driver = d.driver ? String(d.driver) : '';
// ...
<td class="px-6 py-3 whitespace-nowrap">${buildDriverCell(d.id, driver)}</td>
```

**After:**

```ts
const driverUid = d.driver_uid ? String(d.driver_uid) : '';
// ...
<td class="px-6 py-3 whitespace-nowrap">${buildDriverCell(d.id, driverUid)}</td>
```

The `const driver = ...` line above is no longer used by this cell — leave it only if it's referenced elsewhere in the same row template (search the row template for `${escHtml(driver)}` usages; none exist as of this writing, so the line can be deleted, but if grep shows future uses, keep it).

- [ ] **Step 4: Preload drivers in `loadTransfers` BEFORE rendering rows**

At the start of `loadTransfers` (~line 241), before the `supabase.from('transfers').select('*')` call, await the driver list:

**Before:**

```ts
async function loadTransfers() {
  const tbody = document.getElementById('transfers-tbody')!;
  const countEl = document.getElementById('transfers-count');
  try {
    const { data, error } = await supabase.from('transfers').select('*').order('created_at', { ascending: false });
```

**After:**

```ts
async function loadTransfers() {
  const tbody = document.getElementById('transfers-tbody')!;
  const countEl = document.getElementById('transfers-count');
  try {
    driverOptionsCache = await fetchApprovedDrivers();
    const { data, error } = await supabase.from('transfers').select('*').order('created_at', { ascending: false });
```

This ensures every cell rendered in the next `tbody.innerHTML = ...` line has the dropdown options ready.

- [ ] **Step 5: Replace inline-edit click handler with select-change handler**

Find the existing driver inline-edit delegation block (lines 361–406, the comment is `/* ── Driver inline edit delegation ── */`). Replace the entire block (from the comment through the closing `});`) with:

```ts
/* ── Driver dropdown change delegation ── */
document.getElementById('transfers-tbody')?.addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.classList.contains('driver-select')) return;

  const docId = sel.dataset.id!;
  const newDriverUid = sel.value;
  const newDriverName = newDriverUid
    ? (driverOptionsCache.find(d => d.id === newDriverUid)?.fullName ?? '')
    : '';

  // Mirror the driver-self-accept write shape from /driver/available.astro
  const update = newDriverUid
    ? { driver_uid: newDriverUid, driver: newDriverName, ride_status: 'assigned' }
    : { driver_uid: '', driver: '', ride_status: 'new' };

  const { error } = await supabase.from('transfers').update(update).eq('id', docId);
  if (error) {
    console.error('Transfer driver assignment failed:', error);
    alert(`Save failed: [${error.code ?? 'unknown'}] ${error.message}`);
    // On failure, revert UI by reloading
    await loadTransfers();
    return;
  }

  // Update local row cache so reservation modal and re-renders see the new state
  const row = rowsById.get(docId);
  if (row) {
    row.driver_uid = update.driver_uid;
    row.driver = update.driver;
    row.ride_status = update.ride_status;
  }
});
```

This block uses the SAME `tbody.addEventListener('change', ...)` element as the existing ride-status / payment-status delegation (lines 339–359). Keep the existing change-handler block as-is; this new block is a SEPARATE listener on the same element. Both fire and check `classList.contains('xxx-select')` to disambiguate — there's no conflict.

- [ ] **Step 6: Update the row-click handler's "ignored elements" guard**

The existing row-click handler at lines 325–331 ignores clicks on `input, select, button, [data-release], .driver-text, .driver-display`. Since `.driver-text` no longer exists, leave the guard as-is — `select` already covers our new dropdown. No change needed. (If you want to clean up dead selectors, remove `.driver-text, .driver-display`, but this is optional.)

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: 63 pages, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/admin/transfers.astro
git commit -m "feat(admin/transfers): assign driver via dropdown (writes driver_uid + ride_status='assigned')"
```

---

## Phase C — Admin tours driver dropdown

### Task 3: Same dropdown on `src/pages/admin/tours.astro`

**Files:**
- Modify: `src/pages/admin/tours.astro`

- [ ] **Step 1: Add the import + state variable**

In the main `<script>` block of `src/pages/admin/tours.astro`:

```ts
import { fetchApprovedDrivers, renderDriverOptionsHTML, type DriverOption } from '../../lib/driver-options';
```

Add module-level state:

```ts
let driverOptionsCache: DriverOption[] = [];
```

- [ ] **Step 2: Replace `buildDriverCell` (~line 209)**

```ts
const buildDriverCell = (docId: string, driverUid: string) => {
  const optionsHtml = renderDriverOptionsHTML(driverOptionsCache, driverUid);
  return `<select class="driver-select w-full min-w-[140px] px-2 py-1 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 hover:border-[#0C6B95]/40 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20" data-id="${docId}">${optionsHtml}</select>`;
};
```

- [ ] **Step 3: Update the row template (~line 260)**

Find `${buildDriverCell(d.id, String(d.driver ?? ''))}` and change to `${buildDriverCell(d.id, String(d.driver_uid ?? ''))}`.

- [ ] **Step 4: Preload drivers in `loadTours()` before rendering**

Same pattern as Task 2 Step 4: at the top of `loadTours()`, before the Supabase query:

```ts
driverOptionsCache = await fetchApprovedDrivers();
```

- [ ] **Step 5: Replace driver inline-edit handler (~line 342)**

Locate the driver inline-edit block (search for `driver-text` or the equivalent inline-edit delegation in this file). Replace it with the dropdown-change handler — same shape as Task 2 Step 5, but with `tours` instead of `transfers`:

```ts
/* ── Driver dropdown change delegation ── */
document.getElementById('tours-tbody')?.addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.classList.contains('driver-select')) return;

  const docId = sel.dataset.id!;
  const newDriverUid = sel.value;
  const newDriverName = newDriverUid
    ? (driverOptionsCache.find(d => d.id === newDriverUid)?.fullName ?? '')
    : '';

  const update = newDriverUid
    ? { driver_uid: newDriverUid, driver: newDriverName, ride_status: 'assigned' }
    : { driver_uid: '', driver: '', ride_status: 'new' };

  const { error } = await supabase.from('tours').update(update).eq('id', docId);
  if (error) {
    console.error('Tour driver assignment failed:', error);
    alert(`Save failed: [${error.code ?? 'unknown'}] ${error.message}`);
    await loadTours();
    return;
  }

  const row = rowsById.get(docId);
  if (row) {
    row.driver_uid = update.driver_uid;
    row.driver = update.driver;
    row.ride_status = update.ride_status;
  }
});
```

Note: confirm that `tours-tbody` is the actual id of the table body in `admin/tours.astro` and that `rowsById` is the local row cache name. If the names differ, use the existing names.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: 63 pages, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/tours.astro
git commit -m "feat(admin/tours): assign driver via dropdown (writes driver_uid + ride_status='assigned')"
```

---

## Phase D — Admin experiences driver dropdown

### Task 4: Same dropdown on `src/pages/admin/experiences.astro`

**Files:**
- Modify: `src/pages/admin/experiences.astro`

This is structurally identical to Task 3. The differences are: table name is `experiences`, function is `loadExperiences`, table body id is `experiences-tbody`.

- [ ] **Step 1: Add the import + state variable**

```ts
import { fetchApprovedDrivers, renderDriverOptionsHTML, type DriverOption } from '../../lib/driver-options';
// ...
let driverOptionsCache: DriverOption[] = [];
```

- [ ] **Step 2: Replace `buildDriverCell` (~line 209)**

```ts
const buildDriverCell = (docId: string, driverUid: string) => {
  const optionsHtml = renderDriverOptionsHTML(driverOptionsCache, driverUid);
  return `<select class="driver-select w-full min-w-[140px] px-2 py-1 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 hover:border-[#0C6B95]/40 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20" data-id="${docId}">${optionsHtml}</select>`;
};
```

- [ ] **Step 3: Update the row template (~line 260)**

Find `${buildDriverCell(d.id, String(d.driver ?? ''))}` and change the second arg to `String(d.driver_uid ?? '')`.

- [ ] **Step 4: Preload drivers in `loadExperiences()`**

At the top of `loadExperiences()`, before the Supabase query:

```ts
driverOptionsCache = await fetchApprovedDrivers();
```

- [ ] **Step 5: Replace driver inline-edit handler (~line 342)**

Replace with the dropdown-change handler — same shape as Task 2/3, but using `experiences` table and `experiences-tbody` element:

```ts
/* ── Driver dropdown change delegation ── */
document.getElementById('experiences-tbody')?.addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.classList.contains('driver-select')) return;

  const docId = sel.dataset.id!;
  const newDriverUid = sel.value;
  const newDriverName = newDriverUid
    ? (driverOptionsCache.find(d => d.id === newDriverUid)?.fullName ?? '')
    : '';

  const update = newDriverUid
    ? { driver_uid: newDriverUid, driver: newDriverName, ride_status: 'assigned' }
    : { driver_uid: '', driver: '', ride_status: 'new' };

  const { error } = await supabase.from('experiences').update(update).eq('id', docId);
  if (error) {
    console.error('Experience driver assignment failed:', error);
    alert(`Save failed: [${error.code ?? 'unknown'}] ${error.message}`);
    await loadExperiences();
    return;
  }

  const row = rowsById.get(docId);
  if (row) {
    row.driver_uid = update.driver_uid;
    row.driver = update.driver;
    row.ride_status = update.ride_status;
  }
});
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: 63 pages, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/experiences.astro
git commit -m "feat(admin/experiences): assign driver via dropdown (writes driver_uid + ride_status='assigned')"
```

---

## Phase E — Verification

### Task 5: Push to main and verify on live

**Files:** none modified — verification only.

- [ ] **Step 1: Final build**

Run: `npm run build`
Expected: 63 pages, no TS errors, no warnings.

- [ ] **Step 2: Push to main**

```bash
git push origin main
```

Vercel auto-deploys. Wait ~90 seconds.

- [ ] **Step 3: Browser smoke test on live (admin side)**

Sign in as admin (e.g. `mkifokeris@itdev.gr`) on `https://opaway.vercel.app`.

For EACH of `/admin/transfers`, `/admin/tours`, `/admin/experiences`:

1. The "Driver" column now shows a dropdown per row.
2. The dropdown lists "Unassigned" + every approved driver from `partners` (sorted by name).
3. Pick a driver → page should NOT reload but the dropdown should reflect the new selection. The "Ride Status" select on the same row should now show "assigned" (refresh the page to confirm — the realtime UI update is out of scope).
4. Pick "Unassigned" → ride_status reverts to "new" on next refresh.
5. The "Release" button is independent — picking a driver does NOT toggle release.
6. Pre-assigned but un-released ride: assign a driver to a ride that has `released_to_drivers = false`. The write should succeed without the admin having to click "Release" first.

- [ ] **Step 4: Browser smoke test on live (driver side)**

Sign out and sign in as a driver (or use an existing driver account). Navigate to `/driver/upcoming`.

1. Any ride the admin assigned to this driver in Step 3 (with `ride_status='assigned'`) should appear in `/driver/upcoming`, **even if `released_to_drivers` is false**.
2. Sign out, sign back in as a different driver. Their `/driver/upcoming` should NOT show the rides assigned to the first driver.
3. As any driver, navigate to `/driver/available`. The admin-assigned rides should NOT appear here (they're filtered out by the `driver_uid IS NULL OR ''` check).

- [ ] **Step 5: No commit for this task** — verification only. If any check fails, fix in the relevant phase's task and amend with a fixup commit.

---

## Notes for the executor

- **Why we update `ride_status` on assignment.** The driver-self-accept flow at `driver/available.astro:267-274` already does this. If admin assignment did NOT touch `ride_status`, then `/driver/upcoming`'s filter `ride_status IN ('assigned', 'pickup', 'onboard')` would exclude the admin-assigned ride and the driver wouldn't see it. Mirroring the self-accept shape keeps both flows symmetric and means downstream code doesn't have to special-case admin-assigned rides.
- **Why we DON'T touch `released_to_drivers`.** The "Release" button is the admin's tool for letting OTHER drivers see this ride in `/driver/available`. Assignment to a SPECIFIC driver is orthogonal — once `driver_uid` is set, the ride disappears from `/available` regardless of release flag, and appears in the assigned driver's `/upcoming` regardless of release flag. The two booleans serve different purposes: release = "this ride is in the open pool"; driver_uid = "this ride is taken."
- **Module-level cache lifetime.** The `cachedPromise` in `driver-options.ts` is module-scoped, so it lives for the lifetime of the page (= one cold load). New drivers added by another admin in another tab won't show up until the page is refreshed. Acceptable for v1; if real-time updates become important, replace with a realtime subscription on the `partners` table (already wired by `lib/notifications.ts` for badges).
- **No new files outside `src/lib/driver-options.ts`** — three call sites use the same helper. DRY is satisfied without forcing a component.
- **Don't refactor the existing ride-status / payment-status / release wiring** — they work and aren't in scope. Only the driver cell is replaced.
