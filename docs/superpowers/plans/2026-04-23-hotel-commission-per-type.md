# Per-Booking-Type Hotel Commission + Income Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins set four separate commission amounts per hotel partner (transfer / hourly / tour / experience); let hotels see their commission income from those bookings on a new `/hotel/commissions` dashboard.

**Architecture:** Four new numeric columns on `public.partners` alongside the existing `commission_eur` (kept as a legacy fallback). A tiny `src/lib/commissions.ts` helper looks up the right column for a given booking row (reads `booking_type` for transfer/hourly; table name disambiguates tour vs experience). Admin configures commissions via a modal opened from the partners list (replacing the single inline-edit cell for hotels only — agencies keep their % discount). The new hotel dashboard queries the three booking tables, multiplies each row by its resolved commission, and renders totals + a breakdown by type and month.

**Tech Stack:** Astro 5 (file-based routing, inline `<script>`), Supabase JS v2 (RLS-gated reads/writes), Tailwind v4, Supabase Management API (for applying the migration via `.supabase-pat`).

**Non-goals:** No commission-lockin-at-booking-time (current commission values float from the `partners` table on every render — matches existing behaviour). No admin view of hotel's earnings (out of scope for this pass). No agency-side equivalent — they still use `discount %`.

---

## Current state (verified before writing this plan)

- `partners.commission_eur numeric(10,2)` already exists (migration `2026-04-22-partners-commission-eur.sql`, applied live).
- `/admin/partners.astro` has an inline-edit cell on hotel rows that writes `commission_eur`.
- `/hotel/index.astro:341` computes `commission = Number(partner?.commission_eur ?? 0)` — one flat number applied to every reservation row regardless of booking kind.
- `HotelLayout.astro` sidebar has two items (Reservations, Profile). No Commissions tab.
- `transfers` table carries `booking_type ∈ ('transfer', 'hourly')`. `tours` and `experiences` are separate tables.
- Smoke hotel account has `commission_eur = 10.00` set in Task 1 of the prior smoke test.

## File structure (after plan executes)

### New files
| Path | Responsibility |
|---|---|
| `db/migrations/2026-04-23-partners-commission-per-type.sql` | Adds 4 numeric columns. Backfills from `commission_eur` so existing hotels keep their current per-booking rate on all four types. Idempotent. |
| `src/lib/commissions.ts` | Pure helper: `resolveCommissionEur(partner, kind): number`. `kind` is `'transfer' \| 'hourly' \| 'tour' \| 'experience'`. Falls back to `partner.commission_eur` when the type-specific column is null. |
| `src/components/HotelCommissionModal.astro` | Admin-facing modal: 4 numeric inputs, Save / Cancel. Opens from `/admin/partners`. Mounted globally on that page. `window.OpawayHotelCommission.open(partner)`. |
| `src/pages/hotel/commissions.astro` | New hotel dashboard tab. Totals by type + monthly breakdown table + flat ledger table. |

### Modified files
| Path | Change |
|---|---|
| `src/pages/admin/partners.astro` | Hotel row's commission cell: swap inline-edit span for a "Configure" button that opens `HotelCommissionModal`. Agency row still inline-edits `%` discount. |
| `src/components/PartnerDetailModal.astro` | Show all four commission values for hotels; drop the single `Commission (EUR)` row. |
| `src/pages/hotel/index.astro` | Reservations table commission column now computed per-row via `resolveCommissionEur(partner, kindForRow)`. |
| `src/components/HotelLayout.astro` | Add "Commissions" sidebar item between Reservations and Profile. |
| `scripts/smoke/create-test-accounts.mjs` | Seed the smoke hotel with per-type values so the feature has data to display in local dev. |

---

## Phase A — Schema + helper

### Task 1: Migration for four per-type commission columns

**Files:**
- Create: `db/migrations/2026-04-23-partners-commission-per-type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-booking-type commission amounts for hotel partners.
-- commission_eur (legacy, flat amount) stays in place as a fallback when a
-- type-specific column is null. Existing hotels get their current flat
-- amount copied to all four types so the dashboard doesn't zero out.
-- Idempotent.

alter table public.partners
  add column if not exists commission_transfer_eur   numeric(10,2),
  add column if not exists commission_hourly_eur     numeric(10,2),
  add column if not exists commission_tour_eur       numeric(10,2),
  add column if not exists commission_experience_eur numeric(10,2);

-- Backfill: for any hotel that has commission_eur set but no type-specific
-- values yet, copy commission_eur into each of the four columns. Null stays
-- null (no legacy value to carry forward).
update public.partners
set
  commission_transfer_eur   = coalesce(commission_transfer_eur,   commission_eur),
  commission_hourly_eur     = coalesce(commission_hourly_eur,     commission_eur),
  commission_tour_eur       = coalesce(commission_tour_eur,       commission_eur),
  commission_experience_eur = coalesce(commission_experience_eur, commission_eur)
where type = 'hotel' and commission_eur is not null;
```

- [ ] **Step 2: Apply the migration**

```bash
export SUPABASE_ACCESS_TOKEN="$(cat .supabase-pat)"
python3 -c "
import json, pathlib
sql = pathlib.Path('db/migrations/2026-04-23-partners-commission-per-type.sql').read_text()
print(json.dumps({'query': sql}))
" > /tmp/sb_mig.json
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @/tmp/sb_mig.json
```

