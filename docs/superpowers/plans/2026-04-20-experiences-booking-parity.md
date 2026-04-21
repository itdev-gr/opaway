# Experiences Booking Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `/experiences` page and its downstream flow functionally identical to the Tours booking flow — experience dropdown + pickup autocomplete + per-vehicle pricing + Stripe/cash/card-onsite payment — with matching admin catalog management and shared Supabase schema.

**Architecture:** Extend the `experiences_catalog` Supabase table to mirror `tours_catalog` (per-vehicle pricing + duration + three highlight fields). Rewrite `src/pages/experiences.astro` as a clone of `src/pages/book/tour.astro`. Add three downstream pages at `src/pages/book/experience/{results,passenger,payment}.astro` mirroring the tour flow. Upgrade `src/pages/admin/manage-experiences.astro` to capture the new catalog fields. All existing nav links to `/experiences` keep working; the admin "Experiences" tab already exists.

**Tech Stack:** Astro 5, Tailwind CSS 4, Supabase (Postgres), Stripe (`@stripe/stripe-js`), Google Places Autocomplete via `src/lib/places-autocomplete.ts`, form error helpers via `src/lib/form-errors.ts`, image upload via `src/lib/upload.ts`, partner-discount via `src/lib/pricing.ts`.

**Hard constraints:**
- The `experiences` bookings table is already created and in use — insert shape must remain compatible with existing rows and with `admin/experiences.astro` / `profile/experiences.astro` readers.
- Every `alert(...)` call for validation or API failure must use `showFieldError` / `showFormError` (matches the pattern introduced earlier this session — no popups).
- Autocomplete wiring must use `attachPlacesAutocomplete` (shared loader).

---

## File Structure

### Create

- `db/migrations/2026-04-20-experiences-catalog-parity.sql` — SQL that extends `experiences_catalog` with 7 new columns + a helper view for admin listings. User runs this in Supabase Dashboard SQL Editor (or via CLI) before proceeding with code that reads the new columns.
- `src/pages/book/experience/results.astro` — vehicle selection + price calculation. Mirrors `src/pages/book/tour/results.astro`.
- `src/pages/book/experience/passenger.astro` — lead-passenger details form. Mirrors `src/pages/book/tour/passenger.astro`.
- `src/pages/book/experience/payment.astro` — payment method selection + Stripe + Supabase insert into `experiences` table. Mirrors `src/pages/book/tour/payment.astro`.

### Modify

- `src/pages/experiences.astro` — rewrite to mirror `src/pages/book/tour.astro`: booking form panel (experience dropdown, pickup with autocomplete, date/time, participants counter, See prices button with inline error UX), carousel populated from `experiences_catalog`, catalog grid section below.
- `src/pages/admin/manage-experiences.astro` — add `price_sedan`, `price_van`, `price_minibus`, `duration`, `highlight1`, `highlight2`, `highlight3` form fields + UPDATE/INSERT payload wiring. Keep image upload + publish toggle as-is.
- `src/pages/admin/experiences.astro` — only if parity audit against `src/pages/admin/tours.astro` turns up a gap (see Task 8 audit step).

### Delete (end of flow)

- `src/components/experiences/ExperiencesHero.astro` — replaced by the hero block embedded in the rewritten `src/pages/experiences.astro`.
- `src/components/experiences/ExperiencesList.astro` — hard-coded wine-tasting / catamaran showcase; replaced by the data-driven carousel + catalog grid.
- Only delete once the new `experiences.astro` is live and verified.

---

## Task 1: Extend `experiences_catalog` schema in Supabase

**Files:**
- Create: `db/migrations/2026-04-20-experiences-catalog-parity.sql`

**Why first:** Every downstream admin / booking page that reads `price_sedan` / `duration` / `highlight*` requires these columns to exist. Running the SQL is a one-shot user action — the plan cannot continue meaningfully until it's done.

- [ ] **Step 1: Write the migration SQL**

