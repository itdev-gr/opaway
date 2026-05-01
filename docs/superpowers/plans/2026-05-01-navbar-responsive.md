# Responsive Navbar (mobile + tablet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top navbar usable on phones and tablets — currently the centre nav is `hidden md:flex` with no replacement, so anything below 768 px has zero navigation, and the 768–1023 px range overflows and pushes the right-side cluster off-screen.

**Architecture:** Single `Navbar.astro` component already wraps the brand logo on the left, the centre navigation in the middle, and the (language toggle + auth UI) cluster on the right. We keep that exact three-column structure on desktop (`lg` and up). For tablet and mobile (`< lg`) we (a) hide the centre nav entirely, (b) collapse the right-side cluster down to just the language toggle + sign-in, (c) add a hamburger button after the language toggle, and (d) render a slide-down full-width drawer that lists every centre-nav item — including the Book Online sub-items expanded inline — plus a compact auth row at the bottom. The hamburger is wired by extending the existing `initNavbar()` script (which already runs on every `astro:page-load`), so we don't introduce a new script tag.

The Book Online dropdown also stops being hover-only: it now toggles on tap (click) so touch devices can open it on tablet and on desktop the hover behavior still works because we keep the existing `group/group-hover` classes alongside the new toggle.

**Tech Stack:** Astro 5 component, Tailwind utility classes, vanilla TypeScript inside the existing `<script>` block.

**Key UX constraints:**

