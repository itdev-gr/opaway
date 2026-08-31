# 2026-08-31 — Auto-applied coupons smoke test journal

Branch: `feature/auto-coupons`
Commit under test: `60b109d` — "feat: apply running coupon offers automatically,
with no code entry".

What changed: customers no longer type a coupon code anywhere. The new
`get_auto_coupons(p_flow)` RPC returns every offer the visitor qualifies for,
and each page applies whichever saves the most on the price it is showing.

Method: no dev server / browser session was available for this pass. Step 1 ran
in the repo; Step 2 ran against the live project (`wjqfcijisslzqxesbbox`)
through the Management API SQL endpoint. Browser checks are listed as **NOT
RUN** with steps.

---

## Step 1 — Automated gates

`npm test`:

```
Test Files  10 passed (10)
     Tests  151 passed (151)
```
151/151 pass, up from `main`'s 138: `tests/coupons.test.ts` goes 16 → 28 (six
`bestCouponFor` cases and six over the `fetchAutoCoupons` RPC wrapper) and
`tests/promo-banner.test.ts` 6 → 7 (a row with no code, now that the code is
not part of the banner's contract). **PASS.**

`npm run build` also completes cleanly (Astro + the Vercel adapter), which
exercises the rewritten `.astro` templates the type-check alone does not.

The six `bestCouponFor` cases cover: an empty offer list; a single offer; a fixed coupon
beating a percent one at €100 and losing at €300 (the case that forces the
choice to be made per price rather than once per page); the round-trip extra
flipping the winner; nothing being picked when every discount floors to 0 at
the €1 minimum; and a tie keeping the RPC's newest-first order. The six
`fetchAutoCoupons` cases cover the flow it asks for, numeric normalisation of
the rows, dropping an id-less row, and the three empty paths (no offer, RPC
error, thrown request) each leaving prices at full price.

`npx astro check` (branch):

```
Result (165 files):
- 42 errors
- 0 warnings
- 18 hints
```
42 errors — identical to `main`'s baseline measured in the same pass, so **zero
new errors**. (An interim run showed 43: a leftover `refreshCouponStatus()`
call on the round-trip toggle, removed before the commit.) **PASS.**

---

## Step 2 — DB-level checks

`db/migrations/2026-08-31-auto-coupons.sql` was **applied to prod**
(`wjqfcijisslzqxesbbox`) via the Management API SQL endpoint; no token appears
in this journal. Artifacts prefixed `QA_AUTO`, one statement per call.

**2.1 — The function exists, security definer, callable by visitors**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
       array(select r.rolname from pg_roles r
             where has_function_privilege(r.rolname, p.oid, 'execute')
               and r.rolname in ('anon','authenticated')) as grantees
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_auto_coupons';
```

```
get_auto_coupons | p_flow text | prosecdef = true | {authenticated,anon}
```
**PASS.**

**2.2 — Fixtures**

`QA_AUTO_PCT` (10%, all services, all groups), `QA_AUTO_FIX` (fixed €20, tours
only) and `QA_AUTO_OFF` (50%, `active = false`) inserted, all inside today's
date window.

**2.3 — Service targeting**

```sql
select code, discount_type, discount_value, return_extra_value from public.get_auto_coupons('transfer');
```

```
QA_AUTO_PCT | percent | 10 | 0
SEP7        | percent |  7 | 0
```

```sql
select code, discount_type, discount_value from public.get_auto_coupons('tour');
```

```
QA_AUTO_PCT | percent | 10
QA_AUTO_FIX | fixed   | 20
```
The tours-only coupon appears on `tour` and not on `transfer`; the closed one
appears on neither; the all-services one appears on both. `SEP7` is the site's
real running September offer (transfers, retail) and correctly shows only on
`transfer`. **PASS.**

Note on ordering: the three fixtures were inserted in one statement, so they
share a `created_at` to the microsecond and the RPC's `order by created_at desc`
cannot separate them. That is harmless — the client ranks by the amount saved
and only falls back to this order on an exact monetary tie — but it means the
ordering itself is not what this run proves.

**2.4 — Customer-group targeting**

```sql
update public.coupons set applies_to_all_groups = false, groups = array['hotel'] where code = 'QA_AUTO_PCT';
select code from public.get_auto_coupons('transfer') where code like 'QA_AUTO%';
```

```
(no rows)
```
The Management API connection carries no `auth.uid()`, so it resolves as a
guest/`retail` caller — and a hotel-only coupon is correctly withheld from it.
**PASS.**

**2.5 — Date window, both directions**

```sql
update public.coupons set applies_to_all_groups = true, groups = '{}', valid_from = current_date + 5 where code = 'QA_AUTO_PCT';
select code from public.get_auto_coupons('transfer') where code like 'QA_AUTO%';   -- scheduled for later

update public.coupons set valid_from = current_date - 20, valid_until = current_date - 1 where code = 'QA_AUTO_PCT';
select code from public.get_auto_coupons('transfer') where code like 'QA_AUTO%';   -- already expired
```

```
(no rows)
(no rows)
```
**PASS.**

**2.6 — Cleanup**

```sql
delete from public.coupons where code like 'QA_AUTO%';
select count(*) from public.coupons where code like 'QA_AUTO%';
```

```
count = 0
```
**PASS.** Live state afterwards: `get_auto_coupons` returns `SEP7` on
`transfer` and nothing on `hourly`/`tour` — matching that offer's targeting.

---

## Step 3 — Browser checks — **NOT RUN**

With one active 10% coupon (all services, all customers):

1. `/book/transfer/results` — every vehicle card shows the struck-through
   original and the red discounted total, with **no coupon box anywhere** on
   the page. The sidebar shows a "Discount −€X" line and a red Total.
2. Toggle the return leg on a coupon that has a round-trip extra: the cards
   re-price and the extra is included.
3. Continue to passenger → payment: the total matches the card, the payment
   summary shows the same "Discount" line, and the saved booking row carries
   `coupon_code` and `coupon_discount`.
4. Same walk-through for a tour and for an hourly hire, including the tour's
   entrance-ticket count changing the discount live.
5. Two active coupons (10% and a fixed €20): cheap vehicles take the €20, the
   expensive ones take the 10%.
6. A tour-only coupon shows on tour prices and leaves transfers alone; a
   hotel-only coupon shows for a logged-in approved hotel partner and not for a
   guest.
7. Close the coupon in `/admin/coupons`, reload: full prices everywhere.
8. Close the coupon while a payment page is open, then Complete Booking: the
   form says the offer has ended, the price updates, and a retry books at the
   full price.
9. The promo bar still shows its message, with **no code** in it.

---

## Follow-up found during this run

The live `SEP7` offer's `banner_text` ends with *"Enter code SEP7 before
choosing your vehicle"* — an instruction that stops making sense the moment
this branch is deployed, since there is nowhere left to enter it. The copy is
admin-editable (`/admin/coupons`, the Banner column); it needs rewording before
or with the deploy. Flagged to the user rather than changed here: it is live
marketing copy, not a test artifact.
