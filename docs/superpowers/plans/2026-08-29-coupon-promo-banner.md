# Coupon-Driven Promo Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin types a banner message when creating a coupon, and the site's sticky promo banner shows that message together with the coupon code — so the banner advertises whatever offer is currently running instead of fixed copy.

**Architecture:** A new `coupons.banner_text` column plus a public `get_promo_banner()` SECURITY DEFINER RPC that returns the code and banner text of the newest active, in-period coupon that has banner text and applies to the visitor's customer group. `PromoBanner.astro` keeps its current hard-coded copy as the default and swaps it for the coupon message on load when the RPC returns one; its dismissal key becomes per-coupon so a new offer re-appears for visitors who dismissed the previous one. The admin coupons page gains a banner textarea in the create form and an inline-editable banner cell in the list (banner copy gets tweaked far more often than a discount rate, so close-and-recreate is the wrong lifecycle for it).

**Tech Stack:** Supabase Postgres (idempotent migration, SECURITY DEFINER RPC), Astro 5 component with an inline `<script>`, Vitest.

## Decisions locked in

- **The coupons table stays unreadable to the public.** It has no public SELECT policy on purpose (code enumeration). The banner therefore reads through a dedicated RPC that returns exactly two fields — `code` and `banner_text` — for at most one coupon. Codes for coupons *without* banner text remain unguessable.
- **Which coupon wins:** the most recently created (`created_at desc`) coupon that is `active`, inside its validity window (Europe/Athens today), has non-empty `banner_text`, and matches the caller's customer group — the same `retail | hotel | agency | driver` resolution `validate_coupon` already uses. A hotel-only offer is not advertised to retail visitors. Flow targeting (transfer/hourly/tour) does **not** filter the banner: the banner links to `/book`, and the coupon's own flow rules still apply at checkout.
- **Fallback:** when the RPC returns nothing (no promoted coupon, offline, private mode, error), the banner shows its existing hard-coded "Book your transfer online" copy exactly as today. No regression, no flash of empty banner — the coupon text replaces the default only after a successful fetch.
- **The banner shows the code** in a pill next to the message, since a promo message without the code is useless.
- **Dismissal is per-offer:** the localStorage key becomes `promo:coupon:<code>` while a coupon banner is showing (the existing `promo:opawey-book-online` key still governs the default copy). A visitor who dismissed last month's offer sees the new one; dismissing the new one does not resurrect the old.
- **One banner text field, no per-language variants.** The admin writes one message; it renders identically in all three site languages. The i18n attributes on the default copy stay for the fallback case. (Adding EL/ES variants later is a column pair and a form row — deliberately out of scope now.)
- **Banner text is editable in place** on the coupons list (click-to-edit, same interaction as the affiliate commission cell), because promo wording changes without the discount changing.

## Global Constraints

- SQL migrations in `db/migrations/YYYY-MM-DD-slug.sql`, **idempotent** (`add column if not exists`, `create or replace function`, re-grants).
- Applied to the live Supabase project **opaway** (ref `wjqfcijisslzqxesbbox`) via Dashboard SQL Editor or Management API with env `SUPABASE_ACCESS_TOKEN` (custom `User-Agent` header required — Cloudflare 403s the default). **Never write the token into any repo file.** API quirk: multi-statement batches return the FIRST statement's result when the last yields zero rows — send single statements or wrap checks in `count(*)`.
- Indentation: **tabs** in `.astro`, **2 spaces** in `src/lib/*.ts` and `tests/*.ts`. Admin pages are English-only (no `data-i18n-*`); customer-facing markup keeps its `data-i18n-el` / `data-i18n-es` attributes.
- Brand blue `#0C6B95` (hover `#0a5c82`); the banner's own palette is `bg-[#000724]` on white text — do not restyle it.
- Gates: `npx astro check` — pre-existing baseline of **43 errors**, zero new; `npm test` — currently 71 tests green, plus the new ones.
- `src/lib` modules must be importable without env vars (no top-level supabase import — `src/lib/coupons.ts` lazy-loads it for exactly this reason; follow that pattern).
- The banner script binds on `astro:page-load` (view transitions swap `<body>` on every client-side navigation) — any new banner logic must run from that same hook.
- Commit messages end with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BiS87umAz5GGz8pgEjFj98

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-08-29-coupon-banner-text.sql` | `banner_text` column + `get_promo_banner()` RPC |
| Create | `src/lib/promo-banner.ts` | `fetchPromoBanner()` RPC wrapper + pure `promoStorageKey()` |
| Create | `tests/promo-banner.test.ts` | Unit tests for the pure helper |
| Modify | `src/components/PromoBanner.astro` | Render the coupon message + code; per-offer dismissal |
| Modify | `src/pages/admin/coupons.astro` | Banner textarea in the create form; inline-editable Banner column |
| Create | `qa/2026-08-29-coupon-promo-banner-smoke-test.md` | Verification journal |

---

### Task 1: Migration — banner_text column + get_promo_banner RPC

**Files:**
- Create: `db/migrations/2026-08-29-coupon-banner-text.sql`

**Interfaces:**
- Consumes: `public.coupons` (columns `code, active, valid_from, valid_until, applies_to_all_groups, groups, created_at`); `public.partners (id, type, status)` for group resolution — the same pattern as the live `validate_coupon` in `db/migrations/2026-08-28-coupon-return-extra.sql`.
- Produces: column `coupons.banner_text text not null default ''`; RPC `public.get_promo_banner()` returning `table (code text, banner_text text)` — zero or one row — granted to `anon, authenticated`. Task 2 calls it as `supabase.rpc('get_promo_banner')`.

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-08-29-coupon-banner-text.sql` with exactly this content:

```sql
-- Coupon-driven promo banner: banner_text turns a coupon into the site-wide
-- offer message. get_promo_banner() exposes ONLY the code + text of the single
-- coupon currently being advertised, so the coupons table stays unreadable to
-- the public (no code enumeration). Group targeting mirrors validate_coupon:
-- an approved partner sees their group's offers, everyone else sees retail.
-- Idempotent: safe to re-run.

alter table public.coupons add column if not exists banner_text text not null default '';

create or replace function public.get_promo_banner()
returns table (code text, banner_text text)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select coalesce(
      (select p.type
       from public.partners p
       where p.id = auth.uid() and p.status = 'approved'),
      'retail'
    ) as grp
  )
  select c.code, c.banner_text
  from public.coupons c, caller
  where c.active
    and length(btrim(c.banner_text)) > 0
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all_groups or caller.grp = any (c.groups))
  order by c.created_at desc
  limit 1;
$$;

grant execute on function public.get_promo_banner() to anon, authenticated;
```

- [ ] **Step 2: Apply to the live project**

Paste into the Supabase Dashboard SQL Editor for project `wjqfcijisslzqxesbbox` and run, or use the Management API with the file's content as `query`. Expected: empty result, no error. Apply a second time — still no error (idempotent).

- [ ] **Step 3: Verify with SQL** (single statements, or `count(*)`-wrapped per the API quirk)

1. Baseline — no coupon has banner text yet: `select count(*) from public.get_promo_banner();` → `0`.
2. Create a banner coupon:
```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, banner_text)
values ('QA_BAN10', 'percent', 10, current_date, current_date + 30, 'Save 10% on your airport transfer this week')
on conflict do nothing;
```
Then `select * from public.get_promo_banner();` → one row: `code = 'QA_BAN10'`, `banner_text = 'Save 10% on your airport transfer this week'`.
3. Newest wins: insert a second banner coupon `QA_BAN20` (percent 20, same window, banner text `'Twenty off everything'`), then `select code from public.get_promo_banner();` → `QA_BAN20`.
4. Inactive is not advertised: `update public.coupons set active = false where code = 'QA_BAN20';` then `select code from public.get_promo_banner();` → `QA_BAN10`.
5. Whitespace-only text does not count: `update public.coupons set banner_text = '   ' where code = 'QA_BAN10';` then `select count(*) from public.get_promo_banner();` → `0`.
6. Group targeting: `update public.coupons set banner_text = 'Hotel partners save 10%', active = true, applies_to_all_groups = false, groups = array['hotel'] where code = 'QA_BAN10';` then, with no JWT (caller = retail), `select count(*) from public.get_promo_banner();` → `0`. Then simulate an approved hotel partner in one batch and re-check:
```sql
select count(*) from (
  select set_config('request.jwt.claims',
    json_build_object('sub', (select p.id::text from public.partners p where p.type = 'hotel' and p.status = 'approved' limit 1), 'role', 'authenticated')::text,
    true)
) s, public.get_promo_banner() b;
```
→ `1`. (If the JWT simulation proves unreliable through the API, record it as deferred to the browser QA in Task 5 and move on — the same technique worked for `validate_coupon` in `qa/2026-08-26-coupons-smoke-test.md`.)

