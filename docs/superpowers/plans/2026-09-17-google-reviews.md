# Google Reviews Implementation Plan

**Goal:** Show the client's Google Business Profile reviews on the homepage, with every new review approved first in the admin panel. Only approved reviews reach the site.

**Why:** The post-ride email already sends customers to the Google review page (`src/lib/email/templates/ride-review.ts`), so reviews accumulate on Google but never come back to the site. The client asked (2026-09-17) for them on the site, with an approval step.

**Decisions taken with the user:** source = Google Places API (key + Place ID, no owner login, no Google approval process); display = one homepage section; notification = pending-count badge in the admin sidebar.

**Architecture:** A daily Vercel cron (and a "Sync now" button) calls `/api/admin/sync-google-reviews`, which asks both Places endpoints (legacy `reviews_sort=newest`, New "most relevant" — five reviews each, that is Google's cap), normalises them into one shape, dedupes on contributor id + publish time, and inserts unseen reviews as `pending` through the service-role client. The admin flips rows to `approved` / `hidden` under RLS. The homepage (static) fetches approved rows through a `security definer` RPC, like the promo banner does for coupons.

**Tech Stack:** Astro 5 (static + Vercel adapter functions), Supabase Postgres RLS + RPC, Vercel Cron, Vitest.

## Decisions locked in

- **Both Places endpoints, merged.** Legacy is the only one that sorts by newest (what catches a new review); it is in "Legacy status" and may be unavailable on newer Cloud projects, so it is optional and its failure is recorded, not fatal. New always runs and adds the per-review Google Maps link.
- **Dedupe key = `contrib:<id>:<epoch>`** from the author's `google.com/maps/contrib/<id>` URL; `name:<slug>:<epoch>` fallback. Edits on Google keep the publish time, so they update the stored row instead of adding one.
- **Sync never touches `status`.** Only text / rating / photo / links / raw / `last_seen_at` are refreshed on a known review.
- **No public SELECT policy.** `get_public_reviews(p_limit)` and `get_public_reviews_meta()` are the only public window (approved rows, aggregate figures).
- **Section hidden until the first approval.** The homepage looks unchanged until the client approves something.
- **Review text is shown as written** (Google's attribution terms); the admin picks which reviews appear but cannot edit them. No JSON-LD `AggregateRating` (Google's self-serving-review rule).
- **Cron auth = `Authorization: Bearer <CRON_SECRET>`** (Vercel attaches it when the env var exists); the POST path uses the standard admin gate (`users.type = 'admin'`).

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `db/migrations/2026-09-17-google-reviews.sql` | `google_reviews`, `google_reviews_meta`, admin RLS, the two public RPCs, realtime publication |
| Create | `src/lib/google-reviews.ts` | Pure: normalisers, dedupe key, merge, request builder, `relativeTime`, `clampText` |
| Create | `src/pages/api/admin/sync-google-reviews.ts` | GET (cron) / POST (admin) sync route |
| Create | `vercel.json` | Daily cron at 05:00 UTC |
| Create | `src/lib/reviews.ts` | `fetchPublicReviews`, `fetchPublicReviewsMeta`, `GOOGLE_REVIEW_URL` |
| Create | `src/pages/admin/reviews.astro` | Summary + Sync now, Pending/Approved/Hidden/All tabs, Approve/Hide |
| Create | `src/components/ReviewsSection.astro` | Homepage section (EN/EL/ES), hidden until approved reviews exist |
| Modify | `src/pages/index.astro` | Section after `FeaturesSection` |
| Modify | `src/components/AdminLayout.astro`, `src/lib/notifications.ts` | Nav item + pending badge + realtime subscription |
| Modify | `src/lib/email/templates/ride-review.ts` | Uses the shared `GOOGLE_REVIEW_URL` |
| Modify | `.env.example`, `README.md` | `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`, `CRON_SECRET` |
| Create | `tests/google-reviews.test.ts`, `tests/reviews.test.ts` | Unit tests |
| Create | `qa/2026-09-17-google-reviews-smoke-test.md` | Verification journal |

## Tasks

- [x] Migration
- [x] Pure lib + tests (normalisers, dedupe, merge, requests, presentation helpers)
- [x] Sync route + `vercel.json`
- [x] Admin page + sidebar badge
- [x] Public lib + homepage section
- [x] Gates: `npm test`, `npm run build`, `npx astro check` delta 0
- [x] Apply the migration to prod (applied + verified 2026-09-17)
- [x] Add the three env vars in Vercel (Production); push + deploy (2026-09-17, first sync: 10 pending)
- [ ] Client approves reviews on `/admin/reviews`; section appears
- [ ] Browser checklist (journal Step 3)