Create `db/migrations/2026-04-20-experiences-catalog-parity.sql` with exactly:

```sql
-- Brings experiences_catalog to parity with tours_catalog:
-- per-vehicle pricing, duration label, and three highlight strings.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.experiences_catalog
  ADD COLUMN IF NOT EXISTS price_sedan   numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_van     numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_minibus numeric(10,2),
  ADD COLUMN IF NOT EXISTS duration      text,
  ADD COLUMN IF NOT EXISTS highlight1    text,
  ADD COLUMN IF NOT EXISTS highlight2    text,
  ADD COLUMN IF NOT EXISTS highlight3    text;

-- Back-fill per-vehicle pricing from the existing flat `price` column
-- so existing catalog rows produce a valid results page immediately.
UPDATE public.experiences_catalog
SET
  price_sedan   = COALESCE(price_sedan,   price),
  price_van     = COALESCE(price_van,     price),
  price_minibus = COALESCE(price_minibus, price)
WHERE price IS NOT NULL;

-- No index / RLS changes needed: `published` index (if any) and
-- existing RLS on experiences_catalog continue to apply.
```

- [ ] **Step 2: Run the migration in Supabase**

The user runs this in the Supabase Dashboard SQL Editor (project → SQL → New query → paste → Run). Confirm by running:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'experiences_catalog'
ORDER BY ordinal_position;
```

Expected: the list includes `price_sedan`, `price_van`, `price_minibus`, `duration`, `highlight1`, `highlight2`, `highlight3`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-04-20-experiences-catalog-parity.sql
git commit -m "db: extend experiences_catalog with per-vehicle pricing + highlights"
```

---

## Task 2: Upgrade admin catalog editor (`/admin/manage-experiences`)

**Files:**
- Modify: `src/pages/admin/manage-experiences.astro`

Reference: `src/pages/admin/manage-tours.astro` is the exact template. Open both side by side — the diff between the two today is: the tours file has fields for `price_sedan` / `price_van` / `price_minibus` / `duration` / `highlight1` / `highlight2` / `highlight3`; the experiences file has only `price` / `title` / `description` / `image_url` / `published`.

- [ ] **Step 1: Read the tours reference**

Run:

```bash
sed -n '1,200p' src/pages/admin/manage-tours.astro
```

Note the exact field IDs used: `f-file`, `f-image`, `f-title`, `f-price-sedan`, `f-price-van`, `f-price-minibus`, `f-duration`, `f-description`, `f-h1`, `f-h2`, `f-h3`. The Experiences form will use the same IDs but scoped to its own page (safe since both pages never render in the same DOM).

- [ ] **Step 2: Add the new form inputs in `manage-experiences.astro`**

Inside the admin form (replace the current `<input id="f-price" ...>` single-price field), insert this block — matching the tours page layout pixel-for-pixel:

```astro
<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Price — Sedan (€)</label>
		<input id="f-price-sedan" type="number" step="0.01" min="0" placeholder="0.00"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Price — Van (€)</label>
		<input id="f-price-van" type="number" step="0.01" min="0" placeholder="0.00"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Price — Minibus (€)</label>
		<input id="f-price-minibus" type="number" step="0.01" min="0" placeholder="0.00"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
</div>

<div class="mb-4">
	<label class="block text-sm font-medium text-neutral-700 mb-1">Duration label</label>
	<input id="f-duration" type="text" placeholder="e.g. Half day · ~4 hours"
		class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
</div>

<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Highlight 1</label>
		<input id="f-h1" type="text" placeholder="Short bullet"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Highlight 2</label>
		<input id="f-h2" type="text" placeholder="Short bullet"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
	<div>
		<label class="block text-sm font-medium text-neutral-700 mb-1">Highlight 3</label>
		<input id="f-h3" type="text" placeholder="Short bullet"
			class="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]" />
	</div>
</div>
```

The old `<input id="f-price" ...>` element is removed (the flat `price` column is no longer the source of truth — per-vehicle prices replace it; the DB column stays and is kept in sync via the back-fill for older rows).

