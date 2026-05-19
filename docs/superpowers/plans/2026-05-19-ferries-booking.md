# Ferries Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Ferries" booking category that links to a new page embedding the FerriesInGreece affiliate iframe (`aff=opawey`), wired into the desktop "Book Online" dropdown, the mobile drawer, and the `/book` hub page.

**Architecture:** Pure presentational change. One new Astro page (`/book/ferries`) embeds the third-party iframe inside the existing `Layout.astro` shell and matches the visual style of `book.astro` (light sky background, centered hero, white rounded container). Two existing files get a new entry appended to their lists: `Navbar.astro` (desktop dropdown + mobile drawer) and `book.astro` (hub card grid; grid widens from 4 to 5 columns at `xl`). No new components, no client JS, no schema changes.

**Tech Stack:** Astro 5, Tailwind v4, existing `data-i18n-el` / `data-i18n-es` attribute-based i18n (English is the source text; Greek and Spanish are alternate values swapped by the global lang script).

**i18n strings used throughout:**
- English: "Book a Ferry" / "Ferry tickets across the Greek islands"
- Greek (`data-i18n-el`): "Κράτηση πλοίου" / "Εισιτήρια πλοίων για τα ελληνικά νησιά"
- Spanish (`data-i18n-es`): "Reservar un ferry" / "Billetes de ferry por las islas griegas"

**Affiliate iframe (verbatim from user):**
```html
<iframe frameborder="0" scrolling="no" width="100%" height="540" allowtransparency="true" src="https://www.ferriesingreece.com/affiliate_engine.php?aff=opawey&lang=english"></iframe>
```

**Note on iframe `lang` query param:** The widget only supports `english`. We will not parameterize it by site language in this plan — keep `lang=english` for now. (If translation of the widget itself is wanted later, a separate spec is needed; the partner may or may not offer Greek/Spanish modes.)

---

## File Structure

- **Create:** `src/pages/book/ferries.astro` — page that renders the affiliate iframe inside the standard Layout, with a header matching the other `/book/*` landing style.
- **Modify:** `src/components/Navbar.astro` — append a "Book a Ferry" link inside the desktop dropdown panel (after "Book a Tour", before "Experiences") and inside the mobile drawer's "Book Online" group (same position).
- **Modify:** `src/pages/book.astro` — add a 5th card for ferries to the hub grid and widen the `xl` breakpoint from 4 to 5 columns so all cards stay on one row on large screens.

The desktop dropdown and the mobile drawer are two separate blocks in `Navbar.astro`; both must be updated. Forgetting one will make Ferries reachable on desktop but invisible on mobile (or vice versa).

---

### Task 1: Create the Ferries booking page

**Files:**
- Create: `src/pages/book/ferries.astro`

- [ ] **Step 1: Create the file with the page content**

Write `src/pages/book/ferries.astro` with the following exact content:

```astro
---
import Layout from '../../layouts/Layout.astro';
---

<Layout>
	<main class="min-h-screen bg-sky-50 pt-36 pb-24 px-6 lg:px-10">
		<div class="max-w-4xl mx-auto">

			<!-- Header -->
			<div class="text-center mb-10">
				<div class="flex items-center justify-center gap-2 mb-4">
					<span class="w-2 h-2 rounded-full bg-[#0C6B95] shrink-0"></span>
					<span class="text-sm font-medium text-[#0C6B95] tracking-widest uppercase" data-i18n-el="Κράτηση πλοίου" data-i18n-es="Reservar un ferry">Book a Ferry</span>
				</div>
				<h1 class="text-5xl lg:text-6xl font-bold text-neutral-900 leading-tight" data-i18n-el="Εισιτήρια πλοίων" data-i18n-es="Billetes de ferry">Ferry Tickets</h1>
				<p class="text-neutral-500 text-lg mt-4 max-w-xl mx-auto" data-i18n-el="Αναζητήστε και κλείστε εισιτήρια πλοίων για όλα τα ελληνικά νησιά απευθείας παρακάτω." data-i18n-es="Busque y reserve billetes de ferry para todas las islas griegas directamente abajo.">Search and book ferry tickets to every Greek island, right below.</p>
			</div>

			<!-- Booking widget -->
			<div class="bg-white rounded-3xl border border-neutral-200 shadow-sm p-4 sm:p-6">
				<iframe
					title="Ferries in Greece booking engine"
					src="https://www.ferriesingreece.com/affiliate_engine.php?aff=opawey&lang=english"
					width="100%"
					height="540"
					frameborder="0"
					scrolling="no"
					allowtransparency="true"
					class="w-full block rounded-xl"
				></iframe>
			</div>

			<p class="text-center text-xs text-neutral-400 mt-6" data-i18n-el="Η μηχανή κρατήσεων παρέχεται από το ferriesingreece.com." data-i18n-es="Motor de reservas proporcionado por ferriesingreece.com.">Booking engine provided by ferriesingreece.com.</p>

		</div>
	</main>
</Layout>
```

