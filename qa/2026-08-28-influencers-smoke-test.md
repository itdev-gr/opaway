# 2026-08-28 — Influencer referral attribution smoke test journal

Branch: `feature/influencers`
Started: 2026-08-28
Method: no dev server / browser session was available for this pass. Server-side
checks (Step 2 below) were run directly against the live Supabase project
(`wjqfcijisslzqxesbbox`) via the Management API SQL endpoint, using a future
booking date (2026-09-20) and influencer codes prefixed `qa_inf2_` /
`QA_INF2_` for unambiguous cleanup. Browser-only checks are recorded as
**NOT RUN** with concrete steps for a human to follow (see Step 2b).

This is a deliberate adaptation of the task brief's Step 2 (which assumes a
dev server + admin browser login) — the honesty rule for this journal is that
it states exactly what was and wasn't verified, and how.

---

## Step 1 — Automated suite

`npm test`:

```
Test Files  5 passed (5)
     Tests  48 passed (48)
```
All 48/48 Vitest tests pass, including the new `tests/influencer-ref.test.ts`
(7 tests) alongside `tests/pricing.test.ts` (6), `tests/coupons.test.ts` (11),
`tests/booking-filters.test.ts` (17), `tests/booking-date.test.ts` (7).
**PASS.**

`npx astro check`:

```
Result (151 files):
- 43 errors
- 0 warnings
- 18 hints
```
43 errors — matches the pre-existing baseline (all in unrelated files:
`Layout` prop typing on `.astro` pages, `google` global not typed on
`transfer/results.astro`, implicit-any callback params). No new errors
introduced by the influencer-referral feature. **PASS.**

---

## Step 2 — Server-side regression checks (via Supabase Management API SQL)

All queries below ran with the Management API SQL endpoint
(`POST /v1/projects/wjqfcijisslzqxesbbox/database/query`); the access token
used to authenticate is not reproduced here or anywhere in this repo.

Setup — two test influencers created (one active percent-10, one inactive):

```sql
insert into public.influencers (name, ref_code, commission_type, commission_value)
values ('QA Regression', 'qa_inf2_pct', 'percent', 10) on conflict do nothing;

insert into public.influencers (name, ref_code, commission_type, commission_value, active)
values ('QA Regression Off', 'qa_inf2_off', 'percent', 10, false) on conflict do nothing;
```

Both inserts succeeded (`[]`, no conflict).

Verified `TEST10` still exists in prod before check 3: percent 10,
`applies_to_all=true`, `active=true`, `valid_until=2026-09-25` — no
substitute coupon needed.

### 1. Percent attribution — PASS

```sql
select public.create_transfer_booking('{"date":"2026-09-20","time":"10:00","from":"A","to":"B",
  "email":"qa-inf2@test.local","total_price":45,"influencer_code":"QA_INF2_PCT"}'::jsonb);
```

Observed: returned a uuid (`48712885-e980-41d6-9c15-c61ad4e556ec`). Selecting
that row from `public.transfers` showed:

```
{"id":"48712885-...","email":"qa-inf2@test.local","influencer_code":"qa_inf2_pct",
 "influencer_commission":"4.50","influencer_id":"dc71777b-227f-4d09-a02f-a6d15c750cc8","total_price":"45"}
```

Uppercase input code `QA_INF2_PCT` was matched case-insensitively and stored
in canonical (lowercase) casing `qa_inf2_pct`; `influencer_commission=4.50`
(10% of 45); `influencer_id` set to the influencer's row id. **PASS.**

### 2. Inactive code ignored silently — PASS

```sql
select public.create_transfer_booking('{"date":"2026-09-20","time":"10:00","from":"A","to":"B",
  "email":"qa-inf2@test.local","total_price":45,"influencer_code":"qa_inf2_off"}'::jsonb);
```

Observed: returned a uuid (`0c71bfc7-c60e-427f-aa09-5bed0a96f701`) — booking
succeeded despite the referral code belonging to an inactive influencer.
Selecting that row showed:

```
{"id":"0c71bfc7-...","email":"qa-inf2@test.local","influencer_code":null,
 "influencer_commission":"0","influencer_id":null,"total_price":"45"}
```

`influencer_code`/`influencer_id` are `null` and `influencer_commission` is
`0` — the inactive code was silently ignored rather than rejecting the
booking or attributing commission. **PASS.**

