# Hotel Commission Modal — Discount Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discount (%) field to the existing admin `HotelCommissionModal` that writes to `partners.discount`, surfacing the already-wired partner self-booking discount to the admin UI for hotel partners.

**Architecture:** Single-file UI change. The `partners.discount` column already exists and is already applied at booking time via `detectPartnerDiscount()` in the results pages. The commission resolver (`src/lib/commissions.ts::resolveCommissionEur`) reads only commission columns and never touches `discount`, so independence of discount and commission is guaranteed at the code level — no math changes required.

**Tech Stack:** Astro 5 component with inline `<script>`, Supabase JS v2, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-24-hotel-discount-field-design.md`

**Smoke account:** `smoke-hotel-2026-04-22@opawey.test` (password `SmokeTest!2026-04-22`, id `b1262d59-e410-4666-b010-ea378a3c6229`) — mint via `scripts/smoke/create-test-accounts.mjs` if the row was purged.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/HotelCommissionModal.astro` | Modify | Admin commission-per-type modal. Gets one new input + label + helper text + wiring for load/save. |
| `qa/2026-04-22-full-smoke-test.md` | Append | Journal Section 23 with pass/fail table for the new field. |

No other files change. No migration. No new files.

---

## Task 1: Branch setup

**Files:** none (git operations only).

- [ ] **Step 1: Checkout main and pull latest**

```bash
cd /Users/marios/Desktop/Cursor/opaway
git checkout main
git pull --ff-only origin main
```

Expected: "Already up to date." or a clean fast-forward.

- [ ] **Step 2: Create and switch to feature branch**

```bash
git checkout -b feat/hotel-discount-field
```

Expected: "Switched to a new branch 'feat/hotel-discount-field'".

- [ ] **Step 3: Verify clean working tree**

```bash
git status
```

Expected: `On branch feat/hotel-discount-field`, `nothing to commit, working tree clean` (ignore untracked `.claude/settings.local.json` noise).

---

## Task 2: Add Discount (%) field to HotelCommissionModal

**Files:**
- Modify: `src/components/HotelCommissionModal.astro` (lines 42-50 for template insertion, lines 76-82 for `inputs` object, lines 100-112 for save payload, lines 125-137 for open populator).

The modal currently has a 2-column grid for Transfer/Hourly/Tour/Experience commissions (lines 20-41) and a single-column Legacy flat rate block (lines 43-50). We insert the new Discount section directly below the Legacy block, before the action buttons (line 52).

- [ ] **Step 1: Insert the Discount template block**

Open `src/components/HotelCommissionModal.astro`. Find the Legacy flat rate block (currently lines 43-50):

```astro
                <div>
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Legacy flat rate (fallback)</span>
                        <input id="hc-legacy" type="number" step="0.01" min="0" placeholder="0.00"
                            class="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <p class="text-[11px] text-neutral-400 mt-1">Applied when a type-specific rate above is blank.</p>
                </div>
```

Immediately after the closing `</div>` of that block (currently line 50, before the action-buttons row at line 52), insert this new block:

```astro
                <div class="pt-4 border-t border-neutral-200">
                    <label class="block">
                        <span class="block text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wider">Discount (%)</span>
                        <input id="hc-discount" type="number" step="0.01" min="0" max="100" placeholder="0"
                            class="w-full px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95] outline-none" />
                    </label>
                    <p class="text-[11px] text-neutral-400 mt-1">Applied when the hotel books on Opawey. Does not reduce the commissions above.</p>
                </div>
```

Preserve tab indentation (the repo uses tabs, not spaces).

- [ ] **Step 2: Add the new input to the `inputs` object**

Find the `inputs` object in the inline `<script>` block (currently lines 76-82):

```ts
    const inputs = {
        transfer:   document.getElementById('hc-transfer')   as HTMLInputElement,
        hourly:     document.getElementById('hc-hourly')     as HTMLInputElement,
        tour:       document.getElementById('hc-tour')       as HTMLInputElement,
        experience: document.getElementById('hc-experience') as HTMLInputElement,
        legacy:     document.getElementById('hc-legacy')     as HTMLInputElement,
    };
```

