# 2026-08-29 — Coupon promo banner smoke test journal

Branch: `feature/coupon-promo-banner`
Started: 2026-08-28 (worktree at `.claude/worktrees/promo-banner`)
Method: no dev server / browser session was available for this pass. Step 2's
DB-level checks were run directly against the live Supabase project
(`wjqfcijisslzqxesbbox`) via the Management API SQL endpoint, using coupon
codes prefixed `QA_BAN` for unambiguous cleanup. Browser-only checks are
recorded as **NOT RUN** with concrete steps for a human to follow (see
Step 2b).

This is a deliberate adaptation of the task brief's Step 2 (which assumes a
dev server + browser session) — the honesty rule for this journal is that it
states exactly what was and wasn't verified, and how.

---

## Step 1 — Automated suite

`npm test`:

```
Test Files  7 passed (7)
     Tests  74 passed (74)
```
All 74/74 Vitest tests pass, across `tests/promo-banner.test.ts` (3),
`tests/affiliate-ref.test.ts` (7), `tests/pricing.test.ts` (6),
`tests/coupons.test.ts` (16), `tests/booking-edit.test.ts` (18),
`tests/booking-filters.test.ts` (17), `tests/booking-date.test.ts` (7).
**PASS.**

`npx astro check`:

```
Result (156 files):
- 43 errors
- 0 warnings
- 18 hints
```
43 errors — matches the pre-existing baseline (all in unrelated files:
`Layout` prop typing on `.astro` pages, `google` global not typed on
`transfer/results.astro`, implicit-any callback params). No new errors
introduced by the promo-banner feature. **PASS.**

---

## Step 2 — Server-side regression checks (via Supabase Management API SQL)

All queries below ran with the Management API SQL endpoint
(`POST /v1/projects/wjqfcijisslzqxesbbox/database/query`); the access token
used to authenticate is not reproduced here or anywhere in this repo. These
calls run without any JWT / `auth.uid()` context, which is exactly the
"no-JWT (retail) caller" shape `get_promo_banner()`'s caller-group logic
defaults to.

Reference — the deployed function (read via `pg_get_functiondef`, for my own
verification, not itself a check):

```sql
create or replace function public.get_promo_banner()
returns table(code text, banner_text text)
language sql stable security definer set search_path to 'public' as $$
  with caller as (
    select coalesce(
      (select p.type from public.partners p
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
```

Setup — confirmed no leftover `QA_BAN%` rows before starting:

```sql
select count(*) from public.coupons where code like 'QA_BAN%';   -- {"count":0}
```

### 1. Baseline — 0 rows when no active coupon has banner text — PASS

```sql
select code, active, valid_from, valid_until, length(btrim(banner_text)) as banner_len
from public.coupons
where active
  and (now() at time zone 'Europe/Athens')::date between valid_from and valid_until;
-- []

select * from public.get_promo_banner();
-- []
```

Observed: no coupon in prod is currently both active and in its validity
window at all (empty result even before considering banner text), and
`get_promo_banner()` independently returns zero rows. This matches the
context note that all pre-existing coupons were deliberately deactivated
earlier — verified directly rather than assumed. **PASS.**

### 2. A coupon with banner text is returned with exactly `code` + `banner_text` — PASS

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until,
  active, applies_to_all, applies_to_all_groups, banner_text)
values ('QA_BAN1', 'percent', 10, current_date, current_date + 30, true, true, true, 'QA banner one')
returning code, created_at;
-- [{"code":"QA_BAN1","created_at":"2026-08-28 19:25:42.486561+00"}]

select * from public.get_promo_banner();
-- [{"code":"QA_BAN1","banner_text":"QA banner one"}]
```

Observed: exactly one row, exactly the two keys `code` and `banner_text`,
values matching the inserted coupon. **PASS.**

### 3. Newest wins — PASS

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until,
  active, applies_to_all, applies_to_all_groups, banner_text)
values ('QA_BAN2', 'percent', 10, current_date, current_date + 30, true, true, true, 'QA banner two')
returning code, created_at;
-- [{"code":"QA_BAN2","created_at":"2026-08-28 19:25:51.959394+00"}]

select * from public.get_promo_banner();
-- [{"code":"QA_BAN2","banner_text":"QA banner two"}]
```

