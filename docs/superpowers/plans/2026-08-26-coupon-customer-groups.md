# Coupon Customer-Group Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing discount-coupon system so the admin chooses whether each coupon applies to all customers or only to selected customer groups — Retail (λιανική), Hotels, Agencies, Drivers.

**Architecture:** Two new columns on `public.coupons` (`applies_to_all_groups boolean`, `groups text[]`) mirroring the existing flow-targeting pair, and a re-created `validate_coupon()` RPC that resolves the caller's group server-side from `auth.uid()` (guest or plain user → `retail`; approved partner → its `partners.type`). Because both the payment pages and the booking-insert RPCs already funnel every check through `validate_coupon()`, the group restriction is enforced everywhere with **zero changes to the payment pages, the booking RPCs, or the checkout endpoint** — the only UI change is the admin form/list.

**Tech Stack:** Supabase Postgres (idempotent SQL migration, SECURITY DEFINER RPC), Astro 5 admin page (browser-side CRUD), Vitest (existing suite must stay green — no new client logic is added).

## How groups are resolved (locked-in design)

- `public.partners.id` equals the auth user id (see `src/lib/resolve-partner-id.ts` — it queries `partners.id = user.id`), and `partners.type` is one of `'hotel' | 'agency' | 'driver'` with `status = 'approved'` gating.
- Caller group = `partners.type` when an approved partner row exists for `auth.uid()`, else `'retail'`. Guests (no JWT → `auth.uid()` is NULL) and signed-in non-partner users are `retail`.
- `auth.uid()` reads the request JWT inside RPCs, including when `validate_coupon()` is called from within the SECURITY DEFINER booking RPCs, and including server-side calls through `supabaseForUser(accessToken)` in the checkout endpoint. Guest checkouts run as `anon` → NULL → `retail`.
- Group storage values (exact strings): `'retail' | 'hotel' | 'agency' | 'driver'`.
- Backward compatibility: existing coupons get `applies_to_all_groups = true` by default — behavior unchanged (the live `TEST10` demo coupon keeps working for everyone).
- A wrong-group coupon fails exactly like any invalid coupon today: 0 rows from `validate_coupon` → red "Invalid or expired coupon code." in the UI, `COUPON_INVALID` at insert time. No new error message is needed.

## Global Constraints

- SQL migrations live in `db/migrations/YYYY-MM-DD-slug.sql` and must be **idempotent** (`add column if not exists`, `create or replace function`).
- Migrations are applied to the live Supabase project **opaway** (ref `wjqfcijisslzqxesbbox`) via the Supabase Dashboard SQL Editor or the Management API using env var `SUPABASE_ACCESS_TOKEN` (the API needs a custom `User-Agent` header or Cloudflare returns 403). **Never write that token into any file in this repo.**
- Indentation: **tabs** in `.astro` files; admin pages are English-only (no `data-i18n-*`).
- Brand blue `#0C6B95` (hover `#0a5c82`).
- Type gate: `npx astro check` — the repo has a pre-existing baseline of **43 errors**; only the delta matters and it must be zero. Test gate: `npm test` — 41/41 must stay green.
- **Do NOT touch** the payment pages, `src/lib/coupons.ts`, the booking RPCs' bodies, or `src/pages/api/stripe/create-checkout-session.ts` — group enforcement is entirely inside `validate_coupon()`.
- Commit messages end with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BiS87umAz5GGz8pgEjFj98

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-08-26-coupon-customer-groups.sql` | New columns + group-aware `validate_coupon()` |
| Modify | `src/pages/admin/coupons.astro` | "Customers" scope UI in the form, "Customers" column in the list, insert/validation |
| Modify | `qa/2026-08-26-coupons-smoke-test.md` | Append group-targeting verification section |

---

### Task 1: Migration — group columns + group-aware validate_coupon

**Files:**
- Create: `db/migrations/2026-08-26-coupon-customer-groups.sql`

**Interfaces:**
- Consumes: existing `public.coupons` table and `public.validate_coupon(p_code text, p_flow text)` (created by `db/migrations/2026-08-26-coupons.sql`); `public.partners (id uuid, type text, status text)`.
- Produces: columns `coupons.applies_to_all_groups boolean not null default true` and `coupons.groups text[] not null default '{}'`; `validate_coupon` with the **same signature and return shape** as before (`returns table (id uuid, code text, discount_type text, discount_value numeric)`, granted to `anon, authenticated`) but additionally filtering by the caller's group. Task 2 inserts/reads the two new columns.

- [ ] **Step 1: Write the migration file**

Create `db/migrations/2026-08-26-coupon-customer-groups.sql` with exactly this content:

```sql
-- Coupon customer-group targeting: a coupon applies to all customers or to
-- selected groups ('retail' | 'hotel' | 'agency' | 'driver'). The caller's
-- group is resolved server-side inside validate_coupon() from auth.uid():
-- an approved partners row yields its type; everyone else (guests included)
-- is 'retail'. Booking RPCs and payment pages need no changes — they all
-- validate through this function.
-- Idempotent: safe to re-run.