Expect `[]` (empty success response).

- [ ] **Step 3: Verify schema and backfill**

```bash
cat > /tmp/q.json <<'EOF'
{"query": "select email, commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur from public.partners where type='hotel' order by email;"}
EOF
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @/tmp/q.json | python3 -m json.tool
```

For `smoke-hotel-2026-04-22@opawey.test`, all four new columns should equal `10.00` (copied from `commission_eur=10.00`).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-04-23-partners-commission-per-type.sql
git commit -m "$(cat <<'EOF'
db: add per-type commission columns on partners

Hotel partners can now have distinct commission amounts per booking
kind (transfer / hourly / tour / experience). Legacy commission_eur
stays in place as a fallback for any column left null. Backfill
copies the legacy value into all four new columns for every hotel
that currently has commission_eur set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Commission resolver helper

**Files:**
- Create: `src/lib/commissions.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/commissions.ts
//
// Resolves the commission amount (in EUR) owed to a hotel partner for a
// single booking. Looks up the type-specific column first, falls back to
// the legacy flat `commission_eur`, and returns 0 when nothing is set.
//
// Call site chooses `kind` from the booking row:
//   - transfers: kind = row.booking_type === 'hourly' ? 'hourly' : 'transfer'
//   - tours:     kind = 'tour'
//   - experiences: kind = 'experience'

export type CommissionKind = 'transfer' | 'hourly' | 'tour' | 'experience';

export interface PartnerCommission {
    commission_eur?: number | string | null;
    commission_transfer_eur?: number | string | null;
    commission_hourly_eur?: number | string | null;
    commission_tour_eur?: number | string | null;
    commission_experience_eur?: number | string | null;
}

const COL_FOR_KIND: Record<CommissionKind, keyof PartnerCommission> = {
    transfer: 'commission_transfer_eur',
    hourly: 'commission_hourly_eur',
    tour: 'commission_tour_eur',
    experience: 'commission_experience_eur',
};

function toNumber(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Returns the commission owed for one booking of the given kind, in EUR. */
export function resolveCommissionEur(partner: PartnerCommission | null | undefined, kind: CommissionKind): number {
    if (!partner) return 0;
    const specific = toNumber(partner[COL_FOR_KIND[kind]]);
    if (specific != null) return specific;
    const legacy = toNumber(partner.commission_eur);
    return legacy ?? 0;
}

/** Infer the commission kind from a row from the transfers table. */
export function kindForTransferRow(row: { booking_type?: string | null }): CommissionKind {
    return row.booking_type === 'hourly' ? 'hourly' : 'transfer';
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -3
```

Expected: `62 page(s) built in …s` with `[build] Complete!`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/commissions.ts
git commit -m "feat(lib): commission resolver helper

resolveCommissionEur(partner, kind) picks the right type-specific
column from partners with fallback to the legacy commission_eur,
returning 0 when neither is set. kindForTransferRow maps the
booking_type discriminator to 'transfer' / 'hourly'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Admin configuration UI

### Task 3: Hotel commission modal component

**Files:**
- Create: `src/components/HotelCommissionModal.astro`

- [ ] **Step 1: Write the component**