Add one line before the closing brace so it becomes:

```ts
    const inputs = {
        transfer:   document.getElementById('hc-transfer')   as HTMLInputElement,
        hourly:     document.getElementById('hc-hourly')     as HTMLInputElement,
        tour:       document.getElementById('hc-tour')       as HTMLInputElement,
        experience: document.getElementById('hc-experience') as HTMLInputElement,
        legacy:     document.getElementById('hc-legacy')     as HTMLInputElement,
        discount:   document.getElementById('hc-discount')   as HTMLInputElement,
    };
```

- [ ] **Step 3: Add `discount` to the save payload**

Find the `form.addEventListener('submit', ...)` block — the `supabase.from('partners').update({...})` call is currently at lines 106-112:

```ts
        const { error } = await supabase.from('partners').update({
            commission_transfer_eur:   parse(inputs.transfer),
            commission_hourly_eur:     parse(inputs.hourly),
            commission_tour_eur:       parse(inputs.tour),
            commission_experience_eur: parse(inputs.experience),
            commission_eur:            parse(inputs.legacy),
        }).eq('id', currentPartnerId);
```

Add `discount: parse(inputs.discount),` as the last field, so it becomes:

```ts
        const { error } = await supabase.from('partners').update({
            commission_transfer_eur:   parse(inputs.transfer),
            commission_hourly_eur:     parse(inputs.hourly),
            commission_tour_eur:       parse(inputs.tour),
            commission_experience_eur: parse(inputs.experience),
            commission_eur:            parse(inputs.legacy),
            discount:                  parse(inputs.discount),
        }).eq('id', currentPartnerId);
```

- [ ] **Step 4: Populate the input on modal open**

Find the `OpawayHotelCommission.open(...)` function — the populator block is currently lines 130-134:

```ts
            inputs.transfer.value   = fmt(partner.commission_transfer_eur);
            inputs.hourly.value     = fmt(partner.commission_hourly_eur);
            inputs.tour.value       = fmt(partner.commission_tour_eur);
            inputs.experience.value = fmt(partner.commission_experience_eur);
            inputs.legacy.value     = fmt(partner.commission_eur);
```

Add one line at the end:

```ts
            inputs.transfer.value   = fmt(partner.commission_transfer_eur);
            inputs.hourly.value     = fmt(partner.commission_hourly_eur);
            inputs.tour.value       = fmt(partner.commission_tour_eur);
            inputs.experience.value = fmt(partner.commission_experience_eur);
            inputs.legacy.value     = fmt(partner.commission_eur);
            inputs.discount.value   = fmt(partner.discount);
```

- [ ] **Step 5: Build to verify no type errors**

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run build 2>&1 | tail -5
```

Expected: `[build] 63 page(s) built in <Ns>` with no TypeScript or Astro errors. If errors appear, fix them before committing.

- [ ] **Step 6: Commit**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add src/components/HotelCommissionModal.astro && git commit -m "$(cat <<'EOF'
feat(admin): add discount field to hotel commission modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a new commit on `feat/hotel-discount-field` changing one file.

---

## Task 3: Playwright smoke + journal + push + fast-forward merge

**Files:**
- Modify: `qa/2026-04-22-full-smoke-test.md` (append Section 23).

No code changes. Drive the app through real user paths via Playwright MCP, update the journal, then push + FF merge.

- [ ] **Step 1: Start dev server**

```bash
cd /Users/marios/Desktop/Cursor/opaway && npm run dev
```

Run in background. Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/` returns `200`. Expected: `4321` listening, build clean.

- [ ] **Step 2: Admin — open modal on smoke hotel, save discount=10**

Navigate to `http://localhost:4321/login`, log in as `smoke-admin-2026-04-22@opawey.test` / `SmokeTest!2026-04-22`. Navigate `/admin/partners`. Find the row for `smoke-hotel-2026-04-22@opawey.test` (id `b1262d59-e410-4666-b010-ea378a3c6229`) and click its Configure/Commission action to open `HotelCommissionModal`.