Notes on the markup:
- Uses the same `Layout.astro`, same `bg-sky-50 pt-36 pb-24` page chrome, and the same kicker/title/subtitle pattern as `src/pages/book.astro` so it visually belongs to the booking flow.
- `max-w-4xl` (instead of `max-w-3xl` like the hub) gives the iframe a comfortable width on desktop without overstretching on ultrawide screens. The iframe is `height="540"` per the partner's snippet.
- `frameborder` and `allowtransparency` are deprecated HTML attributes but match the partner's snippet verbatim; Astro will pass them through. Don't strip them — the partner's widget script may inspect them.
- The wrapping `<div>` adds a card-style frame around the iframe so it doesn't look like an unstyled rectangle floating on `bg-sky-50`.
- The `title` attribute on the iframe is for accessibility; not present in the partner snippet but required for screen readers.

- [ ] **Step 2: Verify Astro picks up the new route**

Make sure the dev server is running (`npm run dev`). Astro hot-reloads filesystem routes automatically.

Open in browser: `http://localhost:<port>/book/ferries`

(Use whatever port the server reported — earlier this session it was 4324.)

Expected:
- The Opawey navbar is at the top (provided by `Layout.astro`).
- A centered hero with "Book a Ferry" kicker, "Ferry Tickets" headline, subtitle.
- A white rounded card containing the live FerriesInGreece search form.
- A small "Booking engine provided by ferriesingreece.com." caption below.

If the iframe shows a blank white box: open DevTools → Network and verify the request to `affiliate_engine.php` returns 200 with HTML. If it's blocked by an extension (uBlock often flags affiliate URLs), test in a clean profile. This is **not** a bug in our page.

- [ ] **Step 3: Verify Greek and Spanish translations swap**

In the browser, click the `GR` language toggle in the top-right. The kicker should become "Κράτηση πλοίου", the title "Εισιτήρια πλοίων", and the subtitle the Greek translation. Click `ES` — same check in Spanish. Click `EN` — back to English.

If a string doesn't swap, double-check the `data-i18n-el` / `data-i18n-es` attribute names against an existing translated element in `book.astro` (e.g. line 11 of `book.astro`).

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/ferries.astro
git commit -m "feat(book): add /book/ferries page embedding FerriesInGreece widget"
```

---

### Task 2: Add Ferries entry to the desktop "Book Online" dropdown

**Files:**
- Modify: `src/components/Navbar.astro` (desktop dropdown panel, currently lines 43–98)

The dropdown panel is the white card revealed on hover under "BOOK ONLINE". It currently lists four items in this order: **Book a Transfer → Rent per hour → Book a Tour → Experiences**. We're inserting **Book a Ferry** between "Book a Tour" and "Experiences".

- [ ] **Step 1: Locate the insertion point**

Open `src/components/Navbar.astro`. Find the "Book a Tour" anchor inside the desktop dropdown — currently around lines 72–82. The closing `</a>` of "Book a Tour" is followed by a blank line, then the `<!-- Experiences -->` comment. That blank line is the insertion point.

- [ ] **Step 2: Insert the Ferries entry**

Insert the following block between the closing `</a>` of "Book a Tour" and the `<!-- Experiences -->` comment:

```astro
						<!-- Book a Ferry -->
						<a href="/book/ferries" class="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-sky-50 transition-colors duration-150 group/item">
							<div class="w-9 h-9 rounded-xl bg-[#0C6B95]/10 flex items-center justify-center shrink-0 group-hover/item:bg-[#0C6B95]/15 transition-colors">
								<svg class="w-4 h-4 text-[#0C6B95]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l-3 8h6l-3-8zM4 19l2-6h12l2 6M3 21h18" />
								</svg>
							</div>
							<div>
								<div class="font-semibold text-sm text-neutral-900 group-hover/item:text-[#0C6B95] transition-colors" data-i18n-el="Κράτηση πλοίου" data-i18n-es="Reservar un ferry">Book a Ferry</div>
								<div class="text-xs text-neutral-400 mt-0.5" data-i18n-el="Εισιτήρια για τα ελληνικά νησιά" data-i18n-es="Billetes para las islas griegas">Tickets across the Greek islands</div>
							</div>
						</a>