### 3. Coupon + referral compose — PASS

```sql
select public.create_transfer_booking('{"date":"2026-09-20","time":"10:00","from":"A","to":"B",
  "email":"qa-inf2@test.local","coupon_code":"TEST10","coupon_discount":4.5,
  "total_price":40.5,"influencer_code":"qa_inf2_pct"}'::jsonb);
```

Observed: returned a uuid (`a9f61311-689c-4506-bcfa-72be3d9c5ec8`). Selecting
that row showed:

```
{"id":"a9f61311-...","email":"qa-inf2@test.local","coupon_code":"TEST10",
 "influencer_code":"qa_inf2_pct","influencer_commission":"4.05",
 "influencer_id":"dc71777b-227f-4d09-a02f-a6d15c750cc8","total_price":"40.5"}
```

`coupon_code='TEST10'` and `influencer_commission=4.05` — 10% of the
already-discounted total (40.50), confirming referral commission is computed
on the post-coupon total, not the pre-discount price. **PASS.**

### Cleanup performed

```sql
delete from public.transfers where email = 'qa-inf2@test.local';
delete from public.influencers where ref_code like 'qa_inf2_%';
```

Verification after cleanup:

```sql
select count(*) from public.transfers where email = 'qa-inf2@test.local';   -- {"count":0}
select count(*) from public.influencers where ref_code like 'qa_inf2_%';    -- {"count":0}
```

Both counts `0` — no leftover test booking rows or test influencer rows.
**PASS.**

### Demo influencer created for manual QA

Checked first: no `ref_code='demo10'` row existed. Created it and **left it
in place** for the Step 2b manual pass below:

```sql
insert into public.influencers (name, ref_code, commission_type, commission_value, active)
values ('Demo Influencer', 'demo10', 'percent', 10, true) on conflict do nothing;
```

Resulting row:

```
{"id":"40bf7642-9a02-4800-9a1b-79e13c6dd35d","name":"Demo Influencer","email":"",
 "phone":"","ref_code":"demo10","commission_type":"percent","commission_value":"10",
 "active":true,"created_at":"2026-08-28 12:23:02.550304+00"}
```

---

## Step 2b — Browser-only checks: NOT RUN, deferred to manual QA

No dev server or admin browser session was available in this environment.
The following require a human with a running `npm run dev` server, the
`demo10` referral link, and an admin login. **None of the items below were
exercised in this pass — treat them as open until a human runs them.**

1. Visit `/?ref=demo10`, navigate to a transfer booking, pay cash → the
   booking row in Supabase carries `influencer_code='demo10'` and 10%
   commission; `/admin/influencers` shows it under Demo Influencer with
   correct totals.
2. The Copy-link button copies `<origin>/?ref=demo10`.
3. Click-to-edit Rate cell updates commission for future bookings only.
4. Close (deactivate) Demo Influencer → a fresh booking via the link is NOT
   attributed.
5. A booking made with both `TEST10` coupon and the demo ref link records
   both, commission computed on the discounted total.

---

## Summary

| # | Check | Result |
|---|---|---|
| 1 | `npm test` (48/48) | PASS |
| 2 | `npx astro check` (43 baseline, 0 new) | PASS |
| 3 | Percent attribution, canonical casing, 45 → 4.50 commission | PASS |
| 4 | Inactive code ignored silently (booking succeeds, no attribution) | PASS |
| 5 | Coupon + referral compose (`TEST10` + 10%, 40.50 → 4.05 commission) | PASS |
| 6 | Cleanup verified (0 leftover test rows) | PASS |
| 7 | Demo influencer (`demo10`) created and left in place | PASS |
| 2b.1 | `/?ref=demo10` end-to-end booking attribution + admin totals | NOT RUN — deferred |
| 2b.2 | Copy-link button copies `<origin>/?ref=demo10` | NOT RUN — deferred |
| 2b.3 | Click-to-edit Rate cell affects future bookings only | NOT RUN — deferred |
| 2b.4 | Deactivating Demo Influencer stops attribution | NOT RUN — deferred |
| 2b.5 | Coupon + referral combined at checkout | NOT RUN — deferred |

7 of 7 automated/DB-level checks PASS. 5 browser-only checks NOT RUN
(deferred to manual QA with steps above). 0 FAIL.