- [ ] **Step 3: Update the SAVE handler to write the new columns**

Find the existing insert/update block in `manage-experiences.astro` (search for `.from('experiences_catalog').insert` / `.update`). Replace the payload construction with:

```ts
const payload = {
	title: (document.getElementById('f-title') as HTMLInputElement).value.trim(),
	description: (document.getElementById('f-description') as HTMLTextAreaElement).value.trim(),
	image_url: (document.getElementById('f-image') as HTMLInputElement).value.trim(),
	price_sedan:   Number((document.getElementById('f-price-sedan')   as HTMLInputElement).value) || null,
	price_van:     Number((document.getElementById('f-price-van')     as HTMLInputElement).value) || null,
	price_minibus: Number((document.getElementById('f-price-minibus') as HTMLInputElement).value) || null,
	duration:      (document.getElementById('f-duration') as HTMLInputElement).value.trim() || null,
	highlight1:    (document.getElementById('f-h1') as HTMLInputElement).value.trim() || null,
	highlight2:    (document.getElementById('f-h2') as HTMLInputElement).value.trim() || null,
	highlight3:    (document.getElementById('f-h3') as HTMLInputElement).value.trim() || null,
	published: true,
};
```

Keep the existing code that branches on "edit mode" (update vs insert). Update both branches to use this payload shape.

- [ ] **Step 4: Update the EDIT-modal prefill**

Find the edit handler (search for `function openEdit` or `f-title')?.value = `). Extend it to prefill every new field:

```ts
(document.getElementById('f-title')         as HTMLInputElement).value    = row.title ?? '';
(document.getElementById('f-description')   as HTMLTextAreaElement).value = row.description ?? '';
(document.getElementById('f-image')         as HTMLInputElement).value    = row.image_url ?? '';
(document.getElementById('f-price-sedan')   as HTMLInputElement).value    = row.price_sedan   ?? row.price ?? '';
(document.getElementById('f-price-van')     as HTMLInputElement).value    = row.price_van     ?? row.price ?? '';
(document.getElementById('f-price-minibus') as HTMLInputElement).value    = row.price_minibus ?? row.price ?? '';
(document.getElementById('f-duration')      as HTMLInputElement).value    = row.duration      ?? '';
(document.getElementById('f-h1')            as HTMLInputElement).value    = row.highlight1    ?? '';
(document.getElementById('f-h2')            as HTMLInputElement).value    = row.highlight2    ?? '';
(document.getElementById('f-h3')            as HTMLInputElement).value    = row.highlight3    ?? '';
```

- [ ] **Step 5: Update the card grid display (per-experience)**

The existing grid likely shows `row.price` with a single euro value. Update it to show all three prices, matching manage-tours display. Find the row-rendering block and replace the single price line with:

```ts
const priceLine = [
	row.price_sedan   ? `Sedan €${Number(row.price_sedan).toFixed(0)}`     : null,
	row.price_van     ? `Van €${Number(row.price_van).toFixed(0)}`         : null,
	row.price_minibus ? `Minibus €${Number(row.price_minibus).toFixed(0)}` : null,
].filter(Boolean).join(' · ') || (row.price ? `€${Number(row.price).toFixed(0)}` : '—');
```

Use `priceLine` wherever the old single-price was rendered.

- [ ] **Step 6: Manual smoke test**

Run `npm run dev`, sign in as admin, go to `/admin/manage-experiences`, create a new experience with title `Wine tasting test`, duration `Half day · ~4 hours`, prices 80/140/220 for sedan/van/minibus, three highlights. Save. Refresh — confirm it appears in the grid with the 3-price line, and clicking Edit re-opens the modal with every field prefilled.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/manage-experiences.astro
git commit -m "admin: extend manage-experiences catalog form with vehicle prices, duration, highlights"
```

---

## Task 3: Create `/book/experience/results.astro` (vehicle selection)

**Files:**
- Create: `src/pages/book/experience/results.astro`

Mirrors `src/pages/book/tour/results.astro` — reads the selected experience by `experienceId`, displays three vehicle cards with per-vehicle pricing (with partner discount applied), navigates to passenger page on selection.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/pages/book/experience
```

