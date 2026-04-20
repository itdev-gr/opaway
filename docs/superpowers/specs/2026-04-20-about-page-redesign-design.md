# About Us Page Redesign — Design Spec

**Date:** 2026-04-20
**Scope:** Visual redesign of `/about` page only. All existing copy is preserved verbatim — no additions, no removals, no wording changes.
**Files in scope:**
- `src/pages/about.astro`
- `src/components/about/AboutHero.astro`
- `src/components/about/AboutStory.astro`
- `src/components/about/AboutFleet.astro`
- `src/components/about/AboutCommitment.astro`
- `src/layouts/Layout.astro` (font imports only)

---

## Goals

1. Elevate the About Us page from a generic-feeling layout to a warm, editorial, hospitality-forward experience.
2. Anchor the design in the "Mediterranean Warmth" direction — a palette and type language that reflects the Greek/Mexican origin story of the Opawey brand.
3. Improve visual hierarchy, reading rhythm, and perceived quality without changing any written content.

## Non-goals

- No copy changes (add / remove / rewrite). Text stays identical.
- No route, URL, or IA change.
- No changes to Navbar, Footer, or any other page.
- No new backend/data dependencies.

---

## Design Direction: Mediterranean Warmth

Selected direction: warm, human, sunlit. Terracotta paired with the existing Aegean blue. Friendly serif italics + humanist sans. Soft curved shapes and organic blob accents. Echoes the brand's "OPA + WEY" cultural fusion rather than defaulting to generic luxury minimalism.

---

## Design Tokens (shared)

### Colors

| Token | Value | Purpose |
|---|---|---|
| `primary-blue` | `#0C6B95` | Brand Aegean blue, existing — primary accent |
| `terracotta` | `#C97B4A` | NEW secondary accent, warmth |
| `sand` | `#F5D4A8` | NEW light accent for rules, highlights, on-dark text |
| `cream` | `#FFF8F0` | NEW soft background for sections |
| `charcoal-teal` | `#2B3A3A` | NEW heading text (replaces stark `#111`) |
| `warm-neutral` | `#6b5a47` | NEW body text (replaces cold `text-neutral-500`) |

These are applied as inline `#HEX` values (consistent with how the codebase uses `#0C6B95` and `#F5F6F8` today) — no Tailwind config changes required.

### Typography

- **Headings:** Playfair Display (serif, loaded via Google Fonts).
- **Body + UI:** Inter (humanist sans, loaded via Google Fonts).
- **Eyebrow labels:** Inter, tracked-uppercase, prefixed with a `✦` diamond glyph (replacing the current filled-circle dot).

Font import: add `<link>` tags to `<head>` in `src/layouts/Layout.astro`. Fonts apply via Tailwind utility classes (`font-serif` / `font-sans`) and a small utility block in `src/styles/global.css` to register the families.

### Shape language

- Radii: `rounded-3xl` on cards and image frames (was `rounded-2xl`).
- Decorative absolute-positioned blob circles (terracotta, blue, sand) at low opacity (~5–18%) for organic accents.
- Thin hand-drawn-style wavy SVG dividers where appropriate (section breaks, card dividers).

### Motion

- Scroll reveals: fade-up with Intersection Observer; no animation library.
- Stagger delays: 0 / 100 / 200 ms for grouped items.
- Hover lifts: `-translate-y-1` + shadow deepen.
- Smooth-scroll globally; respect `prefers-reduced-motion: reduce` (skip reveals + transforms).

---

## Section 1: Hero (`AboutHero.astro`)

**Kept:** The existing sea background video (`/sea-2025-12-17-09-44-18-utc.mp4`), all copy verbatim.

**Changes:**

- **Overlay:** Replace `bg-black/55` with a tri-color warm wash: `linear-gradient(115deg, rgba(43,58,58,0.7) 0%, rgba(201,123,74,0.55) 50%, rgba(12,107,149,0.55) 100%)`.
- **Content alignment:** Move from `items-center justify-center text-center` to `items-start justify-end text-left` — heading and paragraphs sit bottom-left at roughly `pb-20 px-6 lg:px-10` with a `max-w-3xl` cap.
- **Eyebrow:** Replace the `w-2 h-2 rounded-full` blue dot with a `w-8 h-[2px] bg-[#F5D4A8]` short sand rule, followed by the existing "Who We Are" label styled in sand color.
- **Heading:** "About Us" rendered in Playfair Display, size unchanged (`text-5xl lg:text-7xl`). Append a terracotta italic period styling: the final period in "About Us." is wrapped in a `<span class="italic text-[#C97B4A]">` for accent.
- **Highlighted keywords in paragraph 1:**
  - `"OPA,"` → warm sand (`#F5D4A8`), `font-semibold`
  - `"WEY,"` → light cyan / sand-contrast accent or white-bold — use `#9BD4EC` (light blue-tint for contrast on the warm wash)
  - `"way,"` → white, `font-semibold`
  (Currently all three are identical blue; differentiating them mirrors the origin-story meaning.)
