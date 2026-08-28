# 2026-08-28 — Coupon round-trip return-extra smoke test journal

Branch: `feature/coupon-return-extra`
Started: 2026-08-28
Method: no dev server / browser session was available for this pass.
Server-side checks (Step 2 below) were run directly against the live
Supabase project (`wjqfcijisslzqxesbbox`) via the Management API SQL
endpoint, using a future booking date (2026-09-25) and coupon codes
prefixed `QA_RT` for unambiguous cleanup. Browser-only checks are
recorded as **NOT RUN** with concrete steps for a human to follow (see
Step 3).

This is a deliberate adaptation of the task brief's Step 2/3 (which assumes
a dev server + admin browser login) — the honesty rule for this journal is
that it states exactly what was and wasn't verified, and how.

---

## Step 1 — Automated suite

`npm test`:

```
Test Files  5 passed (5)
     Tests  53 passed (53)
```

All 53/53 Vitest tests pass (`tests/pricing.test.ts` 6, `tests/affiliate-ref.test.ts`
7, `tests/coupons.test.ts` 16, `tests/booking-filters.test.ts` 17,
`tests/booking-date.test.ts` 7). **PASS.**

`npx astro check`:

```
Result (151 files):
- 43 errors
- 0 warnings
- 18 hints
```

43 errors — matches the pre-existing baseline (all in unrelated files:
`Layout` prop typing on `.astro` pages, `google` global not typed on
`transfer/results.astro`, implicit-any callback params). No new errors
introduced by the coupon return-extra feature. **PASS.**

---

## Step 2 — Server-side regression checks (via Supabase Management API SQL)

All queries below ran with the Management API SQL endpoint
(`POST /v1/projects/wjqfcijisslzqxesbbox/database/query`); the access token
used to authenticate is not reproduced here or anywhere in this repo.

Pre-flight: confirmed no leftover `QA_RT%` / `RT15` coupon rows existed
before starting.

```sql
select code, discount_type, discount_value, return_extra_value, active,
       valid_from, valid_until
from public.coupons
where code ilike 'QA_RT%' or code ilike 'RT15%';
```

Observed: `[]` — clean slate.

Setup — created the test coupon:

```sql
insert into public.coupons
  (code, discount_type, discount_value, return_extra_value,
   valid_from, valid_until, active, applies_to_all, applies_to_all_groups)
values
  ('QA_RT10', 'percent', 10, 5, current_date, current_date + 30, true, true, true)
on conflict do nothing
returning code, discount_value, return_extra_value;
```

Observed: `[{"code":"QA_RT10","discount_value":"10","return_extra_value":"5"}]`.

### 1. `validate_coupon` 5-column return, transfer flow — PASS

```sql
select * from public.validate_coupon('QA_RT10', 'transfer');
```

Observed:

```json
[{"id":"742a62da-e148-46e5-92fd-e7ee15f8bc68","code":"QA_RT10",
  "discount_type":"percent","discount_value":"10","return_extra_value":"5"}]
```

One row, 5 columns (`id, code, discount_type, discount_value,
return_extra_value`), `return_extra_value = 5`. **PASS.**

### 2. `validate_coupon` still returns the row for `hourly` flow — PASS (expected)

```sql
select * from public.validate_coupon('QA_RT10', 'hourly');
```

Observed:

```json
[{"id":"742a62da-e148-46e5-92fd-e7ee15f8bc68","code":"QA_RT10",
  "discount_type":"percent","discount_value":"10","return_extra_value":"5"}]
```

Identical row returned for the `hourly` flow. This is **expected behavior,
not a regression**: `QA_RT10` has `applies_to_all = true`, so the flow
filter (`applies_to_all or p_flow = any(flows)`) always passes regardless
of which flow is asked for. `validate_coupon`'s flow targeting is
unchanged by this feature — `return_extra_value` is a purely client-side,
transfer-only concern (the return-leg UI only ever reads/uses it on the
transfer results/payment pages; the hourly and tour flows have no
round-trip concept and never surface or apply it). **PASS.**

### 3. Guest booking with the coupon end-to-end — PASS

```sql
select public.create_transfer_booking('{"date":"2026-09-25","time":"10:00",
  "from":"A","to":"B","email":"qa-rt@test.local","coupon_code":"QA_RT10",
  "coupon_discount":6.75,"total_price":38.25}'::jsonb);
```

Observed: returned a uuid (`b7852561-322b-4c85-9717-d9c0047c1068`).
Selecting that row:

```sql
select id, email, coupon_code, coupon_discount, total_price
from public.transfers where email = 'qa-rt@test.local';
```

```json
[{"id":"b7852561-322b-4c85-9717-d9c0047c1068","email":"qa-rt@test.local",
  "coupon_code":"QA_RT10","coupon_discount":"6.75","total_price":"38.25"}]
```

Booking succeeded (simulating 15% off a €45 round trip: 10% coupon + 5%
return extra = 6.75), `coupon_discount = 6.75` stored as inserted. **PASS.**

### 4. Percent-total constraint — PASS

```sql
insert into public.coupons
  (code, discount_type, discount_value, return_extra_value,
   valid_from, valid_until, active, applies_to_all, applies_to_all_groups)
values
  ('QA_RT_BAD', 'percent', 98, 5, current_date, current_date + 30, true, true, true);
```

Observed:

```
ERROR:  23514: new row for relation "coupons" violates check constraint
"coupons_percent_total_max"
DETAIL:  Failing row contains (..., QA_RT_BAD, percent, 98, ..., 5).
```

