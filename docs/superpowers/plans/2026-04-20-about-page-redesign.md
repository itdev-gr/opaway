# About Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the visual presentation of `/about` in the Mediterranean Warmth direction (terracotta + Aegean blue, Playfair + Inter), keeping every word of the existing copy identical.

**Architecture:** Astro + Tailwind CSS 4. All four existing About components (`AboutHero`, `AboutStory`, `AboutFleet`, `AboutCommitment`) are rewritten in place. Two new small components are introduced for reuse: `ScrollReveal` (IntersectionObserver fade-up wrapper) and `WavyDivider` (decorative SVG between sections). Font families load via Google Fonts link in `Layout.astro`; families are registered in `global.css` so `font-serif` and `font-sans` Tailwind utilities resolve correctly.

**Tech Stack:** Astro 5, Tailwind CSS 4, native Intersection Observer, Google Fonts (Playfair Display + Inter). No new dependencies.

**Hard constraint:** Every visible text string on `/about` after the redesign must be character-identical to the current page. Added / removed / reworded copy is a regression.

---

## File Structure

**Modify:**
- `src/layouts/Layout.astro` — add Google Fonts `<link>` tags to `<head>`
- `src/styles/global.css` — register Inter as base body font, Playfair as `.font-serif`, add `prefers-reduced-motion` override
- `src/components/about/AboutHero.astro` — rewrite presentation (layout, overlay, type, accents)
- `src/components/about/AboutStory.astro` — rewrite presentation (blockquote treatment, image shadow, floating card)
- `src/components/about/AboutFleet.astro` — rewrite presentation (cream bg, passenger badge, wavy divider, terracotta checks)
- `src/components/about/AboutCommitment.astro` — rewrite presentation (differentiated Mission/Vision, warm value cards)
- `src/pages/about.astro` — insert `<WavyDivider>` between Story/Fleet and Fleet/Commitment

**Create:**
- `src/components/about/ScrollReveal.astro` — fade-up wrapper using IntersectionObserver
- `src/components/about/WavyDivider.astro` — decorative inline-SVG divider

No test files: Astro project has no test harness. Verification is dev-server + visual + text-parity grep.

---

## Task 1: Load Playfair Display and Inter, wire base type

**Files:**
- Modify: `src/layouts/Layout.astro:8-17`
- Modify: `src/styles/global.css:1`

- [ ] **Step 1: Add Google Fonts preconnect + stylesheet links to Layout**

Edit `src/layouts/Layout.astro`. Replace the existing `<head>` block content with:

```astro
<head>
	<meta charset="utf-8" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" href="/favicon.ico" />
	<meta name="viewport" content="width=device-width" />
	<meta name="generator" content={Astro.generator} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Inter:wght@300..700&display=swap" rel="stylesheet" />
	<title>Opawey</title>
	<ViewTransitions />
</head>
```

- [ ] **Step 2: Register the font families in global.css**

Replace the full contents of `src/styles/global.css` with:

```css
@import "tailwindcss";

@layer base {
	html {
		scroll-behavior: smooth;
	}
	body {
		font-family: "Inter", system-ui, -apple-system, sans-serif;
	}
	.font-serif {
		font-family: "Playfair Display", Georgia, serif;
	}
}

@media (prefers-reduced-motion: reduce) {
	.reveal {
		opacity: 1 !important;
		transform: none !important;
		transition: none !important;
	}
}
```

- [ ] **Step 3: Verify fonts load in dev**

Run: `npm run dev`
Open `http://localhost:4321/about` in the browser. Open DevTools → Network → filter "Font". Expected: `Playfair-Display` and `Inter` WOFF2 files returned 200. The page already renders; the fonts may not yet visibly apply until later tasks use `.font-serif` — that's expected.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Layout.astro src/styles/global.css
git commit -m "feat(about): load Playfair Display + Inter for page redesign"
```

---

## Task 2: Create ScrollReveal wrapper component

**Files:**
- Create: `src/components/about/ScrollReveal.astro`

- [ ] **Step 1: Write the component**

Create `src/components/about/ScrollReveal.astro` with:

```astro
---
interface Props {
	delay?: number;
	class?: string;
}
const { delay = 0, class: className = '' } = Astro.props;
---

<div
	class:list={["reveal", className]}
	style={`--reveal-delay: ${delay}ms`}
	data-reveal
>
	<slot />
</div>

<style>
	.reveal {
		opacity: 0;
		transform: translateY(16px);
		transition: opacity 700ms ease-out, transform 700ms ease-out;
		transition-delay: var(--reveal-delay, 0ms);
	}
	.reveal.is-visible {
		opacity: 1;
		transform: translateY(0);
	}
</style>

<script>
	function initReveal() {
		const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
		if (!('IntersectionObserver' in window)) {
			els.forEach((el) => el.classList.add('is-visible'));
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						entry.target.classList.add('is-visible');
						io.unobserve(entry.target);
					}
				}
			},
			{ threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
		);
		els.forEach((el) => io.observe(el));
	}

	document.addEventListener('astro:page-load', initReveal);
