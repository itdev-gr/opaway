# 2026-08-26 — Coupons end-to-end smoke test journal

Branch: `feature/discount-coupons`
Started: 2026-08-26
Method: no dev server / browser session was available for this pass. Server-side
checks (Step 2 below) were run directly against the live Supabase project
(`wjqfcijisslzqxesbbox`) via the Management API SQL endpoint, using future
booking dates (2026-09-15) and coupon codes prefixed `QA_` for unambiguous
cleanup. Browser-only checks are recorded as **NOT RUN** with concrete steps
for a human to follow (see Step 2b).

This is a deliberate adaptation of the task brief's Step 2 (which assumes a
dev server + admin browser login) — the honesty rule for this journal is that
it states exactly what was and wasn't verified, and how.

---

## Step 1 — Automated suite

`npm test`:

```
Test Files  4 passed (4)
     Tests  41 passed (41)
```
All 41/41 Vitest tests pass (`tests/coupons.test.ts` 11, `tests/pricing.test.ts` 6,
`tests/booking-filters.test.ts` 17, `tests/booking-date.test.ts` 7). **PASS.**

`npx astro check`:

```
Result (148 files):
- 43 errors
- 0 warnings
- 18 hints
```
43 errors — matches the pre-existing baseline (all in unrelated files:
`Layout` prop typing on `.astro` pages, `google` global not typed on
`transfer/results.astro`, implicit-any callback params). No new errors
introduced by the coupons feature. **PASS.**

---

## Step 2 — Server-side adversarial checks (via Supabase Management API SQL)

All queries below ran with the Management API SQL endpoint
(`POST /v1/projects/wjqfcijisslzqxesbbox/database/query`); the access token
used to authenticate is not reproduced here or anywhere in this repo.

### 1. Valid coupon accepted + stored — PASS

Created `QA_OK10` (percent 10, valid today−30..today+30, `applies_to_all=true`).

```sql
select public.create_transfer_booking('{"date":"2026-09-15","time":"10:00","from":"A","to":"B",
  "email":"qa@test.local","total_price":45,"coupon_code":"QA_OK10","coupon_discount":5,
  "booking_type":"transfer"}'::jsonb);
```

Observed: returned a uuid (`b1970c91-dc3e-430f-8a7f-77e72c673f3f`). Selecting
that row from `public.transfers` showed:

```
{"id":"b1970c91-...","coupon_id":"7b0ed3d8-...","coupon_code":"QA_OK10","coupon_discount":"5","total_price":"45"}
```

`coupon_id` set, `coupon_code='QA_OK10'`, `coupon_discount=5` as expected.
Test booking row deleted afterwards.

### 2. Case-insensitive match — PASS

```sql
select * from public.validate_coupon('qa_ok10','transfer');
```

Observed: 1 row returned (`QA_OK10`, percent, 10), despite the lowercase
lookup code. **PASS.**

### 3. Closed coupon rejected — PASS

```sql
update public.coupons set active=false where code='QA_OK10';
select * from public.validate_coupon('QA_OK10','transfer');   -- []
select public.create_transfer_booking('{... "coupon_code":"QA_OK10", ...}'::jsonb);
```

Observed: `validate_coupon` returned 0 rows after closing. The same
`create_transfer_booking` call raised:

```
ERROR:  P0001: COUPON_INVALID
```

`select count(*) from public.transfers where coupon_code='QA_OK10'` was 0
both before and after the failed attempt — no partial/orphaned row was
inserted. **PASS.**

### 4. Expired rejected — PASS

Created `QA_OLD` with `valid_from` and `valid_until` both `current_date - 1`
(yesterday, 2026-08-25).

```sql
select * from public.validate_coupon('QA_OLD','transfer');   -- []
```

Observed: 0 rows. **PASS.**

### 5. Scheduled rejected — PASS

Created `QA_FUTURE` with `valid_from = current_date + 1` (tomorrow, 2026-08-27).

```sql
select * from public.validate_coupon('QA_FUTURE','transfer');   -- []
```

Observed: 0 rows. **PASS.**

### 6. Flow restriction — PASS

Created `QA_HOURLY` (`applies_to_all=false`, `flows='{hourly}'`).

```sql
select * from public.validate_coupon('QA_HOURLY','hourly');   -- 1 row
select * from public.validate_coupon('QA_HOURLY','tour');     -- []
select public.create_tour_booking('{... "coupon_code":"QA_HOURLY" ...}'::jsonb);
```

