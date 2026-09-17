# 2026-09-17 — Coupon offer rules: smoke test journal

Branch: `feature/coupon-offer-rules`.

What changed (client feedback, three points):
1. The promo banner's "Book now" lands on the booking page of the service the
   offer targets (`/book/transfer`, `/book/tour`, `/book/hourly`), or `/book`
   when the offer covers several.
2. A transfer offer can be for one-way rides only, round trips only, or both
   (`coupons.trip_scope`).
3. The offer (booking) period `valid_from..valid_until` is now separate from
   the travel dates `travel_from..travel_until`, so an October offer can be
   booked in September.

Method: Step 1 ran in the repo. Step 2 ran against prod through the
Management API SQL endpoint, executed by the user from the session right
after the migration was applied the same way (2026-09-17). Step 3 ran on the
live site after the deploy.

---

## Step 1 — Automated gates

`npm test`: **198 passed (198)**, up from 189: `validateCouponFields` gains six
cases (early-booking offer accepted; travel dates order; travel ending before
the offer opens; round-trip-only and one-way-only accepted; trip type on a
non-transfer offer rejected; extra on a one-way-only offer rejected) and
`promoBannerHref` two (single service → page; all/several/unknown → `/book`).
Existing `fetchPromoBanner` cases now assert `href`. **PASS.**

`npm run build`: completes. **PASS.**

`npx astro check`: same error count as `main` (baseline 42). **Zero new
errors. PASS.**

---

## Step 2 — DB checks (after applying `db/migrations/2026-09-17-coupon-offer-rules.sql`)

**2.1 — Columns, backfill, functions**

```sql
select code, valid_from, valid_until, travel_from, travel_until, trip_scope from public.coupons order by created_at desc;
-- expect: every row has travel_* = valid_* and trip_scope = 'any'
select p.proname, pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('get_promo_banner','get_auto_coupons','validate_coupon');
-- expect get_promo_banner → TABLE(code text, banner_text text, applies_to_all boolean, flows text[])
```

**2.2 — Fixtures** (today is 2026-09-17)

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, travel_from, travel_until, trip_scope, active, applies_to_all, applies_to_all_groups, flows) values
  ('QA_EARLY', 'percent', 10, '2026-09-15', '2026-09-30', '2026-10-01', '2026-10-31', 'any',        true, false, true, '{transfer}'),
  ('QA_RT',    'percent', 15, '2026-09-01', '2026-09-30', '2026-09-01', '2026-10-31', 'round_trip', true, false, true, '{transfer}'),
  ('QA_OW',    'fixed',    5, '2026-09-01', '2026-09-30', '2026-09-01', '2026-10-31', 'one_way',    true, true,  true, '{}');
```

**2.3 — `get_auto_coupons`**

| # | Call | Expect |
|---|---|---|
| V1 | `('transfer','2026-10-10',null)` filtered to QA_EARLY | 1 row (early booking: booked today, travels in October) |
| V2 | `('transfer','2026-09-20',null)` → QA_EARLY | 0 rows (travel dates are October) |
| V3 | `('transfer','2026-10-10',null)` → QA_RT | 0 rows (one way) |
| V4 | `('transfer','2026-10-10','2026-10-12')` → QA_RT | 1 row (round trip) |
| V5 | `('transfer','2026-10-10',null)` → QA_OW | 1 row |
| V6 | `('transfer','2026-10-10','2026-10-12')` → QA_OW | 0 rows |
| V7 | `('tour','2026-10-10',null)` → QA_OW | 1 row (scope ignored off the transfer flow; QA_OW applies to all services) |

**2.4 — `validate_coupon`**: V8 `('qa_rt','transfer','2026-10-10',null)` → 0 rows; V9 with `'2026-10-12'` → 1 row; V10 `('qa_early','transfer','2026-10-10',null)` → 1 row.

**2.5 — Booking RPC**: `create_transfer_booking` one-way 10/10 with `coupon_code: 'QA_RT'` → `COUPON_INVALID`, nothing inserted.

**2.6 — Banner**: `select * from public.get_promo_banner();` → the advertised offer's `applies_to_all` and `flows` come back.

**2.7 — Cleanup**: `delete from public.coupons where code like 'QA_%' returning code;`

Results:

```
backfill    every existing coupon: travel = valid, scope = any
            (B2B October Offer 08/09–30/09; Exclusive VIP September 17/09–30/09;
             VIPSEP7 — since re-dated by the admin to 01/10–31/10, so travel is October too)
get_promo_banner → TABLE(code, banner_text, applies_to_all, flows)
V1 early oct ride today        1   V2 early sep ride          0
V3 rt-only one way             0   V4 rt-only round trip      1
V5 ow-only one way             1   V6 ow-only round trip      0
V7 ow-only on tour flow        1   (scope ignored off transfers)
V8 validate rt-only one way    0   V9 validate rt-only rt     1
V10 validate early oct         1
V11 "VIPSEP7 on a 20/09 ride"  0   — expected in hindsight: the admin moved VIPSEP7
                                     to October; the running September offer is now
                                     "Exclusive VIP September" (see 05)