</script>
```

Notes:
- Uses `astro:page-load` (not `DOMContentLoaded`) so it re-runs after Astro ViewTransitions navigations — the Layout already imports `ViewTransitions`.
- The media-query override in `global.css` (Task 1, Step 2) neutralises opacity/transform for `prefers-reduced-motion: reduce`.

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no errors about `ScrollReveal.astro`. The component isn't imported yet, so it won't be bundled — this only verifies syntax.

- [ ] **Step 3: Commit**

```bash
git add src/components/about/ScrollReveal.astro
git commit -m "feat(about): add ScrollReveal fade-up wrapper"
```

---

## Task 3: Create WavyDivider component

**Files:**
- Create: `src/components/about/WavyDivider.astro`

- [ ] **Step 1: Write the component**

Create `src/components/about/WavyDivider.astro` with:

```astro
---
interface Props {
	color?: string;
	opacity?: number;
	class?: string;
}
const {
	color = '#C97B4A',
	opacity = 0.18,
	class: className = '',
} = Astro.props;
---

<div class:list={["w-full overflow-hidden leading-[0]", className]} aria-hidden="true">
	<svg
		viewBox="0 0 1440 60"
		preserveAspectRatio="none"
		class="block w-full h-[40px] md:h-[60px]"
		fill="none"
	>
		<path
			d="M0 30 Q 120 0 240 30 T 480 30 T 720 30 T 960 30 T 1200 30 T 1440 30"
			stroke={color}
			stroke-opacity={opacity}
			stroke-width="2"
			stroke-linecap="round"
		/>
	</svg>
</div>
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. Not yet imported anywhere.

- [ ] **Step 3: Commit**

```bash
git add src/components/about/WavyDivider.astro
git commit -m "feat(about): add WavyDivider decorative SVG"
```

---

## Task 4: Redesign AboutHero

**Files:**
- Modify: `src/components/about/AboutHero.astro` (full rewrite, 35 lines)

Copy kept verbatim: the "Who We Are" eyebrow, the heading "About Us", both paragraphs.

- [ ] **Step 1: Replace AboutHero.astro contents**

Replace the full contents of `src/components/about/AboutHero.astro` with:

```astro
---
import ScrollReveal from './ScrollReveal.astro';
---

<section class="relative w-full h-[70vh] min-h-[480px] overflow-hidden bg-[#0B0F14]">
	<!-- Background video -->
	<video
		class="absolute inset-0 w-full h-full object-cover"
		autoplay
		muted
		loop
		playsinline
	>
		<source src="/sea-2025-12-17-09-44-18-utc.mp4" type="video/mp4" />
	</video>

	<!-- Warm tri-color overlay -->
	<div
		class="absolute inset-0"
		style="background: linear-gradient(115deg, rgba(43,58,58,0.7) 0%, rgba(201,123,74,0.55) 50%, rgba(12,107,149,0.55) 100%);"
	></div>

	<!-- Sun accent (top-right) -->
	<div
		class="absolute top-7 right-9 w-12 h-12 rounded-full"
		style="background: radial-gradient(circle, #F5D4A8 0%, #C97B4A 100%); box-shadow: 0 0 40px rgba(245,212,168,0.6);"
		aria-hidden="true"
	></div>

	<!-- Content: bottom-left editorial -->
	<div class="relative z-10 h-full flex flex-col items-start justify-end text-left px-6 lg:px-10 pb-20 max-w-6xl mx-auto w-full">
		<ScrollReveal>
			<div class="flex items-center gap-3 mb-5">
				<span class="w-8 h-[2px] bg-[#F5D4A8] shrink-0"></span>
				<span class="text-sm font-medium text-[#F5D4A8] tracking-widest uppercase">Who We Are</span>
			</div>
		</ScrollReveal>

		<ScrollReveal delay={100}>
			<h1 class="font-serif text-5xl lg:text-7xl font-bold text-white mb-6 leading-[0.95] max-w-3xl">
				About Us<span class="italic text-[#C97B4A]">.</span>
			</h1>
		</ScrollReveal>

		<ScrollReveal delay={200}>
			<p class="text-white/85 text-lg lg:text-xl leading-relaxed max-w-3xl mb-4">
				Opawey is a premium luxury transportation and private transfer service in Athens and across Greece, born from the fusion of two remarkable cultures: Greek and Mexican. Our name reflects this unique union — <span class="text-[#F5D4A8] font-semibold">"OPA,"</span> the Greek expression of joy and celebration, and <span class="text-[#9BD4EC] font-semibold">"WEY,"</span> a friendly Mexican word used to refer to close friends. Together, they also echo the English word <span class="text-white font-semibold">"way,"</span> symbolizing the journey we share with every client.
			</p>
		</ScrollReveal>

		<ScrollReveal delay={300}>
			<p class="text-white/75 text-base lg:text-lg leading-relaxed max-w-3xl">
				We believe travel should be more than simply reaching a destination. It should be an experience defined by elegance, comfort, and authentic hospitality.
			</p>
		</ScrollReveal>
	</div>

	<!-- Bottom fade into cream section -->
	<div class="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#FFF8F0] to-transparent"></div>
</section>
```