Observed: `validate_coupon('QA_HOURLY','hourly')` returned 1 row;
`validate_coupon('QA_HOURLY','tour')` returned 0 rows. `create_tour_booking`
with `coupon_code=QA_HOURLY` raised `COUPON_INVALID` (tour flow not in the
coupon's `flows` array), and `select count(*) from public.tours where
coupon_code='QA_HOURLY'` was 0. **PASS.**

### 7. Duplicate code guard — PASS

With `QA_OK10` already present, inserted a second coupon with code
`qa_ok10` (lowercase):

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, active, applies_to_all)
values ('qa_ok10', 'percent', 10, current_date, current_date + 30, true, true);
```

Observed:

```
ERROR:  23505: duplicate key value violates unique constraint "coupons_code_ci"
DETAIL:  Key (lower(code))=(qa_ok10) already exists.
```

Confirms the case-insensitive unique index (`coupons_code_ci`) enforces the
duplicate guard at the DB level, which is what the admin UI's "friendly
duplicate message" is built on top of. **PASS.**

### 8. Tour booking stores coupon — PASS

Created `QA_TOUR5` (fixed 5, `applies_to_all=true`).

```sql
select public.create_tour_booking('{"date":"2026-09-15","time":"10:00","tour_name":"QA",
  "email":"qa@test.local","total_price":95,"coupon_code":"QA_TOUR5","coupon_discount":5}'::jsonb);
```

Observed: returned a uuid (`1d769fe6-603f-436f-a20a-c48f0d2a5938`). Selecting
that row from `public.tours` showed:

```
{"id":"1d769fe6-...","coupon_id":"d9453d49-...","coupon_code":"QA_TOUR5","coupon_discount":"5","total_price":"95"}
```

Coupon columns populated correctly. Test tour row deleted afterwards. **PASS.**

### 9. Floor (client-side clamp) — PASS, covered by existing unit tests

Not re-checked against the DB (the floor is applied client-side before the
total is sent, per the requirement's design — the RPCs store whatever
`coupon_discount` they're given). Already covered by
`tests/coupons.test.ts`:

- `'fixed: clamps so at least €1.00 stays payable (€20 off €8 → €7 discount)'` (line 17)
- `'percent: 100% clamps so at least €1.00 stays payable (€40 → €39 discount)'` (line 21)

Both pass as part of the 41/41 Step 1 run. **PASS (via unit test).**

---

## Step 2b — Browser-only checks: NOT RUN, deferred to manual QA

No dev server or admin browser session was available in this environment.
The following require a human with a running `npm run dev` server and an
admin login, using the `TEST10` demo coupon left in place for this purpose
(percent 10, valid 2026-08-26 → 2026-09-25, active, applies to all flows).
**None of the items below were exercised in this pass — treat them as open
until a human runs them.**

1. **Coupon input UI on the three payment pages** — visit
   `/book/transfer/payment`, `/book/hourly/payment`, `/book/tour/payment`,
   enter `TEST10` in the coupon field, confirm the price updates to reflect
   the 10% discount and a green "Coupon applied" (or equivalent) status line
   appears. Enter a bogus code (e.g. `NOPE123`) and confirm a red
   "Invalid or expired" status line appears instead and the price does not
   change.
2. **Admin `/admin/coupons` page CRUD + nav entry** — confirm the admin nav
   (`AdminLayout.astro`) has a "Coupons" entry, that it lists existing
   coupons (including `TEST10`), and that creating, closing, and deleting a
   coupon through the UI works and reflects immediately in the list.
3. **Stripe checkout showing the discounted amount** — with Stripe test
   keys, apply `TEST10` on a payment page, proceed through Stripe Checkout,
   and confirm the amount Stripe charges is the discounted total, not the
   full price.
4. **`COUPON_INVALID` friendly error surfacing in the payment form** —
   reproduce the tampered-client-bypass scenario: apply a valid coupon on a
   payment page, close that same coupon from another admin tab/session,
   then submit the booking (cash). Confirm the booking fails with a
   friendly error derived from `COUPON_INVALID` (not a raw Postgres error)
   and that no booking row is created.
5. **i18n translations of the coupon labels** — switch the site's language
   selector and confirm the coupon input's label, placeholder, and
   applied/invalid status strings are translated (not left in the
   fallback/English source strings) on at least one non-English locale.

---

## Cleanup performed

- All five `QA_%` test coupons (`QA_OK10`, `QA_OLD`, `QA_FUTURE`,
  `QA_HOURLY`, `QA_TOUR5`) were deleted from `public.coupons` after their
  respective checks.
- Confirmed zero leftover rows in `public.transfers` / `public.tours` for
  `email='qa@test.local'` or any `coupon_code like 'QA_%'` before deleting
  the coupons (the two rows created during checks 1 and 8 were deleted
  individually right after their assertions).
- No `TEST10` coupon existed beforehand (checked first). Created it as the
  demo coupon for manual QA: percent 10, valid 2026-08-26 → 2026-09-25,
  `active=true`, `applies_to_all=true`. **Left in place** for the Step 2b
  manual pass above.

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Valid coupon accepted + stored | PASS |
| 2 | Case-insensitive match | PASS |
| 3 | Closed coupon rejected end-to-end | PASS |
| 4 | Expired coupon rejected | PASS |
| 5 | Scheduled coupon rejected | PASS |
| 6 | Flow restriction (hourly-only) | PASS |
| 7 | Duplicate code guard (case-insensitive) | PASS |
| 8 | Tour booking stores coupon | PASS |
| 9 | Floor/clamp (unit-tested) | PASS |
| 2b.1 | Coupon input UI (3 payment pages) | NOT RUN — deferred |
| 2b.2 | Admin `/admin/coupons` CRUD + nav | NOT RUN — deferred |
| 2b.3 | Stripe checkout discounted amount | NOT RUN — deferred |
| 2b.4 | `COUPON_INVALID` friendly error in payment form | NOT RUN — deferred |
| 2b.5 | i18n of coupon labels | NOT RUN — deferred |

9 of 9 server-side/unit checks PASS. 5 browser-only checks NOT RUN (deferred
to manual QA with steps above). 0 FAIL.