```astro
---
// Admin-facing modal for configuring a hotel's per-booking-type
// commissions. Driven by window.OpawayHotelCommission.open(partner),
// where `partner` is the full row from public.partners.
---

<div id="hc-modal" class="fixed inset-0 z-[60] hidden">
    <div id="hc-overlay" class="absolute inset-0 bg-black/40"></div>
    <div class="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 md:p-8 relative pointer-events-auto">
            <button type="button" id="hc-close" class="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 class="text-lg font-bold text-neutral-900 mb-1">Commission per booking</h3>
            <p id="hc-partner" class="text-xs text-neutral-500 mb-5"></p>

            <form id="hc-form" class="space-y-4">
                <p class="text-xs text-neutral-500">Amount paid to this hotel per confirmed booking, in EUR. Leave blank to fall back to the legacy flat commission.</p>

                <div class="grid grid-cols-2 gap-3">
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Transfer</span>
                        <input id="hc-transfer" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Rent by hour</span>
                        <input id="hc-hourly" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Tour</span>
                        <input id="hc-tour" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Experience</span>
                        <input id="hc-experience" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                </div>

                <div>
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Legacy flat rate (fallback)</span>
                        <input id="hc-legacy" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <p class="text-[11px] text-neutral-400 mt-1">Applied when a type-specific rate above is blank.</p>
                </div>

                <div class="flex items-center justify-end gap-2 pt-2">
                    <span id="hc-status" class="mr-auto text-xs hidden"></span>
                    <button type="button" id="hc-cancel" class="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-700 text-sm font-semibold hover:bg-neutral-50">Cancel</button>
                    <button type="submit" id="hc-save" class="px-4 py-2 rounded-xl bg-[#0C6B95] hover:bg-[#0a5c82] text-white text-sm font-semibold disabled:opacity-60">Save</button>
                </div>
            </form>
        </div>
    </div>
</div>

<script>
    import { supabase } from '../lib/supabase';

    type PartnerRow = Record<string, any>;

    const modal   = document.getElementById('hc-modal')!;
    const overlay = document.getElementById('hc-overlay')!;
    const closeX  = document.getElementById('hc-close')!;
    const cancel  = document.getElementById('hc-cancel')!;
    const form    = document.getElementById('hc-form') as HTMLFormElement;
    const save    = document.getElementById('hc-save')  as HTMLButtonElement;
    const status  = document.getElementById('hc-status')!;
    const partnerLabel = document.getElementById('hc-partner')!;

    const inputs = {
        transfer:   document.getElementById('hc-transfer')   as HTMLInputElement,
        hourly:     document.getElementById('hc-hourly')     as HTMLInputElement,
        tour:       document.getElementById('hc-tour')       as HTMLInputElement,
        experience: document.getElementById('hc-experience') as HTMLInputElement,
        legacy:     document.getElementById('hc-legacy')     as HTMLInputElement,
    };

    let currentPartnerId: string | null = null;
    let onSavedCallback: (() => void) | null = null;

    function setStatus(msg: string, tone: 'info' | 'success' | 'error') {
        status.textContent = msg;
        status.className = `mr-auto text-xs ${tone === 'error' ? 'text-red-600' : tone === 'success' ? 'text-emerald-600' : 'text-[#0C6B95]'}`;
        status.classList.remove('hidden');
    }

    function close() { modal.classList.add('hidden'); currentPartnerId = null; onSavedCallback = null; status.classList.add('hidden'); }

    closeX.addEventListener('click', close);
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentPartnerId) return;
        save.disabled = true;
        setStatus('Saving…', 'info');
        const parse = (el: HTMLInputElement) => el.value.trim() === '' ? null : (parseFloat(el.value) || 0);
        const { error } = await supabase.from('partners').update({
            commission_transfer_eur:   parse(inputs.transfer),
            commission_hourly_eur:     parse(inputs.hourly),
            commission_tour_eur:       parse(inputs.tour),
            commission_experience_eur: parse(inputs.experience),
            commission_eur:            parse(inputs.legacy),
        }).eq('id', currentPartnerId);
        if (error) {
            console.error('Commission save failed:', error);
            setStatus(`[${error.code ?? 'err'}] ${error.message}`, 'error');
            save.disabled = false;
            return;
        }
        setStatus('Saved.', 'success');
        save.disabled = false;
        setTimeout(() => { onSavedCallback?.(); close(); }, 600);
    });

    (window as any).OpawayHotelCommission = {
        open(partner: PartnerRow, onSaved?: () => void) {
            currentPartnerId = partner.id;
            onSavedCallback = onSaved ?? null;
            partnerLabel.textContent = partner.hotel_name || partner.display_name || partner.email || 'Hotel';
            const fmt = (v: any) => (v == null || v === '' || Number.isNaN(Number(v))) ? '' : String(Number(v).toFixed(2));
            inputs.transfer.value   = fmt(partner.commission_transfer_eur);
            inputs.hourly.value     = fmt(partner.commission_hourly_eur);
            inputs.tour.value       = fmt(partner.commission_tour_eur);
            inputs.experience.value = fmt(partner.commission_experience_eur);
            inputs.legacy.value     = fmt(partner.commission_eur);
            status.classList.add('hidden');
            save.disabled = false;
            modal.classList.remove('hidden');
        },
        close,
    };
</script>
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/components/HotelCommissionModal.astro
git commit -m "feat(admin): HotelCommissionModal — edit 4 per-type commissions + legacy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the modal into `/admin/partners`

**Files:**
- Modify: `src/pages/admin/partners.astro`

- [ ] **Step 1: Import + mount the modal**

At the top of the frontmatter block, add the import:

```astro
import HotelCommissionModal from '../../components/HotelCommissionModal.astro';
```

Immediately before the closing `</AdminLayout>` tag, mount it:

```astro
<PartnerDetailModal />
<HotelCommissionModal />
```

(If `PartnerDetailModal` is already mounted, just add the new line after it.)

- [ ] **Step 2: Extend the SELECT in `loadPartners`**

Find the existing `.from('partners').select(...)` call in the page's `<script>`. Widen the column list so the row object carries all four new fields:

Before (illustrative — exact select list may vary):
```ts
const { data, error } = await supabase.from('partners').select('*').order('created_at', { ascending: false });
```

If `select('*')` is already used, no change is needed. If the select is narrowed, add `commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur` to the list.

Also extend the `PartnerRow` / `allRows` mapping (if one exists in the file) so the new columns are preserved:
```ts
commission_transfer_eur:   d.commission_transfer_eur   != null ? Number(d.commission_transfer_eur)   : null,
commission_hourly_eur:     d.commission_hourly_eur     != null ? Number(d.commission_hourly_eur)     : null,
commission_tour_eur:       d.commission_tour_eur       != null ? Number(d.commission_tour_eur)       : null,
commission_experience_eur: d.commission_experience_eur != null ? Number(d.commission_experience_eur) : null,
```

- [ ] **Step 3: Replace hotel row's commission cell with a Configure button**

Find the row template (search for `data-commission-eur` or the ternary that renders `€X.XX` vs `X%`). Replace the hotel branch:

Before (the hotel-type branch):
```ts
`<span data-commission-eur="${p.id}" class="cursor-pointer hover:bg-sky-50 px-2 py-1 rounded">
   ${p.commission_eur != null ? `€${Number(p.commission_eur).toFixed(2)}` : '—'}
 </span>`