- [ ] **Step 2: Visual check in dev**

Run: `npm run dev`
Open `http://localhost:4321/about`.

Expected:
- Sea video still playing in the background
- Overlay is warm (teal→terracotta→blue) rather than flat black
- Heading "About Us" reads in serif, period is a terracotta italic
- Eyebrow "Who We Are" is sand-colored, prefixed with a short sand rule (not a blue dot)
- Paragraph 1: `"OPA,"` is sand, `"WEY,"` is light cyan-blue, `"way,"` is white-bold
- Small glowing sun circle in the top-right corner
- Text is positioned bottom-left (not centered)
- On page load, elements fade up in staggered sequence

- [ ] **Step 3: Text parity check**

Run:
```bash
grep -c 'Opawey is a premium luxury transportation' src/components/about/AboutHero.astro
grep -c 'We believe travel should be more than simply reaching' src/components/about/AboutHero.astro
grep -c '"OPA,"' src/components/about/AboutHero.astro
grep -c '"WEY,"' src/components/about/AboutHero.astro
grep -c '"way,"' src/components/about/AboutHero.astro
grep -c 'Who We Are' src/components/about/AboutHero.astro
grep -c '>About Us<' src/components/about/AboutHero.astro
```

Expected: each command outputs `1`.

- [ ] **Step 4: Commit**

```bash
git add src/components/about/AboutHero.astro
git commit -m "feat(about): redesign hero with warm sunset overlay and editorial layout"
```

---

## Task 5: Redesign AboutStory

**Files:**
- Modify: `src/components/about/AboutStory.astro` (full rewrite)

Copy kept verbatim: the "Our Story" eyebrow, the blockquote (`"If I could give you a gift, I would like to be able to give you what my eyes have seen."`), all three paragraphs, the highlight box text including emphasis on `seamless`, `memorable`, `elegance, comfort, and authentic hospitality`, the `100%` figure, the "Family-owned & operated with passion" label.

- [ ] **Step 1: Replace AboutStory.astro contents**

Replace the full contents of `src/components/about/AboutStory.astro` with:

```astro
---
import ScrollReveal from './ScrollReveal.astro';
---

<section class="bg-[#FFF8F0] py-20 lg:py-28 px-6 lg:px-10">
	<div class="max-w-6xl mx-auto">
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-start">

			<!-- Left: Text content -->
			<div class="flex flex-col">
				<ScrollReveal>
					<div class="flex items-center gap-3 mb-5">
						<span class="text-[#C97B4A] text-lg leading-none">✦</span>
						<span class="text-sm font-medium text-[#6b5a47] tracking-widest uppercase">Our Story</span>
					</div>
				</ScrollReveal>

				<!-- Pull quote with decorative oversized quote mark -->
				<ScrollReveal delay={100}>
					<blockquote class="relative mb-8 pl-2 pt-2">
						<span
							aria-hidden="true"
							class="font-serif absolute -top-4 -left-2 text-[120px] leading-none text-[#C97B4A]/40 select-none"
						>&ldquo;</span>
						<p class="relative font-serif text-xl lg:text-2xl italic font-medium text-[#2B3A3A] leading-relaxed">
							"If I could give you a gift, I would like to be able to give you what my eyes have seen."
						</p>
					</blockquote>
				</ScrollReveal>

				<ScrollReveal delay={150}>
					<p class="text-[#6b5a47] text-lg leading-relaxed mb-5">
						Opawey was born from a deep desire to share what we consider a daily privilege — the opportunity to witness the timeless beauty, extraordinary history, and cultural richness of Greece.
					</p>
				</ScrollReveal>

				<ScrollReveal delay={200}>
					<p class="text-[#6b5a47] text-lg leading-relaxed mb-5">
						For us, Greece is more than a destination; it is a living story shaped by ancient civilizations, breathtaking landscapes, and a culture of genuine hospitality. Inspired by this vision, we created Opawey to offer travelers the opportunity to discover Greece through luxury transportation services and exclusive private tours from Athens.
					</p>
				</ScrollReveal>

				<ScrollReveal delay={250}>
					<p class="text-[#6b5a47] text-lg leading-relaxed">
						Our journey began with a passion for welcoming visitors and ensuring that their experience in Greece begins with comfort and elegance from the very first moment. Today, Opawey proudly provides private driver services, luxury Athens airport transfers, and private bespoke tours across mainland Greece, allowing travelers to explore the country in a refined, relaxed, and unforgettable way.
					</p>
				</ScrollReveal>

				<ScrollReveal delay={300}>
					<div class="mt-8 rounded-3xl p-6 border-l-4 border-[#C97B4A]" style="background: linear-gradient(135deg, #FFF8F0 0%, rgba(245,212,168,0.35) 100%);">
						<p class="text-[#6b5a47] text-sm leading-relaxed italic">
							Our goal is simple: to transform every journey into a <span class="text-[#C97B4A] font-semibold">seamless</span> and <span class="text-[#C97B4A] font-semibold">memorable</span> travel experience, with the perfect balance of <span class="text-[#2B3A3A] font-semibold">elegance, comfort, and authentic hospitality</span>.
						</p>
					</div>
				</ScrollReveal>
			</div>

			<!-- Right: Image with decorative accents -->
			<ScrollReveal delay={200} class="relative lg:translate-y-10">
				<!-- Blue blob behind bottom-left -->
				<div
					aria-hidden="true"
					class="absolute -bottom-4 -left-6 w-24 h-24 rounded-full bg-[#0C6B95] opacity-20"
				></div>

				<div
					class="relative rounded-3xl overflow-hidden aspect-[3/4] lg:aspect-auto lg:h-[580px]"
					style="box-shadow: 0 30px 60px -15px rgba(201,123,74,0.35);"
				>
					<img
						src="https://picsum.photos/seed/opaway-story/800/1000"
						alt="Opawey story"
						class="w-full h-full object-cover"
					/>
				</div>

				<!-- Floating terracotta 100% card, top-right -->
				<div class="absolute -top-6 -right-6 bg-[#C97B4A] text-white rounded-3xl p-5 shadow-xl max-w-[200px]">
					<p class="font-serif text-3xl font-bold mb-1">100%</p>
					<p class="text-sm text-white/85">Family-owned &amp; operated with passion</p>
				</div>
			</ScrollReveal>

		</div>
	</div>
</section>
```

