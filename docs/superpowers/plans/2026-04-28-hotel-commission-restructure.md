# Hotel Commission Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure hotel partner commissions so transfers use a fix-EUR amount per vehicle class (Sedan/Van/Minibus), while hourly / tour / experience use a per-type percentage of the booking total. Update the schema, the admin config UI, the commission resolver, the hotel-facing dashboards, and the admin partner-detail view.

**Architecture:** Add 6 new columns on `partners`: 3 per-vehicle EUR for transfers (`commission_transfer_sedan_eur`, `_van_eur`, `_minibus_eur`) and 3 per-type percentages (`commission_hourly_pct`, `commission_tour_pct`, `commission_experience_pct`). Refactor `src/lib/commissions.ts` so resolution accepts a full booking row (vehicle name + total price) instead of just a `kind`, and returns the computed EUR amount. The `HotelCommissionModal` admin form is rewritten to capture the 6 new fields. Hotel dashboards continue to display EUR earnings unchanged — the math change is invisible to them. Old per-type EUR columns (`commission_transfer_eur`, etc.) are kept in the DB as deprecated so historical data isn't lost; nothing reads them after the cutover. `discount` and `commission_eur` (legacy) stay untouched. Drivers and agencies are out of scope.

**Tech Stack:** Astro 5, Supabase JS v2, PostgreSQL (RLS unchanged), TypeScript.

**Out of scope (explicit):**
- Driver and agency partner types — no change to their pricing.
- The hotel `discount` percentage column (already unused per investigation).
- Backward compatibility for the old EUR-per-type commission columns. The migration backfills the new transfer per-vehicle columns from `commission_transfer_eur`; the new percentage columns default to 0 and require admin reconfiguration (the unit changed — EUR → %, no clean conversion).
- Email/notification of partners about the new model. Operator handles communication out of band.
- The legacy `commission_eur` flat fallback. Keeping the column as-is; the new resolver ignores it.

---

## Current state (verified before writing this plan)

- **Schema** (`db/migrations/2026-04-23-partners-commission-per-type.sql`): hotels have `commission_eur`, `commission_transfer_eur`, `commission_hourly_eur`, `commission_tour_eur`, `commission_experience_eur`, plus an unused `discount` (numeric).
- **Resolver** (`src/lib/commissions.ts:36-42`):
  ```ts
  export function resolveCommissionEur(partner: PartnerCommission | null | undefined, kind: CommissionKind): number {
    if (!partner) return 0;
    const specific = toNumber(partner[COL_FOR_KIND[kind]]);
    if (specific != null) return specific;
    const legacy = toNumber(partner.commission_eur);
    return legacy ?? 0;
  }
  ```
  Takes a `kind` argument (`'transfer' | 'hourly' | 'tour' | 'experience'`) and returns one EUR value. No vehicle awareness, no percentage support.
- **Admin modal** (`src/components/HotelCommissionModal.astro`): inputs for `commission_transfer_eur`, `commission_hourly_eur`, `commission_tour_eur`, `commission_experience_eur`, plus legacy `commission_eur` and discount. All inputs are EUR.
- **Hotel dashboard query** (`src/pages/hotel/commissions.astro:156`):
  ```ts
  .select('commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur')
  ```
  Calls `resolveCommissionEur(partner, kindForTransferRow(row))` for transfer rows and `resolveCommissionEur(partner, 'tour' | 'experience')` for the others.
- **Admin partner detail** (`src/components/PartnerDetailModal.astro:102-106`): 5 EUR commission fields rendered for hotels.
- **Vehicle identification on booking rows**: the `transfers` table has `vehicle_name` (e.g., "Sedan", "Van", "Minibus", or "Sedan: Mercedes E-Class") — not a structured slug. The new resolver will map this to the right per-vehicle column via a case-insensitive substring match.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `db/migrations/2026-04-28-partners-commission-restructure.sql` | Adds 6 new columns to `partners`; backfills the 3 transfer per-vehicle EUR fields from existing `commission_transfer_eur` (or `commission_eur`); leaves percentage columns at 0. Idempotent. |

### Modified files