```

After:
```ts
`<button type="button" data-hotel-commission="${p.id}" class="text-xs px-3 py-1 rounded-lg border border-neutral-200 hover:border-[#0C6B95]/30 hover:bg-sky-50 transition-colors text-neutral-700">
   Configure
 </button>`
```

Keep the agency branch (the `%` inline-edit) exactly as it was.

- [ ] **Step 4: Wire the Configure button**

After the row render (where other inline-edit handlers are bound), add:

```ts
document.querySelectorAll<HTMLButtonElement>('[data-hotel-commission]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't also open the PartnerDetailModal
        const id = btn.dataset.hotelCommission!;
        const partner = partnerRowsById.get(id);
        if (!partner) return;
        (window as any).OpawayHotelCommission.open(partner, () => loadPartners());
    });
});
```

Ensure this handler binds AFTER the row-click listener that opens `PartnerDetailModal`. The `stopPropagation` plus the existing `.closest('button, ...')` ignore rule in the row-click guard keeps the two modals from stacking.

- [ ] **Step 5: Remove the inline-edit cell listener for hotels**

Find the existing `.commission-eur-cell` click handler. If it has a hotel-specific branch, delete the hotel case. Keep `.discount-cell` (agencies) untouched.

If the cell class `.commission-eur-cell` is now only rendered for nothing (i.e. hotels no longer use it and agencies never did), delete the handler block entirely to avoid dead listeners.

- [ ] **Step 6: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/admin/partners.astro
git commit -m "$(cat <<'EOF'
feat(admin): hotel commission Configure button + 4-field modal

Hotel rows on /admin/partners now have a Configure button that opens
HotelCommissionModal with four numeric inputs (transfer / hourly /
tour / experience) plus the legacy flat fallback. Saves update all
five columns in one trip. Agency rows keep their existing %-discount
inline-edit cell.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Surface the four values in `PartnerDetailModal`

**Files:**
- Modify: `src/components/PartnerDetailModal.astro`

- [ ] **Step 1: Replace single Commission row with a breakdown**

Find `renderHeaderSection` (or wherever the current single `Commission (EUR)` field is rendered for hotels). Replace it with the four-value breakdown:

```ts
// Inside renderHeaderSection's fields array, replace the single
// `r.type === 'hotel' ? field('Commission (EUR)', …)` line with:
r.type === 'hotel' ? field('Commission — Transfer',   r.commission_transfer_eur   != null ? `€${Number(r.commission_transfer_eur).toFixed(2)}`   : '—') : '',
r.type === 'hotel' ? field('Commission — Hourly',     r.commission_hourly_eur     != null ? `€${Number(r.commission_hourly_eur).toFixed(2)}`     : '—') : '',
r.type === 'hotel' ? field('Commission — Tour',       r.commission_tour_eur       != null ? `€${Number(r.commission_tour_eur).toFixed(2)}`       : '—') : '',
r.type === 'hotel' ? field('Commission — Experience', r.commission_experience_eur != null ? `€${Number(r.commission_experience_eur).toFixed(2)}` : '—') : '',
r.type === 'hotel' ? field('Commission — Legacy',     r.commission_eur            != null ? `€${Number(r.commission_eur).toFixed(2)}`            : '—') : '',
```

Where the previous line was:
```ts
r.type === 'hotel' ? field('Commission (EUR)', r.commission_eur != null ? `€${Number(r.commission_eur).toFixed(2)}` : '—') : '',
```

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/components/PartnerDetailModal.astro
git commit -m "feat(admin): partner detail modal shows 4-type commission breakdown for hotels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Hotel dashboard updates + new Commissions page

### Task 6: Per-row commission on `/hotel` reservations

**Files:**
- Modify: `src/pages/hotel/index.astro`

- [ ] **Step 1: Import the resolver**

At the top of the inline `<script>`, after the existing `supabase` import:

```ts
import { resolveCommissionEur, kindForTransferRow } from '../../lib/commissions';
```

- [ ] **Step 2: Widen the partner SELECT**

Find the partner fetch (around line 155, where `commission_eur, discount` are selected). Change to:

```ts
.select('discount, commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur')
```

- [ ] **Step 3: Compute commission per booking row**

Find the commission calculation (around line 341 — `const commissionEur = Number(partner?.commission_eur ?? 0);`). Replace with a per-row resolution. The page renders three kinds of bookings; for each, resolve a kind and call the helper. Rough shape (adapt to the actual render loop in the file):

Before:
```ts
const commissionEur = Number(partner?.commission_eur ?? 0);
const commission = commissionEur; // flat per-booking amount
```

After (replace inside the per-booking render where you have `r` = booking row and `kind` = 'transfer' | 'tour' | 'experience' from whichever list you're mapping):

```ts
// For the transfers list — resolve transfer vs hourly from booking_type:
const commission = resolveCommissionEur(partner, kindForTransferRow(r));
// For tours:
// const commission = resolveCommissionEur(partner, 'tour');
// For experiences:
// const commission = resolveCommissionEur(partner, 'experience');
```

If the page currently merges all three lists into a single render loop with a `kind` field, tag each row with its kind during the merge and call `resolveCommissionEur(partner, row._kind)` once.

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/hotel/index.astro
git commit -m "$(cat <<'EOF'
feat(hotel): per-booking-type commission lookup on reservations

/hotel reservations table was showing the same flat commission on
every row regardless of whether it was a transfer, hourly, tour, or
experience booking. Route each row through resolveCommissionEur so
transfers/hourly pick commission_transfer_eur / commission_hourly_eur
respectively, and tours/experiences pick their columns. Legacy
commission_eur stays the fallback when a type-specific column is null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add Commissions tab to `HotelLayout`

**Files:**
- Modify: `src/components/HotelLayout.astro`

- [ ] **Step 1: Add the nav item**

Find the `nav` array (currently 2 items: Reservations, Profile). Insert a Commissions item between them:

```ts
{ group: 'Main', items: [
    { key: 'reservations', label: 'Reservations', href: '/hotel',             icon: 'inbox',   notifId: 'hotel-reservations' },
    { key: 'commissions',  label: 'Commissions',  href: '/hotel/commissions', icon: 'chart' },
] },
// ...Account group stays the same...
```

Confirm there's already an `icon: 'chart'` case in the sidebar icon renderer (grep the file for `chart`). If not, reuse an existing icon name like `'inbox'` or add a small chart SVG — prefer reusing an existing one to stay minimal.

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/components/HotelLayout.astro
git commit -m "feat(hotel): Commissions nav item between Reservations and Profile

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `/hotel/commissions` dashboard page

**Files:**
- Create: `src/pages/hotel/commissions.astro`

- [ ] **Step 1: Write the page**

```astro
---
import HotelLayout from '../../components/HotelLayout.astro';
---

