# Per-Card Image Carousel for Tours & Experiences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/book/tour` and `/experiences`, render every image stored in a tour/experience's `images` jsonb array as a mini image carousel inside the card (featured card **and** catalog-grid card). Today the frontend only shows `images[0]`; the rest are invisible to customers even though admins can upload up to 10.

**Architecture:** One shared vanilla-JS helper `src/lib/image-carousel.ts` with two exports — `renderImageCarouselHTML(...)` returns the markup (all images stacked, arrows hidden behind a `group/carousel` hover gate, dot indicators, single-image fallback) and `initImageCarousels(root)` scans the root element for `[data-image-carousel]` attributes and wires up the interactions. Caller passes the aspect-ratio wrapper class and optional per-image class so both the 16:9 featured card and the 4:3 catalog-grid card (with its existing `group-hover:scale-105` zoom) are covered by the same helper. Hand-rolled, no new dependencies — matches the existing outer card-level carousel's implementation style in `tour.astro` / `experiences.astro`.

**Tech Stack:** Astro 5 (file-based routing, inline `<script>`), TypeScript, Tailwind v4 (using the named-group feature `group/carousel`).

**Out of scope (explicit):**
- No changes to admin upload UI — `manage-tours.astro` / `manage-experiences.astro` already upload up to 10 images into `images[]` with `images[0]` as cover. Good as-is.
- No schema changes — `tours_catalog.images` and `experiences_catalog.images` (both `jsonb`, default `'[]'`) already exist and are backfilled (see `db/migrations/2026-04-22-tours-catalog-categories.sql`).
- No swipe / drag gesture support in v1 — arrows + dots only. Touch users can tap arrows/dots. Swipe is a later enhancement.
- No auto-advance / autoplay.
- No keyboard arrow-key navigation inside the carousel (buttons are focusable `<button>` so Tab + Enter works; left/right keys are a nice-to-have deferred to later).
- No lightbox / fullscreen view.
- No changes to the **outer** card-level carousel on the featured sections (the "1 / 8" cycling between tours) — it keeps working untouched.

---

## Current state (verified before writing this plan)

- `tours_catalog` schema: `image_url text`, `images jsonb default '[]'`. Admin UI enforces max 10 images, treats `images[0]` as cover.
- `experiences_catalog` schema: identical — `image_url` + `images jsonb`, same admin UX.
- Both `jsonb` columns were **backfilled** on 2026-04-22, so every existing row has `images` populated from its old `image_url`. No DB work needed.
- `src/pages/book/tour.astro`:
  - Featured card render at lines **242–278**, cover derived as `(Array.isArray(t.images) && t.images[0]) || t.image_url || ''`.
  - Catalog-grid card render at lines **359–395**, same cover derivation.
  - Outer card-level carousel wired at lines **280–330** (prev/next/indicator).
- `src/pages/book/experiences.astro`:
  - Featured card render at lines **316–351** — **bug**: reads only `t.image_url`, ignores the `images` array entirely.
  - Catalog-grid card render at lines **424–…** — **same bug**: reads only `t.image_url`.
  - `ExperienceItem` interface at line 280 has no `images` field (also needs fixing).
- No test runner configured (no `test` script in `package.json`, no `*.test.*` files). Verification = `astro build` (type-check) + manual browser walkthrough against a tour/experience that has ≥2 images.
- Tailwind v4.2.1 is installed — supports the named-group variant syntax `group/carousel` + `group-hover/carousel:...` used below.

## File structure (after plan executes)

### New files

| Path | Responsibility |
|---|---|
| `src/lib/image-carousel.ts` | `renderImageCarouselHTML({ images, alt, wrapperClass, imgClass? })` returns the full aspect-wrapper markup (stacked images, overlaid arrows with hover-gate, dot indicators, single-image short-circuit). `initImageCarousels(root)` finds every `[data-image-carousel]` inside `root` and wires up prev/next/dot click handlers with an opacity crossfade. Pure DOM, no Supabase. |

### Modified files