Observed: with two active, in-period, banner-bearing coupons, the one with
the later `created_at` (`QA_BAN2`) is returned. **PASS.**

### 4. Deactivating the newest falls back to the older one — PASS

```sql
update public.coupons set active=false where code='QA_BAN2' returning code, active;
-- [{"code":"QA_BAN2","active":false}]

select * from public.get_promo_banner();
-- [{"code":"QA_BAN1","banner_text":"QA banner one"}]
```

Observed: with `QA_BAN2` deactivated, the RPC falls back to `QA_BAN1`.
**PASS.**

### 5. Whitespace-only `banner_text` is not advertised — PASS

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until,
  active, applies_to_all, applies_to_all_groups, banner_text)
values ('QA_BAN3', 'percent', 10, current_date, current_date + 30, true, true, true, '   ')
returning code, created_at, length(banner_text) as raw_len;
-- [{"code":"QA_BAN3","created_at":"2026-08-28 19:26:08.029368+00","raw_len":3}]

select * from public.get_promo_banner();
-- [{"code":"QA_BAN1","banner_text":"QA banner one"}]
```

Observed: `QA_BAN3` is newer than `QA_BAN1` and active/in-period, but its
`banner_text` is three spaces (`btrim` length 0), so it's filtered out and
`QA_BAN1` is still returned. **PASS.**

### 6. Group targeting — `groups=['hotel']` coupon returns 0 rows for a no-JWT (retail) caller — PASS

Isolated the check by deactivating `QA_BAN1` first (so the only active,
in-period, non-blank-banner coupon left is the new hotel-only one):

```sql
update public.coupons set active=false where code='QA_BAN1' returning code, active;
-- [{"code":"QA_BAN1","active":false}]

insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until,
  active, applies_to_all, applies_to_all_groups, groups, banner_text)
values ('QA_BAN4', 'percent', 10, current_date, current_date + 30, true, true, false,
  array['hotel'], 'QA hotel-only banner')
returning code, applies_to_all_groups, groups;
-- [{"code":"QA_BAN4","applies_to_all_groups":false,"groups":["hotel"]}]

select * from public.get_promo_banner();
-- []
```

Observed: with `QA_BAN3` filtered by blank text, `QA_BAN1`/`QA_BAN2`
deactivated, and `QA_BAN4` restricted to `groups=['hotel']`, the RPC (run
with no JWT, i.e. `auth.uid()` is null and the function's caller CTE
resolves the group to `'retail'`) returns zero rows — a hotel-only banner
coupon does not leak to a retail caller. **PASS.**

### 7. The RPC leaks nothing else — two columns only — PASS

```sql
update public.coupons set active=true where code='QA_BAN1' returning code, active;
-- [{"code":"QA_BAN1","active":true}]

select * from public.get_promo_banner();
-- [{"code":"QA_BAN1","banner_text":"QA banner one"}]

select p.proname, pg_get_function_result(p.oid) as return_type
from pg_proc p where p.proname='get_promo_banner';
-- [{"proname":"get_promo_banner","return_type":"TABLE(code text, banner_text text)"}]
```

Observed: even though `QA_BAN1` carries plenty of other columns
(`discount_value`, `valid_from`, `applies_to_all`, `groups`,
`return_extra_value`, etc.), `select *` from the RPC surfaces only `code`
and `banner_text` — confirmed both by the runtime row shape and by the
function's declared return signature (`TABLE(code text, banner_text
text)`), which structurally prevents any other column from ever being
returned regardless of future callers. **PASS.**

### Cleanup performed

```sql
delete from public.coupons where code like 'QA_BAN%';
select count(*) from public.coupons where code like 'QA_BAN%';   -- {"count":0}
```

Count is `0` — no leftover `QA_BAN%` test coupons. **PASS.**

### Demo banner coupon created for manual QA

Checked first: no `code='BANNER10'` row existed. Created it and **left it
active** for the Step 2b manual pass below:

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until,
  active, applies_to_all, applies_to_all_groups, banner_text)
values ('BANNER10', 'percent', 10, current_date, current_date + 30, true, true, true,
  'Book online and save 10% on your transfer')
returning *;
```