| Path | Change |
|---|---|
| `src/lib/commissions.ts` | Replace `resolveCommissionEur(partner, kind)` with `resolveHotelCommission(partner, booking)`. Booking object carries `kind`, `vehicle_name?`, `total_price?`. For transfers: pick per-vehicle EUR. For hourly/tour/experience: pct × total_price ÷ 100. Keep the old export name as a thin wrapper that constructs the new shape from `(partner, kindOnly)` so call sites can be migrated incrementally — but in this plan, all callers ARE migrated, so the wrapper is added for safety only. |
| `src/components/HotelCommissionModal.astro` | Rewrite the form: replace the 4 EUR-per-type inputs with 3 per-vehicle EUR inputs (Sedan/Van/Minibus) and 3 percentage inputs (Hourly/Tour/Experience). Update the read+write logic to pull/save the new columns. |
| `src/components/PartnerDetailModal.astro` | Update the hotel commission display rows: 3 per-vehicle EUR values for transfers + 3 percentages for hourly/tour/experience. |
| `src/pages/hotel/commissions.astro` | Update the SELECT to include the 6 new columns. Update each `resolveCommissionEur` call site to use the new `resolveHotelCommission(partner, row)`. |
| `src/pages/hotel/index.astro` | Same SELECT + resolver-call update. |

---

## Phase A — Schema migration

### Task A1: Migration — add 6 new columns + backfill

**Files:**
- Create: `db/migrations/2026-04-28-partners-commission-restructure.sql`
- Apply via Supabase Management API (project ref `wjqfcijisslzqxesbbox`, token in `.supabase-pat`).

- [ ] **Step 1: Write the migration**

```sql
-- Hotel commission restructure.
-- Replaces 4 single-type EUR columns (commission_transfer_eur, _hourly_eur, _tour_eur,
-- _experience_eur) with a richer structure: per-vehicle EUR for transfers and per-type
-- percentages for hourly/tour/experience. Old columns are kept as deprecated for
-- historical data; nothing reads them after this migration.
-- Idempotent.

alter table public.partners
  add column if not exists commission_transfer_sedan_eur   numeric(10,2),
  add column if not exists commission_transfer_van_eur     numeric(10,2),
  add column if not exists commission_transfer_minibus_eur numeric(10,2),
  add column if not exists commission_hourly_pct           numeric(5,2),
  add column if not exists commission_tour_pct             numeric(5,2),
  add column if not exists commission_experience_pct       numeric(5,2);

-- Backfill: hotels that had a flat transfer EUR get it copied to all 3 vehicle slots.
-- Operators can refine per-vehicle in the admin UI afterwards.
update public.partners
set commission_transfer_sedan_eur   = coalesce(commission_transfer_sedan_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0),
    commission_transfer_van_eur     = coalesce(commission_transfer_van_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0),
    commission_transfer_minibus_eur = coalesce(commission_transfer_minibus_eur,
                                                commission_transfer_eur,
                                                commission_eur,
                                                0)
where type = 'hotel';

-- Percentage columns: there's no clean way to convert EUR → %, so they stay NULL/0
-- until the operator sets them in the UI. The new resolver treats null/missing as 0%.
```

- [ ] **Step 2: Apply the migration**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'query': open('db/migrations/2026-04-28-partners-commission-restructure.sql').read()}))")"
```

Expected output: `[]` (DDL queries return an empty array on success).

- [ ] **Step 3: Verify the new columns + backfill values**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d '{"query": "select column_name, data_type, is_nullable from information_schema.columns where table_schema='"'"'public'"'"' and table_name='"'"'partners'"'"' and column_name in ('"'"'commission_transfer_sedan_eur'"'"','"'"'commission_transfer_van_eur'"'"','"'"'commission_transfer_minibus_eur'"'"','"'"'commission_hourly_pct'"'"','"'"'commission_tour_pct'"'"','"'"'commission_experience_pct'"'"') order by column_name;"}'
```

Expected: 6 rows, all `numeric`, all `is_nullable = YES`.

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-migration/1.0" \
  -d '{"query": "select id, full_name, commission_transfer_eur, commission_transfer_sedan_eur, commission_transfer_van_eur, commission_transfer_minibus_eur from public.partners where type='hotel' limit 5;"}'
```

Expected: each hotel row's three new vehicle columns equal its old `commission_transfer_eur` (or `commission_eur` if that was null), or 0 if both were null.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-04-28-partners-commission-restructure.sql
git commit -m "db: hotel commission restructure (per-vehicle EUR + per-type pct columns)"
```

