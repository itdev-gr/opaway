# 2026-09-17 — Google reviews: smoke test journal

Branch: `feature/google-reviews`.

What changed: reviews from the client's Google Business Profile are pulled
into `google_reviews` (daily cron + admin "Sync now"), approved one by one on
`/admin/reviews`, and the approved ones show in a new homepage section.

Method: Step 1 ran in the repo. Step 2 ran against prod
(`wjqfcijisslzqxesbbox`) through the Management API SQL endpoint, one
statement per call, executed by the user from the session right after the
migration was applied the same way (2026-09-17; no token in this journal).
Step 3 ran on 2026-09-17 after the env vars were added to Vercel
(Production) and `main` was pushed. Step 4 needs an admin login for the
approve/hide part, so it stays **NOT RUN** except where noted.

---

## Step 1 — Automated gates

`npm test`:

```
Test Files  12 passed (12)
     Tests  189 passed (189)
```
189/189, up from `main`'s 164: `tests/google-reviews.test.ts` (18 cases —
contributor id, both normalisers, dedupe key, merge, meta, the exact Places
requests, `relativeTime`, `clampText`) and `tests/reviews.test.ts` (7 cases —
the two public fetchers and the review URL). **PASS.**

`npm run build`: completes (Astro + Vercel adapter); the new page, section
and API route compile. **PASS.**

`npx astro check`: 42 errors, identical to `main`'s baseline. **Zero new
errors. PASS.**

---

## Step 2 — DB checks (after applying `db/migrations/2026-09-17-google-reviews.sql`)

**2.1 — Objects, RLS, grants**

```sql
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('google_reviews','google_reviews_meta');
select policyname, tablename from pg_policies where tablename in ('google_reviews','google_reviews_meta');
select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
       array(select r.rolname from pg_roles r where has_function_privilege(r.rolname, p.oid, 'execute') and r.rolname in ('anon','authenticated'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('get_public_reviews','get_public_reviews_meta');
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='google_reviews';
select id, last_sync_at from public.google_reviews_meta;
```
Expected: both tables `rowsecurity = true`; one "Admins manage …" policy
each; both RPCs `prosecdef = true`, grantees `{anon,authenticated}`;
`google_reviews` in the realtime publication; meta row `id = 1` present.

```
table    google_reviews        rowsecurity=true
table    google_reviews_meta   rowsecurity=true
policy   Admins manage google_reviews / Admins manage google_reviews_meta
rpc      get_public_reviews(p_limit integer)   secdef=true grantees={authenticated,anon}
rpc      get_public_reviews_meta()             secdef=true grantees={authenticated,anon}
realtime google_reviews  supabase_realtime
meta-row 1  last_sync_at=never
```
**PASS.**

**2.2 — Only approved rows leave the RPC**

```sql
insert into public.google_reviews (dedupe_key, author_name, rating, text, published_at, status) values
  ('qa:1', 'QA Pending',  5, 'pending',  now() - interval '1 day', 'pending'),
  ('qa:2', 'QA Approved', 4, 'approved', now() - interval '2 day', 'approved'),
  ('qa:3', 'QA Hidden',   3, 'hidden',   now() - interval '3 day', 'hidden');
select author_name from public.get_public_reviews(12);              -- expect only QA Approved (plus any real approved rows)
select approved_count from public.get_public_reviews_meta();        -- expect 1 (+ real approved rows)
set role anon; select count(*) from public.google_reviews; reset role; -- expect a permission error / 0 rows (no public policy)
delete from public.google_reviews where dedupe_key like 'qa:%';
```
```
V1 rpc rows                  | QA Approved      (pending and hidden rows absent)
V2 meta approved_count       | 1
V3 get_public_reviews(0)     | 1 row            (limit clamped to >= 1)
anon: select count(*) from google_reviews | 0   (no public policy; RLS hides every row)
cleanup                      | qa:1, qa:2, qa:3 deleted
```
**PASS.**

---

## Step 3 — Sync route (after the env vars are set and the deploy is live)

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://www.opawey.com/api/admin/sync-google-reviews
# expect {"ok":true,"new":N,"seen":M,"errors":[...]} — "legacy: REQUEST_DENIED" in errors is fine if the Cloud project has no legacy Places access
curl -s -o /dev/null -w '%{http_code}\n' https://www.opawey.com/api/admin/sync-google-reviews            # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://www.opawey.com/api/admin/sync-google-reviews    # expect 401
```
Vercel dashboard → project → Cron Jobs: `/api/admin/sync-google-reviews`
listed with schedule `0 5 * * *`.

Results (Place ID `ChIJ93NeVc29oRQRC-MF9nS9pAY`, business rating 5.0 with
58 reviews on Google at the time):

```
GET  no auth            → 401
GET  wrong secret       → 401
POST no auth            → 403
GET  with CRON_SECRET   → {"ok":true,"new":10,"seen":10,"errors":[]}   (first sync: 5 newest + 5 most relevant, no overlap; both endpoints answered)
GET  again              → {"ok":true,"new":0,"seen":10,"errors":[]}    (idempotent)
```
**PASS.** (Cron Jobs listing in the dashboard not eyeballed in this pass.)

---

## Step 4 — Browser checklist

1. `/admin/reviews` as admin: summary card shows the Google rating and total
   after the first sync; **Sync now** reports "N new, M seen"; the Pending
   tab lists them; the sidebar badge next to *Google Reviews* shows N.
2. Approve two reviews, hide one: pills change, the badge drops, the
   "approved on the site" counter updates.
3. Homepage (logged out): the "What our customers say" section appears after
   `FeaturesSection` with exactly the approved reviews, newest first, author
   photo/initial, stars, relative date, Google mark, "See all reviews on
   Google" (when the place URL is known) and "Write a review".
4. Long review: "Read more" expands it in place.
5. Switch EL / ES in the navbar: heading, subheading, buttons and the
   "Sorted by newest" note translate; card dates follow the language.
6. Mobile width: cards scroll horizontally with snap; no horizontal page
   scroll.
7. Hide every approved review → the section disappears from the homepage.
8. Post-ride email still links to the Google review page (the URL now comes
   from `src/lib/reviews.ts`).

Result: items 1–2 and 4–8 **NOT RUN** (admin login needed). Checked as a
guest on the live site after the first sync: the homepage renders the
section node hidden with zero cards (10 pending, 0 approved), and
`/admin/reviews` redirects to `/login`. **PASS** for the "hidden until
approved" rule.
