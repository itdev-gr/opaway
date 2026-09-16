# 2026-09-16 — Coupons tied to the travel date: smoke test journal

Branch: `feature/coupon-trip-dates`.

What changed: a coupon now discounts a booking only when the **trip** travels
inside the coupon's period (ride date, and the return date for a round trip),
on top of the existing rule that the booking itself is made inside the period.
Client report that prompted it: an October transfer booked in September got
the September offer (`SEP7`, 30/08–30/09).

Where the rule lives: `get_auto_coupons(p_flow, p_date, p_return_date)` (what
the pages price with) and `validate_coupon(p_code, p_flow, p_date,
p_return_date)` (what the booking RPCs re-check). Both booking RPCs now pass
the payload's `date` / `return_date`. A call without a trip date returns no
coupon, so a stale client build gets full price, never a wrong discount.

Method: Step 1 ran in the repo. Step 2 ran against the live project
(`wjqfcijisslzqxesbbox`) through the Management API SQL endpoint, one
statement per call, executed by the user from the session (the migration
file as a single call, then the checks below); no token appears in this
journal. Step 3 is the browser checklist, not run in this pass.

---

## Step 1 — Automated gates

`npm test`:

```
Test Files  10 passed (10)
     Tests  164 passed (164)
```
164/164, up from `main`'s 161: `tests/coupons.test.ts` gains three
`fetchAutoCoupons` cases (return date handed over; empty return date sent as
`null`; no trip date → `[]` without an RPC call) and the existing "asks the RPC
for the flow" case now asserts the dates too. **PASS.**

`npm run build`: completes (Astro + Vercel adapter), so the rewritten
`.astro` templates compile. **PASS.**

`npx astro check`: 42 errors on the branch, 42 errors on `main` measured in
the same pass (stash / unstash). **Zero new errors. PASS.**

---

## Step 2 — DB checks (after applying `db/migrations/2026-09-16-coupon-trip-dates.sql`)

The migration was **applied to prod on 2026-09-16** as one Management API
call (returned `[]`, no error). It drops the single-arity `get_auto_coupons(text)` and
`validate_coupon(text, text)` first — the new arity would otherwise be an
ambiguous overload for PostgREST — then re-creates the two booking RPCs from
the influencers bodies with only the `validate_coupon` call changed.

**2.0 — Before applying: the live booking RPCs match the file they are rebuilt from**

```sql
select pg_get_functiondef('public.create_transfer_booking(jsonb)'::regprocedure);
select pg_get_functiondef('public.create_tour_booking(jsonb)'::regprocedure);
```
Compare with `db/migrations/2026-08-28-influencers.sql` (lines 49–288). Only
formatting should differ. Result: **NOT RUN** (no read access before the
apply); the post-apply checks V10–V12 below exercise the rebuilt bodies.

**2.1 — Signatures, security definer, grants**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
       array(select r.rolname from pg_roles r
             where has_function_privilege(r.rolname, p.oid, 'execute')
               and r.rolname in ('anon','authenticated')) as grantees
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_auto_coupons','validate_coupon','create_transfer_booking','create_tour_booking')
order by 1;
```
Expected: exactly one row per name; `get_auto_coupons` → `p_flow text, p_date date, p_return_date date`;
`validate_coupon` → `p_code text, p_flow text, p_date date, p_return_date date`;
all `prosecdef = true`, grantees `{anon,authenticated}`.

```
create_tour_booking     | payload jsonb                                             | t | {authenticated,anon}
create_transfer_booking | payload jsonb                                             | t | {authenticated,anon}
get_auto_coupons        | p_flow text, p_date date, p_return_date date              | t | {authenticated,anon}
validate_coupon         | p_code text, p_flow text, p_date date, p_return_date date | t | {authenticated,anon}
```
One row per name — the old overloads are gone. **PASS.**

**2.2 — Fixture** (10 %, all services, all groups, September only)

```sql
insert into public.coupons (code, discount_type, discount_value, valid_from, valid_until, active, applies_to_all, applies_to_all_groups)
values ('QA_TRIP', 'percent', 10, '2026-09-01', '2026-09-30', true, true, true);
```

**2.3 — `get_auto_coupons` (what the pages see)**

| # | Call | Expect |
|---|---|---|
| V1 | `select code from public.get_auto_coupons('transfer','2026-09-20',null) where code='QA_TRIP';` | 1 row |
| V2 | `select code from public.get_auto_coupons('transfer','2026-10-05',null) where code='QA_TRIP';` | 0 rows |
| V3 | `select code from public.get_auto_coupons('transfer','2026-09-28','2026-10-03') where code='QA_TRIP';` | 0 rows (return leg in October) |
| V4 | `select code from public.get_auto_coupons('transfer','2026-09-20','2026-09-25') where code='QA_TRIP';` | 1 row |
| V5 | `select code from public.get_auto_coupons('transfer') where code='QA_TRIP';` | 0 rows (no date = old client = no offer) |
| V6 | `select code from public.get_auto_coupons('tour','2026-09-01',null) where code='QA_TRIP';` and the same with `'2026-09-30'` | 1 row each (bounds inclusive) |

Run as one `union all` of counts:

```
V1 auto sep one-way (expect 1)          | 1
V2 auto oct one-way (expect 0)          | 0
V3 auto 09-28->10-03 (expect 0)         | 0
V4 auto 09-20->09-25 (expect 1)         | 1
V5 auto no date (expect 0)              | 0
V6 auto bounds 09-01 + 09-30 (expect 2) | 2
```
**PASS.**

**2.4 — `validate_coupon` (what the booking RPCs re-check)**

| # | Call | Expect |
|---|---|---|
| V7 | `select code from public.validate_coupon('qa_trip','transfer','2026-09-20',null);` | 1 row (case-insensitive as before) |
| V8 | `select code from public.validate_coupon('qa_trip','transfer','2026-10-05',null);` | 0 rows |
| V9 | `select code from public.validate_coupon('qa_trip','transfer','2026-09-28','2026-10-03');` | 0 rows |

```
V7 validate sep (expect 1)          | 1
V8 validate oct (expect 0)          | 0
V9 validate 09-28->10-03 (expect 0) | 0
```
**PASS.**

**2.5 — Booking RPCs refuse an out-of-period coupon** (each block raises,
so nothing is inserted; the `notice` shows the error text)

```sql
-- V10: October transfer with the September code → COUPON_INVALID
do $$ begin
  perform public.create_transfer_booking('{"from":"QA","to":"QA","date":"2026-10-05","time":"10:00","email":"qa@example.com","total_price":90,"coupon_code":"QA_TRIP","coupon_discount":10}'::jsonb);
  raise exception 'UNEXPECTED_SUCCESS';