alter table public.coupons add column if not exists applies_to_all_groups boolean not null default true;
alter table public.coupons add column if not exists groups text[] not null default '{}';

do $$ begin
  alter table public.coupons
    add constraint coupons_groups_known check (groups <@ array['retail','hotel','agency','driver']);
exception
  when duplicate_object then null;
end $$;

create or replace function public.validate_coupon(p_code text, p_flow text)
returns table (id uuid, code text, discount_type text, discount_value numeric)
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
  select c.id, c.code, c.discount_type, c.discount_value
  from public.coupons c, caller
  where lower(c.code) = lower(trim(p_code))
    and c.active
    and (now() at time zone 'Europe/Athens')::date between c.valid_from and c.valid_until
    and (c.applies_to_all or p_flow = any (c.flows))
    and (c.applies_to_all_groups or caller.grp = any (c.groups));
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;
```

- [ ] **Step 2: Apply to the live project**

Paste into the Supabase Dashboard SQL Editor for project `wjqfcijisslzqxesbbox` and run, or use the Management API pattern (token from env, never committed):

```bash
python3 - <<'EOF'
import json, os, urllib.request
sql = open('db/migrations/2026-08-26-coupon-customer-groups.sql').read()
req = urllib.request.Request(
  'https://api.supabase.com/v1/projects/wjqfcijisslzqxesbbox/database/query',
  data=json.dumps({'query': sql}).encode(),
  headers={'Authorization': f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
           'Content-Type': 'application/json', 'User-Agent': 'migration'},
  method='POST')
print(urllib.request.urlopen(req).read().decode()[:500])
EOF
```

Expected: empty result (`[]`-like), no error object. Re-run once more to confirm idempotency (no error).

- [ ] **Step 3: Verify with SQL — retail caller and simulated partner caller**

The SQL editor / Management API runs with no JWT, so `auth.uid()` is NULL → the caller is `retail`. A partner caller is simulated by setting the `request.jwt.claims` GUC (which `auth.uid()` reads) inside the same transaction. Run this as ONE query:

```sql
-- setup: one hotel-only coupon, one retail-only coupon
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, applies_to_all, flows, applies_to_all_groups, groups)
values
  ('GRPTEST_HOTEL', 'percent', 15, current_date, current_date + 30, true, '{}', false, array['hotel']),
  ('GRPTEST_RETAIL', 'percent', 5, current_date, current_date + 30, true, '{}', false, array['retail'])
on conflict do nothing;

-- 1) no JWT → retail: hotel-only rejected, retail-only accepted
select 'retail sees hotel coupon' as label, count(*) as rows from public.validate_coupon('GRPTEST_HOTEL', 'transfer')
union all
select 'retail sees retail coupon', count(*) from public.validate_coupon('GRPTEST_RETAIL', 'transfer')
union all
-- 2) simulate an approved hotel partner (pick a real one) and re-check
select 'hotel sees hotel coupon', (
  select count(*) from (
    select set_config('request.jwt.claims',
      json_build_object('sub', (select p.id::text from public.partners p where p.type = 'hotel' and p.status = 'approved' limit 1), 'role', 'authenticated')::text,
      true)
  ) s, public.validate_coupon('GRPTEST_HOTEL', 'transfer') v
)
union all
select 'existing all-groups coupon unaffected (retail)', count(*) from public.validate_coupon('TEST10', 'transfer');
```

Expected rows: `retail sees hotel coupon = 0`, `retail sees retail coupon = 1`, `hotel sees hotel coupon = 1`, `existing all-groups coupon unaffected (retail) = 1`.

Note on row 3: `set_config(..., true)` is transaction-local and the whole batch runs in one transaction; the CROSS JOIN forces `set_config` to evaluate before `validate_coupon`. If this ordering proves flaky in the API (returns 0), run row 3 alone as `select set_config(...); select * from public.validate_coupon('GRPTEST_HOTEL','transfer');` in a single batch and read the second result — if it still cannot be made to work through the API, record it as "verified via UI in Task 3" and do not fight it further.

Then clean up:

```sql
delete from public.coupons where code in ('GRPTEST_HOTEL', 'GRPTEST_RETAIL');
```

- [ ] **Step 4: Confirm the client suite still passes** (no client code changed, this is a regression gate)

Run: `npm test`
Expected: 41/41.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-08-26-coupon-customer-groups.sql
git commit -m "feat(db): coupon customer-group targeting in validate_coupon"
```