Insert rejected (`discount_value + return_extra_value = 103 > 100`),
error mentions `coupons_percent_total_max`; no `QA_RT_BAD` row persisted
(insert failed atomically). **PASS.**

### Cleanup performed

```sql
delete from public.transfers where email = 'qa-rt@test.local';
delete from public.coupons where code ilike 'QA_RT%';
```

Verification after cleanup:

```sql
select count(*) from public.transfers where email = 'qa-rt@test.local';  -- {"count":0}
select count(*) from public.coupons where code ilike 'QA_RT%';           -- {"count":0}
```

Both counts `0` — no leftover test booking rows or test coupon rows
(covers `QA_RT10` and the rejected-insert attempt `QA_RT_BAD`, which never
persisted). **PASS.**

### Demo coupon created for manual QA

Checked first: no `code='RT15'` row existed. Created it and **left it in
place** for the Step 3 manual pass below:

```sql
insert into public.coupons
  (code, discount_type, discount_value, return_extra_value,
   valid_from, valid_until, active, applies_to_all, applies_to_all_groups)
values
  ('RT15', 'percent', 10, 5, current_date, current_date + 30, true, true, true)
on conflict do nothing;
```

Resulting row:

```json
{"id":"34134330-c2d9-470b-a6e9-71fc7f058f17","code":"RT15",
 "discount_type":"percent","discount_value":"10","return_extra_value":"5",
 "valid_from":"2026-08-28","valid_until":"2026-09-27","active":true,
 "applies_to_all":true,"applies_to_all_groups":true}
```

`RT15`: 10% base discount + 5% round-trip extra = 15% off with a return
leg, valid 2026-08-28 → 2026-09-27, all services/groups, active.

---

## Step 3 — Browser-only checks: NOT RUN, deferred to manual QA

No dev server or browser session was available in this environment. The
following require a human with a running `npm run dev` server and the
`RT15` demo coupon. **None of the items below were exercised in this
pass — treat them as open until a human runs them.**

1. **Transfer results page — coupon applies to one-way total.**
   Steps: run `npm run dev`, complete a one-way transfer search on
   `/book/transfer/results`, enter `RT15` in the coupon field and apply.
   Expected: every vehicle card shows the original price struck through
   and a red total price ~10% lower; the caption under the total still
   reads "total price" (not relabeled).

2. **"Add return" toggle — live 15% off + extra line.**
   Steps: with `RT15` still applied from #1, click "Add return" (or
   otherwise select a return date) on the same results page.
   Expected: cards update live to show 15% off (10% base + 5% return
   extra) without re-entering the code; the green coupon status line
   gains a second clause reading "+ 5% round-trip extra"; the price
   sidebar/summary shows the coupon row and the red discounted total.

3. **Carry-over to payment page, pre-applied.**
   Steps: from the results page with `RT15` applied and a return leg
   selected, continue through the passenger-details step to the payment
   page.
   Expected: the coupon input on the payment page arrives pre-filled with
   `RT15`, the green "coupon applied" line is shown automatically (no
   re-entry needed), and the totals reflect 15% off (10% + 5% return
   extra) since the return leg is selected.

4. **Completed cash round-trip booking — correct discount stored, storage cleared.**
   Steps: complete the payment-page flow from #3 with payment method
   "cash" through to a successful booking confirmation.
   Expected: the new row in `public.transfers` has `coupon_discount`
   equal to 15% of the pre-coupon (pre-discount) total price; after the
   success page loads, `sessionStorage.getItem('opaway:coupon')` in the
   browser devtools console returns `null` (cleared post-booking).

5. **Admin coupons page — extra column display + client-side validation.**
   Steps: log into `/admin/coupons` as an admin, create a new coupon with
   discount value 10 and an extra (return_extra_value) of 5; then attempt
   to create/edit a coupon with discount value 98 and extra 5.
   Expected: the Discount column for the first coupon renders as
   `10% (+5% RT)` (or equivalent combined label); the second attempt
   (98 + 5 = 103 > 100) is rejected by client-side validation before any
   network request is made (inline error, no DB round-trip).

---

## Summary

| # | Check | Result |
|---|---|---|
| 1 | `npm test` (53/53) | PASS |
| 2 | `npx astro check` (43 baseline, 0 new) | PASS |
| 3 | `validate_coupon` 5-column return, transfer flow, `return_extra_value=5` | PASS |
| 4 | `validate_coupon` hourly flow still returns the row (flow targeting unchanged, expected) | PASS |
| 5 | `create_transfer_booking` with coupon — booking + `coupon_discount=6.75` stored | PASS |
| 6 | Percent-total constraint (`coupons_percent_total_max`) rejects 98+5 | PASS |
| 7 | Cleanup verified (0 leftover `QA_RT%` coupons, 0 leftover test booking rows) | PASS |
| 8 | Demo coupon `RT15` (10% + 5% RT extra) created and left in place | PASS |
| 3.1 | Transfer results page: `RT15` struck-through + red total, caption unchanged | NOT RUN — deferred |
| 3.2 | "Add return" toggle: live 15% off, "+ 5% round-trip extra" line, sidebar coupon row | NOT RUN — deferred |
| 3.3 | Payment page: coupon pre-applied, 15% off with return selected | NOT RUN — deferred |
| 3.4 | Cash round-trip booking: `coupon_discount` = 15% of pre-coupon total; sessionStorage cleared | NOT RUN — deferred |
| 3.5 | Admin coupons: `10% (+5% RT)` column display; 98+5 rejected client-side | NOT RUN — deferred |

8 of 8 automated/DB-level checks PASS. 5 browser-only checks NOT RUN
(deferred to manual QA with steps above). 0 FAIL.