Verify: The new `Discount (%)` input is visible beneath Legacy flat rate, separated by a top border, with helper text "Applied when the hotel books on Opawey. Does not reduce the commissions above."

Enter `10` into the discount input. Click Save. Wait for the "Saved." status. Modal closes.

Expected: no console errors.

- [ ] **Step 3: SQL verify discount saved**

```bash
PAT=$(cat .supabase-pat); curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d '{"query":"select id, discount, commission_transfer_eur from public.partners where id = '"'"'b1262d59-e410-4666-b010-ea378a3c6229'"'"';"}'
```

Expected: `[{"id":"b1262d59-...","discount":"10","commission_transfer_eur":"10.00"}]` — discount is now `10` and the existing commission is unchanged.

- [ ] **Step 4: Hotel self-booking — verify discount banner + pricing**

Log out. Log in as `smoke-hotel-2026-04-22@opawey.test` / `SmokeTest!2026-04-22`. Navigate `/book/transfer`. Fill step 1 (Athens → Piraeus, any future date e.g. `2026-05-30` at `14:00`, 2 passengers). Click See prices.

Verify on `/book/transfer/results`: a green banner reading "Partner discount: 10% applied" is visible. Vehicle cards show a strikethrough original price and a reduced total. Pick Sedan, click Continue. On `/book/transfer/passenger`, fill the Phone field with `6931234567`, click Continue. On `/book/transfer/payment`, pick Cash on-site, click Complete Booking. Note the 8-char reference shown on the success panel.

- [ ] **Step 5: SQL verify booking row honors discount (price) but not commission (flat)**

```bash
REF=<8char-from-step-4-lowercased>; PAT=$(cat .supabase-pat); curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d "{\"query\":\"select id, total_price, base_price, booking_type, partner_id from public.transfers where id::text like '${REF}%' limit 1;\"}"
```

Expected: `total_price` equals `base_price * 0.90` (within a cent) — the 10% discount was applied to the customer-facing price. `partner_id` matches the hotel id. Commission paid is resolved downstream via `resolveCommissionEur` reading `partner.commission_transfer_eur` (flat `10.00`) — unaffected by the discount column.

- [ ] **Step 6: Clear discount flow**

Log out. Log in as the smoke admin. Re-open the hotel's commission modal. Verify the Discount input loads with value `10.00`. Clear it (empty string). Click Save.

SQL verify:

```bash
PAT=$(cat .supabase-pat); curl -s -X POST "https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query" -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d '{"query":"select id, discount from public.partners where id = '"'"'b1262d59-e410-4666-b010-ea378a3c6229'"'"';"}'
```

Expected: `discount` is `null`.

- [ ] **Step 7: Confirm banner gone on next booking**

Log out. Log in as the hotel. Navigate `/book/transfer`. Fill step 1 with different dates (`2026-05-31`, `15:00`). Click See prices.

Expected: no "Partner discount" banner on `/book/transfer/results`. Vehicle cards show plain totals with no strikethrough. Do not complete this booking — just verify the banner is absent.

- [ ] **Step 8: Append Section 23 to journal**

Open `qa/2026-04-22-full-smoke-test.md`. Find the last existing section (Section 22 from the luggage work). Append after it:

```md

---

### Section 23 — Hotel discount field in commission modal

Branch: `feat/hotel-discount-field` (tip SHA to be filled in after Step 10)
Date: 2026-04-24
Spec: `docs/superpowers/specs/2026-04-24-hotel-discount-field-design.md`

End-to-end test booking: transfer ref `<8-char ref from Step 4>`, Athens → Piraeus, Sedan, cash on-site, partner_id = `b1262d59-e410-4666-b010-ea378a3c6229`.

| Check | Result |
|---|---|
| Discount input renders below Legacy flat rate with top-border separator | pass |
| Helper text reads "Applied when the hotel books on Opawey. Does not reduce the commissions above." | pass |
| Save persists `partners.discount = 10` (SQL-verified) | pass |
| Commission columns unchanged after discount save | pass |
| Hotel self-booking on `/book/transfer/results` shows "Partner discount: 10% applied" banner | pass |
| Booked `transfers.total_price = base_price * 0.90` (SQL-verified) | pass |
| Commission resolver (`resolveCommissionEur`) returns flat `commission_transfer_eur` unaffected by discount | pass |
| Clearing discount input saves `null` | pass |
| Next booking shows no discount banner after clear | pass |
| Build (`npm run build`) — 63 pages, 0 errors, 0 warnings | pass |

No findings. Feature ready to merge.
```

Replace `<8-char ref from Step 4>` with the actual ref captured in Step 4.

- [ ] **Step 9: Commit journal**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git add qa/2026-04-22-full-smoke-test.md && git commit -m "$(cat <<'EOF'
qa: smoke verify — hotel discount field in commission modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Push + fast-forward merge to main**

```bash
cd /Users/marios/Desktop/Cursor/opaway && git push -u origin feat/hotel-discount-field
git checkout main
git pull --ff-only origin main
git merge --ff-only feat/hotel-discount-field
git push origin main
git checkout feat/hotel-discount-field
```

Expected: branch pushed, main fast-forwards cleanly (2 new commits: Task 2 feat + Task 3 journal), push succeeds. No merge conflicts possible because the only files touched are new or append-only.

After the FF, go back to `qa/2026-04-22-full-smoke-test.md` and replace the "tip SHA to be filled in after Step 10" placeholder in Section 23 with the actual SHA from `git rev-parse --short feat/hotel-discount-field`, then amend the journal commit — OR, simpler, skip the SHA reference in the journal (it's discoverable via `git log --grep="hotel discount field"`).

- [ ] **Step 11: Stop dev server**

```bash
kill $(lsof -tiTCP:4321 -sTCP:LISTEN 2>/dev/null) 2>/dev/null
```

Expected: port 4321 freed.

---

## Self-review

**1. Spec coverage.**

- Spec "Architecture" → Task 2 (no schema, no math change, single file touched). ✓
- Spec "UI" — label "Discount (%)", input attributes (`step`, `min="0"`, `max="100"`, `placeholder="0"`), top-border separator, helper text — Task 2 Step 1 has the exact markup. ✓
- Spec "Data flow" open populator — Task 2 Step 4. ✓
- Spec "Data flow" save payload — Task 2 Step 3. ✓
- Spec "Testing" three checks: save flow (Task 3 Steps 2-3), self-booking application (Task 3 Steps 4-5), clear flow (Task 3 Steps 6-7). All three present. ✓
- Spec "Out of scope" — no tasks touch agency/driver, no tasks touch the commission resolver or results-page pricing logic. ✓

No spec gaps.

**2. Placeholder scan.**

One deliberate placeholder in Task 3 Step 5 / Step 8: `<8-char ref>` is a runtime value captured in Step 4 — that is a runtime substitution, not a plan placeholder. Similarly `<tip SHA>` in journal Section 23 is filled in after Step 10. Both are explicit with substitution instructions. Every step has concrete code, paths, and commands. No TBDs, no "add appropriate validation" handwaves, no "similar to Task N" cross-references.

**3. Type consistency.**

- Column names: `discount` (partners table) and `partner.discount` (read) — consistent across Task 2 Step 3 (save), Task 2 Step 4 (load), Task 3 Step 3 / Step 6 (SQL verify).
- Input id: `hc-discount` — consistent across Task 2 Step 1 (HTML), Step 2 (inputs object), Step 3 (save), Step 4 (load).
- Helper text: "Applied when the hotel books on Opawey. Does not reduce the commissions above." — identical in spec, Task 2 Step 1, Task 3 Step 2, Task 3 Step 8.
- Branch name `feat/hotel-discount-field` — consistent across Tasks 1, 3.

No inconsistencies.