- **Sun accent:** Small 48px radial-gradient circle (`radial-gradient(circle, #F5D4A8 0%, #C97B4A 100%)`) with a soft sand-colored box-shadow glow in the top-right corner (absolute-positioned).
- **Bottom fade:** `bg-gradient-to-t from-white to-transparent` → `bg-gradient-to-t from-[#FFF8F0] to-transparent` so the transition into the next (cream) section is seamless.
- **Scroll reveal:** Heading + paragraphs fade-up on mount (150 ms stagger).

---

## Section 2: Our Story (`AboutStory.astro`)

**Kept:** 2-column layout, all copy verbatim, blockquote content, "100%" stat label.

**Changes:**

- **Section background:** `bg-white` → `bg-[#FFF8F0]` (cream).
- **Eyebrow:** `✦` glyph replaces the blue dot. Label in `#6b5a47`.
- **Blockquote:** Remove the `border-l-4 border-[#0C6B95] pl-5` rule. Replace with a large decorative terracotta opening `"` glyph rendered in Playfair Display at ~`text-8xl`, color `#C97B4A`, opacity 40%, absolute-positioned behind the quote text (top-left). The quote itself stays in Playfair italic, `text-xl lg:text-2xl`, color `#2B3A3A`.
- **Body paragraphs:** Color `text-neutral-500` → `text-[#6b5a47]`, size `text-base` → `text-lg` for breathing room.
- **Highlight box** (the "Our goal is simple" footer box):
  - Background: `bg-[#F5F6F8]` → `bg-gradient-to-br from-[#FFF8F0] to-[#F5D4A8]/40`
  - Add a `border-l-4 border-[#C97B4A]` terracotta accent bar on the left (replaces the original gray fill-only treatment)
  - The inline highlighted words keep their emphasis: `seamless` / `memorable` → `text-[#C97B4A] font-semibold`; `elegance, comfort, and authentic hospitality` → `text-[#2B3A3A] font-semibold`
- **Image:**
  - `rounded-2xl` → `rounded-3xl`
  - Shadow: `shadow-xl` → a custom warm-toned shadow (`shadow-[0_30px_60px_-15px_rgba(201,123,74,0.35)]`)
  - Vertical offset: add `lg:translate-y-10` so the image sits ~40px lower than the text column, breaking the rigid symmetric grid
- **Floating "100%" card:**
  - Reposition from `-bottom-6 -left-6` → `-top-6 -right-6`
  - Background `bg-[#0C6B95]` → `bg-[#C97B4A]` (terracotta — creates color dialogue across the page)
  - Same content, same typography size, `rounded-3xl`
- **Decorative accent:** Add a small blue blob (`w-20 h-20 rounded-full bg-[#0C6B95] opacity-20`) absolute-positioned behind the bottom-left corner of the image.
- **Scroll reveal:** Text column fades-up from left, image column fades-up from right (100 ms stagger).

---

## Section 3: Our Fleet (`AboutFleet.astro`)

**Kept:** All 3 vehicle entries (Sedan, Van, Minibus), all feature bullets, all model strings, existing images (`/car.avif`, `/mini_van.avif`, `/van.avif`).

**Changes:**

- **Section background:** `bg-[#F5F6F8]` (cold gray) → `bg-[#FFF8F0]` (cream).
- **Header:**
  - Eyebrow gains `✦` glyph
  - Heading "Discover our service classes" rendered in Playfair Display with the word "classes" italicized + terracotta (`italic text-[#C97B4A]`)