booking one-way 10/10 + QA_RT  → COUPON_INVALID, nothing inserted
banner → Exclusive VIP September, applies_to_all=false, flows={transfer}
cleanup → QA_EARLY, QA_RT, QA_OW
```
**PASS.**

Follow-up for the admin: `VIPSEP7` now has offer period *and* travel dates
01/10–31/10, so it becomes bookable only on 1 October. For an early-booking
October offer, edit it and set "Offer active from" to today while keeping the
travel dates in October.

---

## Step 3 — Live checks (after the deploy)

### 3a — Quick checks right after the deploy (guest)

Banner "Book now" → both anchors `/book/transfer` (the advertised offer is
transfer-only) **PASS**; transfer search 20/09 one way €70 → €66.50 and after
"Add return" €140 → €133 (the September offer, unchanged by the backfill) **PASS**.

### 3b — End-to-end run as a customer (Chrome, guest, live site, 2026-09-17)

Test coupons created by the user through the Management API (no banner
text, three-day travel windows in 2027 so no real customer could meet them),
three real cash bookings made through the site, rows checked, everything
deleted. Passenger on every booking: QA SMOKE TEST DELETE,
qa-smoke@example.com. Route Athens International Airport → Syntagma Square,
sedan (€70 one way), 2 pax, 12:00.

| Coupon | Rule | Value | Offer active | Travel dates | Trip type |
|---|---|---|---|---|---|
| QA_E2E_EARLY | early booking | 10 % | 17/09–30/09/2026 | 01–03/03/2027 | any |
| QA_E2E_RT | round trip only | 15 % | 17/09–30/09/2026 | 01–03/04/2027 | round_trip |
| QA_E2E_OW | one way only | €5 | 17/09–30/09/2026 | 01–03/05/2027 | one_way |
| QA_E2E_BANNER | banner target | 1 % | today only | today only | any, **tours**, banner text set |

**Scenario 1 — early booking (QA_E2E_EARLY)**
- Results 02/03/2027 one way: €70 → **€63** (van €90 → €81, minibus €175 → €157.50). PASS
- Results 25/09/2026 one way: €70 → €66.50 — only the real 5 % September offer; the QA
  offer does not leak outside its travel dates. PASS
- Passenger: total €63.00, coupon row −€7.00. Payment: same. Cash on-site → "Booking
  confirmed!", reference **6E667331**, total €63.00. PASS

**Scenario 2 — round trip only (QA_E2E_RT)**
- Results 02/04/2027 one way: €70 / €90 / €175, no discount. PASS
- "Add return": €140 → **€119** (−15 %); "Remove return": back to €70, no discount. PASS
- Results with returnDate 03/04: €140 → €119. Passenger and payment: total €119.00,
  coupon row −€21.00. Cash → confirmed, reference **A86B1CF0**. PASS
- Forged one-way booking sent to the REST RPC with `coupon_code: QA_E2E_RT` from the
  browser → `400 COUPON_INVALID`. PASS

**Scenario 3 — one way only (QA_E2E_OW)**
- Results 02/05/2027 one way: €70 → **€65** (−€5). "Add return": €140 / €180 / €350, no
  discount and no extra; "Remove return": −€5 again. PASS
- Passenger and payment: total €65.00, coupon row −€5.00. Cash → confirmed, reference
  **C7233580**. PASS

**Scenario 4 — banner target (QA_E2E_BANNER, tours only)**
- With the coupon present: banner text "QA test banner — ignore", both "Book now" anchors
  `/book/tour`. After deleting it: banner back to the September offer, anchors
  `/book/transfer`. PASS

**Scenario 5 — trip type ignored off transfers**
- Hourly results 02/05/2027: €180 / €180 / €240, no discount (QA_E2E_OW is transfer-only);
  the flow prices normally with the new RPC. PASS

**Stored rows** (`transfers where email = 'qa-smoke@example.com'`):

```
6e667331  2027-03-02  return null        QA_E2E_EARLY  discount 7   total 63   cash pending new
a86b1cf0  2027-04-02  return 2027-04-03  QA_E2E_RT     discount 21  total 119  cash pending new
c7233580  2027-05-02  return null        QA_E2E_OW     discount 5   total 65   cash pending new
```
Every row carries the coupon the customer saw and the discount the page showed. PASS

**Cleanup**: the three bookings and the three coupons deleted (the banner coupon
right after its check); final count 0 bookings / 0 coupons left. The admin will
have received three BCC confirmation emails for the test bookings (the system
copies the admin on every confirmation) and may have seen them briefly as "new"
in the admin panel.

**Overall: PASS** — every rule the client asked for behaves as specified from the
customer's seat, on the stored booking, and at the server.