1. **No regression on desktop (≥1024 px).** The current centre nav, dropdown, language toggle, and auth UI must look and behave exactly as today.
2. **Tablet (768–1023 px) = treated as mobile.** The five centre-nav items + dropdown + 3-button language toggle + auth never fit cleanly at 768. Showing a drawer is simpler and consistent.
3. **Touch-first for the Book Online dropdown.** Hover alone doesn't work on a tablet. The button must toggle on click, and the drawer always shows the sub-items expanded.
4. **Drawer must close on:** tap of the X / hamburger toggle, tap of the dark backdrop, tap of any nav link inside it, `Escape` key, and `astro:page-load` (so navigation between pages doesn't leave it open).
5. **Body scroll lock while drawer is open** — otherwise the page underneath scrolls and the drawer feels broken on iOS Safari.
6. **Z-index hygiene:** drawer above everything (currently the navbar is `z-50`; drawer + backdrop go to `z-50` and `z-40` respectively, both inside the navbar so they inherit the same stacking context).

---

## File Structure

Files modified — single component, single script:

- `src/components/Navbar.astro` — only file touched. Adds the hamburger button, the drawer markup, the backdrop, and extends `initNavbar()` with the toggle/close handlers + body-scroll lock + dropdown click toggle.

No other files change. No new files. No new dependencies.

---

## Task 1: Tighten the existing centre nav and right cluster for the new breakpoint

**Files:**
- Modify: `src/components/Navbar.astro:11`, `:124–134` (centre nav + guest auth cluster)

- [ ] **Step 1: Change the centre nav breakpoint from `md` to `lg`**

In `src/components/Navbar.astro`, change line 11 from:

```astro
<div class="hidden md:flex items-center gap-8 flex-1 justify-center font-medium tracking-wide">
```

to:

```astro
<div class="hidden lg:flex items-center gap-8 flex-1 justify-center font-medium tracking-wide">
```

(Reason: at 768 px the five items + the right cluster overflow. The hamburger drawer covers tablet too.)

- [ ] **Step 2: Hide the "Sign in" text button below `sm` so the right cluster fits at 360 px**

Find the Sign-in anchor at line ~131:

```astro
<a href="/login" class="inline-flex items-center gap-2 bg-white text-[#000724] font-medium px-5 py-2.5 rounded-full hover:bg-neutral-100 transition-colors" data-i18n-el="Συνδεθείτε" data-i18n-es="Iniciar sesión">
	Sign in
</a>
```

Replace with:

```astro
<a href="/login" class="hidden sm:inline-flex items-center gap-2 bg-white text-[#000724] font-medium px-5 py-2.5 rounded-full hover:bg-neutral-100 transition-colors" data-i18n-el="Συνδεθείτε" data-i18n-es="Iniciar sesión">
	Sign in
</a>
```

(Below 640 px the profile-circle icon next to it is the entry point; the "Sign in" pill is duplicate.)

---

## Task 2: Add the hamburger button (visible only below `lg`)

**Files:**
- Modify: `src/components/Navbar.astro` — insert after the language toggle div (around line 122) so it sits visually between the language toggle and the profile icon on small screens.

- [ ] **Step 1: Insert the hamburger button**

After the closing `</div>` of `id="nav-language-toggle"` (line ~122), insert:

```astro
		<!-- Hamburger (mobile + tablet only) -->
		<button
			id="nav-burger"
			type="button"
			class="lg:hidden w-10 h-10 rounded-full border border-white/20 bg-white/0 hover:bg-white/10 flex items-center justify-center transition-colors duration-200 shrink-0"
			aria-label="Open menu"
			aria-expanded="false"
			aria-controls="nav-drawer"
		>
			<svg id="nav-burger-icon" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
```

- [ ] **Step 2: Verify the burger renders only below `lg`**

Run: `npm run build && grep -c 'nav-burger' dist/index.html`
Expected: prints `1` (the button is rendered once). Open the page in Chrome devtools at 1023 px and 1024 px — at 1023 the burger is visible, at 1024 it's hidden.

---

## Task 3: Add the drawer markup (closed by default)

**Files:**
- Modify: `src/components/Navbar.astro` — append new markup right after `</nav>` so the drawer/backdrop sit at the same DOM level (avoids `overflow:hidden` on the nav clipping it).

- [ ] **Step 1: Append the backdrop + drawer**

After the closing `</nav>` tag at line 152, before the `<script>` block, insert:

```astro
<!-- Mobile/tablet backdrop -->
<div
	id="nav-drawer-backdrop"
	class="fixed inset-0 bg-black/60 z-40 hidden lg:hidden"
	aria-hidden="true"
></div>

<!-- Mobile/tablet drawer -->
<div
	id="nav-drawer"
	class="fixed top-0 left-0 right-0 z-50 lg:hidden bg-[#000724] text-white shadow-2xl -translate-y-full transition-transform duration-300 ease-out"
	role="dialog"
	aria-modal="true"
	aria-label="Mobile navigation"
>
	<!-- Drawer header (logo + close) -->
	<div class="flex items-center justify-between px-6 py-1 border-b border-white/10">
		<a href="/" class="flex items-center shrink-0" aria-label="Opawey - Home">
			<img src="/logo-opaway-white.svg" alt="Opawey" class="h-14 w-auto object-contain" width="187" height="56" />
		</a>
		<button
			id="nav-drawer-close"
			type="button"
			class="w-10 h-10 rounded-full border border-white/20 hover:bg-white/10 flex items-center justify-center transition-colors duration-200"
			aria-label="Close menu"
		>
			<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M6 18L18 6" />
			</svg>
		</button>
	</div>

	<!-- Scrollable nav body -->
	<nav class="overflow-y-auto max-h-[calc(100vh-4.5rem)] py-4">
		<a href="/" data-drawer-link class="block px-6 py-3 text-base font-medium tracking-wide hover:bg-white/5" data-i18n-el="ΑΡΧΙΚΗ" data-i18n-es="INICIO">HOME</a>
		<a href="/about" data-drawer-link class="block px-6 py-3 text-base font-medium tracking-wide hover:bg-white/5" data-i18n-el="ΣΧΕΤΙΚΑ ΜΕ ΕΜΑΣ" data-i18n-es="SOBRE NOSOTROS">ABOUT US</a>

		<!-- Book Online (always expanded inline on mobile) -->
		<div class="px-6 pt-3 pb-1 text-xs uppercase tracking-widest text-white/50" data-i18n-el="ΚΡΑΤΗΣΗ ONLINE" data-i18n-es="RESERVAR ONLINE">BOOK ONLINE</div>
		<a href="/book/transfer" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Κράτηση μεταφοράς" data-i18n-es="Reservar un traslado">Book a Transfer</a>
		<a href="/book/hourly" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Ενοικίαση με την ώρα" data-i18n-es="Alquiler por hora">Rent per hour</a>
		<a href="/book/tour" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Κράτηση τουρ" data-i18n-es="Reservar un tour">Book a Tour</a>
		<a href="/experiences" data-drawer-link class="block pl-10 pr-6 py-3 text-sm hover:bg-white/5" data-i18n-el="Εμπειρίες" data-i18n-es="Experiencias">Experiences</a>

		<a href="/work-with-us" data-drawer-link class="block px-6 py-3 mt-2 text-base font-medium tracking-wide hover:bg-white/5" data-i18n-el="ΣΥΝΕΡΓΑΣΙΑ" data-i18n-es="TRABAJA CON NOSOTROS">WORK WITH US</a>
		<a href="/contact" data-drawer-link class="block px-6 py-3 text-base font-medium tracking-wide hover:bg-white/5" data-i18n-el="ΕΠΙΚΟΙΝΩΝΙΑ" data-i18n-es="CONTACTO">CONTACT</a>

		<!-- Sign in row (visible to guests only) -->
		<div class="sm:hidden px-6 pt-4">
			<a href="/login" data-drawer-link class="inline-flex items-center justify-center w-full gap-2 bg-white text-[#000724] font-medium px-5 py-3 rounded-full hover:bg-neutral-100 transition-colors" data-i18n-el="Συνδεθείτε" data-i18n-es="Iniciar sesión">Sign in</a>
		</div>
	</nav>
</div>
```

(`max-h-[calc(100vh-4.5rem)]` keeps the drawer scrollable on small phones if the language is set to Greek and labels grow.)

- [ ] **Step 2: Verify drawer renders closed**

Run: `npm run build && grep -c 'id="nav-drawer"' dist/index.html`
Expected: `1`. Open the page — drawer must be invisible (off-screen above) until the burger is tapped.

---

## Task 4: Wire the burger / drawer toggle inside `initNavbar()`

**Files:**
- Modify: `src/components/Navbar.astro` — extend the existing `<script>` block (the one that begins with `import { supabase } from '../lib/supabase';`). All new code lives inside the existing module so we don't add a second script tag.

- [ ] **Step 1: Add an `initDrawer()` helper above `initNavbar()`**

Inside the `<script>` block, immediately before the `async function initNavbar() {` line (around line 186), insert:

```ts
	function initDrawer() {
		const burger = document.getElementById('nav-burger');
		const drawer = document.getElementById('nav-drawer');
		const backdrop = document.getElementById('nav-drawer-backdrop');
		const closeBtn = document.getElementById('nav-drawer-close');
		if (!burger || !drawer || !backdrop) return;

		const open = () => {
			drawer.classList.remove('-translate-y-full');
			backdrop.classList.remove('hidden');
			burger.setAttribute('aria-expanded', 'true');
			document.body.style.overflow = 'hidden';
		};
		const close = () => {
			drawer.classList.add('-translate-y-full');
			backdrop.classList.add('hidden');
			burger.setAttribute('aria-expanded', 'false');
			document.body.style.overflow = '';
		};

		burger.addEventListener('click', () => {
			const isOpen = burger.getAttribute('aria-expanded') === 'true';
			isOpen ? close() : open();
		});
		closeBtn?.addEventListener('click', close);
		backdrop.addEventListener('click', close);
		document.querySelectorAll<HTMLAnchorElement>('[data-drawer-link]').forEach((a) => {
			a.addEventListener('click', close);
		});
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') close();
		});
	}
```

- [ ] **Step 2: Wire the BOOK ONLINE dropdown to also toggle on click (touch support)**

Still inside the `<script>` block, immediately after `initDrawer()` add:

```ts
	function initDesktopDropdownTap() {
		const trigger = document.querySelector<HTMLButtonElement>('[data-href="/book"]');
		const panel = trigger?.nextElementSibling as HTMLElement | null;
		if (!trigger || !panel) return;
		// On touch / coarse pointers, a click toggles the dropdown's visibility
		// classes (overrides the hover-only group: classes Tailwind emits).
		trigger.addEventListener('click', (e) => {
			e.preventDefault();
			const isOpen = panel.classList.contains('group-tap-open');
			panel.classList.toggle('group-tap-open', !isOpen);
			panel.classList.toggle('opacity-100', !isOpen);
			panel.classList.toggle('visible', !isOpen);
			panel.classList.toggle('translate-y-0', !isOpen);
			panel.classList.toggle('opacity-0', isOpen);
			panel.classList.toggle('invisible', isOpen);
			panel.classList.toggle('translate-y-1', isOpen);
		});
		// Close on outside click
		document.addEventListener('click', (e) => {
			if (!trigger.parentElement?.contains(e.target as Node)) {
				panel.classList.remove('group-tap-open', 'opacity-100', 'visible', 'translate-y-0');
				panel.classList.add('opacity-0', 'invisible', 'translate-y-1');
			}
		});
	}
```

- [ ] **Step 3: Call both helpers from `initNavbar()`**

Find the line `// Active link highlight` near the top of `initNavbar()` (around line 187) and add two lines immediately above it:

```ts
		// Drawer + dropdown setup (idempotent — re-runs on every astro:page-load)
		initDrawer();
		initDesktopDropdownTap();
```

- [ ] **Step 4: Make sure the drawer auto-closes on view transitions**

Inside the `<script>` block, find the bottom line:

```ts
	document.addEventListener('astro:page-load', initNavbar);
```

Replace it with:

```ts
	document.addEventListener('astro:page-load', () => {
		// Reset body scroll lock and drawer position from any previous page
		document.body.style.overflow = '';
		document.getElementById('nav-drawer')?.classList.add('-translate-y-full');
		document.getElementById('nav-drawer-backdrop')?.classList.add('hidden');
		document.getElementById('nav-burger')?.setAttribute('aria-expanded', 'false');
		initNavbar();
	});
```

(This protects against a corner case where the user navigates via View Transitions while the drawer is open.)

---

## Task 5: Build, manual smoke-test, commit, push

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Verify markup**

Run:

```bash
grep -c 'nav-burger' dist/index.html         # expect: 2 (button + icon)
grep -c 'nav-drawer'  dist/index.html         # expect: 4+ (drawer, drawer-close, drawer-backdrop, controls=)
grep -c 'data-drawer-link' dist/index.html    # expect: 7 (HOME, ABOUT, 4 booking, WORK, CONTACT, optionally Sign in)
```

If any number is 0 the markup didn't reach the build — re-check the Astro frontmatter for stray syntax.

- [ ] **Step 3: Smoke-test in Chrome devtools**

Run: `npm run dev` in the background, open `http://localhost:4321/` in Chrome, then:

1. Set viewport to **1280 × 800** → centre nav visible, no burger.
2. Set viewport to **1023 × 700** → centre nav hidden, burger visible.
3. Tap burger → drawer slides down from top, backdrop appears, body cannot scroll.
4. Tap "BOOK ONLINE" sub-items list (already expanded) → navigates and drawer closes.
5. Re-open drawer, tap backdrop → drawer closes, body scrolls again.
6. Re-open drawer, press `Escape` → drawer closes.
7. Set viewport to **375 × 700** (iPhone SE) → "Sign in" pill in top bar is hidden, replaced by the in-drawer pill.

If any of those fail, return to the relevant Task and inspect the JS console for errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.astro docs/superpowers/plans/2026-05-01-navbar-responsive.md
git commit -m "feat(navbar): responsive mobile/tablet drawer with hamburger toggle"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review Checklist

- [ ] On `≥ lg` (1024 px+) the navbar looks identical to before — no visual diff.
- [ ] Below `lg` the centre nav is hidden and a hamburger appears in the right cluster.
- [ ] The drawer slides from the top, has a close X, and lists every centre-nav link plus the four Book Online sub-items expanded inline.
- [ ] Drawer closes on: X tap, backdrop tap, link tap, `Escape`, and view-transition page-load.
- [ ] Body scroll is locked while the drawer is open and unlocked when it closes.
- [ ] BOOK ONLINE button toggles its dropdown on tap (works on tablet touch devices) without breaking the desktop hover behavior.
- [ ] No new files. No new dependencies. Single component touched.