- [ ] **Step 2: Visual check in dev**

Dev server should still be running. Refresh `http://localhost:4321/about` and scroll to the Story section.

Expected:
- Section background is cream (not stark white)
- Eyebrow shows a `✦` glyph instead of the old blue dot
- Blockquote has a large terracotta `"` behind the text, no left border bar
- Paragraphs are noticeably warmer (warm neutral `#6b5a47`), slightly larger than before
- Highlight box below the paragraphs has a cream→sand gradient with a terracotta left bar
- Image column sits offset ~40px lower than the text column at `lg` breakpoints
- The `100%` card is **terracotta (not blue)** and sits **top-right** of the image
- A soft blue blob is visible behind the bottom-left of the image
- On scroll into view, paragraphs fade up in sequence

- [ ] **Step 3: Text parity check**

Run:
```bash
grep -c 'If I could give you a gift' src/components/about/AboutStory.astro
grep -c 'Opawey was born from a deep desire' src/components/about/AboutStory.astro
grep -c 'For us, Greece is more than a destination' src/components/about/AboutStory.astro
grep -c 'Our journey began with a passion' src/components/about/AboutStory.astro
grep -c 'Our goal is simple' src/components/about/AboutStory.astro
grep -c '>seamless<' src/components/about/AboutStory.astro
grep -c '>memorable<' src/components/about/AboutStory.astro
grep -c 'elegance, comfort, and authentic hospitality' src/components/about/AboutStory.astro
grep -c '>100%<' src/components/about/AboutStory.astro
grep -c 'Family-owned' src/components/about/AboutStory.astro
grep -c 'Our Story' src/components/about/AboutStory.astro
```

Expected: each command outputs `1`.

- [ ] **Step 4: Commit**

```bash
git add src/components/about/AboutStory.astro
git commit -m "feat(about): redesign Story with decorative quote, warm highlight, offset image"
```

---

## Task 6: Redesign AboutFleet

**Files:**
- Modify: `src/components/about/AboutFleet.astro` (full rewrite)

Copy kept verbatim: the "Our Fleet" eyebrow, heading "Discover our service classes", all three vehicle entries (titles `Sedan`, `Van`, `Minibus (or two Vans)`, model strings, every feature bullet).

- [ ] **Step 1: Replace AboutFleet.astro contents**

Replace the full contents of `src/components/about/AboutFleet.astro` with:

```astro
---
import ScrollReveal from './ScrollReveal.astro';

const vehicles = [
	{
		title: 'Sedan',
		models: 'Mercedes-Benz E-Class, or similar.',
		image: '/car.avif',
		features: [
			'Fits up to 3 people',
			'1 big + 1 small luggage per person',
			'Available for airport transfers & city tours',
		],
	},
	{
		title: 'Van',
		models: 'Mercedes Vito Tourer, or similar.',
		image: '/mini_van.avif',
		features: [
			'Fits up to 8 people',
			'1 big + 1 small luggage per person',
			'Ideal for group transfers & private tours',
		],
	},
	{
		title: 'Minibus (or two Vans)',
		models: 'Mercedes Sprinter, or similar.',
		image: '/van.avif',
		features: [
			'Fits up to 18 people',
			'1 big + 1 small luggage per person',
			'Perfect for large groups & corporate events',
		],
	},
];

function paxCount(features: string[]): string | null {
	const match = features.find((f) => /Fits up to/.test(f))?.match(/(\d+)/);
	return match ? match[1] : null;
}
---

<section class="bg-[#FFF8F0] py-20 lg:py-28 px-6 lg:px-10">
	<div class="max-w-6xl mx-auto">

		<!-- Header -->
		<ScrollReveal>
			<div class="mb-12">
				<div class="flex items-center gap-3 mb-3">
					<span class="text-[#C97B4A] text-lg leading-none">✦</span>
					<span class="text-sm font-medium text-[#6b5a47] tracking-widest uppercase">Our Fleet</span>
				</div>
				<h2 class="font-serif text-4xl lg:text-5xl font-bold text-[#2B3A3A] leading-tight">
					Discover our service <span class="italic text-[#C97B4A]">classes</span>
				</h2>
			</div>
		</ScrollReveal>

		<!-- Cards grid -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			{vehicles.map((v, i) => {
				const pax = paxCount(v.features);
				return (
					<ScrollReveal delay={i * 100}>
						<article
							class="group bg-white rounded-3xl overflow-hidden flex flex-col h-full transition-all duration-500 hover:-translate-y-1"
							style="box-shadow: 0 20px 50px -20px rgba(201,123,74,0.25);"
						>

							<!-- Image area with passenger badge + gradient overlay -->
							<div class="relative bg-neutral-100 aspect-[4/3] overflow-hidden">
								<img
									src={v.image}
									alt={v.title}
									class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
								/>
								<div
									aria-hidden="true"
									class="absolute inset-0 pointer-events-none"
									style="background: linear-gradient(to top, rgba(201,123,74,0.25), transparent 50%);"
								></div>

								{pax && (
									<div class="absolute top-4 left-4 w-14 h-14 rounded-full bg-[#0C6B95] text-white ring-4 ring-[#FFF8F0] flex flex-col items-center justify-center shadow-lg">
										<span class="font-serif text-lg leading-none font-bold">{pax}</span>
										<span class="text-[9px] tracking-wider uppercase opacity-80 mt-0.5">pax</span>
									</div>
								)}
							</div>

							<!-- Card body -->
							<div class="p-6 flex flex-col flex-1">
								<h3 class="font-serif text-2xl font-bold text-[#2B3A3A] mb-1">{v.title}</h3>
								<p class="text-sm italic text-[#6b5a47] mb-4">{v.models}</p>

								<!-- Hand-drawn wavy divider -->
								<svg
									width="40"
									height="8"
									viewBox="0 0 40 8"
									fill="none"
									aria-hidden="true"
									class="mb-5"
								>
									<path d="M0 4 Q 6 0 12 4 T 24 4 T 36 4 L 40 4" stroke="#C97B4A" stroke-width="1.5" stroke-linecap="round" />
								</svg>

								<!-- Feature checklist -->
								<ul class="flex flex-col gap-3">
									{v.features.map((f) => (
										<li class="flex items-start gap-3">
											<span class="text-[#C97B4A] font-bold text-base leading-tight mt-0.5 shrink-0">✓</span>
											<span class="text-sm text-[#6b5a47] leading-snug">{f}</span>
										</li>
									))}
								</ul>
							</div>

						</article>
					</ScrollReveal>
				);
			})}
		</div>
	</div>
</section>
```

- [ ] **Step 2: Visual check in dev**

Refresh `/about` and scroll to Fleet.

Expected:
- Section background is cream (not cold gray)
- Eyebrow has `✦` glyph
- Heading italicises "classes" in terracotta
- Each card:
  - Rounded-3xl with warm-toned shadow
  - Subtle terracotta gradient overlay on the bottom of the image
  - Circular blue badge top-left showing `3 PAX`, `8 PAX`, `18 PAX` respectively
  - Title in serif, model line in italic warm neutral
  - Small wavy terracotta line between model and features
  - Features prefixed with a terracotta `✓`
- Hover: card lifts, image scales subtly, shadow deepens
- Cards fade up with a stagger

- [ ] **Step 3: Text parity check**

Run:
```bash
grep -c 'Discover our service' src/components/about/AboutFleet.astro
grep -c "title: 'Sedan'" src/components/about/AboutFleet.astro
grep -c "title: 'Van'" src/components/about/AboutFleet.astro
grep -c "title: 'Minibus (or two Vans)'" src/components/about/AboutFleet.astro
grep -c "Mercedes-Benz E-Class, or similar." src/components/about/AboutFleet.astro
grep -c "Mercedes Vito Tourer, or similar." src/components/about/AboutFleet.astro
grep -c "Mercedes Sprinter, or similar." src/components/about/AboutFleet.astro
grep -c "Fits up to 3 people" src/components/about/AboutFleet.astro
grep -c "Fits up to 8 people" src/components/about/AboutFleet.astro
grep -c "Fits up to 18 people" src/components/about/AboutFleet.astro
grep -c "Available for airport transfers & city tours" src/components/about/AboutFleet.astro
grep -c "Ideal for group transfers & private tours" src/components/about/AboutFleet.astro
grep -c "Perfect for large groups & corporate events" src/components/about/AboutFleet.astro
grep -c "1 big + 1 small luggage per person" src/components/about/AboutFleet.astro
grep -c "Our Fleet" src/components/about/AboutFleet.astro
```

Expected: all commands output `1` except `"1 big + 1 small luggage per person"` which outputs `3` (appears once per vehicle).

