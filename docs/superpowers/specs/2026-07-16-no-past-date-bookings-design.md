# No Past-Date Bookings — Design

**Date:** 2026-07-16
**Status:** Approved (user: "go", defaults accepted)

## Goal

Nobody — clients, guests, or admins — can create a booking with a date in the past, in any service: transfer, tour, hourly, experiences. Ferries and hotels are excluded (third-party booking engines, out of our control).

## Decisions

1. **Admins are blocked too** ("anyone" taken literally). The admin Add-booking modals get the same client-side rule. Escape hatch for retro-logging a ride: insert directly in Supabase.
2. **Date-level rule.** Booking *today* is always allowed regardless of time. Time-level cutoffs / minimum lead time are out of scope (possible follow-up).
3. **"Today" is Europe/Athens** everywhere — client and server. The business operates in Greece; the Vercel server runs UTC and would otherwise be up to ~3h lenient around midnight.
4. **Return date** (transfer round-trip) must also not be in the past, and not before the pickup date.

## Current state (mapped 2026-07-16)

- Booking rows are created by SECURITY DEFINER Postgres RPCs `create_transfer_booking` / `create_tour_booking` (`db/migrations/2026-05-04-guest-booking-rpcs.sql`). Date is a pass-through `YYYY-MM-DD` string — no validation.
- Two creation paths per service: cash → payment page calls the RPC directly from the browser; Stripe → payment page POSTs to `api/stripe/create-checkout-session.ts`, which calls the same RPC. The webhook never touches dates.
- Hourly bookings persist into `transfers` with `booking_type: 'hourly'` via the same RPC.
- Experiences insert an inquiry into `requests` client-side + fire an email; no booking table.
- Only two client-side past-date checks exist (book/transfer.astro:386-397, book/hourly.astro:307-318), in browser-local time; all other 10 date inputs have no check and no `min`. Dates travel as URL query params, so those two checks are bypassable by URL editing or the home widget.

## Design — chosen approach: client + server enforcement

Layered: UI for UX, server for enforcement. (Rejected: client-only — trivially bypassed; DB triggers — blocks legitimate manual SQL retro-entries for no real gain over RPC checks, since all app paths go through the RPCs.)

### 1. Shared util — `src/lib/booking-date.ts` (new)

- `todayAthens(): string` — today's `YYYY-MM-DD` in Europe/Athens (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' })`).
- `isPastBookingDate(date: string): boolean` — lexicographic compare against `todayAthens()` (works for `YYYY-MM-DD`).
- Vitest unit tests in `tests/` (TDD), following the existing `booking-filters.test.ts` pattern.

### 2. UI layer — all 12 date inputs

Set `input.min = todayAthens()` on load, and validate on submit with the existing per-page error UX and i18n pattern ("Please select a future date" style, EL/ES variants like neighbouring messages):

| File | Input(s) |
|---|---|
| `src/components/BookingSection.astro` | `#tf-date`, `#tf-return-date`, `#hourly-date`, `#tours-date` |
| `src/pages/book/transfer.astro` | `#tf-date` (check exists — switch to shared util), `#tf-return-date` (add: not past, ≥ pickup) |
| `src/pages/book/tour.astro` | `#tour-date` |
| `src/pages/book/hourly.astro` | `#h-date` (check exists — switch to shared util) |
| `src/pages/experiences.astro` | `#experience-date` |
| `src/pages/admin/transfers.astro` | `#tf-date` (Add modal) |
| `src/pages/admin/tours.astro` | `#to-date` (Add modal) |
| `src/pages/admin/experiences.astro` | `#ex-date` (Add modal) |

### 3. API layer — `src/pages/api/stripe/create-checkout-session.ts`

Reject with 400 (`error: 'BOOKING_DATE_PAST'`) when `booking.date` is missing/malformed/past, or when `booking.return_date` is present and past or before `booking.date`. Runs before the RPC call so Stripe users get a clean early error.

### 4. DB layer — new migration `db/migrations/2026-07-16-block-past-booking-dates.sql`

`CREATE OR REPLACE` both RPCs (`create_transfer_booking`, `create_tour_booking`) adding, before insert:

- `date` must match `YYYY-MM-DD` and satisfy `date::date >= (now() AT TIME ZONE 'Europe/Athens')::date`, else `RAISE EXCEPTION 'BOOKING_DATE_PAST'`.
- Same for `return_date` when present/non-empty, plus `return_date >= date`.

Applied to the live Supabase project via MCP `apply_migration`. This is the enforcement point for **both** cash (direct RPC from browser) and Stripe paths, covering transfer, hourly, and tour.

### Error handling

- UI: inline form error, no navigation.
- API: 400 JSON, payment page surfaces its existing error UI.
- RPC: raised exception → supabase-js error on the cash path; payment pages show their existing failure message. (Generic message is acceptable — a user only hits this path by tampering.)

## Accepted gaps (non-goals)

- **Experiences `requests` insert** happens client-side with the anon key; it gets the UI block, but a determined attacker could still insert a past-date *inquiry* (not a booking; admin triages `requests` anyway). Closing this needs a DB trigger — deliberately skipped.
- Admin bypass via devtools/SQL is a non-threat (admins have Supabase access anyway).
- No minimum lead time / same-day time cutoff.
- Ferries & hotels pages untouched.

## Testing

1. Unit: `booking-date` util (today, past, future, malformed, month/year boundaries).
2. Existing suite stays green (`npm test`), build passes.
3. Live after deploy: each service's form rejects yesterday; URL-tampered payment deep-link fails at RPC/API; admin modals reject past dates; today + future dates still book normally.

## Rollout

Code → push to `main` (Vercel auto-deploys). Migration → Supabase MCP `apply_migration` at the same time. Order: migration first, then code (RPC change is backward-compatible — old clients just gain server rejection of past dates).
