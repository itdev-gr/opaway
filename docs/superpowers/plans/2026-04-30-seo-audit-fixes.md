# SEO Audit Fixes (live site www.opawey.com) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the production site at `https://www.opawey.com/` up to baseline SEO + GEO standards: correct canonical/OG/JSON-LD URLs, real footer NAP + MHTE info, a working `sitemap.xml` (excluding dashboards), `robots.txt`, and an `llms.txt` for AI search engines.

**Architecture:** Astro 5 site with a single `src/layouts/Layout.astro` wrapping every page. We add the `@astrojs/sitemap` integration (with a `filter` that drops dashboard / booking-flow / auth pages), commit static `public/robots.txt` and `public/llms.txt`, set `site` in `astro.config.mjs` so absolute URLs are emitted correctly, fix the hardcoded `opaway.vercel.app` URLs in `Layout.astro` to `www.opawey.com`, replace the placeholder NAP block in `Footer.astro` with the real Magkriotou 6 / Nea Smyrni contact + MHTE number, and extend the JSON-LD `Organization` block to include `telephone` and the legal MHTE identifier.

**Tech Stack:** Astro 5, `@astrojs/sitemap`, plain text static files (`robots.txt`, `llms.txt`), Schema.org JSON-LD.

**Critical audit findings (the plan addresses these in order):**

1. `https://www.opawey.com/sitemap.xml` → **404** (no sitemap exists).
2. `https://www.opawey.com/robots.txt` → falls back to the SPA 404 page (no `robots.txt` file in `public/`).
3. `https://www.opawey.com/llms.txt` → **404** (no AI-search guidance file).
4. `Layout.astro` head hardcodes `https://opaway.vercel.app/` for `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`, JSON-LD `url`, and JSON-LD `logo`. The live host is `www.opawey.com`, so Google receives a canonical pointing at the dev URL — every indexed page is at risk of being dropped or de-duplicated under the wrong host.
5. `astro.config.mjs` does not define `site` → `@astrojs/sitemap` cannot emit absolute URLs and Astro can't generate a correct `sitemap-index.xml`.
6. `Footer.astro` shows placeholder data: address `9 Eirinis Street, Neo Faliro 18547, Greece`, phone `+30 21 1234 5678`, mobile `+30 693 123 4567`, email `info@opaway.com` (typo — missing `e`), and `GEMI 123456789000`. Client-supplied real data must replace it. The MHTE legal number is missing entirely.
7. JSON-LD `Organization` block has `streetAddress: Magkriotou 6, addressLocality: Athens` (correct street, wrong locality — should be `Nea Smyrni`) and is missing `telephone` and the MHTE identifier.

**Strict client constraints:**

- **MHTE NUMBER must appear EXACTLY as supplied** — `MH.TE NUMBER (0206Ε70000370500)`. The Ε between `0206` and `70000370500` is Greek capital epsilon (U+0395), NOT Latin E. Copy/paste the exact string from this plan into code; do not retype it.
- The new footer block must list, in order: address, landline, mobile, email, website, MHTE number.
- Sitemap must EXCLUDE every dashboard route family (`/admin/*`, `/driver/*`, `/hotel/*`, `/agency/*`, `/profile`, `/profile/*`), every multi-step booking-flow page (`/book/*/passenger`, `/book/*/payment`, `/book/*/results`), and every auth / utility page (`/login`, `/register`, `/register-partner`, `/forgot-password`, `/logout`, `/404`).

---

## File Structure

Files modified or created:

- `astro.config.mjs` — set `site: 'https://www.opawey.com'`, register `@astrojs/sitemap` with a `filter` that drops the routes listed above.
- `package.json` / `package-lock.json` — add `@astrojs/sitemap` dev dependency.
- `src/layouts/Layout.astro` — replace every `https://opaway.vercel.app/...` with `https://www.opawey.com/...`; expand JSON-LD to include `telephone` and MHTE; correct address locality to `Nea Smyrni`; bump postal code to `17121`. Also accept a `noindex` prop so dashboard pages can opt-out of indexing.
- `src/components/Footer.astro` — replace placeholder NAP data block with real values + add MHTE row; surface the website URL and replace email typo `info@opaway.com` with `info@opawey.com`.
- `public/robots.txt` — new static file: allow all, disallow dashboard families, point to sitemap.
- `public/llms.txt` — new static file: short AI-search description and pointer to the canonical pages.
- Dashboard pages (`src/pages/admin/*.astro`, `src/pages/driver/*.astro`, `src/pages/hotel/*.astro`, `src/pages/agency/*.astro`, `src/pages/profile.astro`, `src/pages/profile/*.astro`) — pass `noindex` prop to `<Layout>` so they emit `<meta name="robots" content="noindex, nofollow">`. Mass edit, no logic changes.

Files deliberately NOT touched in this plan:

- The English / Greek / Spanish translation strings already shipped on 2026-04-30 stay as-is.
- The hero video and homepage component layout — out of scope.
- The schema.org structured data on individual booking pages (none exist yet) — separate plan.

---

## Task 1: Set the canonical site URL in `astro.config.mjs`

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 1: Add `site` to the Astro config**

Replace the entire contents of `astro.config.mjs` with:

```js
// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.opawey.com',
  devToolbar: { enabled: false },
  integrations: [
    sitemap({
      filter: (page) => {
        // Exclude dashboards entirely
        if (/\/(admin|driver|hotel|agency|profile)(\/|$)/.test(page)) return false;
        // Exclude multi-step booking flow pages (passenger/payment/results)
        if (/\/book\/[^/]+\/(passenger|payment|results)\/?$/.test(page)) return false;
        // Exclude auth / utility / partner-register
        if (/\/(login|register|register-partner|forgot-password|logout|404)\/?$/.test(page)) return false;
        return true;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
```

(`sitemap` is added below as a dev dep — Task 2.)

- [ ] **Step 2: Verify config parses**

Run: `node --check astro.config.mjs`
Expected: no output (silent success). If it errors, the only edit was the import + integrations block — re-check syntax.

---

## Task 2: Install `@astrojs/sitemap`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the integration**

Run: `npm install --save-dev @astrojs/sitemap`
Expected: `npm` adds `@astrojs/sitemap` to `devDependencies` and a single new entry appears in `package-lock.json`. No other dependencies should change.

- [ ] **Step 2: Verify install**

Run: `node -e "console.log(require('@astrojs/sitemap/package.json').version)"`
Expected: a version number prints (e.g. `3.x.x`) — no error.

---

## Task 3: Add `public/robots.txt`

**Files:**
- Create: `public/robots.txt`

- [ ] **Step 1: Write robots.txt**

Create `public/robots.txt` with exactly this content:

```
User-agent: *
Allow: /

Disallow: /admin/
Disallow: /driver/
Disallow: /hotel/
Disallow: /agency/
Disallow: /profile
Disallow: /profile/
Disallow: /book/transfer/passenger
Disallow: /book/transfer/payment
Disallow: /book/transfer/results
Disallow: /book/hourly/passenger
Disallow: /book/hourly/payment
Disallow: /book/hourly/results
Disallow: /book/tour/passenger
Disallow: /book/tour/payment
Disallow: /book/tour/results
Disallow: /forgot-password
Disallow: /logout
Disallow: /register-partner

Sitemap: https://www.opawey.com/sitemap-index.xml
```

(`@astrojs/sitemap` produces `sitemap-index.xml` + per-shard `sitemap-0.xml`. Always link the index.)

- [ ] **Step 2: Verify**

Run: `head -3 public/robots.txt`
Expected output:

```
User-agent: *
Allow: /

```

---

## Task 4: Add `public/llms.txt`

**Files:**
- Create: `public/llms.txt`

- [ ] **Step 1: Write llms.txt**