Cleanup: `delete from public.coupons where code like 'QA_BAN%';` then `select count(*) from public.coupons where code like 'QA_BAN%';` → `0`.

- [ ] **Step 4: Regression gate** — `npm test` → all green (71). No client code changed in this task.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-08-29-coupon-banner-text.sql
git commit -m "feat(db): coupon banner_text and public get_promo_banner RPC"
```

---

### Task 2: Promo-banner lib with tests

**Files:**
- Create: `src/lib/promo-banner.ts`
- Test: `tests/promo-banner.test.ts`

**Interfaces:**
- Consumes: RPC `get_promo_banner()` (Task 1); the anon client from `src/lib/supabase.ts`, imported lazily inside the async function so the module loads without env vars.
- Produces (used by Task 3): `interface PromoBanner { code: string; banner_text: string }`; `fetchPromoBanner(): Promise<PromoBanner | null>`; `promoStorageKey(code: string | null): string`; constant `DEFAULT_PROMO_KEY = 'promo:opawey-book-online'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/promo-banner.test.ts` (2-space indent):

```ts
import { describe, it, expect } from 'vitest';
import { promoStorageKey, DEFAULT_PROMO_KEY } from '../src/lib/promo-banner';

describe('promoStorageKey', () => {
  it('scopes the key to the coupon so a new offer re-appears', () => {
    expect(promoStorageKey('SUMMER25')).toBe('promo:coupon:SUMMER25');
  });

  it('lowercases the code so casing differences share one key', () => {
    expect(promoStorageKey('Summer25')).toBe('promo:coupon:summer25');
  });

  it('falls back to the default key when no coupon is showing', () => {
    expect(promoStorageKey(null)).toBe(DEFAULT_PROMO_KEY);
    expect(promoStorageKey('')).toBe(DEFAULT_PROMO_KEY);
    expect(promoStorageKey('   ')).toBe(DEFAULT_PROMO_KEY);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/promo-banner.test.ts`
Expected: FAIL — cannot resolve `../src/lib/promo-banner`.

- [ ] **Step 3: Implement the library**

Create `src/lib/promo-banner.ts` (2-space indent):

```ts
// Coupon-driven promo banner. The coupons table has no public read policy, so
// the banner asks get_promo_banner() for the one offer currently advertised —
// it returns only a code and a message, never the discount or the rest of the
// row. No top-level supabase import: this module must load without env vars.

export interface PromoBanner {
  code: string;
  banner_text: string;
}

export const DEFAULT_PROMO_KEY = 'promo:opawey-book-online';

// Dismissal is per-offer: a visitor who closed last month's banner still sees
// the new one, and closing the new one does not un-dismiss the old.
export function promoStorageKey(code: string | null): string {
  const trimmed = (code ?? '').trim();
  return trimmed ? `promo:coupon:${trimmed.toLowerCase()}` : DEFAULT_PROMO_KEY;
}

export async function fetchPromoBanner(): Promise<PromoBanner | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('get_promo_banner');
    if (error) {
      console.error('get_promo_banner failed:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const code = typeof row?.code === 'string' ? row.code.trim() : '';
    const text = typeof row?.banner_text === 'string' ? row.banner_text.trim() : '';
    if (!code || !text) return null;
    return { code, banner_text: text };
  } catch (err) {
    console.error('get_promo_banner request failed:', err);
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all suites green (71 pre-existing + 3 new = 74).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo-banner.ts tests/promo-banner.test.ts
git commit -m "feat: promo-banner fetch helper with per-offer dismissal key"
```

---

### Task 3: PromoBanner renders the coupon offer

**Files:**
- Modify: `src/components/PromoBanner.astro`

**Interfaces:**
- Consumes: `fetchPromoBanner`, `promoStorageKey`, `DEFAULT_PROMO_KEY` from `src/lib/promo-banner.ts` (Task 2).
- Produces: nothing for later tasks.

The component today reveals the banner immediately using the fixed `STORAGE_KEY`, then wires the close button. The change keeps that flow for the default copy and layers the coupon offer on top once the RPC answers.

- [ ] **Step 1: Add id hooks to the message markup**

In the `<aside>` body, the message paragraph currently reads:

```html
			<p class="text-base md:text-lg font-semibold leading-tight">
				<span data-i18n-el="Κλείστε online τη μεταφορά σας:" data-i18n-es="Reserva tu traslado online:">Book your transfer online:</span>
				<span
					class="font-normal text-white/90"
					data-i18n-el="ιδιωτικός οδηγός σε όλη την Ελλάδα, με σταθερή τιμή."
					data-i18n-es="chófer privado en toda Grecia, con precio fijo."
				>private chauffeur across Greece, at a fixed price.</span>
			</p>
```

Replace it with (tabs — the default copy is unchanged, it just gains a wrapper id, and a hidden slot for the coupon message is added):

```html
			<p id="promo-default-copy" class="text-base md:text-lg font-semibold leading-tight">
				<span data-i18n-el="Κλείστε online τη μεταφορά σας:" data-i18n-es="Reserva tu traslado online:">Book your transfer online:</span>
				<span
					class="font-normal text-white/90"
					data-i18n-el="ιδιωτικός οδηγός σε όλη την Ελλάδα, με σταθερή τιμή."
					data-i18n-es="chófer privado en toda Grecia, con precio fijo."
				>private chauffeur across Greece, at a fixed price.</span>
			</p>
			<p id="promo-coupon-copy" class="hidden text-base md:text-lg font-semibold leading-tight">
				<span id="promo-coupon-text"></span>
				<span class="ml-2 inline-flex items-center gap-1.5 align-middle">
					<span class="text-xs font-normal text-white/70" data-i18n-el="Κωδικός" data-i18n-es="Código">Code</span>
					<span id="promo-coupon-code" class="px-2 py-0.5 rounded bg-white/15 border border-white/30 font-mono text-sm tracking-wide"></span>
				</span>
			</p>
```

- [ ] **Step 2: Import the lib in the component script**

At the very top of the component's `<script>` block, before the `// Runs on every astro:page-load …` comment, add:

```ts
	import { fetchPromoBanner, promoStorageKey, DEFAULT_PROMO_KEY } from '../lib/promo-banner';
```

- [ ] **Step 3: Replace the script body**

Replace the whole `function initPromoBanner() { … }` body and the listener line with:

```ts
	// Runs on every astro:page-load — view transitions swap the <body>, so the
	// banner element is a new node after each client-side navigation.
	function isDismissed(key: string, ttlMs: number): boolean {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return false;
			const at = Number(raw);
			return Number.isFinite(at) && Date.now() - at < ttlMs;
		} catch {
			return false; // Safari private mode — treat as not dismissed.
		}
	}

	function initPromoBanner() {
		const banner = document.getElementById('promo-banner');
		if (!banner) return;
		const closeBtn = document.getElementById('promo-banner-close');
		const days = Number(banner.dataset.dismissDays ?? '30');
		const ttlMs = days * 24 * 60 * 60 * 1000;

		// The offer currently on screen: null until (and unless) the RPC answers.
		let activeCode: string | null = null;

		if (!isDismissed(DEFAULT_PROMO_KEY, ttlMs)) banner.classList.remove('hidden');

		closeBtn?.addEventListener('click', () => {
			try { localStorage.setItem(promoStorageKey(activeCode), String(Date.now())); } catch { /* ignore */ }
			banner.classList.add('hidden');
		});

		// Swap in the coupon offer once it arrives. A promoted coupon has its own
		// dismissal key, so it shows even to visitors who closed the default copy.
		fetchPromoBanner().then((promo) => {
			if (!promo) return;
			const textEl = document.getElementById('promo-coupon-text');
			const codeEl = document.getElementById('promo-coupon-code');
			if (!textEl || !codeEl) return;
			activeCode = promo.code;
			textEl.textContent = promo.banner_text;
			codeEl.textContent = promo.code;
			document.getElementById('promo-default-copy')?.classList.add('hidden');
			document.getElementById('promo-coupon-copy')?.classList.remove('hidden');
			banner.classList.toggle('hidden', isDismissed(promoStorageKey(promo.code), ttlMs));
		});
	}

	document.addEventListener('astro:page-load', initPromoBanner);
```

(The `data-storage-key` attribute on the `<aside>` is now unused — leave it in place; `DEFAULT_PROMO_KEY` in the lib carries the same value and removing the attribute is churn outside this task.)

- [ ] **Step 4: Gates**

Run: `npx astro check` → 43-error baseline, zero new. Run: `npm test` → 74/74.

- [ ] **Step 5: Commit**

```bash
git add src/components/PromoBanner.astro
git commit -m "feat: promo banner shows the running coupon offer and its code"
```

---

### Task 4: Admin — banner textarea and inline-editable Banner column

**Files:**
- Modify: `src/pages/admin/coupons.astro`

**Interfaces:**
- Consumes: column `banner_text` (Task 1); the page's existing `select('*')` already returns it.
- Produces: nothing for later tasks.

Locate anchors by quoted code (tabs; line numbers drift).

- [ ] **Step 1: Add the textarea to the create form**

Directly **after** the closing `</div>` of the "Customers" scope block (the `mb-5` div containing `id="cp-groups"`) and **before** the submit-button `<div class="flex items-center gap-4">`, insert:

```html
			<div class="mb-5">
				<label for="cp-banner" class="block text-sm font-medium text-neutral-700 mb-1">Banner text <span class="text-neutral-400">(optional)</span></label>
				<textarea id="cp-banner" rows="2" placeholder="e.g. Save 10% on your airport transfer this week"
					class="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/30 focus:border-[#0C6B95]"></textarea>
				<p class="text-xs text-neutral-400 mt-1">Shown in the site-wide promo bar together with this coupon's code. Leave empty for no banner. If several coupons have banner text, the newest one is shown.</p>
			</div>
```

- [ ] **Step 2: Add the Banner column to the table head**

In the `<thead>` row, after `<th class="px-5 py-3 font-medium">Customers</th>` insert:

```html
							<th class="px-5 py-3 font-medium">Banner</th>
```

Change every `colspan="7"` in this file to `colspan="8"` — there are three (the Loading row, the error row inside `loadCoupons()`, and the "No coupons yet." row).

- [ ] **Step 3: Extend the row type and render the cell**

In the `CouponRow` type, after `groups: string[];` add:

```ts
		banner_text: string;
```

In the row template inside `loadCoupons()`, directly after the Customers cell (`<td class="px-5 py-3">${escapeHtml(groupsLabel(c))}</td>`) insert:

```html
					<td class="px-5 py-3 max-w-xs">
						<span class="banner-cell block cursor-pointer hover:bg-sky-50 px-2 py-1 rounded-lg truncate ${c.banner_text ? 'text-neutral-700' : 'text-neutral-300'}" data-banner="${c.id}" title="Click to edit banner text">${c.banner_text ? escapeHtml(c.banner_text) : '—'}</span>
					</td>
```

- [ ] **Step 4: Wire the inline editor**

Inside `loadCoupons()`, directly after the existing `rowsEl.querySelectorAll<HTMLButtonElement>('[data-delete]')…` block, add:

```ts
		rowsEl.querySelectorAll<HTMLSpanElement>('.banner-cell').forEach((cell) => {
			cell.addEventListener('click', () => {
				const coupon = coupons.find((c) => c.id === cell.dataset.banner);
				if (!coupon) return;
				const id = coupon.id;
				cell.outerHTML = `
					<span class="flex items-start gap-1">
						<textarea id="banner-input-${id}" rows="2" class="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs">${escapeHtml(coupon.banner_text ?? '')}</textarea>
						<button id="banner-save-${id}" class="px-2 py-1 bg-[#0C6B95] text-white text-xs rounded-lg hover:bg-[#0a5c82]">Save</button>
					</span>`;
				document.getElementById(`banner-save-${id}`)?.addEventListener('click', async () => {
					const value = (document.getElementById(`banner-input-${id}`) as HTMLTextAreaElement).value.trim();
					const { error } = await supabase.from('coupons').update({ banner_text: value }).eq('id', id);
					if (error) { setStatus(`Error updating banner: [${error.code}] ${error.message}`, 'text-red-500'); return; }
					setStatus(value ? 'Banner text updated.' : 'Banner text cleared.', 'text-green-600');
					await loadCoupons();
				});
			});
		});
```

The handler reads `coupons`, which is the existing local `const coupons = (data ?? []) as CouponRow[];` declared earlier in `loadCoupons()` (currently line 227). The listeners are registered inside the same function, so that local is in scope — no new state variable is needed.

- [ ] **Step 5: Send the field on create**

In the create handler, directly after the `const groups = …` declaration add:

```ts
		const bannerText = (document.getElementById('cp-banner') as HTMLTextAreaElement).value.trim();
```

In the `supabase.from('coupons').insert({…})` object, after `groups,` add:

```ts
			banner_text: bannerText,
```

- [ ] **Step 6: Gates**

Run: `npx astro check` → 43-error baseline, zero new. Run: `npm test` → 74/74.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/coupons.astro
git commit -m "feat(admin): banner text on coupons, editable in place"
```

---

### Task 5: Verification sweep + journal

**Files:**
- Create: `qa/2026-08-29-coupon-promo-banner-smoke-test.md`

- [ ] **Step 1: Automated gates** — `npm test` (74/74) and `npx astro check` (43 baseline, zero new). Record both outputs.

- [ ] **Step 2: DB-level checks** (Management API; single statements or `count(*)` wraps; prefix artifacts `QA_BAN`):

1. `get_promo_banner()` returns 0 rows when no active coupon has banner text.
2. A coupon with banner text is returned with exactly its `code` and `banner_text`, and no other column.
3. Newest-wins: with two banner coupons, the later `created_at` is returned.
4. Deactivating the newest falls back to the older one.
5. Whitespace-only `banner_text` is not advertised.
6. Group targeting: a `groups = array['hotel']` banner coupon returns 0 rows for a no-JWT (retail) caller.
7. Confirm the RPC leaks nothing else: `select * from public.get_promo_banner();` shows two columns only.

Clean up all `QA_BAN%` coupons and prove it with a `count(*)` select. Then create the demo banner coupon and LEAVE it in place for manual QA: code `BANNER10`, percent 10, valid today→+30, all services/groups, `banner_text = 'Book online and save 10% on your transfer'`, **active** (the earlier demo coupons were deliberately deactivated; this one exists so the banner can be seen — note in the journal that the user should deactivate it when finished).

- [ ] **Step 3: Write the journal** `qa/2026-08-29-coupon-promo-banner-smoke-test.md` in the established style (token-free SQL, observed output, PASS/FAIL per check; a FAIL stops the task — report BLOCKED with evidence instead of committing). List the browser-only checks as NOT RUN with concrete steps:
  1. With `BANNER10` active, load any page: the sticky bar shows "Book online and save 10% on your transfer" with a `BANNER10` code pill, and the default "Book your transfer online" copy is gone.
  2. Dismiss the banner, reload: it stays hidden. Then change the coupon's banner text via the admin inline editor to a different message and reload: the banner is still hidden (same code = same key) — dismissing is per coupon, not per wording.
  3. Deactivate `BANNER10`: the banner falls back to the default hard-coded copy on the next load.
  4. Admin `/admin/coupons`: create a coupon with banner text; the Banner column shows it truncated; click the cell, edit, Save, and the list refreshes with the new text; clearing it shows `—`.
  5. Language switch to Greek/Spanish with a coupon banner showing: the message stays in the admin's wording (documented behaviour), while the "Code" label and the Book-now button translate.

- [ ] **Step 4: Commit**

```bash
git add qa/2026-08-29-coupon-promo-banner-smoke-test.md
git commit -m "test: coupon promo banner smoke journal"
```

---

## Out of scope (deliberately)

- Per-language banner text (EL/ES variants) — one message for all languages; adding variants later is a column pair plus two form rows.
- Choosing *which* coupon is promoted from the admin UI (a "promote this one" toggle) — newest-with-text wins, which the form's helper text states.
- Scheduling banner windows separately from the coupon's validity period — the coupon's own dates govern.
- Styling or repositioning the banner, and the per-page `promo={false}` opt-out — both stay exactly as the existing component defines them.
- Click-through tracking on the banner or auto-applying the advertised code at checkout — the visitor types the code, which the existing coupon flow already handles.