- [ ] **Step 2: Read the tour reference**

```bash
sed -n '1,200p' src/pages/book/tour/results.astro
```

You will clone this file with four global substitutions:
- `tour_id` → `experience_id` (in URL params + Supabase reads)
- `tourId` / `tourName` → `experienceId` / `experienceName` (in JS variable names)
- `tours_catalog` → `experiences_catalog` (in Supabase reads)
- `/book/tour/` → `/book/experience/` (in hrefs + navigation)
- `bookingType: 'tour'` → `bookingType: 'experience'`

Page title / heading strings change from "Tour" → "Experience" where appropriate.

- [ ] **Step 3: Write the file**

Create `src/pages/book/experience/results.astro` with the content of `src/pages/book/tour/results.astro`, applying the substitutions above. Full file — produce a complete copy; don't diff-patch. Keep the exact same layout, sub-nav tabs (`/book/transfer` / `/book/hourly` / `/book/tour` / `/experiences` — the experiences entry should now be active), vehicle cards, sidebar, price-calculation, partner-discount logic.

**Key behaviour parity points to double-check in the cloned file:**
- URL params read: `experienceId`, `experienceName`, `pickup`, `date`, `time`, `participants`
- Supabase read: `.from('experiences_catalog').select('price_sedan, price_van, price_minibus').eq('id', experienceId).maybeSingle()`
- On no price data → fall back to `null` → hide the vehicle card (parity with Tours: don't show a vehicle the admin hasn't priced yet)
- CTA link per vehicle: `/book/experience/passenger?{...all params...}&vehicleSlug=...&vehicleName=...&vehicleImage=...&totalPrice=...&bookingType=experience`

- [ ] **Step 4: Build check**

```bash
npm run build
```

Expected: `62 page(s)` rises to `63` (the new page) with no errors. Note the actual count for the remaining tasks' expectations.

- [ ] **Step 5: Commit**

```bash
git add src/pages/book/experience/results.astro
git commit -m "feat(book): add experience results page (vehicle selection + per-vehicle pricing)"
```

---

## Task 4: Create `/book/experience/passenger.astro`

**Files:**
- Create: `src/pages/book/experience/passenger.astro`

Same mechanical clone as Task 3, but for the passenger-details page.

- [ ] **Step 1: Read the tour reference**

```bash
sed -n '1,400p' src/pages/book/tour/passenger.astro
```

- [ ] **Step 2: Clone with substitutions**

Create `src/pages/book/experience/passenger.astro` copying `src/pages/book/tour/passenger.astro` verbatim, then apply:

- `tourId` → `experienceId` (URL param names)
- `tourName` → `experienceName`
- `tour_id`/`tour_name` → `experience_id`/`experience_name` (if referenced)
- `/book/tour/` → `/book/experience/`
- `bookingType: 'tour'` → `bookingType: 'experience'`
- Page titles / heading strings: "Tour" → "Experience"

**Keep identical:** the `supabase.auth.onAuthStateChange` auto-fill of first name / last name / email, the inline error helpers (`showFieldError` / `clearFormErrors`), the email-format check, the sidebar summary card.