- **Cards:**
  - Radius: `rounded-2xl` → `rounded-3xl`
  - Shadow: `shadow-sm` → warm-toned layered shadow `shadow-[0_20px_50px_-20px_rgba(201,123,74,0.25)]`
  - Image area:
    - Add a bottom gradient overlay `linear-gradient(to top, rgba(201,123,74,0.25), transparent 50%)` for depth
    - Add a **passenger-count badge** (circular) anchored top-left — `w-14 h-14 rounded-full bg-[#0C6B95] text-white ring-4 ring-[#FFF8F0]` showing `3` / `8` / `18` respectively. The number is parsed from the feature string "Fits up to N people" at component level (see Data-derivation note below).
  - Title (`v.title`): Playfair Display, `text-[#2B3A3A]`
  - Models line (`v.models`): `italic text-sm text-[#6b5a47]`
  - Divider: the current `w-16 h-1 bg-[#0C6B95] rounded-full` becomes a small inline SVG wavy line (~40×8) stroke `#C97B4A` — an organic hand-drawn feel
  - Feature check icon: replace the current outlined SVG checkmark with a filled `✓` glyph in terracotta (`text-[#C97B4A]`)
  - Feature label text color: `text-neutral-600` → `text-[#6b5a47]`
- **Hover:** `hover:-translate-y-1 hover:shadow-[0_30px_70px_-20px_rgba(201,123,74,0.4)]`, image `group-hover:scale-[1.02]` with `transition-transform duration-500`.
- **Stagger reveal:** card 1 at 0ms, card 2 at 100ms, card 3 at 200ms.

### Data-derivation note

The passenger count badge (3 / 8 / 18) is derived from the first feature string, which already contains "Fits up to N people". Extract with a regex at the top of the component:

```ts
const paxCount = (features) => {
  const m = features.find((f) => /Fits up to/.test(f))?.match(/(\d+)/);
  return m ? m[1] : null;
};
```

No text is added or removed — the count is re-used from the existing feature text purely as visual signal.

---

## Section 4: Our Commitment (`AboutCommitment.astro`)

**Kept:** All 4 value entries, the `Mission` and `Vision` copy verbatim, the 4-card values grid, all SVG icons.

**Changes:**

- **Section background:** `bg-white` → a vertical split: top half `bg-[#FFF8F0]`, bottom half `bg-[#FFF8F0]` with a very subtle terracotta radial tint at the bottom. In practice one base color `bg-[#FFF8F0]` with an overlay pseudo-element for the tint.
- **Header:**
  - Eyebrow `✦`
  - Heading "Principles that define / our essence" — the line break preserved; "essence" styled as `italic text-[#C97B4A]` in Playfair
  - Right-hand intro paragraph: color `text-neutral-500` → `text-[#6b5a47]`, alignment stays `lg:text-right`

### Mission vs Vision — differentiated pair

Replace the two identical blue cards with complementary counterparts. Same size, same radius (`rounded-3xl`), same padding:

- **Mission card (action-oriented):**
  - Background: `bg-[#0C6B95]` (kept)
  - Text: cream `text-[#FFF8F0]` on blue
  - Icon chip: `w-14 h-14 rounded-2xl bg-[#C97B4A]` with the existing lightning-bolt SVG in white — terracotta chip creates a warm focal point on the blue card
  - Heading: Playfair Display, cream
  - Body: `text-[#FFF8F0]/85`, Inter
  - Decorative blob: `w-40 h-40 rounded-full bg-[#F5D4A8] opacity-15 absolute -bottom-10 -right-10`

- **Vision card (aspiration-oriented):**
  - Background: `bg-[#FFF8F0]` with `border border-[#C97B4A]/30`
  - Text: `text-[#2B3A3A]`
  - Icon chip: `w-14 h-14 rounded-2xl bg-[#0C6B95]` with the existing eye SVG in white — blue chip on the warm card mirrors the Mission card's inversion
  - Heading: Playfair Display, charcoal-teal
  - Body: `text-[#6b5a47]`, Inter
  - Decorative blob: `w-40 h-40 rounded-full bg-[#0C6B95] opacity-10 absolute -bottom-10 -right-10`

They read as a pair in dialogue: one grounded, one aspirational; blue↔cream, icon-chip colors inverted.

### 4 Values grid