---

### Task 2: Admin UI — customer-group scope in form and list

**Files:**
- Modify: `src/pages/admin/coupons.astro` (markup ~lines 48-71 area and table ~lines 86-101; script: type ~121-132, labels ~157-165, loadCoupons render ~174-202, scope wiring ~226-234, create handler ~236-278)

**Interfaces:**
- Consumes: columns `applies_to_all_groups` + `groups` from Task 1 (selected via the existing `select('*')`).
- Produces: nothing new for other tasks.

Line numbers refer to the file BEFORE edits — locate each anchor by its quoted code.

- [ ] **Step 1: Add the "Customers" scope block to the form**

Directly **after** the closing `</div>` of the services scope block (the `mb-5` div that contains `id="cp-flows"`, ends at line 71) and **before** the submit-button `<div class="flex items-center gap-4">`, insert (tabs):

```html
			<div class="mb-5">
				<span class="block text-sm font-medium text-neutral-700 mb-2">Customers</span>
				<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
					<label class="flex items-center gap-2 text-sm text-neutral-700">
						<input type="radio" name="cp-group-scope" value="all" checked class="w-4 h-4 text-[#0C6B95]" />
						All customers
					</label>
					<label class="flex items-center gap-2 text-sm text-neutral-700">
						<input type="radio" name="cp-group-scope" value="selected" class="w-4 h-4 text-[#0C6B95]" />
						Selected groups:
					</label>
					<div id="cp-groups" class="flex flex-wrap items-center gap-4 opacity-40 pointer-events-none">
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="retail" class="cp-group w-4 h-4 rounded text-[#0C6B95]" /> Retail
						</label>
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="hotel" class="cp-group w-4 h-4 rounded text-[#0C6B95]" /> Hotels
						</label>
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="agency" class="cp-group w-4 h-4 rounded text-[#0C6B95]" /> Agencies
						</label>
						<label class="flex items-center gap-1.5 text-sm text-neutral-700">
							<input type="checkbox" value="driver" class="cp-group w-4 h-4 rounded text-[#0C6B95]" /> Drivers
						</label>
					</div>
				</div>
				<p class="text-xs text-neutral-400 mt-1">Retail = customers without a partner account (including guests). Partners are matched by their approved account type.</p>
			</div>
```

- [ ] **Step 2: Add the "Customers" column to the table**

In the `<thead>` row, after `<th class="px-5 py-3 font-medium">Services</th>` insert:

```html
							<th class="px-5 py-3 font-medium">Customers</th>
```

Change every `colspan="6"` in this file to `colspan="7"` — there are three: the initial Loading row (line 97), the error row inside `loadCoupons()` (line 174), and the "No coupons yet." row (line 179).

- [ ] **Step 3: Extend the script — type, label helper, row render**

In the `CouponRow` type, after `flows: string[];` add:

```ts
		applies_to_all_groups: boolean;
		groups: string[];
```

After the `servicesLabel` function, add:

```ts
	function groupsLabel(c: CouponRow): string {
		if (c.applies_to_all_groups) return 'All customers';
		const names: Record<string, string> = { retail: 'Retail', hotel: 'Hotels', agency: 'Agencies', driver: 'Drivers' };
		return c.groups.map((g) => names[g] ?? g).join(', ') || '—';
	}
```

In the row template inside `loadCoupons()`, after the Services cell (`<td class="px-5 py-3">${escapeHtml(servicesLabel(c))}</td>`) insert:

```html
					<td class="px-5 py-3">${escapeHtml(groupsLabel(c))}</td>
```

- [ ] **Step 4: Wire the group-scope radio and extend the create handler**

After the existing scope-radio block (the one wiring `input[name="cp-scope"]` to `flowsBox`), add:

```ts
	/* ── Group-scope radio enables/disables the group checkboxes ── */
	const groupsBox = document.getElementById('cp-groups');
	document.querySelectorAll<HTMLInputElement>('input[name="cp-group-scope"]').forEach((radio) => {
		radio.addEventListener('change', () => {
			const selected = (document.querySelector('input[name="cp-group-scope"]:checked') as HTMLInputElement)?.value === 'selected';
			groupsBox?.classList.toggle('opacity-40', !selected);
			groupsBox?.classList.toggle('pointer-events-none', !selected);
		});
	});
```

