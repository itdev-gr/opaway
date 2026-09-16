# Coupons Tied to the Travel Date Implementation Plan

**Goal:** A coupon discounts a booking only when the trip itself travels inside the coupon's period — the ride date, and for a round-trip transfer the return date too — on top of the existing rule that the booking is made inside the period. An October ride booked in September no longer gets the September offer.

**Why:** Client report (16/09/2026): a customer booked an October transfer during September and received the September coupon (`SEP7`, 30/08–30/09). The offer exists to fill the running month's free slots, not to discount future months. Until now every coupon check asked only whether *today* (Europe/Athens) was inside `valid_from..valid_until`; nothing looked at the trip date.

**Architecture:** The rule lives in SQL, in the two public coupon RPCs, and the client only passes the dates it already parses from the URL. `get_auto_coupons(p_flow, p_date, p_return_date)` is what every booking page prices with; `validate_coupon(p_code, p_flow, p_date, p_return_date)` is what `create_transfer_booking` / `create_tour_booking` re-check at insert time on both the cash and the Stripe path. A missing `p_date` yields no coupon (fail closed), so a stale client build gets full price rather than a wrong discount. `get_auto_coupons` still exposes only the five pricing columns.

**Tech Stack:** Astro 5 booking pages (browser-side pricing), Supabase Postgres SECURITY DEFINER RPCs, Vitest.

## Decisions locked in

- **Both legs of a round trip must be inside the period.** A trip 28/09 → 03/10 gets no coupon at all; letting the outward date alone decide would let October rides through the back door, which is exactly the complaint.
- **The "today" check stays.** The client asked for the discount to be tied to the booking period *and* the travel period.
- **One source of truth in SQL.** No client-side date filtering, so the price shown and the price accepted at booking can never disagree.
- **Old overloads are dropped, not kept.** `get_auto_coupons(text)` / `validate_coupon(text, text)` are removed first; keeping them next to the defaulted 3/4-arg versions would make the call ambiguous for PostgREST.
- **The promo banner is untouched.** It advertises the running offer site-wide; the admin's `banner_text` is where the travel period is described (the admin hint now says so).
- **Admin booking edits do not re-price.** Moving a booked ride's date in the reservation modal leaves `coupon_code` / `coupon_discount` as they were (unchanged behaviour, editable by hand).

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-09-16-coupon-trip-dates.sql` | Drop + re-create both coupon RPCs with `(p_date, p_return_date)`; re-create the booking RPCs from the influencers bodies with only the `validate_coupon` call changed |
| Modify | `src/lib/coupons.ts` | `fetchAutoCoupons(flow, tripDate, returnDate = '')` passes `p_date` / `p_return_date`; no trip date → `[]` |
| Modify | `src/pages/book/transfer/results.astro` | Two offer sets (one-way / round-trip); "Add return" flips between them |
| Modify | `src/pages/book/transfer/{passenger,payment}.astro` | Pass `date` and, for a round trip, `returnDate` |
| Modify | `src/pages/book/{hourly,tour}/{results,passenger,payment}.astro` | Pass `date` |
| Modify | `src/pages/admin/coupons.astro` | Hint under the period fields; banner-text hint no longer mentions a code |
| Modify | `tests/coupons.test.ts` | `fetchAutoCoupons` date cases |
| Create | `qa/2026-09-16-coupon-trip-dates-smoke-test.md` | Gates, DB verification SQL, browser checklist |

## Tasks

- [x] Migration written; RPC bodies diffed against `2026-08-28-influencers.sql` (only the two `validate_coupon` calls differ)
- [x] `fetchAutoCoupons` signature + nine call sites
- [x] Admin copy
- [x] Tests: 164/164; build OK; `astro check` 42 = baseline
- [ ] Apply the migration to prod `wjqfcijisslzqxesbbox` and run the journal's Step 2 SQL
- [ ] Deploy; browser checklist (journal Step 3)
- [ ] Reword `SEP7`'s `banner_text` to state the travel dates