- **Cards:** Background `bg-[#F5F6F8]` → `bg-[#FFF8F0]` with a subtle terracotta `border border-[#C97B4A]/15`. Radius `rounded-2xl` → `rounded-3xl`.
- **Watermark numbers (01–04):** Color `text-neutral-200` → `text-[#C97B4A]/8`; on hover `group-hover:text-[#C97B4A]/14`.
- **Icon chips:** Currently all `bg-[#0C6B95]`. Alternate colors by index for visual rhythm:
  - Safety (0): blue `#0C6B95`
  - Hospitality (1): terracotta `#C97B4A`
  - Excellence (2): blue `#0C6B95`
  - Flexibility (3): terracotta `#C97B4A`
- **Wavy SVG divider:** Small 40×8 terracotta wavy line placed between the icon chip and the title.
- **Heading:** Playfair Display, `text-[#2B3A3A]`
- **Body:** Inter, `text-[#6b5a47]`
- **Corner blob accent:** Alternating `#0C6B95` / `#C97B4A` at ~5% opacity, absolute-positioned bottom-right, matching the alternating chip color.
- **Hover:** `-translate-y-1`, watermark opacity lifts from 8% → 14%, subtle shadow.
- **Stagger reveal:** 0 / 100 / 200 / 300 ms across the four cards.

---

## Section 5: Globals

### Font loading

In `src/layouts/Layout.astro` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Inter:wght@300..700&display=swap" rel="stylesheet" />
```

In `src/styles/global.css`, add:

```css
@import "tailwindcss";

@layer base {
  body {
    font-family: "Inter", system-ui, sans-serif;
  }
  .font-serif {
    font-family: "Playfair Display", Georgia, serif;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal,
  .reveal-stagger > * {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
}
```

### Scroll reveals

Create `src/components/about/ScrollReveal.astro` — a small wrapper component that:

- Renders `<div class="reveal translate-y-4 opacity-0 transition-all duration-700">` around its slot.
- Includes a tiny inline `<script>` that uses IntersectionObserver to add a `.is-visible` class (which transitions `translate-y-0 opacity-100`) as elements enter the viewport.
- Accepts a `delay` prop (ms) to support stagger.

Wrap key elements (headings, paragraph blocks, cards) in the About components with `<ScrollReveal>`.

### Section dividers

Between Story → Fleet and Fleet → Commitment, render a thin `~80px` wavy SVG divider at ~15% opacity terracotta stroke, full-width. Kept purely decorative (`aria-hidden="true"`).

### Smooth-scroll

Add `html { scroll-behavior: smooth; }` in `global.css`.

---

## Testing & Acceptance

### Content parity (hard constraint)

Every visible text string on `/about` after the redesign must be identical (character-for-character, excluding whitespace normalization) to the current page. Acceptance script: visually diff rendered text, or run a quick text-extraction comparison. Any diff is a regression.

### Visual acceptance

- Hero overlay reads warm, not black
- OPA / WEY / way are visually distinct in color
- Story blockquote has decorative `"` glyph; no left border rule
- "100%" card is terracotta, top-right of the image
- Fleet passenger badges are visible top-left of each vehicle image (3 / 8 / 18)
- Mission card is blue with terracotta chip; Vision card is cream with blue chip
- Values grid: icon chips alternate blue/terracotta
- Scroll reveals fire on first enter, not on every scroll
- `prefers-reduced-motion: reduce` disables reveals

### Browser QA

- Chrome + Safari at 1440px, 1024px, 768px (tablet), 375px (mobile)
- Hero bottom-left text stays legible at all breakpoints (stack gracefully if needed)
- Story section image offset does not create ugly overlap at `< lg`
- Passenger badge does not collide with card image content at mobile width

### Performance

- Google Fonts loaded with `display=swap`; acceptable CLS
- No new JS libraries; Intersection Observer is native
- Videos untouched (existing sea mp4)

---

## Risks / Open Questions

1. **Font load flash:** First paint may briefly show Georgia + system-ui before Playfair/Inter arrive. Acceptable with `display=swap`; no further mitigation planned.
2. **Image currently placeholder:** `AboutStory` uses `https://picsum.photos/seed/opaway-story/800/1000`. The redesign does not change this — the user can swap later; it is out of scope for this spec.
3. **Wavy SVG divider assets:** Small inline SVGs authored during implementation; no external asset dependency.

---

## Out of Scope

- Navbar, Footer, any other page
- Copy edits of any kind
- Image content swaps (placeholder URL remains; this is a styling change)
- Adding new data or CMS wiring
- Dark mode / theme switching