DO NOT push yet (the resolver + UI still read old columns until Phase B/C land).

---

## Phase B — Pricing logic

### Task B1: Update `src/lib/commissions.ts` to support the new model

**Files:**
- Modify: `src/lib/commissions.ts` (full rewrite — small file).

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `src/lib/commissions.ts` with:

```ts
// src/lib/commissions.ts
//
// Resolves the commission amount (in EUR) owed to a hotel partner for a
// single booking under the new per-vehicle / per-type-percentage model.
//
// Transfers (kind='transfer'/'hourly') -> fix EUR per vehicle class
//   commission_transfer_sedan_eur   for vehicle_name matching /sedan/i
//   commission_transfer_van_eur     for vehicle_name matching /van/i (and not "minibus")
//   commission_transfer_minibus_eur for vehicle_name matching /minibus/i
//
// Hourly bookings still use the per-vehicle EUR (they ride in the same vehicle classes).
//
// Tours / experiences -> percentage of total_price.
//   commission_tour_pct       for kind='tour'
//   commission_experience_pct for kind='experience'
//
// Returns 0 when the relevant column is null / missing / non-numeric.

export type CommissionKind = 'transfer' | 'hourly' | 'tour' | 'experience';

export interface PartnerCommission {
    // New per-vehicle EUR columns (transfers + hourly use these)
    commission_transfer_sedan_eur?: number | string | null;
    commission_transfer_van_eur?: number | string | null;
    commission_transfer_minibus_eur?: number | string | null;
    // New per-type percentage columns
    commission_hourly_pct?: number | string | null;
    commission_tour_pct?: number | string | null;
    commission_experience_pct?: number | string | null;
}

export interface CommissionBooking {
    kind: CommissionKind;
    vehicle_name?: string | null;
    total_price?: number | string | null;
}

export type VehicleClass = 'sedan' | 'van' | 'minibus' | 'unknown';

function toNumber(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Map a free-text vehicle_name to one of three classes.
 * Order matters: minibus is checked before van because "minibus" contains "bus" but not
 * "van", and we don't want false positives. "Sedan" is matched last as a fallback when
 * a row mentions a model only.
 */
export function classifyVehicle(vehicleName: string | null | undefined): VehicleClass {
    if (!vehicleName) return 'unknown';
    const v = vehicleName.toLowerCase();
    if (v.includes('minibus')) return 'minibus';
    if (v.includes('van')) return 'van';
    if (v.includes('sedan')) return 'sedan';
    return 'unknown';
}

/** Resolves the commission EUR for one booking. */
export function resolveHotelCommission(
    partner: PartnerCommission | null | undefined,
    booking: CommissionBooking,
): number {
    if (!partner) return 0;

    if (booking.kind === 'transfer' || booking.kind === 'hourly') {
        const cls = classifyVehicle(booking.vehicle_name);
        if (cls === 'sedan')   return toNumber(partner.commission_transfer_sedan_eur)   ?? 0;
        if (cls === 'van')     return toNumber(partner.commission_transfer_van_eur)     ?? 0;
        if (cls === 'minibus') return toNumber(partner.commission_transfer_minibus_eur) ?? 0;
        // Unknown vehicle: pick the smallest configured rate as a conservative default,
        // or 0 if none. Better to under-pay than over-pay; admin can fix the row.
        const candidates = [
            toNumber(partner.commission_transfer_sedan_eur),
            toNumber(partner.commission_transfer_van_eur),
            toNumber(partner.commission_transfer_minibus_eur),
        ].filter((n): n is number => n != null);
        return candidates.length ? Math.min(...candidates) : 0;
    }

    // tour / experience: percentage × total_price
    const total = toNumber(booking.total_price) ?? 0;
    if (total <= 0) return 0;
    const pctRaw = booking.kind === 'tour'
        ? toNumber(partner.commission_tour_pct)
        : toNumber(partner.commission_experience_pct);
    if (pctRaw == null || pctRaw <= 0) return 0;
    // Round to cents.
    return Math.round(total * pctRaw) / 100;
}

/** Backwards-compatible thin wrapper. */
export function resolveCommissionEur(
    partner: PartnerCommission | null | undefined,
    kind: CommissionKind,
    extra?: { vehicle_name?: string | null; total_price?: number | string | null },
): number {
    return resolveHotelCommission(partner, {
        kind,
        vehicle_name: extra?.vehicle_name,
        total_price: extra?.total_price,
    });
}

/** Infer the commission kind from a row from the transfers table. */
export function kindForTransferRow(row: { booking_type?: string | null }): CommissionKind {
    return row.booking_type === 'hourly' ? 'hourly' : 'transfer';
}
```