**Forward params** on submit: build the URL for `/book/experience/payment?...` including all the fields Tours forwards plus `experienceId`, `experienceName`, `participants`, `bookingType: 'experience'`.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: page count rises by 1, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/experience/passenger.astro
git commit -m "feat(book): add experience passenger-details page"
```

---

## Task 5: Create `/book/experience/payment.astro`

**Files:**
- Create: `src/pages/book/experience/payment.astro`

Mirrors `src/pages/book/tour/payment.astro`. Writes to the existing `experiences` bookings table (columns already in place).

- [ ] **Step 1: Read the tour reference**

```bash
sed -n '1,500p' src/pages/book/tour/payment.astro
```

- [ ] **Step 2: Clone with substitutions**

Create `src/pages/book/experience/payment.astro` copying the tour payment page verbatim, then apply:

- `tourId` / `tour_id` → `experienceId` / `experience_id`
- `tourName` / `tour_name` → `experienceName` / `experience_name`
- `.from('tours')` → `.from('experiences')` (the INSERT target)
- `/book/tour/` → `/book/experience/` (back-button href)
- `bookingType: 'tour'` → `bookingType: 'experience'`
- Copy labels: "Tour" → "Experience" wherever user-facing

**Supabase insert payload** — use exactly these columns (matches existing `experiences` table inspected in the audit):

```ts
const payload = {
	experience_id: experienceId,
	experience_name: experienceName,
	pickup, pickup_location: pickup,
	date, time,
	participants: parseInt(participants, 10),
	passengers: parseInt(participants, 10),
	vehicle_name: vehicleName,
	first_name: firstName, last_name: lastName,
	name: `${firstName} ${lastName}`.trim(),
	email, phone,
	notes: driverNotes || null,
	total_price: finalTotal,
	ride_status: 'new',
	payment_status: paymentMethod === 'stripe' ? 'paid' : 'pending',
	payment_method: paymentMethod,
	payment_token: paymentToken || null,
	uid: user?.id || null,
	partner_id: partnerId,
	added_by_admin: false,
};
```

**Keep identical:** Stripe loader, payment-method radio group, card-onsite 5% surcharge, inline error helpers, success section (reference ID, summary lines, email confirmation).

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build succeeds, page count reflects another new page, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/book/experience/payment.astro
git commit -m "feat(book): add experience payment page (Stripe + Supabase insert)"
```

---

## Task 6: Rewrite `/experiences.astro` as booking form

**Files:**
- Modify: `src/pages/experiences.astro` (full rewrite)
- Delete (end of task): `src/components/experiences/ExperiencesHero.astro`, `src/components/experiences/ExperiencesList.astro`

The page today renders a showcase with a "Request Quote" form. After this task it renders a mirror of `src/pages/book/tour.astro` — including the hero section, sub-nav tabs, booking form panel on the left, data-driven carousel on the right, and a catalog grid section below.

- [ ] **Step 1: Read the tour page for reference**

```bash
sed -n '1,450p' src/pages/book/tour.astro
```

- [ ] **Step 2: Write the new `experiences.astro`**

Overwrite `src/pages/experiences.astro` with the content of `src/pages/book/tour.astro`, applying these substitutions:

- `tour-select` → `experience-select`
- `tour-pickup` → `experience-pickup`
- `tour-date` → `experience-date`
- `tour-time` → `experience-time`
- `tour-submit-btn` → `experience-submit-btn`
- `tour-carousel-inner` / `data-tour-carousel` / `data-tour-card` / `data-tour-prev` / `data-tour-next` / `data-tour-indicator` → replace `tour` with `experience` in all six
- `tours_catalog` → `experiences_catalog` (Supabase read)
- `loadTours` function name → `loadExperiences`
- `/book/tour/results` → `/book/experience/results` (navigation target)
- URL param `tourId` / `tourName` → `experienceId` / `experienceName`
- User-facing copy: "Tour" → "Experience", "Tours" → "Experiences", "Book a Tour" → "Book an Experience", section headers like "Curated Tours in Greece" → "Curated Experiences in Greece", "Explore Available Tours" → "Explore Available Experiences"
- Sub-nav tabs: four entries — `/book/transfer`, `/book/hourly`, `/book/tour`, `/experiences`; make the Experiences tab the active one (apply the `bg-[#0C6B95] text-white` styling to `/experiences`, give the others the neutral styling).