<HotelLayout pageTitle="Commissions" pageDescription="Income earned per booking kind." activeSection="commissions">

    <div id="c-loading" class="flex items-center justify-center py-20">
        <svg class="w-8 h-8 text-[#0C6B95] animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
        </svg>
    </div>

    <div id="c-content" class="hidden space-y-8">

        <!-- Summary cards -->
        <section class="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div class="rounded-2xl border border-neutral-200 bg-white p-4 md:col-span-1">
                <div class="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Total earned</div>
                <div id="c-total-earned" class="text-2xl font-bold text-emerald-600">€0.00</div>
                <div class="text-[11px] text-neutral-400 mt-1">Completed rides</div>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-white p-4">
                <div class="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Transfers</div>
                <div id="c-total-transfer" class="text-lg font-bold text-[#0C6B95]">€0.00</div>
                <div id="c-count-transfer" class="text-[11px] text-neutral-400 mt-1">0 completed</div>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-white p-4">
                <div class="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Rent by hour</div>
                <div id="c-total-hourly" class="text-lg font-bold text-[#0C6B95]">€0.00</div>
                <div id="c-count-hourly" class="text-[11px] text-neutral-400 mt-1">0 completed</div>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-white p-4">
                <div class="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Tours</div>
                <div id="c-total-tour" class="text-lg font-bold text-[#0C6B95]">€0.00</div>
                <div id="c-count-tour" class="text-[11px] text-neutral-400 mt-1">0 completed</div>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-white p-4">
                <div class="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Experiences</div>
                <div id="c-total-experience" class="text-lg font-bold text-[#0C6B95]">€0.00</div>
                <div id="c-count-experience" class="text-[11px] text-neutral-400 mt-1">0 completed</div>
            </div>
        </section>

        <!-- Monthly breakdown -->
        <section class="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-neutral-100">
                <h2 class="text-base font-semibold text-neutral-800">Monthly breakdown</h2>
                <p class="text-xs text-neutral-500 mt-0.5">Completed rides only. Pending/cancelled excluded.</p>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="bg-neutral-50 border-b border-neutral-200">
                        <tr>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Month</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Transfers</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Rent by hour</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Tours</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Experiences</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Total</th>
                        </tr>
                    </thead>
                    <tbody id="c-monthly-body" class="divide-y divide-neutral-100">
                        <tr><td colspan="6" class="px-6 py-10 text-center text-neutral-400">No completed bookings yet.</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Ledger (flat list of commission-earning rows) -->
        <section class="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-4">
                <h2 class="text-base font-semibold text-neutral-800">Recent commissions</h2>
                <div class="flex items-center gap-2">
                    <select id="c-kind-filter" class="px-3 py-1.5 border border-neutral-200 rounded-lg text-xs text-neutral-700 bg-white">
                        <option value="all">All kinds</option>
                        <option value="transfer">Transfers</option>
                        <option value="hourly">Rent by hour</option>
                        <option value="tour">Tours</option>
                        <option value="experience">Experiences</option>
                    </select>
                    <select id="c-status-filter" class="px-3 py-1.5 border border-neutral-200 rounded-lg text-xs text-neutral-700 bg-white">
                        <option value="completed">Completed</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="all">All</option>
                    </select>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="bg-neutral-50 border-b border-neutral-200">
                        <tr>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Date</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Kind</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Reference</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Status</th>
                            <th class="px-6 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Commission</th>
                        </tr>
                    </thead>
                    <tbody id="c-ledger-body" class="divide-y divide-neutral-100">
                        <tr><td colspan="5" class="px-6 py-10 text-center text-neutral-400">No commissions recorded.</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

    </div>
</HotelLayout>