Create `public/llms.txt` with exactly this content:

```
# Opawey

> Opawey is a premium luxury transportation and private transfer service based in Athens, Greece, offering airport transfers, hourly chauffeur service, private tours, and curated experiences across mainland Greece.

## Core pages

- [Home](https://www.opawey.com/): Overview of services — airport transfers, hourly chauffeur, private tours, and experiences.
- [About Us](https://www.opawey.com/about): Company background, fleet, and values.
- [Book a Transfer](https://www.opawey.com/book/transfer): Reserve a private airport or city transfer.
- [Rent by the Hour](https://www.opawey.com/book/hourly): Hire a chauffeur and vehicle by the hour.
- [Book a Tour](https://www.opawey.com/book/tour): Curated private tours across Greece.
- [Experiences](https://www.opawey.com/experiences): Wine tastings, yacht cruises, gastronomy, and other VIP experiences.
- [Work With Us](https://www.opawey.com/work-with-us): Partnership program for hotels, travel agencies, and professional drivers.
- [Contact](https://www.opawey.com/contact): Phone, email, and office address in Nea Smyrni, Athens.

## Optional

- [Terms of Use](https://www.opawey.com/terms)
- [Privacy Policy](https://www.opawey.com/privacy)
```

- [ ] **Step 2: Verify**

Run: `head -3 public/llms.txt`
Expected:

```
# Opawey

> Opawey is a premium luxury transportation and private transfer service based in Athens, Greece, offering airport transfers, hourly chauffeur service, private tours, and curated experiences across mainland Greece.
```

---

## Task 5: Fix the canonical / OG / JSON-LD URLs in `Layout.astro`

**Files:**
- Modify: `src/layouts/Layout.astro:9-31` (the head block) and the `<html lang>` opening tag (top of the layout).

- [ ] **Step 1: Add a `noindex` prop on the layout's frontmatter**

Replace the frontmatter block at the top of `src/layouts/Layout.astro`:

```astro
---
import '../styles/global.css';
import Navbar from '../components/Navbar.astro';
import Footer from '../components/Footer.astro';
import { ViewTransitions } from 'astro:transitions';
---
```

with:

```astro
---
import '../styles/global.css';
import Navbar from '../components/Navbar.astro';
import Footer from '../components/Footer.astro';
import { ViewTransitions } from 'astro:transitions';

interface Props {
	noindex?: boolean;
}
const { noindex = false } = Astro.props;
---
```

- [ ] **Step 2: Replace the head block with corrected URLs + Organization JSON-LD**

Find the existing block in `src/layouts/Layout.astro` that begins with `<head>` and ends with `</head>` (currently lines ~9–31, the one containing the `<link rel="canonical" href="https://opaway.vercel.app/" />`). Replace it with:

```astro
	<head>
		<meta charset="utf-8" />
		<link rel="icon" type="image/svg+xml" href="/logo-opawey.svg" />
		<link rel="icon" type="image/png" sizes="500x500" href="/logo-opawey.png" />
		<link rel="apple-touch-icon" href="/logo-opawey.png" />
		<meta name="viewport" content="width=device-width" />
		<meta name="generator" content={Astro.generator} />
		{noindex && <meta name="robots" content="noindex, nofollow" />}
		<meta name="description" content="Opawey — premium luxury transportation, private airport transfers, hourly chauffeur service and curated private tours in Athens and across Greece." />
		<link rel="canonical" href={`https://www.opawey.com${Astro.url.pathname}`} />
		<meta property="og:type" content="website" />
		<meta property="og:site_name" content="Opawey" />
		<meta property="og:title" content="Opawey — Luxury Transfers & Private Tours in Greece" />
		<meta property="og:description" content="Premium airport transfers, hourly chauffeur service and curated private tours in Athens and across Greece." />
		<meta property="og:url" content={`https://www.opawey.com${Astro.url.pathname}`} />
		<meta property="og:image" content="https://www.opawey.com/logo-opawey.png" />
		<meta name="twitter:card" content="summary" />
		<meta name="twitter:title" content="Opawey — Luxury Transfers & Private Tours in Greece" />
		<meta name="twitter:description" content="Premium airport transfers, hourly chauffeur service and curated private tours in Athens and across Greece." />
		<meta name="twitter:image" content="https://www.opawey.com/logo-opawey.png" />
		<script type="application/ld+json" set:html={JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Organization",
			"name": "Opawey",
			"url": "https://www.opawey.com/",
			"logo": "https://www.opawey.com/logo-opawey.png",
			"email": "info@opawey.com",
			"telephone": "+302109333164",
			"address": {
				"@type": "PostalAddress",
				"streetAddress": "Magkriotou 6",
				"addressLocality": "Nea Smyrni",
				"postalCode": "17121",
				"addressCountry": "GR"
			},
			"identifier": [
				{ "@type": "PropertyValue", "name": "MHTE", "value": "0206Ε70000370500" }
			]
		})} />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Inter:wght@300..700&display=swap" rel="stylesheet" />
		<title>Opawey — Luxury Transfers & Private Tours in Greece</title>
		<ViewTransitions />
	</head>
