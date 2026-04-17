# Admin Hourly Bookings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an admin page at `/admin/hourly` to manage hourly rental bookings, add it to the admin sidebar, and filter the existing transfers page to exclude hourly bookings.

**Architecture:** Hourly bookings are stored in the `transfers` table with `booking_type = 'hourly'`. Create a new admin page modeled after `admin/transfers.astro` that queries with `.eq('booking_type', 'hourly')`, displays hourly-specific columns (Pickup, Hours instead of From/To), and supports the same admin actions (ride status, payment status, driver assignment, manual add). Update the existing transfers page to filter out hourly records.

**Tech Stack:** Astro 5, Supabase JS, AdminLayout component

---

## Task 1: Add "Hourly" nav item to AdminLayout

**Files:**
- Modify: `src/components/AdminLayout.astro` (line 31)

- [ ] **Step 1: Add the nav entry**

In `src/components/AdminLayout.astro`, after the tours entry (line 30), add the hourly entry:

```typescript
// Change this (lines 27-32):
items: [
    { key: 'requests',    label: 'Requests',    href: '/admin/requests',    icon: 'inbox'    },
    { key: 'transfers',   label: 'Transfers',   href: '/admin/transfers',   icon: 'transfer' },
    { key: 'tours',       label: 'Tours',       href: '/admin/tours',       icon: 'map' },
    { key: 'experiences', label: 'Experiences', href: '/admin/experiences', icon: 'star' },
],

// To this:
items: [
    { key: 'requests',    label: 'Requests',    href: '/admin/requests',    icon: 'inbox'    },
    { key: 'transfers',   label: 'Transfers',   href: '/admin/transfers',   icon: 'transfer' },
    { key: 'hourly',      label: 'Hourly',      href: '/admin/hourly',      icon: 'transfer' },
    { key: 'tours',       label: 'Tours',       href: '/admin/tours',       icon: 'map' },
    { key: 'experiences', label: 'Experiences', href: '/admin/experiences', icon: 'star' },
],
```

- [ ] **Step 2: Verify build**

Run: `npx astro build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/components/AdminLayout.astro
git commit -m "feat: add Hourly nav item to admin sidebar"
```

---

## Task 2: Filter admin transfers page to exclude hourly bookings

**Files:**
- Modify: `src/pages/admin/transfers.astro` (line 237)

- [ ] **Step 1: Add booking_type filter to transfers query**

In `src/pages/admin/transfers.astro`, line 237, change:

```typescript
const { data, error } = await supabase.from('transfers').select('*').order('created_at', { ascending: false });
```

To:

```typescript
const { data, error } = await supabase.from('transfers').select('*').neq('booking_type', 'hourly').order('created_at', { ascending: false });
```

- [ ] **Step 2: Also filter the manual add booking insert**

In the same file, the add-booking form submit handler (line 407) inserts without `booking_type`. Add `booking_type: 'transfer'` to the insert object:

```typescript
// Line 407-422, add booking_type:
await supabase.from('transfers').insert({
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phone || '',
    from, to, date,
    time: time || '',
    passengers,
    vehicle_name: vehicle || '',
    notes: notes || '',
    ride_status: rideStatus,
    payment_status: 'pending',
    payment_method: 'cash',
    driver: '',
    added_by_admin: true,
    booking_type: 'transfer',
}).select().single();
```

- [ ] **Step 3: Verify build**

Run: `npx astro build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/transfers.astro
git commit -m "fix: filter hourly bookings out of admin transfers page"
```

---

## Task 3: Create `/admin/hourly` page

**Files:**
- Create: `src/pages/admin/hourly.astro`
- Reference: `src/pages/admin/transfers.astro` (template)

This is the main task. The page is modeled after `admin/transfers.astro` but adapted for hourly bookings.

- [ ] **Step 1: Create the page with HTML structure**

Create `src/pages/admin/hourly.astro` with:

**Frontmatter:**
```astro
---
import AdminLayout from '../../components/AdminLayout.astro';
---
```

**Layout wrapper:**
```html
<AdminLayout pageTitle="Hourly Bookings" activeSection="hourly">
```

**Table headers** (adapted for hourly — replace From/To with Pickup/Hours):

| Date | Time | Name | Email | Phone | Pickup | Hours | Passengers | Vehicle | Driver | Ride Status | Payment |
|------|------|------|-------|-------|--------|-------|------------|---------|--------|-------------|---------|

**Add Booking Modal** — same as transfers but with hourly-specific fields:
- Replace "From" with "Pickup Location"
- Remove "To" field
- Add "Hours" field (number input, min 1)
- Add "Per Hour Rate" field (number input)

- [ ] **Step 2: Add the script block**

The script is identical to `admin/transfers.astro` with these changes:

1. **Query:** `supabase.from('transfers').select('*').eq('booking_type', 'hourly').order('created_at', { ascending: false })`

2. **Table row rendering:** Replace From/To columns with:
   - Pickup: `d.from ?? '—'` (hourly uses `from` for pickup location)
   - Hours: `d.hours ?? '—'` with "h" suffix

3. **Add booking insert:** Include hourly-specific fields:
   ```typescript
   await supabase.from('transfers').insert({
       booking_type: 'hourly',
       first_name: firstName,
       last_name: lastName,
       email,
       phone: phone || '',
       from: pickup, to: pickup,
       date,
       time: time || '',
       hours: parseInt(hoursVal),
       per_hour: parseFloat(perHourVal) || 0,
       passengers,
       vehicle_name: vehicle || '',
       notes: notes || '',
       ride_status: rideStatus,
       payment_status: 'pending',
       payment_method: 'cash',
       driver: '',
       added_by_admin: true,
   }).select().single();
   ```

4. **All admin actions (ride status, payment status, driver assignment)** stay exactly the same — they update the `transfers` table by `id`.

- [ ] **Step 3: Verify build**

Run: `npx astro build 2>&1 | tail -5`
Expected: 58 pages built (new hourly page added)

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/hourly.astro
git commit -m "feat: create admin hourly bookings page"
```

---

## Verification

After all tasks are complete:

1. **Build check:** `npx astro build` — should complete with 58 pages
2. **Dev server test:** `npm run dev`
   - Navigate to `/admin` — sidebar should show "Hourly" under Bookings
   - `/admin/transfers` — should NOT show hourly bookings (booking_type = 'hourly')
   - `/admin/hourly` — should show ONLY hourly bookings
   - Click "Add Booking" on hourly page — modal should have Pickup, Hours, Per Hour fields
   - Test ride status dropdown, payment status dropdown, driver inline edit on hourly page
3. **Push to production:** `git push` — Vercel auto-deploys

---

## File Change Summary

| File | Action | Task |
|------|--------|------|
| `src/components/AdminLayout.astro` | MODIFY | 1 |
| `src/pages/admin/transfers.astro` | MODIFY | 2 |
| `src/pages/admin/hourly.astro` | CREATE | 3 |
