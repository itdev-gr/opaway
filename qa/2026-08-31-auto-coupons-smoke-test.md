# 2026-08-31 — Auto-applied coupons smoke test journal

Branch: `feature/auto-coupons`
Commit under test: `60b109d` — "feat: apply running coupon offers automatically,
with no code entry".

What changed: customers no longer type a coupon code anywhere. The new
`get_auto_coupons(p_flow)` RPC returns every offer the visitor qualifies for,
and each page applies whichever saves the most on the price it is showing.

Method: no dev server / browser session was available for this pass. Step 1 ran
in the repo. Step 2 needs the live project (`wjqfcijisslzqxesbbox`) and is
**BLOCKED** — see below. Browser checks are listed as **NOT RUN** with steps.

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

## Step 2 — DB-level checks — **BLOCKED**

The Supabase MCP server disconnected mid-session, so
`db/migrations/2026-08-31-auto-coupons.sql` has **not** been applied to prod and
none of the checks below have been run. Nothing else is blocked by this — the
migration is additive (one new function, no schema change) and no deployed page
calls it yet.

To run, with `QA_AUTO`-prefixed artifacts, one statement per call:
1. Apply the migration, then insert `QA_AUTO_PCT` (10%, all services/groups),
   `QA_AUTO_FIX` (fixed €20, tours only) and `QA_AUTO_OFF` (`active = false`).
2. `select * from public.get_auto_coupons('transfer');` → `QA_AUTO_PCT` only.
3. `select * from public.get_auto_coupons('tour');` → both live coupons, newest
   first; the closed one absent.
4. `update ... set applies_to_all_groups = false, groups = array['hotel']` on
   `QA_AUTO_PCT` → `get_auto_coupons('transfer')` returns nothing (the MCP
   connection has no `auth.uid()`, so it books as `retail`).
5. `update ... set valid_from = current_date + 5` → still nothing.
6. `delete from public.coupons where code like 'QA_AUTO%';` then
   `select count(*) ...` → `0`.

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