```

Critical: the `Ε` in `0206Ε70000370500` is Greek capital epsilon (U+0395), not Latin `E`. Copy the literal string from this plan; do not retype it. If you need to verify, run `node -e "console.log(Array.from('0206Ε70000370500').map(c=>c.charCodeAt(0).toString(16)))"` after editing — character 5 should be `0x395`.

- [ ] **Step 3: Verify the Greek epsilon survived the edit**

Run: `grep -n 'name": "MHTE"' src/layouts/Layout.astro | head -1` and confirm it prints; then run `node -e "const s=require('fs').readFileSync('src/layouts/Layout.astro','utf8'); const m=s.match(/0206.70000370500/); console.log(m && m[0].charCodeAt(4).toString(16));"`
Expected: prints `395` (Greek epsilon). If it prints `45` (Latin E), the byte was lost — re-paste from this plan.

- [ ] **Step 4: Run the build to confirm no Astro errors**

Run: `npm run build`
Expected: build completes; `dist/sitemap-index.xml` and `dist/sitemap-0.xml` are produced; `dist/robots.txt` and `dist/llms.txt` are copied through. Build log should not warn about missing `site`.

- [ ] **Step 5: Inspect generated sitemap**

Run: `cat dist/sitemap-0.xml | grep -oE '<loc>[^<]+</loc>' | sort -u`
Expected: lists ONLY public-marketing URLs — `/`, `/about`, `/book`, `/book/transfer`, `/book/hourly`, `/book/tour`, `/contact`, `/experiences`, `/privacy`, `/terms`, `/work-with-us`. Must NOT include any `/admin/*`, `/driver/*`, `/hotel/*`, `/agency/*`, `/profile*`, `/book/*/passenger|payment|results`, `/login`, `/register`, `/register-partner`, `/forgot-password`, `/logout`, or `/404`. If anything dashboard-like leaks through, the `filter` regex in Task 1 needs the missing route segment added.

---

## Task 6: Replace placeholder footer NAP with real client data

**Files:**
- Modify: `src/components/Footer.astro:2-16` (the `contact` object literal in the frontmatter) and the contact-block rendering around lines 71–93.

- [ ] **Step 1: Replace the `contact` object in the frontmatter**

In `src/components/Footer.astro`, replace the existing `contact` object literal:

```astro
const contact = {
	address: '9 Eirinis Street, Neo Faliro 18547, Greece',
	addressEl: 'Ειρήνης 9, Νέο Φάληρο Τ.Κ. 18547',
	addressEs: 'Calle Eirinis 9, Neo Faliro 18547, Grecia',
	phone: '+30 21 1234 5678',
	mobile: '+30 693 123 4567',
	email: 'info@opaway.com',
	gemi: 'GEMI 123456789000',
	gemiEl: 'Γ.Ε.ΜΗ. 123456789000',
	hours: [
		{ en: 'Monday – Friday 8:00–21:30', el: 'Δευτέρα – Παρασκευή 8:00–21:30', es: 'Lunes – viernes 8:00–21:30' },
		{ en: 'Saturday 9:00–16:00', el: 'Σάββατο 9:00–16:00', es: 'Sábado 9:00–16:00' },
	],
};
```

with:

```astro
const contact = {
	address: 'Magkriotou 6, Nea Smyrni 171 21',
	addressEl: 'Μαγκριώτου 6, Νέα Σμύρνη 171 21',
	addressEs: 'Magkriotou 6, Nea Smyrni 171 21',
	phone: '210 933 3164',
	phoneTel: '+302109333164',
	mobile: '+30 6972680618',
	mobileTel: '+306972680618',
	email: 'info@opawey.com',
	website: 'www.opawey.com',
	mhte: 'MH.TE NUMBER (0206Ε70000370500)',
	hours: [
		{ en: 'Monday – Friday 8:00–21:30', el: 'Δευτέρα – Παρασκευή 8:00–21:30', es: 'Lunes – viernes 8:00–21:30' },
		{ en: 'Saturday 9:00–16:00', el: 'Σάββατο 9:00–16:00', es: 'Sábado 9:00–16:00' },
	],
};
```

Same critical reminder: the `Ε` in `0206Ε70000370500` is Greek capital epsilon. Paste the literal from this plan.

- [ ] **Step 2: Replace the contact-block JSX**

Find the contact column in the same file (the `<div class="text-neutral-700 text-sm space-y-2">` block immediately after `<!-- Contact -->`). Replace its inner content (currently address, phone, mobile, email, gemi, hours) with:

```astro
				<div class="text-neutral-700 text-sm space-y-2">
					<p data-i18n-el={contact.addressEl} data-i18n-es={contact.addressEs}>{contact.address}</p>
					<p>
						<a href={`tel:${contact.phoneTel}`} class="hover:text-blue-600 transition-colors">{contact.phone}</a>
					</p>
					<p>
						<a href={`tel:${contact.mobileTel}`} class="hover:text-blue-600 transition-colors">{contact.mobile}</a>
					</p>
					<p>
						<a href={`mailto:${contact.email}`} class="hover:text-blue-600 transition-colors">{contact.email}</a>
					</p>
					<p>
						<a href={`https://${contact.website}`} target="_blank" rel="noopener" class="hover:text-blue-600 transition-colors">{contact.website}</a>
					</p>
					<p class="text-neutral-500 text-xs pt-1">{contact.mhte}</p>
					<p class="font-semibold text-neutral-800 pt-4" data-i18n-el="Ώρες λειτουργίας" data-i18n-es="Horario">Business Hours</p>
					{contact.hours.map((line) => <p data-i18n-el={line.el} data-i18n-es={line.es}>{line.en}</p>)}
					{(social.facebook || social.instagram || social.linkedin) && (
						<div class="flex gap-3 pt-4">
							{social.facebook && (
								<a href={social.facebook} target="_blank" rel="noopener noreferrer" class="w-9 h-9 rounded-full border border-sky-200 flex items-center justify-center text-blue-600 hover:bg-sky-50 transition-colors" aria-label="Facebook"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></a>
							)}
							{social.instagram && (
								<a href={social.instagram} target="_blank" rel="noopener noreferrer" class="w-9 h-9 rounded-full border border-sky-200 flex items-center justify-center text-blue-600 hover:bg-sky-50 transition-colors" aria-label="Instagram"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.265.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg></a>
							)}
							{social.linkedin && (
								<a href={social.linkedin} target="_blank" rel="noopener noreferrer" class="w-9 h-9 rounded-full border border-sky-200 flex items-center justify-center text-blue-600 hover:bg-sky-50 transition-colors" aria-label="LinkedIn"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>
							)}
						</div>
					)}
				</div>
