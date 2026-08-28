# Coupon Edit Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin can edit an existing coupon — code, discount type and value, round-trip extra, validity period, services, customer groups and banner text — from an Edit button on each row, instead of deleting and recreating it.

**Architecture:** The create form's field-reading and validation logic moves into two shared helpers so the edit modal reuses them instead of duplicating ~15 lines of rules: a pure `validateCouponFields()` in `src/lib/coupons.ts` (unit-tested), and a `readCouponFields(prefix)` reader in the admin page that works against either the create form (`cp-*` ids) or the modal (`ed-*` ids). The modal is a full-width dialog mirroring the create form's controls, pre-filled from the row's already-loaded data, saving with a single `update()` on the coupon id.

**Tech Stack:** Astro 5 admin page (browser-side CRUD with the anon client under admin RLS), Supabase Postgres, Vitest.

## Decisions locked in

- **Everything on the coupon is editable except `active`.** The row's existing Close/Reopen button already owns the active flag; putting it in the modal too would give the same state two controls that can disagree. The modal never sends `active`.
- **The code is editable.** Bookings snapshot `coupon_code` at insert time, so renaming a coupon never rewrites history. A collision with another coupon surfaces the same friendly "already exists" message the create form shows (Postgres `23505` against the case-insensitive unique index).
- **Validation is shared, not copied.** The create handler currently inlines eight validation rules; the edit modal needs the identical set. They move to one exported pure function so the two paths cannot drift — and so the rules become unit-testable, which they are not today.
- **The modal is pre-filled from the already-fetched row** (`loadCoupons()` holds the full row objects), so opening the editor costs no extra request.
- **Saving refreshes the list** via the existing `loadCoupons()`, matching every other mutation on this page.
- **Escape and the Cancel button both close the modal** without saving; opening a different row's editor replaces the contents.

## Global Constraints