```

Indentation: the file uses **tabs** for indentation (six tabs at this nesting level). Match the surrounding "Book a Tour" entry exactly when pasting. If your editor inserts spaces, fix it before saving.

Notes on the SVG icon:
- Path describes a simple ship silhouette: triangular sail at top (`M12 3l-3 8h6l-3-8z`), trapezoidal hull (`M4 19l2-6h12l2 6`), and a waterline (`M3 21h18`).
- Same `w-4 h-4 text-[#0C6B95]` styling and `stroke-width="2"` as the other dropdown icons — keeps visual rhythm consistent.

- [ ] **Step 3: Verify in browser**

With dev server running, open the site root `http://localhost:<port>/` and hover over **BOOK ONLINE** in the navbar.

Expected: the dropdown now lists five entries in this order — Book a Transfer, Rent per hour, Book a Tour, **Book a Ferry**, Experiences. The ferry icon should appear in the same blue-tinted rounded square as the others, and clicking the row navigates to `/book/ferries`.

Toggle to Greek and re-hover — the new row should read "Κράτηση πλοίου" / "Εισιτήρια για τα ελληνικά νησιά". Toggle to Spanish — same check.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.astro
git commit -m "feat(navbar): add Book a Ferry to desktop dropdown"
```

---

### Task 3: Add Ferries entry to the mobile drawer

**Files:**
- Modify: `src/components/Navbar.astro` (mobile drawer "Book Online" section, currently lines 205–209)

The mobile drawer (visible when the hamburger is tapped on mobile/tablet) duplicates the dropdown contents as a flat list under a "BOOK ONLINE" header. We add the ferries link in the same position as the desktop entry (between Tour and Experiences).

- [ ] **Step 1: Locate the mobile drawer block**

Find this section in `src/components/Navbar.astro` (around lines 205–209):

```astro
			<!-- Book Online (always expanded inline on mobile) -->
			<div class="px-6 pt-3 pb-1 text-xs uppercase tracking-widest text-white/50" data-i18n-el="ΚΡΑΤΗΣΗ ONLINE" data-i18n-es="RESERVAR ONLINE">BOOK ONLINE</div>
			<a href="/book/transfer" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Κράτηση μεταφοράς" data-i18n-es="Reservar un traslado">Book a Transfer</a>
			<a href="/book/hourly" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Ενοικίαση με την ώρα" data-i18n-es="Alquiler por hora">Rent per hour</a>
			<a href="/book/tour" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Κράτηση τουρ" data-i18n-es="Reservar un tour">Book a Tour</a>
			<a href="/experiences" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Εμπειρίες" data-i18n-es="Experiencias">Experiences</a>
```

- [ ] **Step 2: Insert the Ferries link**

Insert this line between the "Book a Tour" anchor and the "Experiences" anchor:

```astro
			<a href="/book/ferries" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Κράτηση πλοίου" data-i18n-es="Reservar un ferry">Book a Ferry</a>
```

The `data-drawer-link` attribute is important — `initDrawer()` in the same file (lines 273–305) wires click handlers to elements with that attribute so the drawer auto-closes after the user taps a link. Without it, the drawer would stay open across navigation.

- [ ] **Step 3: Verify on a narrow viewport**

In Chrome DevTools, toggle device toolbar (Cmd+Shift+M) and set width below 1024px (the `lg` breakpoint). Reload the page, tap the hamburger icon to open the drawer.

Expected: under "BOOK ONLINE", you now see five rows in order — Book a Transfer, Rent per hour, Book a Tour, **Book a Ferry**, Experiences. Tap "Book a Ferry": the drawer closes and the page navigates to `/book/ferries`.

Test all three languages via the drawer's own language toggle at the bottom.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.astro
git commit -m "feat(navbar): add Book a Ferry to mobile drawer"
```

---

### Task 4: Add Ferries card to the /book hub grid

**Files:**
- Modify: `src/pages/book.astro` (card grid at line 22, fifth card inserted before `</div>` at line 102)

The hub page at `/book` currently shows four cards in a `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` grid. We add a fifth card and widen the `xl` column count from 4 to 5 so all five cards fit on one row on large screens. On `sm` (≥640px) it remains 2 columns (so 5 cards lay out as 2-2-1 on tablets, which is acceptable given the same orphan would happen at any odd count).

- [ ] **Step 1: Widen the grid breakpoint**

Edit `src/pages/book.astro` line 22. Change:

```astro
			<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
```

to:

```astro
			<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
```

- [ ] **Step 2: Insert the Ferries card**

In the same file, find the closing `</a>` of the **Book a Tour** card (currently line 80). It is followed by a blank line and then `<!-- Book an Experience -->`. Insert this new card between them so the order matches the dropdown (Transfer → Hourly → Tour → Ferry → Experience):

```astro
				<!-- Book a Ferry -->
				<a
					href="/book/ferries"
					class="group bg-white rounded-3xl p-8 border border-neutral-200 shadow-sm hover:shadow-xl hover:border-[#0C6B95]/30 transition-all duration-300 flex flex-col"
				>
					<div class="w-14 h-14 rounded-2xl bg-[#0C6B95] flex items-center justify-center mb-6 shadow-lg shadow-[#0C6B95]/25 group-hover:scale-110 transition-transform duration-300">
						<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l-3 8h6l-3-8zM4 19l2-6h12l2 6M3 21h18" />
						</svg>
					</div>
					<h2 class="text-2xl font-bold text-neutral-900 mb-2" data-i18n-el="Κράτηση πλοίου" data-i18n-es="Reservar un ferry">Book a Ferry</h2>
					<p class="text-neutral-500 text-sm leading-relaxed flex-1 mb-6" data-i18n-el="Εισιτήρια πλοίων από όλα τα μεγάλα ελληνικά λιμάνια προς τα νησιά του Αιγαίου και του Ιονίου." data-i18n-es="Billetes de ferry desde los principales puertos griegos hacia las islas del Egeo y del Jónico.">Ferry tickets from every major Greek port to the islands of the Aegean and Ionian.</p>
					<span class="inline-flex items-center gap-2 text-[#0C6B95] font-semibold text-sm group-hover:gap-3 transition-all duration-200" data-i18n-el="Κράτηση τώρα" data-i18n-es="Reservar ahora">
						Book Now
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
						</svg>
					</span>
				</a>
```

Same ship-icon path as Task 2, sized `w-7 h-7` to match the other hero icons on this page. The "Book Now" arrow row uses the same animation and i18n strings as the other cards.

- [ ] **Step 3: Verify hub page renders correctly**

Open `http://localhost:<port>/book` and check:

- **Desktop (≥1280px / `xl`):** five cards on one row, equal width, equal height.
- **Tablet (640–1279px / `sm`):** two columns. Cards 1–4 fill two rows, card 5 (Ferries OR whichever ends up last given the source order — Ferries is 4th, Experiences is 5th in the DOM) sits alone in the third row. This is the expected orphan pattern.
- **Mobile (<640px):** single column, five cards stacked.

Click the Ferries card → it should navigate to `/book/ferries`.

Test all three language toggles — title, description, and "Book Now" CTA all swap.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book.astro
git commit -m "feat(book): add Ferries card to /book hub and widen grid to 5 cols"
```

---

### Task 5: Cross-flow verification

No file changes here — this is an end-to-end smoke test of all entry points before considering the feature done.

- [ ] **Step 1: Test desktop entry path**

In a normal desktop window:
1. Land on `/`.
2. Hover "BOOK ONLINE" in the navbar → click "Book a Ferry" → land on `/book/ferries` with the iframe loaded.
3. Back to `/`. Click "BOOK ONLINE" (no submenu link) → land on `/book` hub → click the Ferries card → land on `/book/ferries`.

- [ ] **Step 2: Test mobile entry path**

In DevTools mobile emulation (any width <1024px):
1. Tap hamburger → tap "Book a Ferry" under BOOK ONLINE → drawer closes, page navigates to `/book/ferries`.
2. Reload `/book` directly → cards display in single column → tap Ferries card → navigates correctly.

- [ ] **Step 3: Test language persistence across navigation**

1. On `/`, switch language to Greek.
2. Hover the dropdown — "Book a Ferry" should read "Κράτηση πλοίου".
3. Click it. On `/book/ferries`, the kicker/title/subtitle should all already be in Greek (the lang script reads `localStorage` on every page-load via `astro:page-load`).
4. Repeat with Spanish.

If on step 3 the page loads in English first and then snaps to Greek, that's a pre-existing FOUC behavior in this codebase, not a regression — note it but don't fix it as part of this feature.

- [ ] **Step 4: Check console for errors**

DevTools → Console. Reload `/book/ferries`. Expect no errors from our code. The third-party iframe may emit its own console messages (analytics, etc.) — those are out of scope. If you see a CSP violation blocking the iframe, check `astro.config.mjs` and `vercel.json` for a Content-Security-Policy header that doesn't allow `frame-src https://www.ferriesingreece.com`. (Quick check: `grep -i "Content-Security-Policy\|frame-src" astro.config.mjs vercel.json src/ 2>/dev/null` — if nothing comes back, there's no CSP set and the iframe loads freely. If a CSP is found, add `https://www.ferriesingreece.com` to the `frame-src` directive in a separate commit.)

- [ ] **Step 5: Final commit (only if any fix-ups happened)**

If Step 4 surfaced a CSP issue or anything else that needed patching, commit those fixes now with a descriptive message. Otherwise this task ends with no commit.

---

## Out of scope (do NOT do as part of this plan)

- Localizing the iframe widget itself (it only supports `lang=english`).
- Tracking affiliate clicks in our analytics — the `aff=opawey` parameter is the partner's own attribution; no extra wiring needed.
- Adding ferries to the homepage hero, footer, or any marketing component.
- Schema.org / SEO metadata on `/book/ferries` (open a separate ticket if needed — the existing `/book/*` pages don't have per-page schema either, so adding it here only would be inconsistent).
- Reordering existing dropdown items.