Resulting row:

```
{"id":"6c0fa80c-0ce3-4fbc-820b-bd29e6b70710","code":"BANNER10","discount_type":"percent",
 "discount_value":"10","valid_from":"2026-08-28","valid_until":"2026-09-27","active":true,
 "applies_to_all":true,"flows":[],"created_at":"2026-08-28 19:26:49.9937+00",
 "applies_to_all_groups":true,"groups":[],"return_extra_value":"0",
 "banner_text":"Book online and save 10% on your transfer"}
```

Confirmed the live RPC surfaces it:

```sql
select * from public.get_promo_banner();
-- [{"code":"BANNER10","banner_text":"Book online and save 10% on your transfer"}]
```

**The user should deactivate `BANNER10` (or delete it) once manual QA is
done** — it is a real, live, active 10%-off coupon on production, left in
place deliberately so the banner has something to show during the browser
pass below.

---

## Step 2b — Browser-only checks: NOT RUN, deferred to manual QA

No dev server or browser session was available in this environment. The
following require a human with a running `npm run dev` server (or the
deployed site) and, for item 4, an admin login. **None of the items below
were exercised in this pass — treat them as open until a human runs them.**

1. With `BANNER10` active, load any page: the sticky bar shows "Book online
   and save 10% on your transfer" with a `BANNER10` code pill, and the
   default "Book your transfer online" copy is gone.
2. Dismiss the banner, reload: it stays hidden. Then change the coupon's
   banner text via the admin inline editor (`/admin/coupons`, click the
   Banner cell for `BANNER10`) to a different message and reload: the
   banner is still hidden (same code = same dismissal key) — dismissing is
   per coupon, not per wording.
3. Deactivate `BANNER10` (toggle `active` off in `/admin/coupons` or via
   SQL): the banner falls back to the default hard-coded copy on the next
   load.
4. Admin `/admin/coupons`: create a coupon with banner text; the Banner
   column shows it truncated; click the cell, edit, Save, and the list
   refreshes with the new text; clearing it shows `—`.
5. Language switch to Greek/Spanish with a coupon banner showing: the
   message stays in the admin's wording (documented behaviour), while the
   "Code" label and the Book-now button translate.

---

## Summary

| # | Check | Result |
|---|---|---|
| 1 | `npm test` (74/74) | PASS |
| 2 | `npx astro check` (43 baseline, 0 new) | PASS |
| 3 | DB check 1 — 0 rows when no active coupon has banner text | PASS |
| 4 | DB check 2 — returned row has exactly `code` + `banner_text` | PASS |
| 5 | DB check 3 — newest-created banner coupon wins | PASS |
| 6 | DB check 4 — deactivating newest falls back to older | PASS |
| 7 | DB check 5 — whitespace-only `banner_text` not advertised | PASS |
| 8 | DB check 6 — `groups=['hotel']` coupon hidden from no-JWT/retail caller | PASS |
| 9 | DB check 7 — RPC exposes exactly two columns, nothing else | PASS |
| 10 | Cleanup verified (0 leftover `QA_BAN%` coupons) | PASS |
| 11 | Demo coupon `BANNER10` created, active, surfaced by the RPC | PASS |
| 2b.1 | Sticky bar shows `BANNER10` banner text + code pill, default copy gone | NOT RUN — deferred |
| 2b.2 | Dismiss persists across reload and across a banner-text edit (per-code key) | NOT RUN — deferred |
| 2b.3 | Deactivating `BANNER10` falls back to default hard-coded copy | NOT RUN — deferred |
| 2b.4 | Admin Banner column: truncation, inline edit + save, clear shows `—` | NOT RUN — deferred |
| 2b.5 | Language switch: banner text stays as authored, surrounding UI translates | NOT RUN — deferred |

11 of 11 automated/DB-level checks PASS. 5 browser-only checks NOT RUN
(deferred to manual QA with steps above). 0 FAIL.

**Reminder:** `BANNER10` is live and active in production. Deactivate or
delete it once the manual QA pass above is complete.