- Indentation: **tabs** in `.astro`; **2 spaces** in `src/lib/*.ts` and `tests/*.ts`.
- Admin pages are English-only — no `data-i18n-*` attributes.
- Brand blue `#0C6B95` (hover `#0a5c82`); the modal reuses the delete-modal's shell classes (`fixed inset-0 z-50 … bg-black/40`, inner `bg-white rounded-2xl shadow-xl`).
- Every user-entered value rendered into `innerHTML` goes through the page's existing `escapeHtml` helper; values placed into form fields are assigned via `.value`, never interpolated into markup.
- `src/lib` modules must stay importable without env vars (`src/lib/coupons.ts` lazy-loads supabase inside `validateCoupon` for exactly this reason — do not add a top-level supabase import).
- Gates: `npx astro check` — compare against the pre-existing baseline measured at the start of each task (currently **42 errors**), zero new; `npm test` — the full suite must stay green and grow by the new cases.
- Commit messages end with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BiS87umAz5GGz8pgEjFj98

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lib/coupons.ts` | `CouponFields` type + pure `validateCouponFields()` |
| Modify | `tests/coupons.test.ts` | Unit tests for the validator |
| Modify | `src/pages/admin/coupons.astro` | Shared field reader + scope wiring; Edit button, modal, save handler |
| Create | `qa/2026-08-29-coupon-edit-smoke-test.md` | Verification journal |

---

### Task 1: Shared validator in the lib (TDD) + create form switched onto it

**Files:**
- Modify: `src/lib/coupons.ts`
- Test: `tests/coupons.test.ts`
- Modify: `src/pages/admin/coupons.astro` (the create handler's validation block only)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 2): exported `interface CouponFields { code: string; discountType: 'percent' | 'fixed'; discountValue: number; returnExtra: number; validFrom: string; validUntil: string; appliesToAll: boolean; flows: string[]; appliesToAllGroups: boolean; groups: string[]; bannerText: string }` and `validateCouponFields(f: CouponFields): string | null` — returns the first violated rule's message, or `null` when the fields are valid.

- [ ] **Step 1: Write the failing tests**

Append to `tests/coupons.test.ts` (2-space indent). Extend the existing import from `../src/lib/coupons` to also bring in `validateCouponFields` and the `CouponFields` type, then add:

```ts
describe('validateCouponFields', () => {
  const valid: CouponFields = {
    code: 'SUMMER25',
    discountType: 'percent',
    discountValue: 10,
    returnExtra: 5,
    validFrom: '2026-09-01',
    validUntil: '2026-09-30',
    appliesToAll: true,
    flows: [],
    appliesToAllGroups: true,
    groups: [],
    bannerText: '',
  };

  it('accepts a well-formed coupon', () => {
    expect(validateCouponFields(valid)).toBeNull();
  });

  it('requires a code', () => {
    expect(validateCouponFields({ ...valid, code: '' })).toBe('Enter a coupon name/code.');
  });

  it('requires a positive discount value', () => {
    expect(validateCouponFields({ ...valid, discountValue: 0 })).toBe('Discount value must be greater than 0.');
    expect(validateCouponFields({ ...valid, discountValue: NaN })).toBe('Discount value must be greater than 0.');
  });

  it('caps a percent discount at 100', () => {
    expect(validateCouponFields({ ...valid, discountValue: 101, returnExtra: 0 })).toBe('Percent discount cannot exceed 100.');
  });

  it('rejects a negative round-trip extra', () => {
    expect(validateCouponFields({ ...valid, returnExtra: -1 })).toBe('Extra round-trip discount cannot be negative.');
  });

  it('caps percent discount plus extra at 100', () => {
    expect(validateCouponFields({ ...valid, discountValue: 98, returnExtra: 5 })).toBe('Discount plus round-trip extra cannot exceed 100%.');
  });

  it('allows a fixed discount above 100 with an extra', () => {
    expect(validateCouponFields({ ...valid, discountType: 'fixed', discountValue: 150, returnExtra: 20 })).toBeNull();
  });

  it('requires a period with the end on or after the start', () => {
    expect(validateCouponFields({ ...valid, validFrom: '', validUntil: '2026-09-30' })).toBe('Set a valid period (end date not before start date).');
    expect(validateCouponFields({ ...valid, validFrom: '2026-09-30', validUntil: '2026-09-01' })).toBe('Set a valid period (end date not before start date).');
    expect(validateCouponFields({ ...valid, validFrom: '2026-09-01', validUntil: '2026-09-01' })).toBeNull();
  });

  it('requires at least one service when the scope is selected', () => {
    expect(validateCouponFields({ ...valid, appliesToAll: false, flows: [] })).toBe('Pick at least one service, or choose "All services".');
    expect(validateCouponFields({ ...valid, appliesToAll: false, flows: ['transfer'] })).toBeNull();
  });

  it('requires at least one customer group when the scope is selected', () => {
    expect(validateCouponFields({ ...valid, appliesToAllGroups: false, groups: [] })).toBe('Pick at least one customer group, or choose "All customers".');
    expect(validateCouponFields({ ...valid, appliesToAllGroups: false, groups: ['hotel'] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/coupons.test.ts`
Expected: FAIL — `validateCouponFields` is not exported.

- [ ] **Step 3: Implement the validator**

Append to `src/lib/coupons.ts` (2-space indent):

```ts
// Admin coupon form fields, shared by the create form and the edit modal so the
// two cannot drift apart on validation rules.
export interface CouponFields {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  returnExtra: number;
  validFrom: string;
  validUntil: string;
  appliesToAll: boolean;
  flows: string[];
  appliesToAllGroups: boolean;
  groups: string[];
  bannerText: string;
}

// Returns the first violated rule's message, or null when the fields are valid.
export function validateCouponFields(f: CouponFields): string | null {
  if (!f.code) return 'Enter a coupon name/code.';
  if (!Number.isFinite(f.discountValue) || f.discountValue <= 0) return 'Discount value must be greater than 0.';
  if (f.discountType === 'percent' && f.discountValue > 100) return 'Percent discount cannot exceed 100.';
  if (f.returnExtra < 0) return 'Extra round-trip discount cannot be negative.';
  if (f.discountType === 'percent' && f.discountValue + f.returnExtra > 100) return 'Discount plus round-trip extra cannot exceed 100%.';
  if (!f.validFrom || !f.validUntil || f.validUntil < f.validFrom) return 'Set a valid period (end date not before start date).';
  if (!f.appliesToAll && !f.flows.length) return 'Pick at least one service, or choose "All services".';
  if (!f.appliesToAllGroups && !f.groups.length) return 'Pick at least one customer group, or choose "All customers".';
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all suites green, the coupons suite grown by 10 cases.

- [ ] **Step 5: Switch the create handler onto the shared validator**

In `src/pages/admin/coupons.astro`, extend the lib import at the top of the `<script>`:

```ts
	import { couponStatusOn, athensTodayISO, validateCouponFields, type CouponStatus, type CouponFields } from '../../lib/coupons';
```

In the create submit handler, replace the eight consecutive `if (…) { setStatus(…); return; }` validation lines with:

```ts
		const fields: CouponFields = {
			code, discountType, discountValue, returnExtra, validFrom, validUntil,
			appliesToAll, flows, appliesToAllGroups, groups, bannerText,
		};
		const problem = validateCouponFields(fields);
		if (problem) { setStatus(problem, 'text-red-500'); return; }
```

(The `const code = …` … `const bannerText = …` reads above stay as they are; only the validation block changes. The insert payload below stays as it is.)

- [ ] **Step 6: Gates**

Run: `npx astro check` — record the error count before your edits and after; zero new. Run: `npm test` — all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/coupons.ts tests/coupons.test.ts src/pages/admin/coupons.astro
git commit -m "refactor: shared coupon field validator, unit-tested"
```

---

### Task 2: Edit button, modal and save handler

**Files:**
- Modify: `src/pages/admin/coupons.astro`

**Interfaces:**
- Consumes: `validateCouponFields()` and `CouponFields` from `src/lib/coupons.ts` (Task 1); the page's existing `escapeHtml`, `setStatus`, `loadCoupons`, and the `CouponRow` type.
- Produces: nothing for later tasks.

Locate anchors by quoted code — line numbers drift.

- [ ] **Step 1: Add the edit modal markup**

Directly **after** the closing `</div>` of the delete-confirm modal (`id="delete-modal"`) and **before** `</AdminLayout>`, insert (tabs):

```html
	<!-- ── Edit coupon modal ── -->
	<div id="edit-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
			<div class="p-6">
				<h3 class="text-base font-bold text-neutral-900 mb-4">Edit coupon</h3>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
					<div>
						<label for="ed-code" class="block text-sm font-medium text-neutral-700 mb-1">Name / code</label>
						<input id="ed-code" type="text" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
						<p class="text-xs text-neutral-400 mt-1">Renaming does not affect bookings already made with the old code.</p>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="ed-type" class="block text-sm font-medium text-neutral-700 mb-1">Discount type</label>
							<select id="ed-type" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]">
								<option value="percent">Percent (%)</option>
								<option value="fixed">Fixed (&euro;)</option>
							</select>
						</div>
						<div>
							<label for="ed-value" class="block text-sm font-medium text-neutral-700 mb-1">Value</label>
							<input id="ed-value" type="number" min="0.01" step="0.01" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
						</div>
					</div>
				</div>

				<div class="mb-4">
					<label for="ed-return-extra" class="block text-sm font-medium text-neutral-700 mb-1">Extra round-trip discount — transfers only <span class="text-neutral-400">(optional)</span></label>
					<input id="ed-return-extra" type="number" min="0" step="0.01" class="w-full md:w-64 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
					<div>
						<label for="ed-from" class="block text-sm font-medium text-neutral-700 mb-1">Valid from</label>
						<input id="ed-from" type="date" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					</div>
					<div>
						<label for="ed-until" class="block text-sm font-medium text-neutral-700 mb-1">Valid until</label>
						<input id="ed-until" type="date" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]" />
					</div>
				</div>

				<div class="mb-5">
					<span class="block text-sm font-medium text-neutral-700 mb-2">Applies to</span>
					<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
						<label class="flex items-center gap-2 text-sm text-neutral-700">
							<input type="radio" name="ed-scope" value="all" class="w-4 h-4 text-[#0C6B95]" />
							All services
						</label>
						<label class="flex items-center gap-2 text-sm text-neutral-700">
							<input type="radio" name="ed-scope" value="selected" class="w-4 h-4 text-[#0C6B95]" />
							Selected services:
						</label>
						<div id="ed-flows" class="flex items-center gap-4">
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="transfer" class="ed-flow w-4 h-4 rounded text-[#0C6B95]" /> Transfers
							</label>
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="hourly" class="ed-flow w-4 h-4 rounded text-[#0C6B95]" /> Hourly
							</label>
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="tour" class="ed-flow w-4 h-4 rounded text-[#0C6B95]" /> Tours
							</label>
						</div>
					</div>
				</div>

				<div class="mb-5">
					<span class="block text-sm font-medium text-neutral-700 mb-2">Customers</span>
					<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
						<label class="flex items-center gap-2 text-sm text-neutral-700">
							<input type="radio" name="ed-group-scope" value="all" class="w-4 h-4 text-[#0C6B95]" />
							All customers
						</label>
						<label class="flex items-center gap-2 text-sm text-neutral-700">
							<input type="radio" name="ed-group-scope" value="selected" class="w-4 h-4 text-[#0C6B95]" />
							Selected groups:
						</label>
						<div id="ed-groups" class="flex flex-wrap items-center gap-4">
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="retail" class="ed-group w-4 h-4 rounded text-[#0C6B95]" /> Retail
							</label>
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="hotel" class="ed-group w-4 h-4 rounded text-[#0C6B95]" /> Hotels
							</label>
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="agency" class="ed-group w-4 h-4 rounded text-[#0C6B95]" /> Agencies
							</label>
							<label class="flex items-center gap-1.5 text-sm text-neutral-700">
								<input type="checkbox" value="driver" class="ed-group w-4 h-4 rounded text-[#0C6B95]" /> Drivers
							</label>
						</div>
					</div>
				</div>

				<div class="mb-5">
					<label for="ed-banner" class="block text-sm font-medium text-neutral-700 mb-1">Banner text <span class="text-neutral-400">(optional)</span></label>
					<textarea id="ed-banner" rows="2" maxlength="140" class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]"></textarea>
				</div>

				<p id="ed-status" class="text-sm mb-3"></p>

				<div class="flex justify-end gap-3">
					<button id="edit-cancel" type="button" class="px-4 py-2 text-sm font-semibold rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50">Cancel</button>
					<button id="edit-save" type="button" class="px-5 py-2 text-sm font-semibold rounded-xl bg-[#0C6B95] hover:bg-[#0a5c82] text-white disabled:opacity-50">Save changes</button>
				</div>
			</div>
		</div>
	</div>
```

- [ ] **Step 2: Add the Edit button to each row**

In the row template's actions cell, directly **before** the `data-toggle` button, insert:

```html
						<button data-edit="${c.id}" class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-neutral-200 text-neutral-700 hover:bg-sky-50">
							Edit
						</button>
```

and change the `data-toggle` button's opening tag to add a left margin so the three buttons stay spaced — replace `class="px-3 py-1.5 text-xs font-semibold rounded-lg border ${c.active ?` with `class="ml-2 px-3 py-1.5 text-xs font-semibold rounded-lg border ${c.active ?`.

- [ ] **Step 3: Add the shared field reader and scope wiring**

In the `<script>`, directly **after** the `discountLabel` function, add:

```ts
	// Reads the create form ('cp') or the edit modal ('ed') — one shape, two forms.
	function readCouponFields(p: 'cp' | 'ed'): CouponFields {
		const appliesToAll = (document.querySelector(`input[name="${p}-scope"]:checked`) as HTMLInputElement)?.value === 'all';
		const appliesToAllGroups = (document.querySelector(`input[name="${p}-group-scope"]:checked`) as HTMLInputElement)?.value === 'all';
		return {
			code: (document.getElementById(`${p}-code`) as HTMLInputElement).value.trim(),
			discountType: (document.getElementById(`${p}-type`) as HTMLSelectElement).value as 'percent' | 'fixed',
			discountValue: parseFloat((document.getElementById(`${p}-value`) as HTMLInputElement).value),
			returnExtra: parseFloat((document.getElementById(`${p}-return-extra`) as HTMLInputElement).value) || 0,
			validFrom: (document.getElementById(`${p}-from`) as HTMLInputElement).value,
			validUntil: (document.getElementById(`${p}-until`) as HTMLInputElement).value,
			appliesToAll,
			flows: appliesToAll ? [] : Array.from(document.querySelectorAll<HTMLInputElement>(`.${p}-flow:checked`)).map((c) => c.value),
			appliesToAllGroups,
			groups: appliesToAllGroups ? [] : Array.from(document.querySelectorAll<HTMLInputElement>(`.${p}-group:checked`)).map((c) => c.value),
			bannerText: (document.getElementById(`${p}-banner`) as HTMLTextAreaElement).value.trim(),
		};
	}

	// The scope radios grey out their checkbox group when "all" is selected.
	function wireScopeRadios(p: 'cp' | 'ed') {
		const pairs: Array<[string, string]> = [[`${p}-scope`, `${p}-flows`], [`${p}-group-scope`, `${p}-groups`]];
		for (const [radioName, boxId] of pairs) {
			const box = document.getElementById(boxId);
			const sync = () => {
				const selected = (document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement)?.value === 'selected';
				box?.classList.toggle('opacity-40', !selected);
				box?.classList.toggle('pointer-events-none', !selected);
			};
			document.querySelectorAll<HTMLInputElement>(`input[name="${radioName}"]`).forEach((radio) => {
				radio.addEventListener('change', sync);
			});
			sync();
		}
	}
```

Then replace BOTH existing scope-radio blocks (the `/* ── Scope radio enables/disables the flow checkboxes ── */` block and the `/* ── Group-scope radio enables/disables the group checkboxes ── */` block, including their `const flowsBox = …` / `const groupsBox = …` lines) with:

```ts
	/* ── Scope radios (create form + edit modal) ── */
	wireScopeRadios('cp');
	wireScopeRadios('ed');
```

Then, in the create submit handler, replace the block of `const code = …` through `const bannerText = …` reads AND the `const fields: CouponFields = { … }` line with a single:

```ts
		const fields = readCouponFields('cp');
```

and update the insert payload to read from `fields` (it currently reads the standalone consts):

```ts
		const { error } = await supabase.from('coupons').insert({
			code: fields.code,
			discount_type: fields.discountType,
			discount_value: fields.discountValue,
			return_extra_value: fields.returnExtra,
			valid_from: fields.validFrom,
			valid_until: fields.validUntil,
			applies_to_all: fields.appliesToAll,
			flows: fields.flows,
			applies_to_all_groups: fields.appliesToAllGroups,
			groups: fields.groups,
			banner_text: fields.bannerText,
			active: true,
		});
```

Also update the duplicate-code error message and the success message, which referenced the old `code` const, to use `fields.code`. After the form reset, the create form's checkbox groups must be re-greyed — replace the existing `flowsBox?.classList.add(…)` / `groupsBox?.classList.add(…)` reset lines with:

```ts
		wireScopeRadios('cp');
```

- [ ] **Step 4: Wire the Edit button, pre-fill and save**

Inside `loadCoupons()`, directly after the `[data-delete]` listener block, add:

```ts
		rowsEl.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
			btn.addEventListener('click', () => {
				const coupon = coupons.find((c) => c.id === btn.dataset.edit);
				if (coupon) openEditModal(coupon);
			});
		});
```

At the end of the `<script>` (after the delete-modal handlers), add:

```ts
	/* ── Edit modal ── */
	let editingId: string | null = null;
	const editStatusEl = document.getElementById('ed-status');

	function setEditStatus(msg: string, cls: string) {
		if (!editStatusEl) return;
		editStatusEl.textContent = msg;
		editStatusEl.className = `text-sm mb-3 ${cls}`;
	}

	function openEditModal(c: CouponRow) {
		editingId = c.id;
		setEditStatus('', '');
		(document.getElementById('ed-code') as HTMLInputElement).value = c.code;
		(document.getElementById('ed-type') as HTMLSelectElement).value = c.discount_type;
		(document.getElementById('ed-value') as HTMLInputElement).value = String(c.discount_value);
		(document.getElementById('ed-return-extra') as HTMLInputElement).value = String(c.return_extra_value ?? 0);
		(document.getElementById('ed-from') as HTMLInputElement).value = c.valid_from;
		(document.getElementById('ed-until') as HTMLInputElement).value = c.valid_until;
		(document.getElementById('ed-banner') as HTMLTextAreaElement).value = c.banner_text ?? '';

		const scopeValue = c.applies_to_all ? 'all' : 'selected';
		document.querySelectorAll<HTMLInputElement>('input[name="ed-scope"]').forEach((r) => { r.checked = r.value === scopeValue; });
		document.querySelectorAll<HTMLInputElement>('.ed-flow').forEach((cb) => { cb.checked = c.flows.includes(cb.value); });

		const groupScopeValue = c.applies_to_all_groups ? 'all' : 'selected';
		document.querySelectorAll<HTMLInputElement>('input[name="ed-group-scope"]').forEach((r) => { r.checked = r.value === groupScopeValue; });
		document.querySelectorAll<HTMLInputElement>('.ed-group').forEach((cb) => { cb.checked = c.groups.includes(cb.value); });

		wireScopeRadios('ed');
		document.getElementById('edit-modal')?.classList.remove('hidden');
	}

	function closeEditModal() {
		editingId = null;
		document.getElementById('edit-modal')?.classList.add('hidden');
	}

	document.getElementById('edit-cancel')?.addEventListener('click', closeEditModal);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !document.getElementById('edit-modal')?.classList.contains('hidden')) closeEditModal();
	});

	document.getElementById('edit-save')?.addEventListener('click', async () => {
		if (!editingId) return;
		const fields = readCouponFields('ed');
		const problem = validateCouponFields(fields);
		if (problem) { setEditStatus(problem, 'text-red-500'); return; }

		const saveBtn = document.getElementById('edit-save') as HTMLButtonElement;
		saveBtn.disabled = true;
		const { error } = await supabase.from('coupons').update({
			code: fields.code,
			discount_type: fields.discountType,
			discount_value: fields.discountValue,
			return_extra_value: fields.returnExtra,
			valid_from: fields.validFrom,
			valid_until: fields.validUntil,
			applies_to_all: fields.appliesToAll,
			flows: fields.flows,
			applies_to_all_groups: fields.appliesToAllGroups,
			groups: fields.groups,
			banner_text: fields.bannerText,
		}).eq('id', editingId);
		saveBtn.disabled = false;

		if (error) {
			setEditStatus(error.code === '23505'
				? `A coupon named "${fields.code}" already exists.`
				: `Error saving coupon: [${error.code}] ${error.message}`, 'text-red-500');
			return;
		}

		const savedCode = fields.code;
		closeEditModal();
		setStatus(`Coupon "${savedCode}" updated.`, 'text-green-600');
		await loadCoupons();
	});
```

- [ ] **Step 5: Gates**

Run: `npx astro check` — record the count before and after; zero new. Run: `npm test` — all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/coupons.astro
git commit -m "feat(admin): edit an existing coupon from the list"
```

---

### Task 3: Verification sweep + journal

**Files:**
- Create: `qa/2026-08-29-coupon-edit-smoke-test.md`

- [ ] **Step 1: Automated gates** — `npm test` (all green, including the 10 new validator cases) and `npx astro check` (record the count; zero new versus the baseline you measure first). Record both outputs.

- [ ] **Step 2: DB-level round-trip check** (Management API; single statements or `count(*)` wraps; prefix artifacts `QA_EDIT`):

1. Create a coupon to edit:
```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, applies_to_all, flows, applies_to_all_groups, groups, banner_text)
values ('QA_EDIT1', 'percent', 10, current_date, current_date + 10, true, '{}', true, '{}', '')
on conflict do nothing;
```
2. Apply exactly the update the modal issues, and confirm every field lands:
```sql
update public.coupons set
  code = 'QA_EDIT2', discount_type = 'fixed', discount_value = 12.5, return_extra_value = 3,
  valid_from = current_date + 1, valid_until = current_date + 20,
  applies_to_all = false, flows = array['tour'],
  applies_to_all_groups = false, groups = array['hotel'],
  banner_text = 'Edited banner copy'
where code = 'QA_EDIT1'
returning code, discount_type, discount_value, return_extra_value, valid_from, valid_until, applies_to_all, flows, applies_to_all_groups, groups, banner_text, active;
```
Expect one row with every value as set, and **`active` unchanged (`true`)** — the modal never sends it.
3. Confirm the case-insensitive unique index still guards renames: insert a second coupon `QA_EDIT3`, then `update public.coupons set code = 'qa_edit2' where code = 'QA_EDIT3';` → error `23505`.
4. Confirm the DB's own guard still holds for an out-of-range percent: `update public.coupons set discount_type = 'percent', discount_value = 98, return_extra_value = 5 where code = 'QA_EDIT2';` → error mentioning `coupons_percent_total_max`.

Cleanup: `delete from public.coupons where code like 'QA_EDIT%';` then `select count(*) from public.coupons where code like 'QA_EDIT%';` → `0`.

- [ ] **Step 3: Write the journal** `qa/2026-08-29-coupon-edit-smoke-test.md` in the established style (token-free SQL, observed output, PASS/FAIL per check; a FAIL stops the task — report BLOCKED with evidence instead of committing). List the browser-only checks as NOT RUN with concrete steps:
  1. `/admin/coupons` → click **Edit** on a coupon: the modal opens with every field pre-filled to match the row (code, type, value, extra, both dates, the correct services and customer radios/checkboxes, banner text).
  2. Change the discount value and the services scope to a single service, Save: the modal closes, the status line reads `Coupon "…" updated.`, and the row's Discount and Services cells reflect the change.
  3. Open Edit, set a percent discount of 98 with a 5 extra, Save: the modal stays open and shows "Discount plus round-trip extra cannot exceed 100%." — nothing is written.
  4. Rename a coupon to a code that already exists (different casing) and Save: the modal shows "A coupon named … already exists." and stays open.
  5. Open Edit, change fields, press **Escape** (and separately click **Cancel**): the modal closes and the row is unchanged after a reload.
  6. Editing does not disturb the Close/Reopen state: close a coupon, edit its banner text and save, and confirm it is still shown as `closed`.

- [ ] **Step 4: Commit**

```bash
git add qa/2026-08-29-coupon-edit-smoke-test.md
git commit -m "test: coupon edit smoke journal"
```

---

## Out of scope (deliberately)

- Editing the `active` flag from the modal — the row's Close/Reopen button owns it, and two controls for one field is how they drift.
- An edit path for affiliates/influencers — this request is about coupons; the affiliate page keeps its inline rate editor.
- Optimistic concurrency (detecting that another admin changed the coupon while the modal was open) — single-operator admin, last write wins, consistent with every other mutation on this page.
- Audit history of coupon changes — nothing in this admin records who changed what today.