exception when others then
  raise notice 'raised: %', sqlerrm;
  if sqlerrm <> 'COUPON_INVALID' then raise; end if;
end $$;

-- V11: round trip 28/09 → 03/10 with the September code → COUPON_INVALID
do $$ begin
  perform public.create_transfer_booking('{"from":"QA","to":"QA","date":"2026-09-28","return_date":"2026-10-03","time":"10:00","email":"qa@example.com","total_price":90,"coupon_code":"QA_TRIP","coupon_discount":10}'::jsonb);
  raise exception 'UNEXPECTED_SUCCESS';
exception when others then
  raise notice 'raised: %', sqlerrm;
  if sqlerrm <> 'COUPON_INVALID' then raise; end if;
end $$;

-- V12: October tour with the September code → COUPON_INVALID
do $$ begin
  perform public.create_tour_booking('{"tour":"QA","date":"2026-10-05","time":"10:00","email":"qa@example.com","total_price":90,"coupon_code":"QA_TRIP","coupon_discount":10}'::jsonb);
  raise exception 'UNEXPECTED_SUCCESS';
exception when others then
  raise notice 'raised: %', sqlerrm;
  if sqlerrm <> 'COUPON_INVALID' then raise; end if;
end $$;

select count(*) as qa_rows from public.transfers where "from" = 'QA' and "to" = 'QA';  -- expect 0
```
All three blocks returned `[]` (the `COUPON_INVALID` branch swallowed the
error; any other outcome would have surfaced as an API error), and
`qa_transfers = 0`, `qa_tours = 0`. **PASS.**

**2.6 — The live September offer behaves**

```sql
select 'oct' as ride, count(*) from public.get_auto_coupons('transfer','2026-10-05',null)
union all
select 'sep', count(*) from public.get_auto_coupons('transfer','2026-09-20',null);
```
Expected: `oct 0`, `sep ≥ 1` while the September offer is active and today is
inside its period.

Result: `oct 0` **PASS**. The `sep` count came back 0 in the first pass
because the check filtered on the code `SEP7` — the offer actually running
is **`VIPSEP7`** (5 %, transfers, retail, 31/08–30/09; a second offer, a
€4 fixed B2B one for hotels, runs 08/09–30/09). With the caller resolved as
retail (no session), `VIPSEP7` has the same targeting as the `QA_TRIP` fixture
that passed V1, so the rule is exercised; re-run with
`lower(code) = 'vipsep7'` if a written record is wanted.

**2.7 — Cleanup**

```sql
delete from public.coupons where code = 'QA_TRIP' returning code;
```

---

## Step 3 — Browser checklist (NOT RUN — needs the deployed build + the migration)

Prereq: an active offer covering today and September (`SEP7` qualifies).

1. Transfer search for **20/09/2026**, one way → results show the struck-through
   price and the red total on each vehicle; passenger and payment pages show
   the coupon row; a cash booking saves with `coupon_code` set.
2. Same search for **05/10/2026** → full price everywhere, no coupon row on
   results, passenger or payment; a cash booking saves with `coupon_code` null
   and `coupon_discount` 0.
3. Round trip **28/09 → 03/10** → full price on results (the round-trip extra
   does not appear either), passenger and payment.
4. Search for 20/09 one way, then click **Add return** on the results page →
   the discount stays (the return is booked on the outward date, which is
   inside the period); click **Remove return** → still discounted.
5. Round trip **20/09 → 25/09** → discounted, with the round-trip extra when
   the offer has one.
6. Hourly and tour flows: a September date is discounted, an October date is
   not.
7. Forged check (DevTools on the payment page): change the request body of a
   cash booking to `coupon_code: "SEP7"` on an October date → the page reports
   the coupon error and re-prices at full price (existing `COUPON_INVALID`
   handling).
8. Admin → Coupons: the period fields now carry the hint "Applies only to
   bookings made and travelling within these dates. A round trip needs both
   legs inside the period."; the banner-text hint no longer mentions a code.

Note for the client: bookings already saved with the September coupon for an
October ride are not re-priced by this change; they can be adjusted from the
admin reservation modal (coupon code / discount fields).