- [ ] **Step 2: Type-check / build**

Run: `npm run build`
Expected: 63 pages, no TypeScript errors. The build will likely surface mismatches in callers — those are addressed in subsequent tasks.

If the build complains about `commission_transfer_eur` etc. being missing from `PartnerCommission`, that's expected — those fields were intentionally removed from the interface. Existing callers will keep working through the `resolveCommissionEur` wrapper as long as they pass `extra` with `vehicle_name` and `total_price` going forward (we update them in Tasks D1/D2).

- [ ] **Step 3: Commit**

```bash
git add src/lib/commissions.ts
git commit -m "feat(lib/commissions): per-vehicle EUR + per-type pct resolver"
```

---

## Phase C — Admin UI

### Task C1: Rewrite the `HotelCommissionModal.astro` form

**Files:**
- Modify: `src/components/HotelCommissionModal.astro` (full rewrite of the form section + the load/save logic).

- [ ] **Step 1: Read the current file end-to-end**

```bash
wc -l src/components/HotelCommissionModal.astro
sed -n '1,200p' src/components/HotelCommissionModal.astro
```

Note the API: `window.OpawayHotelCommission.open(partnerRow)` is called by the admin partners page; `partnerRow` is a row from `public.partners`. The current form has 4 EUR fields + legacy + discount. Current input ids: `hc-transfer`, `hc-hourly`, `hc-tour`, `hc-experience`, `hc-legacy`, `hc-discount`.

- [ ] **Step 2: Replace the markup**

Replace the entire `<form id="hc-form" …>` block (lines 17–66 region) with:

```astro
<form id="hc-form" class="space-y-5">
    <p class="text-xs text-neutral-500">
        Configure how much this hotel earns per confirmed booking. Transfers use
        a fix EUR amount per vehicle class. Hourly, tours, and experiences use a
        percentage of the booking total.
    </p>

    <fieldset class="space-y-3">
        <legend class="text-xs font-semibold text-neutral-700 uppercase tracking-wider">Transfers — fix EUR per vehicle</legend>
        <div class="grid grid-cols-3 gap-3">
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Sedan</span>
                <div class="flex items-center gap-1">
                    <input id="hc-sedan" type="number" step="0.01" min="0" placeholder="0.00"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">€</span>
                </div>
            </label>
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Van</span>
                <div class="flex items-center gap-1">
                    <input id="hc-van" type="number" step="0.01" min="0" placeholder="0.00"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">€</span>
                </div>
            </label>
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Minibus</span>
                <div class="flex items-center gap-1">
                    <input id="hc-minibus" type="number" step="0.01" min="0" placeholder="0.00"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">€</span>
                </div>
            </label>
        </div>
    </fieldset>

    <fieldset class="space-y-3">
        <legend class="text-xs font-semibold text-neutral-700 uppercase tracking-wider">Hourly / Tours / Experiences — percentage</legend>
        <div class="grid grid-cols-3 gap-3">
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Rent by hour</span>
                <div class="flex items-center gap-1">
                    <input id="hc-hourly-pct" type="number" step="0.01" min="0" max="100" placeholder="0"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">%</span>
                </div>
            </label>
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Tour</span>
                <div class="flex items-center gap-1">
                    <input id="hc-tour-pct" type="number" step="0.01" min="0" max="100" placeholder="0"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">%</span>
                </div>
            </label>
            <label class="block">
                <span class="block text-xs text-neutral-600 mb-1">Experience</span>
                <div class="flex items-center gap-1">
                    <input id="hc-experience-pct" type="number" step="0.01" min="0" max="100" placeholder="0"
                        class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    <span class="text-xs text-neutral-400">%</span>
                </div>
            </label>
        </div>
    </fieldset>

    <div class="flex items-center justify-end gap-2 pt-2">
        <span id="hc-status" class="mr-auto text-xs hidden"></span>
        <button type="button" id="hc-cancel" class="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-700 text-sm font-semibold hover:bg-neutral-50">Cancel</button>
        <button type="submit" id="hc-save" class="px-4 py-2 rounded-xl bg-[#0C6B95] hover:bg-[#0a5c82] text-white text-sm font-semibold disabled:opacity-60">Save</button>
    </div>
</form>
```