| Path | Change |
|---|---|
| `src/pages/book/tour.astro` | Featured card + catalog-grid card: replace the single-`<img>` aspect wrapper with a call to `renderImageCarouselHTML`. After `innerHTML` assignment, call `initImageCarousels(...)` on the inner container and on the catalog grid so the new carousels are interactive. |
| `src/pages/experiences.astro` | Same as tour.astro (both surfaces). Additionally: add `images?: string[]` to the `ExperienceItem` interface and derive `images` as `(Array.isArray(t.images) && t.images.length ? t.images : (t.image_url ? [t.image_url] : []))` so legacy rows with only `image_url` still render. |

---

## Phase A — Shared image-carousel helper

### Task 1: Create `src/lib/image-carousel.ts`

**Files:**
- Create: `src/lib/image-carousel.ts`

- [ ] **Step 1: Create the file with the rendering function**

Create `src/lib/image-carousel.ts` with this content:

```ts
/**
 * Per-card image carousel. Renders a fixed-aspect wrapper containing every
 * image stacked on top of each other; only one is opaque at a time. Arrows
 * fade in on hover (desktop) and are always visible on mobile. Dots sit at
 * the bottom. Single-image inputs short-circuit to a plain <img> (no nav).
 *
 * Rendering is string-based to match the existing tour.astro / experiences.astro
 * inline-JS render pattern. Initialization is a separate pass so templates can
 * be batch-rendered first, then wired up.
 */

export interface ImageCarouselOptions {
  /** Already-escaped alt text (caller runs esc()). */
  alt: string;
  /** Tailwind classes applied to the outer aspect wrapper. */
  wrapperClass: string;
  /** Extra classes for each <img> (e.g. `group-hover:scale-105`). */
  imgClass?: string;
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderImageCarouselHTML(
  images: string[],
  { alt, wrapperClass, imgClass = '' }: ImageCarouselOptions,
): string {
  const safeImages = images.filter(u => typeof u === 'string' && u.length > 0);

  // Fallback: empty or single-image → render a plain <img>, no carousel chrome.
  if (safeImages.length <= 1) {
    const src = safeImages[0] ?? '';
    return `
      <div class="${wrapperClass} bg-neutral-100">
        <img
          src="${escAttr(src)}"
          alt="${alt}"
          class="w-full h-full object-cover ${imgClass}"
          onerror="this.parentElement.style.background='#e5e7eb';this.style.display='none'"
        />
      </div>`;
  }

  const slides = safeImages.map((src, i) => `
    <img
      src="${escAttr(src)}"
      alt="${alt}"
      data-image-slide
      data-idx="${i}"
      class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imgClass} ${i === 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
      onerror="this.style.background='#e5e7eb'"
    />
  `).join('');

  const dots = safeImages.map((_, i) => `
    <button
      type="button"
      data-image-dot
      data-idx="${i}"
      aria-label="Image ${i + 1} of ${safeImages.length}"
      class="w-1.5 h-1.5 rounded-full transition-all ${i === 0 ? 'bg-white w-4' : 'bg-white/60 hover:bg-white/80'}"
    ></button>
  `).join('');

  // Arrows: hidden on desktop by default, fade in on carousel hover via named
  // group. Always visible on mobile (<md) so touch users can tap them.
  const arrowBase = 'absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-neutral-800 shadow-md transition-opacity duration-200 md:opacity-0 md:group-hover/carousel:opacity-100';

  return `
    <div
      data-image-carousel
      class="group/carousel relative ${wrapperClass} bg-neutral-100"
    >
      ${slides}
      <button
        type="button"
        data-image-prev
        aria-label="Previous image"
        class="${arrowBase} left-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        data-image-next
        aria-label="Next image"
        class="${arrowBase} right-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
        ${dots}
      </div>
    </div>`;
}

export function initImageCarousels(root: ParentNode): void {
  const carousels = root.querySelectorAll<HTMLElement>('[data-image-carousel]');

  carousels.forEach(carousel => {
    // Skip if already wired (idempotent — defensive against double-init).
    if (carousel.dataset.imageCarouselReady === '1') return;
    carousel.dataset.imageCarouselReady = '1';

    const slides = Array.from(carousel.querySelectorAll<HTMLImageElement>('[data-image-slide]'));
    const dots   = Array.from(carousel.querySelectorAll<HTMLButtonElement>('[data-image-dot]'));
    const prev   = carousel.querySelector<HTMLButtonElement>('[data-image-prev]');
    const next   = carousel.querySelector<HTMLButtonElement>('[data-image-next]');
    if (slides.length <= 1) return;

    let current = 0;

    function show(idx: number) {
      const target = (idx + slides.length) % slides.length;
      if (target === current) return;

      slides[current].classList.remove('opacity-100');
      slides[current].classList.add('opacity-0', 'pointer-events-none');
      slides[target].classList.remove('opacity-0', 'pointer-events-none');
      slides[target].classList.add('opacity-100');

      dots[current]?.classList.remove('bg-white', 'w-4');
      dots[current]?.classList.add('bg-white/60', 'hover:bg-white/80');
      dots[target]?.classList.add('bg-white', 'w-4');
      dots[target]?.classList.remove('bg-white/60', 'hover:bg-white/80');

      current = target;
    }

    prev?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      show(current - 1);
    });
    next?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      show(current + 1);
    });
    dots.forEach((dot, i) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        show(i);
      });
    });
  });
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx astro check --minimumSeverity error src/lib/image-carousel.ts` (or `npm run build` if `astro check` isn't wired — the project uses `astro build`).

Expected: no errors. If `astro check` reports unknown-type issues on `ParentNode`, the lib dom types are already included by Astro — no change needed. If a lint error appears about `dataset` assignment, it's fine (standard DOM API).

- [ ] **Step 3: Commit**

```bash
git add src/lib/image-carousel.ts
git commit -m "feat(lib): add shared image-carousel helper for tour/experience cards"
```

---

## Phase B — Wire into `/book/tour`

### Task 2: Replace single images with carousels on the tour page (featured card + catalog grid)

**Files:**
- Modify: `src/pages/book/tour.astro` — import at line 185–188 block, featured render at lines 242–278 (specifically 247–254), catalog render at lines 364–395 (specifically 366–373), outer init site after featured innerHTML assignment (~line 278) and after catalog innerHTML (~line 395).

- [ ] **Step 1: Add the import**

Edit `src/pages/book/tour.astro` — add `image-carousel` to the existing import block near line 185:

```ts
import { supabase } from '../../lib/supabase';
import { applyPartnerDiscount } from '../../lib/pricing';
import { showFieldError, clearFormErrors, wireAutoClear } from '../../lib/form-errors';
import { attachPlacesAutocomplete } from '../../lib/places-autocomplete';
import { renderImageCarouselHTML, initImageCarousels } from '../../lib/image-carousel';
```

- [ ] **Step 2: Replace the featured-card image block**

In the featured carousel render (the `inner.innerHTML = docs.map((t, i) => { ... })` block starting ~line 242), replace the existing cover-image derivation and `<div class="aspect-[16/9] overflow-hidden">…</div>` block.

**Before** (lines 242–254 region):

```ts
inner.innerHTML = docs.map((t, i) => {
    const cover = (Array.isArray(t.images) && t.images[0]) || t.image_url || '';
    const highlights = [t.highlight1, t.highlight2, t.highlight3].filter(Boolean);
    return `
    <article data-tour-card class="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm flex flex-col ${i === 0 ? '' : 'hidden'}">
        <div class="aspect-[16/9] overflow-hidden">
            <img
                src="${esc(cover)}"
                alt="${esc(t.title)}"
                class="w-full h-full object-cover"
                onerror="this.parentElement.style.background='#e5e7eb';this.style.display='none'"
            />
        </div>
```

**After:**

```ts
inner.innerHTML = docs.map((t, i) => {
    const images = (Array.isArray(t.images) && t.images.length > 0)
        ? t.images
        : (t.image_url ? [t.image_url] : []);
    const highlights = [t.highlight1, t.highlight2, t.highlight3].filter(Boolean);
    return `
    <article data-tour-card class="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm flex flex-col ${i === 0 ? '' : 'hidden'}">
        ${renderImageCarouselHTML(images, {
            alt: esc(t.title),
            wrapperClass: 'aspect-[16/9] overflow-hidden',
        })}
```

Do **not** touch the rest of the article (duration / title / description / highlights block and the closing `</article>`).

- [ ] **Step 3: Initialize carousels inside the featured inner after render**

Immediately after the `inner.innerHTML = docs.map(...).join('');` line (just before the `/* Init carousel */` comment that wires the **outer** tour carousel, ~line 280), add:

```ts
                }).join('');

                initImageCarousels(inner);

                /* Init carousel */
```

That one line hooks up every per-card image carousel at once. It must run **before** the outer tour carousel's init so the init runs while all cards are still in the DOM (some cards have the `hidden` class but that doesn't prevent querying).

- [ ] **Step 4: Replace the catalog-grid image block**

In the catalog-grid render (the `catalogGrid.innerHTML = ... + docs.map(t => { ... }).join('');` block, ~line 359–395), replace the cover derivation and the `<div class="aspect-[4/3] ...">` wrapper.

**Before** (lines 360–373 region):

```ts
catalogGrid.innerHTML = (partnerDiscount > 0 ? `...` : '') + docs.map(t => {
    const cover = (Array.isArray(t.images) && t.images[0]) || t.image_url || '';
    const fromPrice = Number(t.price_sedan ?? t.price ?? 0);
    const dp = applyPartnerDiscount(fromPrice, partnerDiscount);
    const showOriginal = partnerDiscount > 0 && dp.originalPrice !== dp.discountedPrice;
    return `
    <div class="group bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-100 hover:shadow-xl transition-shadow duration-300">
        <div class="aspect-[4/3] overflow-hidden bg-neutral-100">
            <img
                src="${esc(cover)}"
                alt="${esc(t.title)}"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onerror="this.parentElement.style.background='#f3f4f6';this.style.display='none'"
            />
        </div>
```

**After:**

```ts
catalogGrid.innerHTML = (partnerDiscount > 0 ? `...` : '') + docs.map(t => {
    const images = (Array.isArray(t.images) && t.images.length > 0)
        ? t.images
        : (t.image_url ? [t.image_url] : []);
    const fromPrice = Number(t.price_sedan ?? t.price ?? 0);
    const dp = applyPartnerDiscount(fromPrice, partnerDiscount);
    const showOriginal = partnerDiscount > 0 && dp.originalPrice !== dp.discountedPrice;
    return `
    <div class="group bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-100 hover:shadow-xl transition-shadow duration-300">
        ${renderImageCarouselHTML(images, {
            alt: esc(t.title),
            wrapperClass: 'aspect-[4/3] overflow-hidden',
            imgClass: 'transition-transform duration-500 group-hover:scale-105',
        })}
```

The outer `group` class (on the card div) is kept. The helper's inner `group/carousel` is a distinct named group — the card-level `group-hover:scale-105` zoom on the image still fires when the card is hovered, independently from the arrow fade-in which uses `group-hover/carousel:`.

Keep the partner-discount banner prefix (the `(partnerDiscount > 0 ? '<div>...' : '')` chunk shown as `...`) verbatim — don't rewrite it.

- [ ] **Step 5: Initialize carousels inside the catalog grid after render**

Immediately after the `catalogGrid.innerHTML = ...;` statement (just before `catalogSection.classList.remove('hidden');`, ~line 397), add:

```ts
            }).join('');

            initImageCarousels(catalogGrid);

            catalogSection.classList.remove('hidden');
```

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: build succeeds. If TypeScript complains that `t.images` is `any`/`unknown`, that's OK — existing code already uses the same pattern without issue (see the pre-existing `Array.isArray(t.images) && t.images[0]` guard on line 243).

- [ ] **Step 7: Manual browser verification**

Run: `npm run dev` and open `http://localhost:4321/book/tour`.

Verify:
1. Featured card (right panel): hover the image → prev/next arrows fade in over left/right edges; dots visible at bottom. Click next → image crossfades to image 2; dot indicator updates. Click through all images, wraps at end. Outer tour carousel's `< 1 / N >` below card still works.
2. Catalog grid (below): same behavior on each grid card. Card's `group-hover:scale-105` zoom still fires when you hover the card body.
3. Tour that only has one image: no arrows or dots shown, just the plain image — same as before this change.
4. Tour that failed to load (broken URL): image placeholder grey background shows up; no broken-image icon cascades.

If any of 1–4 fails, fix before committing.

- [ ] **Step 8: Commit**

```bash
git add src/pages/book/tour.astro
git commit -m "feat(tour): show all tour images in a per-card carousel"
```

---

## Phase C — Wire into `/experiences`

### Task 3: Fix experiences page to read `images[]` and render a carousel (featured + grid)

The experiences page has a latent bug — it never reads `images`, only `image_url`. This task fixes that *and* adds the carousel in the same pass (they share the same rewrite surface).

**Files:**
- Modify: `src/pages/experiences.astro` — import block (~line above 280), `ExperienceItem` interface at line 280–290, featured render at lines 316–351 (specifically 319–327), catalog render at lines 424–433.

- [ ] **Step 1: Add the import**

In `src/pages/experiences.astro`, locate the existing `import` block in the page's main `<script>` (it's the block that imports `supabase` and friends — grep for `from '../lib/supabase'`). Add:

```ts
import { renderImageCarouselHTML, initImageCarousels } from '../lib/image-carousel';
```

- [ ] **Step 2: Extend the `ExperienceItem` interface**

At line 280–290, add an `images?: string[]` field:

**Before:**

```ts
interface ExperienceItem {
    id: string;
    title: string;
    description: string;
    image_url: string;
    duration: string;
    highlight1: string;
    highlight2: string;
    highlight3: string;
    published: boolean;
}
```

**After:**

```ts
interface ExperienceItem {
    id: string;
    title: string;
    description: string;
    image_url: string;
    images?: string[];
    duration: string;
    highlight1: string;
    highlight2: string;
    highlight3: string;
    published: boolean;
}
```

- [ ] **Step 3: Replace the featured-card image block**

In the featured render (`inner.innerHTML = docs.map((t, i) => { ... })` starting ~line 316), swap the `<div class="aspect-[16/9] overflow-hidden"><img .../></div>` for a carousel call and derive `images` with a fallback.

**Before** (lines 316–327 region):

```ts
inner.innerHTML = docs.map((t, i) => {
    const highlights = [t.highlight1, t.highlight2, t.highlight3].filter(Boolean);
    return `
    <article data-experience-card class="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm flex flex-col ${i === 0 ? '' : 'hidden'}">
        <div class="aspect-[16/9] overflow-hidden">
            <img
                src="${esc(t.image_url)}"
                alt="${esc(t.title)}"
                class="w-full h-full object-cover"
                onerror="this.parentElement.style.background='#e5e7eb';this.style.display='none'"
            />
        </div>
```

**After:**

```ts
inner.innerHTML = docs.map((t, i) => {
    const images = (Array.isArray(t.images) && t.images.length > 0)
        ? t.images
        : (t.image_url ? [t.image_url] : []);
    const highlights = [t.highlight1, t.highlight2, t.highlight3].filter(Boolean);
    return `
    <article data-experience-card class="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm flex flex-col ${i === 0 ? '' : 'hidden'}">
        ${renderImageCarouselHTML(images, {
            alt: esc(t.title),
            wrapperClass: 'aspect-[16/9] overflow-hidden',
        })}
```

- [ ] **Step 4: Initialize carousels inside the featured inner**

Right after the featured `inner.innerHTML = docs.map(...).join('');` (just before the outer `/* Init carousel */` block at line ~353), add:

```ts
                }).join('');

                initImageCarousels(inner);

                /* Init carousel */
```

- [ ] **Step 5: Replace the catalog-grid image block**

In the grid render (`catalogGrid.innerHTML = docs.map(t => ...)` at ~line 424), swap the single `<img>` wrapper for a carousel and derive `images` the same way.

**Before** (lines 424–433 region):

```ts
catalogGrid.innerHTML = docs.map(t => `
    <div class="group bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-100 hover:shadow-xl transition-shadow duration-300">
        <div class="aspect-[4/3] overflow-hidden bg-neutral-100">
            <img
                src="${esc(t.image_url)}"
                alt="${esc(t.title)}"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onerror="this.parentElement.style.background='#f3f4f6';this.style.display='none'"
            />
        </div>
        <div class="p-6">
```

**After:**

```ts
catalogGrid.innerHTML = docs.map(t => {
    const images = (Array.isArray(t.images) && t.images.length > 0)
        ? t.images
        : (t.image_url ? [t.image_url] : []);
    return `
    <div class="group bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-100 hover:shadow-xl transition-shadow duration-300">
        ${renderImageCarouselHTML(images, {
            alt: esc(t.title),
            wrapperClass: 'aspect-[4/3] overflow-hidden',
            imgClass: 'transition-transform duration-500 group-hover:scale-105',
        })}
        <div class="p-6">
```

Note: this step also changes the outer shape of the grid map from an arrow-expression-returning-template-literal (`docs.map(t => \`...\`)`) to a block body (`docs.map(t => { ... return \`...\`; })`). Remember to close the block with `}).join('');` at the existing end of the map — if the current tail reads `` `...`).join(''); `` it becomes `` `...`; }).join(''); ``. Follow the pattern already used in `tour.astro`.

- [ ] **Step 6: Initialize carousels inside the catalog grid**

Immediately after the `catalogGrid.innerHTML = docs.map(...).join('');` statement, and before `catalogSection.classList.remove('hidden');`, add:

```ts
            }).join('');

            initImageCarousels(catalogGrid);

            catalogSection.classList.remove('hidden');
```

- [ ] **Step 7: Type-check**

Run: `npm run build`
Expected: build succeeds with no errors related to `images` on `ExperienceItem` (that's what Step 2 fixed).

- [ ] **Step 8: Manual browser verification**

Run: `npm run dev`, open `http://localhost:4321/experiences`.

Verify the same four checks from Phase B Step 7, but on the experiences surfaces. Additionally: an experience that *only* had `image_url` set (and never had its `images` array populated beyond the backfill) should still show its single image correctly — the Step 3/5 fallback covers this.

- [ ] **Step 9: Commit**

```bash
git add src/pages/experiences.astro
git commit -m "feat(experiences): show all experience images in a per-card carousel + read images[] (was image_url only)"
```

---

## Phase D — Final verification

### Task 4: Full build + cross-browser spot-check

**Files:** none modified — this is a verification pass only.

- [ ] **Step 1: Clean production build**

Run: `npm run build`
Expected: build completes, no type errors, no unused-import warnings on the two pages. If any warning about unused `image_url` appears on experiences.astro (unlikely since the fallback still references it), resolve it.

- [ ] **Step 2: Smoke test the built site**

Run: `npm run preview`, open both `http://localhost:4321/book/tour` and `http://localhost:4321/experiences`.

Verify:
1. A tour/experience row in the database that has **≥2 images**: carousel arrows + dots render; nav works; crossfade is smooth (~300ms).
2. A row with **1 image**: plain image, no arrows/dots (not even empty containers in the DOM — confirm with DevTools).
3. A row with **0 images / invalid URL**: grey placeholder, no broken-image icon.
4. The outer card-level carousel (`1 / N` below the featured card) still cycles through tours/experiences and its prev/next don't collide with the inner arrows.
5. Catalog grid: hovering a card still triggers the image zoom (`group-hover:scale-105`) AND the arrows are tappable.
6. Mobile viewport (DevTools device toolbar, iPhone SE): inner arrows are always visible (not hidden behind hover); tapping works.

- [ ] **Step 3: If a test row with ≥2 images doesn't exist, create one**

In the Supabase dashboard (or via the admin UI at `/admin/manage-tours` and `/admin/manage-experiences`), upload a second image to an existing row. Confirm the carousel renders it.

- [ ] **Step 4: No commit for this task** — verification only. If issues surfaced in Steps 1–3, fix in place and amend the relevant prior task's commit (or add a fixup commit, depending on preference).

---

## Notes for the executor

- **DRY:** The carousel helper is called 4 times (featured + grid) × (tour + experiences). Don't inline-copy its logic. If during execution you find you need yet another variant (different arrow style, etc.), extend the options interface — don't fork the helper.
- **Hover-gate mobile caveat:** Arrows use `md:opacity-0` (hidden above 768px) + `md:group-hover/carousel:opacity-100` (shown on hover above 768px). Below 768px they're always visible. This is a viewport-size proxy for "does this device have hover?" — crude but works. A future pass can switch to a real `hover:` media query if Tailwind v4 adds one.
- **`stopPropagation` on arrow/dot clicks:** guards against the click bubbling up to any future whole-card click handler (e.g. if you later wrap the catalog card in an `<a>` tag). Cheap insurance.
- **Idempotent init:** `initImageCarousels` writes `data-image-carousel-ready="1"` so calling it twice on the same container is a no-op. Matters because the page's data-load path might re-render (partner-discount fetch resolves after initial render in `tour.astro`).
- **No detail pages yet:** if `/book/tour/[id].astro` or `/experiences/[id].astro` detail pages are added later, they'll want a bigger lightbox-style gallery, not this mini carousel. Don't try to reuse this component there.