```

(The MHTE row uses no `data-i18n-el` / `-es`: it's a legal identifier and must render identically in every language.)

- [ ] **Step 3: Verify the rendered footer locally**

Run: `npm run build` then `cat dist/about/index.html | grep -E 'Magkriotou|MH.TE|6972680618|info@opawey.com' | head -10`
Expected: lines containing each of `Magkriotou 6`, `+30 6972680618` / `6972680618`, `info@opawey.com`, and `MH.TE NUMBER (0206Ε70000370500)` are printed. If any are missing, the JSX edit is wrong.

---

## Task 7: Add `noindex` to dashboard pages

The dashboards are not in the sitemap (Task 1's `filter`) and are blocked by `robots.txt` (Task 3), but a third defence — a per-page `<meta name="robots">` — is the only one that survives if a logged-in user accidentally shares a dashboard URL on social media. We just pass the prop through `<Layout noindex>`.

**Files (mass edit, no logic changes):**

```
src/pages/admin/experiences.astro
src/pages/admin/index.astro
src/pages/admin/manage-experiences.astro
src/pages/admin/manage-tours.astro
src/pages/admin/manage-transfers.astro
src/pages/admin/manage-vehicles.astro
src/pages/admin/new-entry.astro
src/pages/admin/partners.astro
src/pages/admin/prices.astro
src/pages/admin/requests.astro
src/pages/admin/sales.astro
src/pages/admin/settings.astro
src/pages/admin/tours.astro
src/pages/admin/transfers.astro
src/pages/admin/users.astro
src/pages/agency/index.astro
src/pages/agency/profile.astro
src/pages/driver/available.astro
src/pages/driver/billing.astro
src/pages/driver/drivers.astro
src/pages/driver/index.astro
src/pages/driver/past.astro
src/pages/driver/payment-data.astro
src/pages/driver/profile.astro
src/pages/driver/ride.astro
src/pages/driver/settings.astro
src/pages/driver/upcoming.astro
src/pages/driver/vehicles.astro
src/pages/hotel/commissions.astro
src/pages/hotel/index.astro
src/pages/hotel/profile.astro
src/pages/profile.astro
src/pages/profile/dashboard.astro
src/pages/profile/experiences.astro
src/pages/profile/settings.astro
src/pages/profile/transfers.astro
src/pages/profile/trips.astro
```

- [ ] **Step 1: For each file above, find the `<Layout` opening tag and add `noindex`**

The transformation is purely textual: change every occurrence of `<Layout>` (with no attributes) to `<Layout noindex>`, and every `<Layout ... >` with attributes to `<Layout noindex ... >`.

For the simple case the following one-liner works (run from the repo root):

```bash
git ls-files 'src/pages/admin/*.astro' 'src/pages/driver/*.astro' 'src/pages/hotel/*.astro' 'src/pages/agency/*.astro' 'src/pages/profile.astro' 'src/pages/profile/*.astro' \
  | xargs sed -i '' -E 's#<Layout(\s+[^>]*)?>#<Layout noindex\1>#'