In the create handler, after the `const flows = ...` declaration add:

```ts
		const appliesToAllGroups = (document.querySelector('input[name="cp-group-scope"]:checked') as HTMLInputElement)?.value === 'all';
		const groups = appliesToAllGroups
			? []
			: Array.from(document.querySelectorAll<HTMLInputElement>('.cp-group:checked')).map((c) => c.value);
```

After the existing `if (!appliesToAll && !flows.length) { ... }` validation line add:

```ts
		if (!appliesToAllGroups && !groups.length) { setStatus('Pick at least one customer group, or choose "All customers".', 'text-red-500'); return; }
```

In the `supabase.from('coupons').insert({...})` object, after `flows,` add:

```ts
			applies_to_all_groups: appliesToAllGroups,
			groups,
```

In the post-success reset (after `flowsBox?.classList.add('opacity-40', 'pointer-events-none');`) add:

```ts
		groupsBox?.classList.add('opacity-40', 'pointer-events-none');
```

- [ ] **Step 5: Gates**

Run: `npx astro check` → 43-problem baseline, zero new. Run: `npm test` → 41/41.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/coupons.astro
git commit -m "feat(admin): customer-group targeting on coupons"
```

---

### Task 3: Verification sweep + journal update

**Files:**
- Modify: `qa/2026-08-26-coupons-smoke-test.md` (append a new section at the end)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: DB-level adversarial checks** (Management API, same pattern as Task 1 Step 3; prefix test codes `QA_GRP_`)

1. Coupon `QA_GRP_HOTEL` (percent 10, all services, groups=`['hotel']`): no-JWT (retail) validation → 0 rows; `create_transfer_booking` with `"coupon_code":"QA_GRP_HOTEL"` (guest context) → error containing `COUPON_INVALID`, no row inserted.
2. Simulated hotel-partner JWT (Task 1 Step 3 technique) → `validate_coupon('QA_GRP_HOTEL','transfer')` → 1 row.
3. Coupon `QA_GRP_MIX` with groups=`['retail','agency']`: retail validation → 1 row; simulated hotel partner → 0 rows.
4. Group + flow combined: `QA_GRP_HOTEL` is all-services; also set `applies_to_all=false, flows=array['tour']` on it, then simulated hotel partner with flow `'transfer'` → 0 rows, flow `'tour'` → 1 row (both restrictions must hold simultaneously).
5. Backward compat: `TEST10` (all groups) still validates for retail → 1 row.
6. Invalid group value rejected by the check constraint: `insert ... groups = array['vip']` → error mentioning `coupons_groups_known`.

Clean up all `QA_GRP_%` coupons and any test booking rows afterwards; verify only `TEST10` (plus any real coupons the admin has made) remain.

- [ ] **Step 2: Append the journal section**

Append to `qa/2026-08-26-coupons-smoke-test.md` a `## Customer-group targeting (2026-08-26)` section in the same style: per check — SQL run (token-free), observed output, PASS/FAIL. Record honestly; a FAIL stops the task (report BLOCKED with evidence instead of committing). Also append to the existing browser-only NOT RUN list: "admin form: create a coupon for Selected groups → Hotels and confirm the Customers column renders 'Hotels'; sign in as a hotel partner and confirm the coupon applies at checkout while a guest gets 'Invalid or expired coupon code.'".

- [ ] **Step 3: Full gates once more**

Run: `npm test` (41/41) and `npx astro check` (43 baseline, zero new).

- [ ] **Step 4: Commit**

```bash
git add qa/2026-08-26-coupons-smoke-test.md
git commit -m "test: customer-group targeting verification journal"
```

---

## Out of scope (deliberately)

- Per-individual-customer coupons (specific emails/accounts) — groups only, per the request ("όλοι, λιανική, hotel, etc").
- Editing an existing coupon's groups in the admin UI — same close-and-recreate lifecycle as every other coupon field.
- Any change to the payment pages or booking RPCs — group enforcement lives entirely in `validate_coupon()`; a wrong-group coupon surfaces through the existing invalid-coupon paths.
- New client-side unit tests — no new client logic is introduced (the admin form additions mirror the existing services-scope code verbatim); the DB-level checks in Tasks 1 and 3 are the behavioral tests.