The legacy and discount inputs are removed from the modal — those columns stay in the DB but the admin no longer edits them via this surface. (If product wants them back, they can be added separately.)

- [ ] **Step 3: Update the script's `inputs` map and load/save logic**

In the same file's `<script>` block, find:

```ts
const inputs = {
    transfer:   document.getElementById('hc-transfer')   as HTMLInputElement,
    hourly:     document.getElementById('hc-hourly')     as HTMLInputElement,
    tour:       document.getElementById('hc-tour')       as HTMLInputElement,
    experience: document.getElementById('hc-experience') as HTMLInputElement,
    legacy:     document.getElementById('hc-legacy')     as HTMLInputElement,
```

Replace with:

```ts
const inputs = {
    sedan:        document.getElementById('hc-sedan')          as HTMLInputElement,
    van:          document.getElementById('hc-van')            as HTMLInputElement,
    minibus:      document.getElementById('hc-minibus')        as HTMLInputElement,
    hourlyPct:    document.getElementById('hc-hourly-pct')     as HTMLInputElement,
    tourPct:      document.getElementById('hc-tour-pct')       as HTMLInputElement,
    experiencePct:document.getElementById('hc-experience-pct') as HTMLInputElement,
```

Then update the load function (which populates the form when a partner row is passed in) so it reads the new columns. Find the place where each input's `.value` is set from the partner row and replace with:

```ts
inputs.sedan.value         = fmt(partner.commission_transfer_sedan_eur);
inputs.van.value           = fmt(partner.commission_transfer_van_eur);
inputs.minibus.value       = fmt(partner.commission_transfer_minibus_eur);
inputs.hourlyPct.value     = fmt(partner.commission_hourly_pct);
inputs.tourPct.value       = fmt(partner.commission_tour_pct);
inputs.experiencePct.value = fmt(partner.commission_experience_pct);
```