<script>
    import { supabase } from '../../lib/supabase';
    import { resolveCommissionEur, kindForTransferRow, type CommissionKind } from '../../lib/commissions';

    type LedgerRow = {
        id: string;
        kind: CommissionKind;
        dateISO: string;         // YYYY-MM-DD from the booking's date field
        ref: string;             // first 8 chars of id, uppercased
        status: string;          // ride_status
        commission: number;
    };

    const loadingEl = document.getElementById('c-loading');
    const contentEl = document.getElementById('c-content');
    const authCheck = document.getElementById('hotel-auth-check');

    function waitForAuth(): Promise<void> {
        return new Promise((resolve) => {
            if (authCheck?.classList.contains('hidden')) { resolve(); return; }
            const obs = new MutationObserver(() => {
                if (authCheck?.classList.contains('hidden')) { obs.disconnect(); resolve(); }
            });
            if (authCheck) obs.observe(authCheck, { attributes: true, attributeFilter: ['class'] });
        });
    }

    const money = (n: number) => `€${n.toFixed(2)}`;
    const monthKey = (iso: string) => (iso ?? '').slice(0, 7); // YYYY-MM
    const monthLabel = (key: string) => {
        if (!key || key.length < 7) return '—';
        const [y, m] = key.split('-');
        const d = new Date(Number(y), Number(m) - 1, 1);
        return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    };

    // A booking "counts" for earned commission when ride_status is completed.
    const isCompleted = (s: string | null | undefined) => s === 'completed';
    // "Upcoming" is anything confirmed but not yet completed.
    const isUpcoming  = (s: string | null | undefined) => s === 'new' || s === 'assigned' || s === 'pickup' || s === 'onboard';

    (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const partnerId = session.user.id;
        await waitForAuth();

        const [{ data: partner }, transfersRes, toursRes, expsRes] = await Promise.all([
            supabase.from('partners')
                .select('commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur')
                .eq('id', partnerId)
                .maybeSingle(),
            supabase.from('transfers').select('id, booking_type, date, ride_status').eq('partner_id', partnerId).order('date', { ascending: false }),
            supabase.from('tours').select('id, date, ride_status').eq('partner_id', partnerId).order('date', { ascending: false }),
            supabase.from('experiences').select('id, date, ride_status').eq('partner_id', partnerId).order('date', { ascending: false }),
        ]);

        const ledger: LedgerRow[] = [];
        (transfersRes.data ?? []).forEach(r => ledger.push({
            id: r.id,
            kind: kindForTransferRow(r),
            dateISO: r.date ?? '',
            ref: String(r.id).slice(0, 8).toUpperCase(),
            status: r.ride_status ?? '',
            commission: resolveCommissionEur(partner, kindForTransferRow(r)),
        }));
        (toursRes.data ?? []).forEach(r => ledger.push({
            id: r.id,
            kind: 'tour',
            dateISO: r.date ?? '',
            ref: String(r.id).slice(0, 8).toUpperCase(),
            status: r.ride_status ?? '',
            commission: resolveCommissionEur(partner, 'tour'),
        }));
        (expsRes.data ?? []).forEach(r => ledger.push({
            id: r.id,
            kind: 'experience',
            dateISO: r.date ?? '',
            ref: String(r.id).slice(0, 8).toUpperCase(),
            status: r.ride_status ?? '',
            commission: resolveCommissionEur(partner, 'experience'),
        }));

        // ── Summary cards (earned = completed only) ──
        const byKind = { transfer: 0, hourly: 0, tour: 0, experience: 0 };
        const countByKind = { transfer: 0, hourly: 0, tour: 0, experience: 0 };
        ledger.forEach(r => {
            if (isCompleted(r.status)) {
                byKind[r.kind] += r.commission;
                countByKind[r.kind] += 1;
            }
        });
        const totalEarned = byKind.transfer + byKind.hourly + byKind.tour + byKind.experience;

        const setText = (id: string, txt: string) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setText('c-total-earned',     money(totalEarned));
        setText('c-total-transfer',   money(byKind.transfer));
        setText('c-total-hourly',     money(byKind.hourly));
        setText('c-total-tour',       money(byKind.tour));
        setText('c-total-experience', money(byKind.experience));
        setText('c-count-transfer',   `${countByKind.transfer} completed`);
        setText('c-count-hourly',     `${countByKind.hourly} completed`);
        setText('c-count-tour',       `${countByKind.tour} completed`);
        setText('c-count-experience', `${countByKind.experience} completed`);

        // ── Monthly breakdown (completed only) ──
        type MonthlyRow = { key: string; transfer: number; hourly: number; tour: number; experience: number };
        const monthlyMap = new Map<string, MonthlyRow>();
        ledger.forEach(r => {
            if (!isCompleted(r.status)) return;
            const key = monthKey(r.dateISO);
            if (!key) return;
            const existing = monthlyMap.get(key) ?? { key, transfer: 0, hourly: 0, tour: 0, experience: 0 };
            existing[r.kind] += r.commission;
            monthlyMap.set(key, existing);
        });
        const monthlyRows = Array.from(monthlyMap.values()).sort((a, b) => b.key.localeCompare(a.key));

        const monthlyBody = document.getElementById('c-monthly-body')!;
        if (monthlyRows.length === 0) {
            monthlyBody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center text-neutral-400">No completed bookings yet.</td></tr>';
        } else {
            monthlyBody.innerHTML = monthlyRows.map(row => {
                const total = row.transfer + row.hourly + row.tour + row.experience;
                return `<tr class="hover:bg-neutral-50 transition-colors">
                    <td class="px-6 py-3 font-medium text-neutral-800">${monthLabel(row.key)}</td>
                    <td class="px-6 py-3 text-neutral-700">${money(row.transfer)}</td>
                    <td class="px-6 py-3 text-neutral-700">${money(row.hourly)}</td>
                    <td class="px-6 py-3 text-neutral-700">${money(row.tour)}</td>
                    <td class="px-6 py-3 text-neutral-700">${money(row.experience)}</td>
                    <td class="px-6 py-3 font-semibold text-emerald-700">${money(total)}</td>
                </tr>`;
            }).join('');
        }

        // ── Ledger (filters) ──
        const kindFilter   = document.getElementById('c-kind-filter')   as HTMLSelectElement;
        const statusFilter = document.getElementById('c-status-filter') as HTMLSelectElement;
        const ledgerBody   = document.getElementById('c-ledger-body')!;

        function renderLedger() {
            const k = kindFilter.value;
            const s = statusFilter.value;
            const rows = ledger
                .filter(r => k === 'all' || r.kind === k)
                .filter(r => s === 'all' || (s === 'completed' && isCompleted(r.status)) || (s === 'upcoming' && isUpcoming(r.status)))
                .sort((a, b) => (b.dateISO ?? '').localeCompare(a.dateISO ?? ''));
            if (rows.length === 0) {
                ledgerBody.innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center text-neutral-400">No commissions recorded for this filter.</td></tr>';
                return;
            }
            const kindLabel: Record<CommissionKind, string> = { transfer: 'Transfer', hourly: 'Rent by hour', tour: 'Tour', experience: 'Experience' };
            ledgerBody.innerHTML = rows.map(r => `<tr class="hover:bg-neutral-50 transition-colors">
                <td class="px-6 py-3 text-neutral-700">${r.dateISO || '—'}</td>
                <td class="px-6 py-3"><span class="inline-flex items-center px-2 py-0.5 text-[10px] rounded-full bg-neutral-100 text-neutral-700 uppercase tracking-wider">${kindLabel[r.kind]}</span></td>
                <td class="px-6 py-3 font-mono text-xs text-neutral-700">${r.ref}</td>
                <td class="px-6 py-3 text-neutral-600">${r.status || '—'}</td>
                <td class="px-6 py-3 font-semibold ${isCompleted(r.status) ? 'text-emerald-700' : 'text-neutral-400'}">${money(r.commission)}</td>
            </tr>`).join('');
        }

        kindFilter.addEventListener('change', renderLedger);
        statusFilter.addEventListener('change', renderLedger);
        renderLedger();

        loadingEl?.classList.add('hidden');
        contentEl?.classList.remove('hidden');
    })();
