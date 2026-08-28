# 2026-08-28 — Sales report (paid_at) smoke test journal

Branch: `feature/sales-report-paid-at`
Started: 2026-08-28

Method note: this pass had **no Supabase personal access token and no admin
browser login** available, so the migration was not applied to the live project
and no logged-in browser pass was possible. Everything that could be verified
without database access was verified and is recorded below; the database and
browser steps are recorded as **NOT RUN** with the exact commands and clicks a
human (or a later session with a token) should follow.

---

## Step 1 — Automated suite — **PASS**

`npm test`:

```
Test Files  6 passed (6)
     Tests  80 passed (80)
```

New coverage: `tests/sales-report.test.ts` (28) and four added `toAthensDate`
cases in `tests/booking-date.test.ts` (7 → 11). Existing suites unchanged:
`coupons` 11, `pricing` 6, `booking-filters` 17, `affiliate-ref` 7.

The report-specific assertions that matter most:

- a booking made in June, ridden in July and **paid in August** counts as August
  revenue and **not** July revenue;
- an unpaid booking for a ride **later this month** appears in Possible Incomes
  (the period end bound is the end of the month, not today);
- `paid_to_driver` counts as collected;
- a row flagged paid but with no `paid_at` is counted in neither figure;
- cancelled rides are dropped from every bucket;
- refunded / failed / `awaiting_payment` are reported as "not counted";
- breakdowns by method and vehicle are built from collected rows only.

## Step 2 — Type check — **PASS**

`npx astro check`: **42 errors**, 0 warnings, 18 hints.

Pre-existing baseline is 43. **Zero new errors**, and one fewer than baseline:
the old `sales.astro` closed `</AdminLayout>` twice (line 80 and line 288) and
that stray tag is gone.

## Step 3 — Build — **PASS**

`npm run build` completes; `/admin/sales` is emitted and the Vercel adapter
bundles without error.

## Step 4 — Dev server module load — **PASS**

`npm run dev`, then:

- `GET /admin/sales` → 200, markup contains the new "Total Revenue" and
  "Possible Incomes" cards;
- the page's client script (`sales.astro?astro&type=script&index=0&lang.ts`)
  → 200 and transforms to valid JS;
- `GET /src/lib/sales-report.ts` → 200, `GET /src/lib/booking-date.ts` → 200;
- dev server log clean, no errors.

This confirms the new modules bundle for the browser. It does **not** confirm
runtime behaviour against real data — see Step 5.

## Step 5 — Migration on the live database — **APPLIED, PASS**

`db/migrations/2026-08-28-paid-at.sql` was applied to the opaway project
(`wjqfcijisslzqxesbbox`) on 2026-08-28 via the Management API SQL endpoint, all
16 statements sent **one at a time** (a multi-statement batch returns the first
statement's result when the last yields no rows, which makes the outcome
unreadable). Every statement returned HTTP 201.

State immediately before the migration, for the record:

| table | rows | paid | paid_to_driver | pending | cancelled |
|---|---:|---:|---:|---:|---:|
| transfers | 228 | 196 | 4 | 28 | 0 |
| tours | 8 | 7 | 0 | 0 | 1 |
| experiences | 0 | 0 | 0 | 0 | 0 |

`paid_at` did not exist on any table beforehand.

**5a — every collected booking now has a payment date.** PASS.

| table | missing paid_at | stamped |
|---|---:|---:|
| transfers | 0 | 200 |
| tours | 0 | 7 |
| experiences | 0 | 0 |

**5b — the backfill used `created_at` with no drift.** PASS:
`select count(*) from public.transfers where paid_at is not null and paid_at <> created_at` → `0`.

**Triggers installed.** PASS — `trg_set_paid_at`, `BEFORE`, `INSERT+UPDATE`, on
all three of `transfers`, `tours` and `experiences`.

### 5c-5e — live trigger round-trip — **PASS**

Run on transfer `b1258312-fe92-40ae-8118-1b7d3887167b`, whose original state was
recorded first (`pending` / `new` / `paid_at` null) and restored at the end. The
sequence was issued as one uninterruptible batch so the row could not be left
mid-test.

| # | action | expected | observed |
|---|---|---|---|
| before | — | pending / new / null | pending / new / null |
| 5c | `payment_status` → `paid` | `paid_at` stamped with now() | `2026-08-28 19:00:59.17886+00`, `stamped_just_now = true` |
| 5e | `ride_status` → `assigned` | `paid_at` unchanged | `2026-08-28 19:00:59.17886+00` — identical |
| 5d | `payment_status` → `pending` | `paid_at` cleared | `null` |
| after | restore | pending / new / null | pending / new / null |

So the trigger stamps on the way in, survives unrelated edits (a payment date is
not rewritten every time a driver is assigned or a ride is completed), and clears
on the way out.

**Table-wide integrity after the test — unchanged**, no trace left:

| payment_status | rows | with paid_at |
|---|---:|---:|
| paid | 196 | 196 |
| paid_to_driver | 4 | 4 |
| pending | 28 | 0 |

## Step 6 — Browser pass as admin — **READY, NOT RUN**

Step 5 is applied, so the page loads against real data now. A dev server for this
branch runs at **`http://localhost:4324/admin/sales`** (port 4324 — 4321-4323 were
already taken by other branches' servers; the repo's main working directory is
checked out on a different branch, so the changes are only visible on 4324).

Still needs an admin login, which this session does not have. Steps:

1. `/admin/sales` loads; **Total Revenue** shows only paid money and **Possible
   Incomes** only unpaid — the two must not overlap, and neither should equal
   the old all-inclusive figure.
2. In `/admin/transfers`, switch an old booking (ride date in a past month) from
   Pending to **Paid**. Back on `/admin/sales` → This Month: its amount is now in
   Total Revenue, and it has left Possible Incomes. This is the bug being fixed:
   before, that money was filed under the month the booking was created.
3. Switch the same booking back to **Pending** → it leaves Total Revenue and
   returns to Possible Incomes.
4. As a driver, complete a cash or card-onsite ride → status becomes
   `paid_to_driver` and the fare appears in Total Revenue dated today.
5. Cancel a booking → it disappears from both figures. A refunded booking shows
   under the **Not counted** tab with its value in the caption under the cards.
6. Switch period to This Week / This Quarter / This Year / All Time; the caption
   next to the buttons shows the interval. Reload the page — the selected period
   and tab survive, because both are kept in the URL.
7. A Stripe test payment marks the booking paid via the webhook and appears in
   Total Revenue dated today, with no code change needed (the trigger stamps it).

## Known behaviour changes worth telling the admin about

- **Total Revenue is a smaller number than before.** It used to include every
  non-cancelled booking regardless of payment; it now includes only money
  actually received.
- **"This Week" is now Monday-Sunday** (the calendar week the label promises),
  where the old code used a rolling "last 7 days".
- **Historical payments are dated by `created_at`**, because no payment date was
  ever recorded for them. Only payments made from the migration onwards carry a
  true payment date, so month-over-month comparisons that cross that line are
  approximate for the older side.
- **Abandoned Stripe checkouts (`awaiting_payment`) are not expected income.**
  The booking row is written before the customer reaches Stripe, so counting
  them would inflate Possible Incomes with every abandoned cart. They appear
  under "Not counted".