Note: the `3 PAX` / `8 PAX` / `18 PAX` badge labels are **derived visuals**, not new copy — the digits come from the existing `Fits up to N people` bullet which is still rendered verbatim in the feature list.

- [ ] **Step 4: Commit**

```bash
git add src/components/about/AboutFleet.astro
git commit -m "feat(about): redesign Fleet with cream bg, passenger badges, wavy dividers"
```

---

## Task 7: Redesign AboutCommitment

**Files:**
- Modify: `src/components/about/AboutCommitment.astro` (full rewrite)

Copy kept verbatim: the "Our Commitment" eyebrow, heading "Principles that define / our essence", the right-side intro paragraph, both Mission and Vision body paragraphs, all four values (title + description).

- [ ] **Step 1: Replace AboutCommitment.astro contents**

Replace the full contents of `src/components/about/AboutCommitment.astro` with:

```astro
---
import ScrollReveal from './ScrollReveal.astro';

const values = [
	{
		title: 'Safety',
		description: 'The safety of our passengers is our highest priority. Our vehicles meet the highest technical standards and are operated by experienced professional drivers. Every private transfer in Athens or mainland Greece is conducted with the utmost care to ensure peace of mind.',
		icon: 'shield',
	},
	{
		title: 'Hospitality',
		description: 'Inspired by the Greek tradition of philoxenia, we welcome every traveler with warmth and professionalism. Our team combines genuine hospitality with personalized service to create authentic, memorable experiences.',
		icon: 'heart',
	},
	{
		title: 'Excellence',
		description: 'We are committed to exceeding expectations. From luxury airport transfers in Athens to personalized private tours, every detail — punctuality, vehicle quality, and service standards — reflects our commitment to premium travel experiences.',
		icon: 'star',
	},
	{
		title: 'Flexibility',
		description: 'We understand that every traveler is unique. Our services are tailored to meet the specific needs and preferences of our clients, whether adjusting schedules, routes, or activities. Our personalized approach allows us to offer quick, efficient solutions with a proactive, open-minded attitude.',
		icon: 'adjust',
	},
];

// alternating chip + blob colors by index
const chipColors = ['#0C6B95', '#C97B4A', '#0C6B95', '#C97B4A'];
---

<section class="relative bg-[#FFF8F0] py-20 lg:py-28 px-6 lg:px-10 overflow-hidden">
	<!-- Soft terracotta radial tint at the bottom -->
	<div
		aria-hidden="true"
		class="absolute inset-0 pointer-events-none"
		style="background: radial-gradient(circle at 50% 110%, rgba(201,123,74,0.08), transparent 50%);"
	></div>

	<div class="relative max-w-6xl mx-auto">

		<!-- Header -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-10 items-end mb-16">
			<ScrollReveal>
				<div>
					<div class="flex items-center gap-3 mb-4">
						<span class="text-[#C97B4A] text-lg leading-none">✦</span>
						<span class="text-sm font-medium text-[#6b5a47] tracking-widest uppercase">Our Commitment</span>
					</div>
					<h2 class="font-serif text-4xl lg:text-5xl font-bold text-[#2B3A3A] leading-tight">
						Principles that define<br/>our <span class="italic text-[#C97B4A]">essence</span>
					</h2>
				</div>
			</ScrollReveal>
			<ScrollReveal delay={100}>
				<p class="text-[#6b5a47] leading-relaxed lg:text-right">
					At Opawey, we believe that every journey should be an exceptional experience. That is why our commitment is founded on principles that guide every service we provide.
				</p>
			</ScrollReveal>
		</div>

		<!-- Mission & Vision (differentiated pair) -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
			<!-- Mission: blue card, terracotta chip -->
			<ScrollReveal>
				<div class="relative bg-[#0C6B95] rounded-3xl p-8 text-[#FFF8F0] overflow-hidden h-full">
					<div
						aria-hidden="true"
						class="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-[#F5D4A8] opacity-15"
					></div>
					<div class="relative">
						<div class="w-14 h-14 rounded-2xl bg-[#C97B4A] flex items-center justify-center mb-5">
							<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
							</svg>
						</div>
						<h3 class="font-serif text-2xl font-bold mb-3">Our Mission</h3>
						<p class="text-[#FFF8F0]/85 text-sm leading-relaxed">Our mission is to deliver exceptional luxury transportation and private travel services in Greece, ensuring every client enjoys a seamless experience defined by comfort, reliability, and personalized attention.</p>
					</div>
				</div>
			</ScrollReveal>

			<!-- Vision: cream card, blue chip -->
			<ScrollReveal delay={100}>
				<div class="relative bg-[#FFF8F0] border border-[#C97B4A]/30 rounded-3xl p-8 text-[#2B3A3A] overflow-hidden h-full">
					<div
						aria-hidden="true"
						class="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-[#0C6B95] opacity-10"
					></div>
					<div class="relative">
						<div class="w-14 h-14 rounded-2xl bg-[#0C6B95] flex items-center justify-center mb-5">
							<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
						</div>
						<h3 class="font-serif text-2xl font-bold mb-3">Our Vision</h3>
						<p class="text-[#6b5a47] text-sm leading-relaxed">Our vision is to become a trusted reference for luxury transportation and bespoke travel experiences in Greece, recognized for our commitment to excellence, professionalism, and authentic hospitality. We aspire to create journeys that combine comfort, culture, and exclusivity, transforming every trip into a remarkable memory.</p>
					</div>
				</div>
			</ScrollReveal>
		</div>

		<!-- Values grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
			{values.map((v, i) => {
				const chip = chipColors[i];
				return (
					<ScrollReveal delay={i * 100}>
						<article class="group relative bg-[#FFF8F0] border border-[#C97B4A]/15 rounded-3xl p-8 overflow-hidden transition-all duration-500 hover:-translate-y-1">
							<!-- Corner blob accent -->
							<div
								aria-hidden="true"
								class="absolute -bottom-12 -right-12 w-48 h-48 rounded-full opacity-[0.05]"
								style={`background:${chip};`}
							></div>

							<!-- Watermark number -->
							<span class="absolute top-4 right-6 font-serif text-8xl font-black text-[#C97B4A]/[0.08] group-hover:text-[#C97B4A]/[0.14] select-none leading-none transition-colors">
								{String(i + 1).padStart(2, '0')}
							</span>

							<!-- Icon chip -->
							<div class="relative w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shrink-0" style={`background:${chip};`}>
								{v.icon === 'shield' && (
									<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
									</svg>
								)}
								{v.icon === 'heart' && (
									<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
									</svg>
								)}
								{v.icon === 'star' && (
									<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
									</svg>
								)}
								{v.icon === 'adjust' && (
									<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
									</svg>
								)}
							</div>

							<!-- Wavy divider between icon and title -->
							<svg width="40" height="8" viewBox="0 0 40 8" fill="none" aria-hidden="true" class="mb-3 relative">
								<path d="M0 4 Q 6 0 12 4 T 24 4 T 36 4 L 40 4" stroke="#C97B4A" stroke-width="1.5" stroke-linecap="round" />
							</svg>

							<h3 class="font-serif text-xl font-bold text-[#2B3A3A] mb-3 relative z-10">{v.title}</h3>
							<p class="text-[#6b5a47] text-sm leading-relaxed relative z-10">{v.description}</p>
						</article>
					</ScrollReveal>
				);
			})}
		</div>
	</div>
</section>
```

