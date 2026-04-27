# Fix: Dashboard Data Not Loading on First Client-Side Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dashboard page load its data on the first client-side navigation (currently shows a stuck "Loading…" until the user manually refreshes).

**Architecture:** `<ViewTransitions />` is enabled in `src/layouts/Layout.astro:19`. On client-side navigation, Astro swaps the `<body>` but inline `<script type="module">` blocks execute only once per browser session — they do **not** re-run on swap. ~24 dashboard pages register their data-load and DOM-element bindings at module top level (often via a MutationObserver attached to a soon-to-be-stale `#xxx-auth-check` element), so after a swap nothing fires and the new DOM stays at "Loading…". The fix is the canonical Astro pattern already used by the working pages (`agency/index.astro`, `agency/profile.astro`, `hotel/index.astro`, `hotel/profile.astro`, `driver/profile.astro`, etc.): wrap page-level setup in a named function and register it via `document.addEventListener('astro:page-load', fn)`, which fires on initial load AND after every view-transition swap.

**Tech Stack:** Astro 5.17, inline `<script type="module">`, Supabase JS v2.

**Out of scope (explicit):**
- **Removing `<ViewTransitions />`.** That would also fix the bug in one line, but the user wants page-transition UX preserved. Sidebar option only.
- Migrating from `<ViewTransitions />` to `<ClientRouter />` (Astro 5 deprecation; separate pass).
- Refactoring the auth-check pattern itself.
- Touching the ~17 pages that already use `astro:page-load` correctly.
- Adding test infrastructure (the project has no test runner; verification = browser smoke test).

---

## Current state (verified before writing this plan)

- `src/layouts/Layout.astro:19`: enables `<ViewTransitions />` site-wide.
- `src/components/about/ScrollReveal.astro:33`: comment explicitly notes "Astro ViewTransitions swap the DOM and fire page-load again." — i.e., the team knows the pattern.
- **Working pages** (already use `astro:page-load`, do **not** touch):
  - `register.astro`, `forgot-password.astro`, `login.astro`, `contact.astro`
  - `agency/index.astro`, `agency/profile.astro`
  - `hotel/index.astro`, `hotel/profile.astro`
  - `driver/drivers.astro`, `driver/payment-data.astro`, `driver/vehicles.astro`, `driver/billing.astro`, `driver/profile.astro`
  - `profile/experiences.astro`, `profile/trips.astro`, `profile/transfers.astro`
- **Broken pages** (24 files, no `astro:page-load` listener — confirmed via `grep -L`):
  - `admin/` (15): `experiences`, `index`, `manage-experiences`, `manage-tours`, `manage-transfers`, `manage-vehicles`, `new-entry`, `partners`, `prices`, `requests`, `sales`, `settings`, `tours`, `transfers`, `users`
  - `driver/` (6): `available`, `index`, `past`, `ride`, `settings`, `upcoming`
  - `hotel/` (1): `commissions`
  - `profile/` (2): `dashboard`, `settings`
- **Universal trigger pattern** in the broken pages (verified in `admin/users.astro`, `admin/index.astro`, `driver/upcoming.astro`):
  1. Top-level helpers + state.
  2. A `loadX()` async function that calls Supabase and renders.
  3. A few `document.getElementById('foo')?.addEventListener('click', …)` for static page-level controls (prev/next month, close buttons, search inputs, modal yes/no, etc.).
  4. An auth-guard `MutationObserver` watching `#admin-auth-check` (or `#driver-auth-check`, etc.) that calls `loadX()` once auth verifies (the observer disconnects after the first hidden-class flip).
- After a view-transition swap, the auth-check element is replaced with a fresh DOM node carrying the same id; the OLD observer is dangling on the OLD node which is no longer in the document → nothing ever calls `loadX()` again.

## File structure (after plan executes)

### Modified files (24 total)