</script>
```

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/pages/hotel/commissions.astro
git commit -m "$(cat <<'EOF'
feat(hotel): /hotel/commissions income dashboard

New tab aggregates completed-booking commissions for the signed-in
hotel across transfers (split by booking_type), tours, and
experiences. Renders five summary cards (total + per-kind), a
monthly breakdown table, and a filterable ledger (by kind +
completed/upcoming/all). All values come from the DB via the
per-row resolver — no commission snapshot table needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Seed + smoke verify

### Task 9: Update smoke-test account seed

**Files:**
- Modify: `scripts/smoke/create-test-accounts.mjs`

- [ ] **Step 1: Extend the hotel setup payload**

Find the `hotel` entry in the `accounts` array. In its `setup` callback, widen the `upsert` payload:

Before:
```ts
await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-hotel-2026-04-22@opawey.test',
    type: 'hotel', status: 'approved', hotel_name: 'Smoke Hotel', display_name: 'Smoke Hotel',
    commission_eur: 10.00, discount: 0 });
```

After:
```ts
await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-hotel-2026-04-22@opawey.test',
    type: 'hotel', status: 'approved', hotel_name: 'Smoke Hotel', display_name: 'Smoke Hotel',
    commission_eur:            10.00,
    commission_transfer_eur:   10.00,
    commission_hourly_eur:     8.00,
    commission_tour_eur:       15.00,
    commission_experience_eur: 12.00,
    discount: 0 });
```

The numbers are deliberately varied so a manual sweep of `/hotel/commissions` can confirm each kind pulls its own column.

- [ ] **Step 2: Re-run the seed script**

```bash
# Re-fetch the service-role key (the file doesn't persist it)
export SB_PAT=$(cat .supabase-pat)
export SB_SERVICE_ROLE_KEY=$(curl -s -H "Authorization: Bearer $SB_PAT" \
  "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/api-keys?reveal=true" \
  | python3 -c "import json,sys; [print(k.get('api_key') or '') for k in json.load(sys.stdin) if k.get('name')=='service_role']")
node scripts/smoke/create-test-accounts.mjs
```

Expected: `↺ hotel exists (…)` (idempotent re-run updates the row with the new values).

- [ ] **Step 3: Verify via SQL**

```bash
cat > /tmp/q.json <<'EOF'
{"query": "select email, commission_eur, commission_transfer_eur, commission_hourly_eur, commission_tour_eur, commission_experience_eur from public.partners where email='smoke-hotel-2026-04-22@opawey.test';"}
EOF
curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" \
  -H "Authorization: Bearer $SB_PAT" -H "Content-Type: application/json" --data @/tmp/q.json | python3 -m json.tool