**Keep identical to the Tours page:**
- Hero section (if tour page has one — confirm during reading) — title, subtitle, background image/video
- Partner-discount detection block at top of script
- `loadExperiences` async function — uses the same `.neq('published', false).order('created_at', { ascending: false })` filter
- Select-dropdown population loop
- Carousel init (identical animation logic, same dead-zone / timing numbers)
- Catalog grid rendering with `esc()` helper
- Autocomplete attached via `attachPlacesAutocomplete` on `experience-pickup`
- Inline error helpers + `wireAutoClear` on `experience-select` and `experience-date`
- Submit-button handler: validates select + date, navigates with `new URLSearchParams` to `/book/experience/results`

- [ ] **Step 3: Verify public page works end-to-end**

Run `npm run dev`, go to `http://localhost:4321/experiences`. Expected:
1. Sub-nav: Transfer / Rent per Hour / Tour / Experience — Experience tab highlighted.
2. Left panel: Experience dropdown populated from `experiences_catalog` (you already created a test row in Task 2 Step 6).
3. Right: carousel shows the same experience with duration label + three highlights (or a graceful fallback when fields are blank).
4. Pickup field: typing "athens" shows Google Places suggestions.
5. Clicking "See prices" with no selection: red inline helper under the select + banner — no `alert()`.
6. Selecting an experience + a date + pressing See prices: navigates to `/book/experience/results?experienceId=...&experienceName=...&pickup=...&date=...&time=...&participants=...`

- [ ] **Step 4: Delete stale components**

```bash
rm src/components/experiences/ExperiencesHero.astro
rm src/components/experiences/ExperiencesList.astro
```

Verify nothing else imports them:

```bash
grep -rn "ExperiencesHero\|ExperiencesList" src/
```

Expected: no output (empty result). If anything still references them, remove the stale imports in those files as part of this task.

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/experiences.astro src/components/experiences/
git commit -m "feat(experiences): rewrite public page as Tours-parity booking flow entry"
```

---

## Task 7: End-to-end flow verification (browser)

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run dev**

```bash
npm run dev
```

- [ ] **Step 2: Book an experience end-to-end (happy path)**

In the browser at `http://localhost:4321`:
1. Visit `/experiences` → select the test experience from Task 2 → enter pickup (use autocomplete) → pick a date + time → set participants to 3 → click **See prices**.
2. Arrive at `/book/experience/results?...` — confirm three vehicle cards render with the three prices you set (80/140/220 minus any partner discount) and the sidebar sticky summary shows the right experience name / pickup / date.
3. Click the **Sedan** card — arrive at `/book/experience/passenger?...` — confirm auto-fill of first name / last name / email if logged in.
4. Fill in passenger fields → click **Continue** → arrive at `/book/experience/payment?...`.
5. Select **Cash** as payment method (simplest for local test) → click **Complete Booking**.
6. Confirm the success section renders with a reference ID and the email confirmation line.

- [ ] **Step 3: Verify DB row**

In Supabase Dashboard → Table Editor → `experiences` table. The new row should have: `experience_id` = the UUID, `experience_name` = your test title, `vehicle_name` = Sedan, `total_price` = 80 (or discounted), `payment_method` = `cash`, `payment_status` = `pending`, `ride_status` = `new`, `uid` = your auth user id (or null for guest).

- [ ] **Step 4: Verify admin dashboard**

Go to `/admin/experiences`. Confirm the new booking appears in the list with all columns populated. The dashboard calendar (`/admin`) should also show a new violet dot on the booking date.

- [ ] **Step 5: Validation-error paths**

Click **See prices** with empty Experience select → red inline helper "Please select an experience." under the select (not a popup). Click **Complete Booking** with no payment method selected → red banner above the button (not a popup). Commit: no code changes needed — this is a verification gate.

- [ ] **Step 6: Text parity: no stray "tour" leakage in experience UI**

Run:

```bash
grep -rn -iE "tour|Τουρ" src/pages/experiences.astro src/pages/book/experience/
```

Expected: only matches inside comments or routes like `/book/tour` that are links in the sub-navigation. No user-facing heading/label mistakenly reading "Tour" on an Experience page.