| Path | Change |
|---|---|
| `src/pages/admin/users.astro` | Wrap page-level bindings + MutationObserver in `pageInit()`; register on `astro:page-load`. |
| `src/pages/admin/index.astro` | Same pattern. |
| `src/pages/admin/manage-tours.astro` | Same pattern. |
| `src/pages/admin/manage-experiences.astro` | Same pattern. |
| `src/pages/admin/manage-transfers.astro` | Same pattern. |
| `src/pages/admin/manage-vehicles.astro` | Same pattern. |
| `src/pages/admin/experiences.astro` | Same pattern. |
| `src/pages/admin/tours.astro` | Same pattern. |
| `src/pages/admin/transfers.astro` | Same pattern. |
| `src/pages/admin/partners.astro` | Same pattern. |
| `src/pages/admin/prices.astro` | Same pattern. |
| `src/pages/admin/requests.astro` | Same pattern. |
| `src/pages/admin/sales.astro` | Same pattern. |
| `src/pages/admin/new-entry.astro` | Same pattern. |
| `src/pages/admin/settings.astro` | Same pattern. |
| `src/pages/driver/index.astro` | Same pattern (auth element id is `driver-auth-check`). |
| `src/pages/driver/available.astro` | Same. |
| `src/pages/driver/upcoming.astro` | Same. |
| `src/pages/driver/past.astro` | Same. |
| `src/pages/driver/ride.astro` | Same. |
| `src/pages/driver/settings.astro` | Same. |
| `src/pages/hotel/commissions.astro` | Same (auth element id likely `hotel-auth-check` — verify in file). |
| `src/pages/profile/dashboard.astro` | Same. |
| `src/pages/profile/settings.astro` | Same. |

### No new files

This is a uniform retrofit; no new helpers needed. The ~17 working pages already define the canonical pattern — no shared module is required.

---

## The Pattern (the engineer must internalize this before touching any file)

**Read this section completely. Each task below applies it. Do not skim.**

In Astro 5 with `<ViewTransitions />`, the `astro:page-load` event fires:
- Once on initial full page load (after all `<script type="module">` modules execute).
- Once after every view-transition swap of the body.

So a listener registered at module top-level (`document.addEventListener('astro:page-load', fn)`) catches both cases. The listener registration runs once; the callback runs many times.

**Three categories of code in each broken script:**

| Category | Example | Where it goes |
|---|---|---|
| **Module-level state & helpers** | `import { supabase } from '...'`, `interface Row {...}`, `const fmtDate = ts => {...}`, `let allUsers: Row[] = []`, `function renderTable() {...}` | Stays at module top level. Runs once per session. |
| **Document-level listeners** | `document.addEventListener('click', closeAllDropdowns)` (binds to `document`, persists across swaps) | Stays at module top level. Runs once per session — duplicating across navigations would create duplicate listeners. |
| **Page-level bindings & observers** | `document.getElementById('foo')?.addEventListener(...)`, `new MutationObserver(...)`, `loadX()` triggered by observer | **Move into `pageInit()`** so it re-runs per swap. |

**Standard fix shape:**

```ts
<script>
  import { supabase } from '...';
  // Module-level helpers, types, state — unchanged
  // ...
  // Document-level listeners — stay at top level
  document.addEventListener('click', closeAllDropdowns);

  // Wrap everything that touches a swappable page element
  function pageInit() {
    // Static-control bindings
    document.getElementById('prev-month')?.addEventListener('click', () => { /* ... */ });
    document.getElementById('search-input')?.addEventListener('input', (e) => { /* ... */ });

    // Auth-guard observer that triggers data load
    const authEl = document.getElementById('admin-auth-check');
    if (authEl) {
      const observer = new MutationObserver(() => {
        if (authEl.classList.contains('hidden')) {
          observer.disconnect();
          loadData();
        }
      });
      observer.observe(authEl, { attributes: true, attributeFilter: ['class'] });
    }
  }

  document.addEventListener('astro:page-load', pageInit);
</script>
```