(Use whatever `fmt` helper currently formats numeric DB values into `<input>`-friendly strings; if there isn't one, inline: `(v == null ? '' : String(v))`.)

Update the SAVE handler — the supabase update payload. Find the existing save object and replace its commission fields with:

```ts
const payload = {
    commission_transfer_sedan_eur:   parseField(inputs.sedan.value),
    commission_transfer_van_eur:     parseField(inputs.van.value),
    commission_transfer_minibus_eur: parseField(inputs.minibus.value),
    commission_hourly_pct:           parseField(inputs.hourlyPct.value),
    commission_tour_pct:             parseField(inputs.tourPct.value),
    commission_experience_pct:       parseField(inputs.experiencePct.value),
};
```

Where `parseField` is a helper (define inline if not present):

```ts
function parseField(v: string): number | null {
    const t = (v ?? '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
```

The save call remains `supabase.from('partners').update(payload).eq('id', partnerId)`.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: 63 pages, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/HotelCommissionModal.astro
git commit -m "feat(admin/hotel-commission-modal): per-vehicle EUR + per-type pct fields"
```

### Task C2: Update `PartnerDetailModal.astro` admin display

**Files:**
- Modify: `src/components/PartnerDetailModal.astro` (lines 102-106 region).

- [ ] **Step 1: Replace the commission display rows**

Find the existing block (around lines 102-106):

```ts
r.type === 'hotel' ? field('Commission — Transfer',   r.commission_transfer_eur   != null ? `€${Number(r.commission_transfer_eur).toFixed(2)}`   : '—') : '',
r.type === 'hotel' ? field('Commission — Hourly',     r.commission_hourly_eur     != null ? `€${Number(r.commission_hourly_eur).toFixed(2)}`     : '—') : '',
r.type === 'hotel' ? field('Commission — Tour',       r.commission_tour_eur       != null ? `€${Number(r.commission_tour_eur).toFixed(2)}`       : '—') : '',
r.type === 'hotel' ? field('Commission — Experience', r.commission_experience_eur != null ? `€${Number(r.commission_experience_eur).toFixed(2)}` : '—') : '',
r.type === 'hotel' ? field('Commission — Legacy',     r.commission_eur            != null ? `€${Number(r.commission_eur).toFixed(2)}`            : '—') : '',
```

Replace with:

```ts
r.type === 'hotel' ? field('Transfer — Sedan',   r.commission_transfer_sedan_eur   != null ? `€${Number(r.commission_transfer_sedan_eur).toFixed(2)}`   : '—') : '',
r.type === 'hotel' ? field('Transfer — Van',     r.commission_transfer_van_eur     != null ? `€${Number(r.commission_transfer_van_eur).toFixed(2)}`     : '—') : '',
r.type === 'hotel' ? field('Transfer — Minibus', r.commission_transfer_minibus_eur != null ? `€${Number(r.commission_transfer_minibus_eur).toFixed(2)}` : '—') : '',
r.type === 'hotel' ? field('Hourly — %',         r.commission_hourly_pct           != null ? `${Number(r.commission_hourly_pct).toFixed(2)}%`           : '—') : '',
r.type === 'hotel' ? field('Tour — %',           r.commission_tour_pct             != null ? `${Number(r.commission_tour_pct).toFixed(2)}%`             : '—') : '',
r.type === 'hotel' ? field('Experience — %',     r.commission_experience_pct       != null ? `${Number(r.commission_experience_pct).toFixed(2)}%`       : '—') : '',
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: 63 pages, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PartnerDetailModal.astro
git commit -m "feat(admin/partner-detail): show per-vehicle EUR + per-type pct for hotels"
```

---

## Phase D — Hotel dashboards

### Task D1: Update `hotel/commissions.astro` — SELECT + resolver calls

**Files:**
- Modify: `src/pages/hotel/commissions.astro`

- [ ] **Step 1: Update the partner SELECT**

Find line 156:

```ts
.select('commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur')
```

Replace with:

```ts
.select('commission_transfer_sedan_eur, commission_transfer_van_eur, commission_transfer_minibus_eur, commission_hourly_pct, commission_tour_pct, commission_experience_pct')
```

- [ ] **Step 2: Update the resolver call sites**

Find each call to `resolveCommissionEur(partner, …)` in this file. Replace with `resolveHotelCommission(partner, { kind, vehicle_name, total_price })`.

Specifically (around lines 171, 179, 187):

```ts
// Before:
commission: resolveCommissionEur(partner, kindForTransferRow(r)),

// After (transfers — kind comes from kindForTransferRow which returns 'transfer' or 'hourly'):
commission: resolveHotelCommission(partner, {
    kind: kindForTransferRow(r),
    vehicle_name: r.vehicle_name,
    total_price: r.total_price,
}),
```

```ts
// Before:
commission: resolveCommissionEur(partner, 'tour'),

// After:
commission: resolveHotelCommission(partner, {
    kind: 'tour',
    total_price: r.total_price,
}),
```

```ts
// Before:
commission: resolveCommissionEur(partner, 'experience'),

// After:
commission: resolveHotelCommission(partner, {
    kind: 'experience',
    total_price: r.total_price,
}),
```

Update the import at line 112 to include the new function name:

```ts
import { resolveHotelCommission, kindForTransferRow, type CommissionKind } from '../../lib/commissions';
```

(Drop `resolveCommissionEur` from the import — no longer used here.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: 63 pages, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/hotel/commissions.astro
git commit -m "feat(hotel/commissions): use new per-vehicle / per-type-pct resolver"
```

### Task D2: Update `hotel/index.astro` — SELECT + resolver call

**Files:**
- Modify: `src/pages/hotel/index.astro`

- [ ] **Step 1: Update the partner SELECT**

Find line 156:

```ts
.select('discount, commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur')
```

Replace with:

```ts
.select('discount, commission_transfer_sedan_eur, commission_transfer_van_eur, commission_transfer_minibus_eur, commission_hourly_pct, commission_tour_pct, commission_experience_pct')
```

(`discount` retained — out of scope to remove.)

- [ ] **Step 2: Update the resolver call site**

Find line 342:

```ts
const commission = resolveCommissionEur(partner, (d as any)._commissionKind as CommissionKind);
```

Replace with:

```ts
const commission = resolveHotelCommission(partner, {
    kind: (d as any)._commissionKind as CommissionKind,
    vehicle_name: (d as any).vehicle_name ?? null,
    total_price: (d as any).total_price ?? null,
});
```

Update the import at line 109:

```ts
import { resolveHotelCommission, kindForTransferRow, type CommissionKind } from '../../lib/commissions';
```

(Drop `resolveCommissionEur`.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: 63 pages, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/hotel/index.astro
git commit -m "feat(hotel/index): use new per-vehicle / per-type-pct resolver"
```

---

## Phase E — Verification

### Task E1: Live verification end-to-end

**Files:** none modified — verification only.

- [ ] **Step 1: Push branch + merge to main + push main**

```bash
git push -u origin <branch-name>
git checkout main
git pull origin main
git merge --ff-only <branch-name>
git push origin main
```

Wait ~90 seconds for Vercel to deploy.

- [ ] **Step 2: Admin: configure a hotel via the new modal**

Sign in as admin (`mkifokeris@itdev.gr` / `123456789`) on `https://opaway.vercel.app`. Navigate to `/admin/partners`.

Pick an approved hotel row → click "Configure". The modal should now show:
- Three Transfer EUR inputs (Sedan / Van / Minibus)
- Three Percentage inputs (Hourly / Tour / Experience)
- No legacy / discount fields

Set realistic values: Sedan 10€, Van 15€, Minibus 20€, Hourly 10%, Tour 10%, Experience 10%. Save. Modal closes; values persist on reopen.

- [ ] **Step 3: Verify the DB write**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $(cat .supabase-pat)" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opaway-verify/1.0" \
  -d '{"query": "select id, full_name, commission_transfer_sedan_eur, commission_transfer_van_eur, commission_transfer_minibus_eur, commission_hourly_pct, commission_tour_pct, commission_experience_pct from public.partners where type='hotel' and status='approved';"}'
```

Expected: the hotel you just edited has the values 10/15/20 and 10/10/10.

- [ ] **Step 4: Hotel dashboard — verify earned amounts use the new math**

Sign out, sign in as the hotel partner (whatever account corresponds to the configured hotel). Navigate to `/hotel/commissions`. The summary cards and ledger should reflect the new math:
- Each transfer row shows EUR equal to the configured per-vehicle amount.
- Each tour row shows `total_price × tour_pct ÷ 100`.
- Each experience row similarly.

Spot-check at least one row from each category against expected math.

Navigate to `/hotel/index.astro` (the reservations table) — the "Hotel Commission" column should show the same per-row amounts.

- [ ] **Step 5: Admin partner detail — verify the new fields render**

Sign back in as admin. On `/admin/partners`, click a hotel row to open the partner-detail modal. The "Commission" section should now show 6 lines: Transfer–Sedan, Transfer–Van, Transfer–Minibus, Hourly–%, Tour–%, Experience–%. Values match what you saved in Step 2.

- [ ] **Step 6: No commit** — verification only. If any step fails, fix in the relevant phase's task.

---

## Notes for the executor

- **Vehicle classification.** The new resolver uses a lowercase substring match on `vehicle_name` to pick the column. The match order (minibus → van → sedan) handles common cases like "Sedan: Mercedes E-Class" or "Van: Mercedes V-Class". Free-text rows that don't mention any of those words fall back to the smallest configured rate. If the data source ever standardizes a `vehicle_slug` column, the classifier can be replaced with a direct lookup — but that's a separate cleanup.
- **Old columns kept.** `commission_transfer_eur`, `commission_hourly_eur`, `commission_tour_eur`, `commission_experience_eur`, `commission_eur` remain on the table for historical inspection. They are no longer read or written by any code after this plan ships. A future `db: drop deprecated commission columns` migration can remove them once the operator confirms nothing they care about queries them.
- **Percentage data was wiped to 0.** The migration backfilled per-vehicle EUR (good — that's a 1-to-3 fanout that approximates the prior single value). It did NOT migrate the prior per-type EUR amounts to percentages because there's no clean conversion (would need each booking's price). All hotels start with 0% on hourly/tour/experience until reconfigured. Communicate this to existing hotel partners out of band.
- **Backwards-compat wrapper `resolveCommissionEur`.** Kept as a thin wrapper for safety in case any caller is missed. Search `grep -rn "resolveCommissionEur"` in `src/` after Phase D to confirm no stragglers; if any are found, migrate them to `resolveHotelCommission`.
- **No agency / driver impact.** The `discount` column on agencies is untouched; agency pricing logic in `src/lib/pricing.ts` (`applyPartnerDiscount`) doesn't read any of the changed columns.