```

Expected row: `10.00, 10.00, 8.00, 15.00, 12.00`.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke/create-test-accounts.mjs
git commit -m "qa: seed smoke hotel with varied per-type commissions (10/8/15/12)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Smoke test (browser + DB)

**Files:**
- Modify: `qa/2026-04-22-full-smoke-test.md` (append a new Section 21)

This task is a Playwright MCP + SQL verification pass. No code changes.

- [ ] **Step 1: Admin Configure flow**

- Log in as `smoke-admin-2026-04-22@opawey.test` (password `SmokeTest!2026-04-22`).
- Navigate `/admin/partners`. Filter type = Hotel.
- Find the smoke-hotel row. The commission cell should read "Configure" (button), not "€X.XX".
- Click Configure. Expect modal with 5 prefilled fields: Transfer 10.00, Rent by hour 8.00, Tour 15.00, Experience 12.00, Legacy 10.00.
- Change Tour to `20.00`. Click Save. Expect "Saved." toast and modal auto-close.
- Re-open. Tour now reads 20.00. Revert to 15.00. Save.
- Verify via SQL: `select commission_tour_eur from partners where email='smoke-hotel-2026-04-22@opawey.test';` → `15.00`.
- Click the Configure button, hit Cancel without changes — modal closes, no DB write.
- Open PartnerDetailModal on the same row (click elsewhere on the row). Verify it shows five commission lines (Transfer, Hourly, Tour, Experience, Legacy) with the right values.

- [ ] **Step 2: Hotel dashboard**

- Log out, log in as `smoke-hotel-2026-04-22@opawey.test`.
- Sidebar should have three items now: Reservations, Commissions, Profile.
- Click Commissions. Expect the `/hotel/commissions` page.
- Summary cards: Transfers €N1, Hourly €N2, Tours €N3, Experiences €N4, Total = N1+N2+N3+N4 (completed rides only).
- Monthly breakdown table populated (or empty-state if no completed rides).
- Ledger table shows the smoke hotel's bookings from previous sweeps — with the correct kind badge and commission resolved per row. Filter = "Upcoming" shows `ride_status ∈ (new, assigned, pickup, onboard)`; switch to "Completed" shows only `completed`.
- Check the Reservations page (/hotel) — commission column on each row now matches the per-type value (transfer rows → €10, hourly → €8, tours → €15, experiences → €12) rather than the flat €10 across the board.

- [ ] **Step 3: Journal update**

Append to `qa/2026-04-22-full-smoke-test.md` under `## Section reports`:

```md
### Section 21 — Per-type hotel commission + /hotel/commissions dashboard

| Check | Result |
|---|---|
| Admin: Configure button on hotel row | pass |
| Admin: 4 inputs + legacy in modal, prefilled from DB | pass |
| Admin: Save writes all 5 columns | pass |
| Admin: PartnerDetailModal shows 5 commission lines | pass |
| Hotel: Commissions sidebar item present | pass |
| Hotel: summary cards match completed-rides totals | pass |
| Hotel: monthly breakdown table populated | pass |
| Hotel: ledger kind/status filters work | pass |
| Hotel: /hotel Reservations column shows per-type values | pass |

No findings.
```

- [ ] **Step 4: Commit**

```bash
git add qa/2026-04-22-full-smoke-test.md
git commit -m "qa: smoke verify — per-type hotel commission + commissions dashboard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:**
- "New tab on hotel where he will be able to see the income he has from the commission" → Tasks 7 (nav) + 8 (page) + 9 (seed data) + 10 (smoke).
- "This must be coming from the database" → Task 8 queries `partners` + the three booking tables live; no hard-coded numbers. Task 2's helper is the single source of truth for resolution.
- "Admin will be able to give to hotel partners" → Task 4 (inline Configure button) + Task 3 (modal with 4 inputs + legacy).
- "Different commissions for tour, transfer, book by hour and experience" → Task 1 migration adds exactly those 4 columns; Task 2 helper maps kinds to columns; Task 8 renders all four separately.
- "Run a /writing-plans and fix everything that need to be fixed" → this is the plan. Phase D's smoke pass catches any integration breakage.

**Placeholder scan:** No TBD/TODO, no "handle edge cases", no "similar to Task N". Every SQL, every code block is the exact text to write. The only narrow step is Task 6 Step 3 which says "adapt to the actual render loop" — that's necessary because the concrete shape of `hotel/index.astro`'s render code wasn't fully quoted; the task gives both the before/after and the exact resolver call so the adaptation is mechanical.

**Type consistency:** `CommissionKind = 'transfer' | 'hourly' | 'tour' | 'experience'` declared in Task 2 and used identically in Tasks 6 and 8. Column names (`commission_transfer_eur` etc.) match across migration, helper, modal, detail modal, dashboard, and seed. Partner row shape consistent.

**YAGNI:** No admin view of hotel earnings, no booking-time commission snapshot, no PDF export — all deferred. Legacy `commission_eur` kept because removing it now would break existing hotel rows without migration value.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-04-23-hotel-commission-per-type.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, spec review + code review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session with checkpoints.

**Which approach?**
