# Allow Guest Bookings (transfer / hourly / tour) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forcing guests to log in before completing a transfer / hourly / tour booking. The payment step already says "Allow guest bookings" and the schema already accepts `user_id = NULL`, but the **passenger** step in all three booking flows currently redirects unauthenticated users to `/login`. Removing that redirect makes the entire flow work end-to-end for guests, matching the way the experiences-request form already behaves.

**Architecture:** Three near-identical Astro pages each ship an immediately-invoked async function (IIFE) that calls `supabase.auth.getSession()` and bounces to `/login?next=…&reason=booking` when no session is found. The fix is to delete that IIFE in each file. The form on each passenger page already collects first name / last name / email / phone — so the next step (payment) gets everything it needs from the URL params + form fields, and the existing `onAuthStateChange` listener (which auto-fills the form when a session does exist) is left in place as a convenience for already-logged-in users.

**Tech Stack:** Astro 5, Supabase JS client, vanilla TypeScript.

**Smoke-test confirmation (before fix):**

| Page | URL | Behavior for guest |
|---|---|---|
| `/book/transfer` | search → results | ✅ works |
| `/book/transfer/results` | pick a vehicle | ✅ works |
| **`/book/transfer/passenger`** | open form | ❌ instant redirect to `/login` |
| `/book/transfer/payment` | pay | ✅ already accepts guest (commented as such) |
| Same for `/book/hourly/*` and `/book/tour/*` | | ❌ same gate |

**The single line of evidence (`grep -rn '/login' src/pages/book/`):**

```
src/pages/book/transfer/passenger.astro:280: window.location.href = `/login?next=${next}&reason=booking`;
src/pages/book/hourly/passenger.astro:191:   window.location.href = `/login?next=${next}&reason=booking`;
src/pages/book/tour/passenger.astro:268:     window.location.href = `/login?next=${next}&reason=booking`;
```

These three lines (and the IIFE wrapping each) are the entire problem.

---

## File Structure

Three single-block deletions in three sibling files:

- `src/pages/book/transfer/passenger.astro` — remove the IIFE on lines 276–282
- `src/pages/book/hourly/passenger.astro` — remove the IIFE on lines 187–193
- `src/pages/book/tour/passenger.astro` — remove the IIFE on lines 264–270

No other files change. No new dependencies. No schema changes (the `transfers` / `hourly_bookings` / `tour_bookings` tables already accept `user_id = NULL` based on the payment-page comment + the existing experiences-request flow).

---

## Task 1: Remove the auth gate on the transfer passenger page

**Files:**
- Modify: `src/pages/book/transfer/passenger.astro:273-283`

- [ ] **Step 1: Delete the redirect IIFE**

In `src/pages/book/transfer/passenger.astro`, find this exact block (it's the first `(async () => { … })();` immediately after the `import { supabase }` line):

```ts
	(async () => {
		const { data: { session } } = await supabase.auth.getSession();
		if (!session?.user) {
			const next = encodeURIComponent(window.location.pathname + window.location.search);
			window.location.href = `/login?next=${next}&reason=booking`;
		}
	})();

```

Delete it entirely (the import above and the rest of the script stay). Leave a single blank line where the IIFE used to be.

- [ ] **Step 2: Verify**

Run: `grep -n "/login" src/pages/book/transfer/passenger.astro`
Expected: no output. (If the line is still present, the deletion missed.)

---

## Task 2: Remove the auth gate on the hourly passenger page

**Files:**
- Modify: `src/pages/book/hourly/passenger.astro:184-194`

- [ ] **Step 1: Delete the redirect IIFE**

In `src/pages/book/hourly/passenger.astro`, find and delete the same block:

```ts
	(async () => {
		const { data: { session } } = await supabase.auth.getSession();
		if (!session?.user) {
			const next = encodeURIComponent(window.location.pathname + window.location.search);
			window.location.href = `/login?next=${next}&reason=booking`;
		}
	})();

```

- [ ] **Step 2: Verify**

Run: `grep -n "/login" src/pages/book/hourly/passenger.astro`
Expected: no output.

---

## Task 3: Remove the auth gate on the tour passenger page

**Files:**
- Modify: `src/pages/book/tour/passenger.astro:261-271`

- [ ] **Step 1: Delete the redirect IIFE**

In `src/pages/book/tour/passenger.astro`, find and delete the same block:

```ts
	(async () => {
		const { data: { session } } = await supabase.auth.getSession();
		if (!session?.user) {
			const next = encodeURIComponent(window.location.pathname + window.location.search);
			window.location.href = `/login?next=${next}&reason=booking`;
		}
	})();

```

- [ ] **Step 2: Verify**

Run: `grep -n "/login" src/pages/book/tour/passenger.astro`
Expected: no output.

---

## Task 4: Repo-wide check, build, manual smoke-test, commit, push

- [ ] **Step 1: Repo-wide grep — confirm no other booking-flow page still gates on auth**

Run: `grep -rn "/login?next=" src/pages/book/`
Expected: no output. If anything remains, it's another gate that needs the same treatment.

- [ ] **Step 2: Clean build**

Run: `rm -rf dist && npm run build`
Expected: build succeeds, 63 pages built.

- [ ] **Step 3: Manual smoke test (signed-out)**

Start the dev server: `npm run dev` (background).
In a private/incognito window, walk through each flow without signing in:

1. Visit `http://localhost:4321/book/transfer`. Fill in From / To / date / time / passengers → "See prices".
2. On the results page, pick any vehicle → continue to `passenger`.
   - **Expected pre-fix:** redirect to `/login?next=…`.
   - **Expected post-fix:** the passenger form renders. Fill in name / email / phone → "Continue".
3. On the payment page, pick "Pay on arrival" or any non-card option → submit.
   - **Expected:** booking is created with `user_id = NULL` in the `transfers` table (admin can still see it from the form fields).
4. Repeat the walkthrough for `/book/hourly` and `/book/tour`.

If any step still bounces to `/login`, return to the relevant Task and re-check the IIFE deletion.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/transfer/passenger.astro \
        src/pages/book/hourly/passenger.astro \
        src/pages/book/tour/passenger.astro \
        docs/superpowers/plans/2026-05-01-allow-guest-bookings.md
git commit -m "fix(book): allow guests to complete transfer/hourly/tour bookings"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review Checklist

- [ ] Three identical IIFE blocks deleted (transfer / hourly / tour passenger pages).
- [ ] `grep -rn '/login?next=' src/pages/book/` returns no output.
- [ ] `onAuthStateChange` auto-fill block in each passenger page is **left untouched** — logged-in users still get name/email auto-filled.
- [ ] Payment pages (already guest-friendly) are not modified.
- [ ] Build succeeds.
- [ ] Manual smoke test passes for all three flows in an incognito window.
