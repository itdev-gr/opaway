# Coupon Offer Rules Implementation Plan

**Goal:** Three client requests on the offers system: the promo banner sends the visitor to the booking page of the offer's service; a transfer offer can target one-way rides only, round trips only, or both; and the period the offer can be booked in is separate from the travel dates it covers (early-booking offers).

**Why:** Client feedback 17/09/2026 after the trip-date fix. Early-booking offers (book in September, travel in October) were impossible because one date range served both purposes; a September offer for round trips only had to discount one-way rides too; and the banner always landed on `/book`.

**Architecture:** One migration adds `travel_from` / `travel_until` (backfilled from `valid_*`) and `trip_scope` to `coupons`, and rewrites the two coupon RPCs so that *today* is checked against the offer period and the ride/return dates against the travel period, with the trip-scope predicate on the transfer flow. `get_promo_banner()` also returns the offer's services; a pure `promoBannerHref()` maps one service to its booking page. The admin form gets the two date ranges and a trip-type radio. The client pricing code is untouched apart from the transfer results page always asking for the round-trip offer set with a return date.

## Decisions locked in

- **`valid_from..valid_until` = offer (booking) period**, kept as the column names to avoid a rename across admin, banner and status logic. **`travel_from..travel_until` = travel period.** Existing coupons get travel = valid.
- **`trip_scope` is transfer-only.** Hourly and tour bookings ignore it (`p_flow <> 'transfer'` short-circuits the predicate).
- **`return_extra_value` keeps its meaning** (added on top for round trips). A round-trip-only offer puts its whole discount in `discount_value`; a one-way-only offer cannot carry an extra (validation).
- **Validation guards nonsense**: travel end before travel start; travel dates ending before the offer opens; trip type on an offer that excludes transfers.
- **Banner href**: exactly one service → `/book/<flow>`; all or several → `/book`.
- **Transfer results page** fetches the round-trip set with `returnDate || date`, because a round-trip-only offer only comes back when a return date is passed.

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-09-17-coupon-offer-rules.sql` | Columns + backfill + constraints; `get_auto_coupons` / `validate_coupon` rewritten; `get_promo_banner` drop + create with `applies_to_all, flows` |
| Modify | `src/lib/coupons.ts` | `TripScope`, `CouponFields` (+3), `validateCouponFields` rules, `TRIP_SCOPE_LABEL` |
| Modify | `src/lib/promo-banner.ts` | `promoBannerHref`, `PromoBanner.href` |
| Modify | `src/components/PromoBanner.astro` | "Book now" anchors take `promo.href` |
| Modify | `src/pages/book/transfer/results.astro` | Round-trip offer set always fetched with a return date |
| Modify | `src/pages/admin/coupons.astro` | Trip type radios, offer period + travel dates (with "Same as offer period"), list shows both ranges and the scope |
| Modify | `tests/coupons.test.ts`, `tests/promo-banner.test.ts` | New rules and href mapping |
| Create | `qa/2026-09-17-coupon-offer-rules-smoke-test.md` | Gates, DB checks, browser checklist |

## Tasks

- [x] Migration
- [x] Lib + tests (198/198)
- [x] Banner + results page
- [x] Admin form / modal / list / payloads
- [x] Gates: build, `astro check` delta 0
- [ ] Apply the migration to prod, then push; live checks (journal Step 3)