**Critical "do not"s:**
- Do **not** also call `pageInit()` at module top-level. `astro:page-load` fires on initial load too — calling immediately would double-register every listener on the first load. (`agency/index.astro` does call both, but it works there only because its `init` re-fetches data without re-binding listeners. For the dashboards we're fixing, every `pageInit()` re-runs `addEventListener` and would create duplicates.)
- Do **not** put `document.addEventListener('astro:page-load', pageInit)` inside `pageInit`. The listener registration is module-level, the callback is page-level.
- Do **not** wrap module-level imports, types, or helper-function declarations. Those don't depend on the swapped DOM.
- Do **not** disconnect the observer outside the "hidden" check; the existing logic already disconnects after first fire.

---

## Phase A — Validate the fix on one page

### Task 1: Retrofit `admin/users.astro` and verify in browser

**Goal:** Prove the pattern works end-to-end before fanning out across 23 more files.

**Files:**
- Modify: `src/pages/admin/users.astro` (script block roughly lines 74–346; the bottom `<script>`'s page-level bindings sit at lines 200–214 and 324–345).

- [ ] **Step 1: Read the file end-to-end**

```bash
sed -n '74,346p' src/pages/admin/users.astro
```
Identify which lines fall into each of the three categories (module-level / document-level / page-level). Note that `document.addEventListener('click', closeAllDropdowns)` near line 214 is document-level (stays); the modal-yes/modal-no bindings (~lines 324–328), the search/filter input bindings (~lines 331–338), and the MutationObserver block (~lines 341–345) are page-level (move into `pageInit`).

- [ ] **Step 2: Apply the wrap**

In `src/pages/admin/users.astro`, replace the trailing block (currently sitting between the helpers and `</script>`):

**Before** (the existing block at the bottom of the script, roughly lines 324–345):

```ts
	document.getElementById('modal-no')?.addEventListener('click', closeModal);
	document.getElementById('modal-yes')?.addEventListener('click', confirmAction);
	document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
		if (e.target === e.currentTarget) closeModal();
	});

	/* ── Search + filter ── */
	document.getElementById('users-search')?.addEventListener('input', (e) => {
		currentSearch = (e.target as HTMLInputElement).value.toLowerCase().trim();
		renderTable();
	});
	document.getElementById('users-role-filter')?.addEventListener('change', (e) => {
		currentRoleFilter = (e.target as HTMLSelectElement).value;
		renderTable();
	});

	/* ── Auth guard observer ── */
	const authEl = document.getElementById('admin-auth-check');
	const observer = new MutationObserver(() => {
		if (authEl?.classList.contains('hidden')) { observer.disconnect(); loadUsers(); }
	});
	if (authEl) observer.observe(authEl, { attributes: true, attributeFilter: ['class'] });
</script>
```

**After:**

```ts
	function pageInit() {
		document.getElementById('modal-no')?.addEventListener('click', closeModal);
		document.getElementById('modal-yes')?.addEventListener('click', confirmAction);
		document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
			if (e.target === e.currentTarget) closeModal();
		});

		/* ── Search + filter ── */
		document.getElementById('users-search')?.addEventListener('input', (e) => {
			currentSearch = (e.target as HTMLInputElement).value.toLowerCase().trim();
			renderTable();
		});
		document.getElementById('users-role-filter')?.addEventListener('change', (e) => {
			currentRoleFilter = (e.target as HTMLSelectElement).value;
			renderTable();
		});

		/* ── Auth guard observer ── */
		const authEl = document.getElementById('admin-auth-check');
		if (authEl) {
			const observer = new MutationObserver(() => {
				if (authEl.classList.contains('hidden')) { observer.disconnect(); loadUsers(); }
			});
			observer.observe(authEl, { attributes: true, attributeFilter: ['class'] });
		}
	}

	document.addEventListener('astro:page-load', pageInit);
</script>
```

Note the `document.addEventListener('click', closeAllDropdowns)` line (~line 214) and the `document.querySelectorAll<HTMLButtonElement>('.dd-item')` block in `renderTable()` are NOT moved — the `dd-item` query lives inside `renderTable()` which is called from `loadUsers()` which itself runs each navigation via the observer flow, so it re-binds correctly on each load.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: build succeeds, 63 pages, no TypeScript errors.

- [ ] **Step 4: Browser verification**

Run: `npm run dev` (background)
- Open `http://localhost:4321` (signed in as an admin).
- Navigate via the in-app menu/link to `/admin/users` — DO NOT refresh.
- Confirm: the users table populates within ~2 seconds. Auth-check banner disappears, table fills.
- Navigate away to another route (e.g., `/admin/index`), then back to `/admin/users` via link — the table should still populate without refresh.

If the table is still stuck on "Loading…", the fix is incomplete; STOP and report `BLOCKED`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/users.astro
git commit -m "fix(admin/users): trigger data load on view-transition swap via astro:page-load"
```

---

## Phase B — Apply the pattern to the remaining `admin/*` pages

### Task 2: Retrofit `admin/index.astro`, `admin/manage-tours.astro`, `admin/manage-experiences.astro`, `admin/manage-transfers.astro`

**Files:**
- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/admin/manage-tours.astro`
- Modify: `src/pages/admin/manage-experiences.astro`
- Modify: `src/pages/admin/manage-transfers.astro`

For **each** file:

- [ ] **Step 1: Read the file's `<script>` block and classify code into three buckets**

Categories (see "The Pattern" section above):
- Module-level state & helpers (imports, types, helper functions, top-level `let`/`const` state) → stay top-level.
- Document-level listeners (`document.addEventListener('click', …)`, `document.addEventListener('keydown', …)` where the target is `document` itself) → stay top-level.
- Page-level bindings (any `document.getElementById('…')?.addEventListener(...)`, `document.querySelector('…')?.addEventListener(...)`, `new MutationObserver(...)` watching a page element, `IntersectionObserver` watching page elements) → move into `pageInit()`.

- [ ] **Step 2: Wrap the page-level block in `pageInit()` and add the listener**

Use this exact shape at the bottom of the `<script>` (place it AFTER all module-level helpers and document-level listeners):

```ts
	function pageInit() {
		// Move every page-level binding from this file's old top-level into here.
		// Including the auth-guard MutationObserver block exactly as it was, but with the
		// `if (authEl)` guard wrapping the observer construction (some files have the
		// guard inside, some outside — make it `if (authEl) { const observer = ...; observer.observe(...) }`).
	}

	document.addEventListener('astro:page-load', pageInit);
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: success, 63 pages.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/index.astro src/pages/admin/manage-tours.astro src/pages/admin/manage-experiences.astro src/pages/admin/manage-transfers.astro
git commit -m "fix(admin): trigger data load on view-transition swap (4 pages)"
```

### Task 3: Retrofit `admin/manage-vehicles.astro`, `admin/experiences.astro`, `admin/tours.astro`, `admin/transfers.astro`

**Files:**
- Modify: `src/pages/admin/manage-vehicles.astro`
- Modify: `src/pages/admin/experiences.astro`
- Modify: `src/pages/admin/tours.astro`
- Modify: `src/pages/admin/transfers.astro`

For each file: apply the exact same three-bucket classification + `pageInit()` wrap + `document.addEventListener('astro:page-load', pageInit)` pattern described in Task 2.

- [ ] **Step 1: Apply the pattern to all four files**

Per file: read script, classify, wrap page-level code in `pageInit()`, register the listener.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/manage-vehicles.astro src/pages/admin/experiences.astro src/pages/admin/tours.astro src/pages/admin/transfers.astro
git commit -m "fix(admin): trigger data load on view-transition swap (4 pages)"
```

### Task 4: Retrofit `admin/partners.astro`, `admin/prices.astro`, `admin/requests.astro`, `admin/sales.astro`

**Files:**
- Modify: `src/pages/admin/partners.astro`
- Modify: `src/pages/admin/prices.astro`
- Modify: `src/pages/admin/requests.astro`
- Modify: `src/pages/admin/sales.astro`

- [ ] **Step 1: Apply the pattern to all four files**

Per file: classify, wrap page-level into `pageInit()`, register `astro:page-load` listener. See "The Pattern" section above for the canonical shape and Task 1 for a worked example.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/partners.astro src/pages/admin/prices.astro src/pages/admin/requests.astro src/pages/admin/sales.astro
git commit -m "fix(admin): trigger data load on view-transition swap (4 pages)"
```

### Task 5: Retrofit `admin/new-entry.astro`, `admin/settings.astro`

**Files:**
- Modify: `src/pages/admin/new-entry.astro`
- Modify: `src/pages/admin/settings.astro`

These are the trailing two admin pages; they may have different scripts than the table-style dashboards (e.g., `new-entry` is a form, `settings` is config). Apply the same classification rule but expect fewer page-level bindings.

- [ ] **Step 1: Apply the pattern**

Per file: classify, wrap page-level into `pageInit()`, register `astro:page-load`. If a page has NO page-level code (purely a form whose handlers run on user click events bound to elements that always exist when the form is in the DOM), then `pageInit()` only needs to bind those handlers; data load may not exist.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/new-entry.astro src/pages/admin/settings.astro
git commit -m "fix(admin): trigger data load on view-transition swap (2 pages)"
```

---

## Phase C — Apply to driver dashboards

### Task 6: Retrofit `driver/index.astro`, `driver/available.astro`, `driver/upcoming.astro`

**Files:**
- Modify: `src/pages/driver/index.astro`
- Modify: `src/pages/driver/available.astro`
- Modify: `src/pages/driver/upcoming.astro`

These pages use `#driver-auth-check` (not `#admin-auth-check`) for the auth guard. Otherwise the structure is identical.

- [ ] **Step 1: Apply the pattern to all three files**

Per file: classify, wrap page-level into `pageInit()`, register `astro:page-load`. Auth-guard observer watches `#driver-auth-check`.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/driver/index.astro src/pages/driver/available.astro src/pages/driver/upcoming.astro
git commit -m "fix(driver): trigger data load on view-transition swap (3 pages)"
```

### Task 7: Retrofit `driver/past.astro`, `driver/ride.astro`, `driver/settings.astro`

**Files:**
- Modify: `src/pages/driver/past.astro`
- Modify: `src/pages/driver/ride.astro`
- Modify: `src/pages/driver/settings.astro`

- [ ] **Step 1: Apply the pattern to all three files**

Per file: classify, wrap page-level into `pageInit()`, register `astro:page-load`.

`driver/ride.astro` may have a more complex structure (it's an active-ride detail page). Pay extra attention to: any `setInterval` / `setTimeout` for live updates → those should be cleared inside the observer fire path or on `astro:before-swap` (a separate `document.addEventListener('astro:before-swap', cleanup)` is fine if needed). For v1 of this fix, just ensure `pageInit()` registers the new interval and don't worry about leaks unless the build complains — leaks are not the bug being fixed.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/driver/past.astro src/pages/driver/ride.astro src/pages/driver/settings.astro
git commit -m "fix(driver): trigger data load on view-transition swap (3 pages)"
```

---

## Phase D — Apply to hotel + profile dashboards

### Task 8: Retrofit `hotel/commissions.astro`, `profile/dashboard.astro`, `profile/settings.astro`

**Files:**
- Modify: `src/pages/hotel/commissions.astro` (uses `#hotel-auth-check` or similar — verify in file)
- Modify: `src/pages/profile/dashboard.astro` (auth element name varies — likely `#profile-auth-check` or relies on `supabase.auth.getUser()` directly)
- Modify: `src/pages/profile/settings.astro`

- [ ] **Step 1: Apply the pattern to all three files**

Per file: classify code, wrap page-level into `pageInit()`, register `astro:page-load`.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pages/hotel/commissions.astro src/pages/profile/dashboard.astro src/pages/profile/settings.astro
git commit -m "fix(hotel,profile): trigger data load on view-transition swap (3 pages)"
```

---

## Phase E — Cross-dashboard verification

### Task 9: Browser smoke test across all retrofitted pages

**Files:** none modified — verification only.

- [ ] **Step 1: Production build sanity**

Run: `npm run build`
Expected: 63 pages, no errors, no warnings about unused imports.

- [ ] **Step 2: Dev-server walkthrough**

Run: `npm run dev` (background).

In ONE browser session (do not refresh between routes — that would mask the bug):
- Sign in as an admin.
- Navigate via in-app menu/link (not URL bar):
  1. `/admin/index` → confirm calendar populates with bookings within ~3s.
  2. `/admin/users` → users table fills.
  3. `/admin/manage-tours` → tours list fills.
  4. `/admin/manage-experiences` → experiences list fills.
  5. `/admin/manage-vehicles` → vehicles list fills.
  6. `/admin/manage-transfers` → transfers list fills.
  7. `/admin/partners` → partners list fills.
  8. `/admin/sales` → sales data loads.
  9. `/admin/requests` → requests list fills.
  10. `/admin/settings` → settings load.

Then sign in as a driver (in a new browser context to clear admin session) and:
- `/driver/index` → driver dashboard loads.
- `/driver/upcoming` → upcoming rides load.
- `/driver/past` → past rides load.
- `/driver/available` → available rides load.

Then sign in as a hotel partner:
- `/hotel/commissions` → commissions load.

Then sign in as a regular user:
- `/profile/dashboard` → profile dashboard loads.
- `/profile/settings` → settings form loads.

If ANY page is stuck on "Loading…" without refresh, the fix is incomplete on that page. Identify the page, return to its phase, re-classify the code, and ensure the page-level bindings are inside `pageInit()` and the listener is registered.

- [ ] **Step 3: Smoke test the original carousel feature**

After the dashboards are fixed, navigate to `/book/tour` and `/experiences` to confirm the image carousel still works (Task 4 of the previous plan). The fix here should not affect those pages.

- [ ] **Step 4: No commit for this task** — verification only. If any page failed, file the fix as an additional commit on the appropriate task's batch.

---

## Notes for the executor

- **Do not move `document.addEventListener('click', x)` (where target is `document`) into `pageInit()`.** Document-level listeners persist across swaps; moving them in would create duplicates on each navigation.
- **The listener registration `document.addEventListener('astro:page-load', pageInit)` runs at module top-level**, NOT inside `pageInit`. Putting it inside would mean it never registers (because `pageInit` doesn't run until a swap, but registering the listener after the event fires the first time is too late for the initial load).
- **Do not call `pageInit()` immediately at module top.** `astro:page-load` fires on initial load. Calling immediately would double-register every event listener on the first cold load. (Some working pages do this — they're tolerable because their `init` re-fetches without re-binding listeners. The pages we're fixing have many `addEventListener` calls inside `pageInit`, so doubling is a real bug.)
- **For files with NO page-level bindings** (purely module-level helper code), no change is needed — but every file in the broken list above does have at least one page-level binding (the auth observer). If a file appears to have none, double-check by searching for `MutationObserver` and `getElementById` in that file before skipping.
- **If `pageInit()` is registered but the page still doesn't load**, the most likely cause is that the auth-check element id in that page differs from what the observer expects. Verify the id in the HTML matches the id in the JS.
- **No new files; no helper extraction.** Repeating the four-line `pageInit() { … }` + listener idiom across 24 files is fine — DRY would mean a shared helper, but each `pageInit` body is unique to its page, so the only shared part is the listener registration line, which isn't worth extracting.

## Quick alternative (if the user changes their mind during execution)

If at any point during execution the user prefers the one-line global fix, the alternative is:

```diff
--- a/src/layouts/Layout.astro
+++ b/src/layouts/Layout.astro
@@ -2,7 +2,6 @@
 import '../styles/global.css';
 import Navbar from '../components/Navbar.astro';
 import Footer from '../components/Footer.astro';
-import { ViewTransitions } from 'astro:transitions';
 ---

 <html lang="el">
@@ -16,7 +15,6 @@
 		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
 		<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Inter:wght@300..700&display=swap" rel="stylesheet" />
 		<title>Opawey</title>
-		<ViewTransitions />
 	</head>
 	<body class="flex flex-col min-h-screen">
 		<Navbar />
```

This forces every navigation to be a full page load. Pro: fixes all 24 pages instantly with one commit, no risk of regression in any other page. Con: loses the smooth in-page transitions on routes that work today (carousel pages, hotel/* working pages, agency/* working pages, etc.). The user explicitly chose to keep `<ViewTransitions />` for this plan; document this only as a fallback.