- [ ] **Step 7: Commit any fixes**

If verification turns up issues (typo in a cloned substitution, missing wiring), fix them and commit:

```bash
git add -A
git commit -m "fix(experiences): address end-to-end verification findings"
```

If no fixes are needed, skip this step.

---

## Task 8: Admin bookings-list parity audit

**Files:**
- Modify: `src/pages/admin/experiences.astro` (only if audit finds gaps)

`/admin/experiences.astro` already exists. Confirm it's at feature parity with `/admin/tours.astro` and close any gap.

- [ ] **Step 1: Run the audit diff**

```bash
diff <(sed 's/[Tt]our/EXP/g; s/tours/experiences/g' src/pages/admin/tours.astro) src/pages/admin/experiences.astro | head -80
```

This is a coarse diff — it will flag layout differences, missing columns in the table, missing modal fields, missing edit handlers. Don't try to make the diff empty (the two pages will never be identical); instead, scan for **functional** gaps: missing columns in the table, missing inline status dropdowns, missing "Add booking" modal, missing driver-assignment column.

- [ ] **Step 2: Compile gap list**

Write the gaps (if any) as a short checklist — e.g.:

- [ ] No "Add booking" modal in experiences.astro
- [ ] Missing `driver` column in table
- [ ] Payment-status dropdown doesn't re-render on change

Each gap becomes a sub-step below.

- [ ] **Step 3: Close each gap**

For each gap, apply the corresponding markup/script from `src/pages/admin/tours.astro` into `src/pages/admin/experiences.astro`, substituting `tours`→`experiences`, `tour_id`→`experience_id`, `tour_name`→`experience_name`. The structural patterns are identical.

- [ ] **Step 4: Manual test**

Sign in as admin → `/admin/experiences`. Verify all columns render, the "Add booking" modal (if cloned) populates its experience dropdown, inline ride-status changes persist after page refresh.

- [ ] **Step 5: Commit (only if changes were made)**

```bash
git add src/pages/admin/experiences.astro
git commit -m "admin: close feature-parity gaps in experiences bookings list"
```

If Step 2 produced an empty gap list, skip the commit.

---

## Task 9: Push

**Files:**
- None.

- [ ] **Step 1: Push all commits from this plan**

```bash
git push origin main
```

Expected: `remote: ...` shows the new commits landed on `origin/main`. The user can now exercise the flow in the deployed preview.

---

## Notes / risks

- **Backwards compat:** Existing rows in `experiences_catalog` have only the flat `price` column; the migration back-fills `price_sedan/van/minibus` from `price` so the new results page renders for legacy rows out of the box. The flat `price` column is left in the table (not dropped) to avoid breaking unknown readers.
- **`experiences` bookings table:** already exists with the right columns (27 total, matching `tours`). No migration needed for that table.
- **Admin tab already wired:** the sidebar "Experiences" entry at `src/components/AdminLayout.astro:31` is already present with the `star` icon and `activeSection="experiences"` key. The "adjustment" the user mentioned was likely about catalog editor parity (Task 2), not the sidebar itself.
- **No home-page Experiences tab:** the home booking widget (`BookingSection.astro`) has only Transfer / Rent per hour / Tours tabs today. Adding a fourth Experiences tab was deliberately excluded from this plan — user can request it as a separate task. The Navbar and Footer already route to `/experiences` for public discovery.
- **Image upload folder:** `manage-experiences.astro` already uploads to the `experiences` folder in Supabase Storage (verified in the audit). No change needed in Task 2.
- **Partner discount:** works identically to Tours — reads `partners.discount` for approved partners, applies via `applyPartnerDiscount()` on the results page. No new helper required.
- **Existing `/experiences` request-quote flow:** the current page submits to the `requests` table. This plan **replaces** that flow with a full booking flow. If the quote-only pathway is still desired as an alternative, it can be restored as an "Ask for a custom quote" CTA on the rewritten page — but that's out of scope here unless the user asks.