```

(`sed -i ''` is BSD/macOS syntax; on Linux drop the `''`.)

- [ ] **Step 2: Verify no file ended up with `noindex noindex`**

Run: `git grep -n 'noindex noindex' src/pages/`
Expected: no output. If any line shows up, run the same `sed` again backwards: `sed -i '' -E 's#noindex noindex#noindex#g'`.

- [ ] **Step 3: Verify all targeted files now use `noindex`**

Run: `git grep -L 'noindex' src/pages/admin src/pages/driver src/pages/hotel src/pages/agency src/pages/profile.astro src/pages/profile`
Expected: empty output (every file imports/calls `<Layout noindex …>` somewhere). If a file is listed, open it and add `noindex` manually — typically because it uses `<Layout slot="…">` with a non-trivial attribute layout that the sed missed.

- [ ] **Step 4: Build and grep for the meta**

Run: `npm run build && grep -l 'noindex, nofollow' dist/admin/*.html dist/driver/*.html dist/hotel/*.html dist/agency/*.html dist/profile*.html 2>/dev/null | wc -l`
Expected: count > 0 — at least the dashboard index pages render with the noindex meta.

---

## Task 8: Final build, deploy preview, and commit

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: build succeeds. Output should include lines like:

```
[@astrojs/sitemap] `sitemap-index.xml` created at `dist`
```

- [ ] **Step 2: Smoke-test the generated assets**

Run all of:

```bash
test -f dist/robots.txt && head -2 dist/robots.txt
test -f dist/llms.txt && head -2 dist/llms.txt
test -f dist/sitemap-index.xml && head -2 dist/sitemap-index.xml
test -f dist/sitemap-0.xml && grep -oE '<loc>[^<]+</loc>' dist/sitemap-0.xml | wc -l
```

Expected: each `test -f` succeeds, the head outputs match Tasks 3 & 4, and the URL count is between 8 and 15 (the public-marketing surface area). If the count exceeds 20, the `filter` in Task 1 is too permissive — re-check the regex against the leak.

- [ ] **Step 3: Commit**

```bash
git add astro.config.mjs package.json package-lock.json \
        public/robots.txt public/llms.txt \
        src/layouts/Layout.astro src/components/Footer.astro \
        src/pages/admin src/pages/driver src/pages/hotel src/pages/agency \
        src/pages/profile.astro src/pages/profile
git commit -m "seo: fix canonical to www.opawey.com, add sitemap/robots/llms, real footer NAP + MHTE"
```

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Post-deploy verification (after Vercel ships the build)**

Wait for the Vercel deploy to land at `https://www.opawey.com`, then:

```bash
curl -sI https://www.opawey.com/robots.txt | head -1     # expect: HTTP/2 200
curl -sI https://www.opawey.com/llms.txt | head -1       # expect: HTTP/2 200
curl -sI https://www.opawey.com/sitemap-index.xml | head -1  # expect: HTTP/2 200
curl -s  https://www.opawey.com/sitemap-index.xml | head -5  # expect: <?xml ... <sitemapindex>
curl -s  https://www.opawey.com/ | grep -E 'canonical|og:url' | head -5  # expect: www.opawey.com URLs only
```

If any of these still return the SPA 404 page, the file isn't in `public/` — re-check Tasks 3 & 4. If `canonical` still says `opaway.vercel.app`, Vercel served a stale build — trigger a redeploy.

---

## Self-Review Checklist

- [ ] No remaining `opaway.vercel.app` strings: `git grep -n 'opaway.vercel' src/` should be empty.
- [ ] No remaining `opaway.com` (no Y) strings: `git grep -n 'opaway\.com' src/ public/` should be empty (only `opawey.com` should appear).
- [ ] `0206Ε70000370500` appears in both `Layout.astro` (JSON-LD) and `Footer.astro` (contact block); the Ε in both is U+0395.
- [ ] `astro.config.mjs` has `site: 'https://www.opawey.com'` and the sitemap `filter` excludes admin/driver/hotel/agency/profile + booking flow + auth utility routes.
- [ ] `robots.txt` lists every dashboard prefix as `Disallow:` and points to `https://www.opawey.com/sitemap-index.xml`.
- [ ] `llms.txt` lists only public marketing pages and uses `https://www.opawey.com/...` URLs.
- [ ] Built `dist/sitemap-0.xml` contains 8–15 URLs, all under `https://www.opawey.com/`, with no dashboard / booking-flow / auth route.
- [ ] Footer renders address, landline, mobile, email, website, and the MHTE legal line — in that order — with the MHTE string byte-identical to `MH.TE NUMBER (0206Ε70000370500)`.
- [ ] Dashboard pages emit `<meta name="robots" content="noindex, nofollow">`.