- [ ] **Step 2: Visual check in dev**

Refresh `/about` and scroll to Commitment.

Expected:
- Section background is cream with a subtle terracotta glow at the bottom
- Eyebrow `✦`, heading italicises "essence" in terracotta
- Mission card: blue with terracotta icon chip, sand-colored blob bottom-right
- Vision card: cream with blue icon chip, faint blue blob bottom-right (reads as a visual inversion/pair with Mission)
- Value cards:
  - Cream background with subtle terracotta border hint
  - Watermark numbers (01–04) in faint terracotta (not gray)
  - Icon chips alternate blue / terracotta / blue / terracotta across Safety, Hospitality, Excellence, Flexibility
  - Corner blob accents alternate matching colors
  - Small wavy terracotta line between the icon and the title
  - Hover: card lifts, watermark darkens slightly

- [ ] **Step 3: Text parity check**

Run:
```bash
grep -c "title: 'Safety'" src/components/about/AboutCommitment.astro
grep -c "title: 'Hospitality'" src/components/about/AboutCommitment.astro
grep -c "title: 'Excellence'" src/components/about/AboutCommitment.astro
grep -c "title: 'Flexibility'" src/components/about/AboutCommitment.astro
grep -c 'The safety of our passengers is our highest priority' src/components/about/AboutCommitment.astro
grep -c 'Inspired by the Greek tradition of philoxenia' src/components/about/AboutCommitment.astro
grep -c 'We are committed to exceeding expectations' src/components/about/AboutCommitment.astro
grep -c 'We understand that every traveler is unique' src/components/about/AboutCommitment.astro
grep -c '>Our Mission<' src/components/about/AboutCommitment.astro
grep -c '>Our Vision<' src/components/about/AboutCommitment.astro
grep -c 'Principles that define' src/components/about/AboutCommitment.astro
grep -c 'our commitment is founded on principles' src/components/about/AboutCommitment.astro
grep -c 'Our mission is to deliver exceptional luxury transportation' src/components/about/AboutCommitment.astro
grep -c 'Our vision is to become a trusted reference' src/components/about/AboutCommitment.astro
grep -c 'Our Commitment' src/components/about/AboutCommitment.astro
```

Expected: each command outputs `1`.

- [ ] **Step 4: Commit**

```bash
git add src/components/about/AboutCommitment.astro
git commit -m "feat(about): differentiate Mission/Vision pair and warm up value cards"
```

---

## Task 8: Wire WavyDivider into the About page

**Files:**
- Modify: `src/pages/about.astro` (full rewrite, 17 lines)

- [ ] **Step 1: Replace about.astro contents**

Replace the full contents of `src/pages/about.astro` with:

```astro
---
import Layout from '../layouts/Layout.astro';
import AboutHero from '../components/about/AboutHero.astro';
import AboutStory from '../components/about/AboutStory.astro';
import AboutFleet from '../components/about/AboutFleet.astro';
import AboutCommitment from '../components/about/AboutCommitment.astro';
import WavyDivider from '../components/about/WavyDivider.astro';
---

<Layout>
	<main class="min-h-screen bg-[#FFF8F0]">
		<AboutHero />
		<AboutStory />
		<WavyDivider class="bg-[#FFF8F0]" />
		<AboutFleet />
		<WavyDivider class="bg-[#FFF8F0]" />
		<AboutCommitment />
	</main>
</Layout>
```

- [ ] **Step 2: Visual check in dev**

Refresh `/about` and scroll the full page.

Expected:
- Thin terracotta wavy line visible between Story→Fleet and Fleet→Commitment
- Base page background is cream (so there's no jarring white strip below the last section before the Footer)
- Full scroll from hero to commitment feels continuous and consistent

- [ ] **Step 3: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat(about): insert wavy dividers between sections and set cream base"
```

---

## Task 9: Full-page QA and production build verification

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: build completes with `0 errors`. Note any warnings — a Tailwind purge warning or unused-class warning is acceptable; a build error is not.

- [ ] **Step 2: Preview the build**

Run: `npm run preview`
Open the printed URL (typically `http://localhost:4321`) → navigate to `/about`.

Expected: rendered output matches the dev output. Fonts load. No console errors in DevTools.

- [ ] **Step 3: Breakpoint sweep**

In DevTools device toolbar, test:
- 1440px desktop — hero bottom-left text is legible, Story 2-col layout balanced, Fleet 3-col cards even, Mission/Vision side-by-side
- 1024px (lg) — same as desktop
- 768px (md) — Story collapses to single column, image shows above or below text cleanly (no ugly overlap from `lg:translate-y-10`), Fleet drops to 1 col, Values stay 2-col
- 375px mobile — hero text wraps and stays inside the viewport; passenger badge on Fleet cards doesn't collide with anything; Mission/Vision stack cleanly; all wavy dividers still span the viewport

Expected: no overflow, no clipped text, no overlapping elements at any breakpoint.

- [ ] **Step 4: Reduced-motion check**

In DevTools → Rendering panel → "Emulate CSS media feature `prefers-reduced-motion`" → set to `reduce`. Reload `/about`.

Expected: all content is immediately visible (no fade-up animation). No layout shift from the reveal animation.

- [ ] **Step 5: Text parity sweep across the whole About page**

Run:
```bash
grep -rE 'Opawey|About Us|OPA|WEY|way|Who We Are|Our Story|Our Fleet|Our Commitment|Mission|Vision|Safety|Hospitality|Excellence|Flexibility|seamless|memorable|philoxenia|Principles that define|our essence|100%|Family-owned|Sedan|Minibus|Mercedes' src/components/about src/pages/about.astro | wc -l
```

Expected: count is ≥ the count from before the redesign (run the same command on main before starting if uncertain). No missing terms.

Then confirm the three "gift" tokens:
```bash
grep -c 'If I could give you a gift' src/components/about/AboutStory.astro
grep -c 'Fits up to 3 people' src/components/about/AboutFleet.astro
grep -c 'Fits up to 18 people' src/components/about/AboutFleet.astro
```
Expected: each outputs `1`.

- [ ] **Step 6: Final commit (only if any fixes were needed)**

If any breakpoint / motion / parity fixes were made during QA, commit them:

```bash
git add -A
git commit -m "fix(about): address QA findings from full-page review"
```

If no fixes were needed, skip this step.

- [ ] **Step 7: Push**

```bash
git push origin main
```

Expected: push succeeds; all redesign commits (Tasks 1–8, plus any fix in Step 6) land on `origin/main`.

---

## Notes for the implementing engineer

1. **Do not reword any copy.** The "1 big + 1 small luggage per person" string, the `"OPA,"` / `"WEY,"` / `"way,"` quoted punctuation, the "Family-owned & operated with passion" ampersand encoding — all preserved character-for-character.
2. **Passenger count badge** is a visual derivation from the existing `Fits up to N people` feature string. The original feature bullet is still rendered in the list; the badge just re-uses its number as a visual cue. No new copy introduced.
3. **Astro ViewTransitions are already wired** via `Layout.astro`. The `ScrollReveal` script uses `astro:page-load` (not `DOMContentLoaded`) so reveals fire after client-side navigation too.
4. **Tailwind 4** is configured via the `@tailwindcss/vite` plugin; arbitrary values with `#HEX` colors (e.g., `bg-[#FFF8F0]`) work out of the box.
5. **Font fallback:** Until Playfair Display loads, headings render in Georgia. Until Inter loads, body renders in system-ui. Acceptable flash — spec does not require eliminating it.
6. **Placeholder image in Story** (`https://picsum.photos/seed/opaway-story/800/1000`) is left as-is. Swapping for a real photo is out of scope per the spec.
