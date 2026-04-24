# Optional Ticket Name for Tour Entrance Tickets

**Date:** 2026-04-24
**Status:** Approved — ready for plan
**Scope:** Extends the shipped entrance-tickets feature (`feat/tour-entrance-tickets`) with an optional admin-set name that flows through to the customer passenger/payment UI, the booking row, and the admin reservation modal.

---

## Goal

Let admins name the specific ticket they're selling on a priced tour (e.g. "Knossos Entry Ticket", "Acropolis Combo Pass"). When a name is set, the customer sees it — in the passenger-step block heading, in both sidebars, and on the admin reservation detail. When it's blank, the existing "Entrance tickets" label stays as the fallback. No migration backfill needed; the field is nullable.

## Context

The base entrance-tickets feature is already live on this branch:

- `tours_catalog` has `entrance_ticket_per_person` and `entrance_ticket_count` (admin-set at `src/pages/admin/manage-tours.astro`).
- `tours` booking table has `entrance_tickets_count` and `entrance_tickets_total` (added in `db/migrations/2026-04-24-tours-entrance-tickets.sql`).
- Customer flow (`src/pages/book/tour/passenger.astro` → `src/pages/book/tour/payment.astro`) already renders an "Entrance tickets" block, forwards `ticketCount` + `ticketUnitPrice` through URL params, recomputes totals, and persists count + subtotal on the booking.
- Admin reservation detail modal (`src/components/ReservationDetailModal.astro`) already renders an "Entrance tickets: N × €X = €Y" row.

This spec adds a single new piece — a name — across the same surfaces.

## Schema migration

New file `db/migrations/2026-04-24-tours-entrance-ticket-name.sql`:

```sql
alter table public.tours_catalog
  add column if not exists entrance_ticket_name text;

alter table public.tours
  add column if not exists entrance_tickets_name text;
```

Both columns are nullable. `tours_catalog.entrance_ticket_name` is admin-edited. `tours.entrance_tickets_name` is a per-booking snapshot so historical bookings preserve the name even if the catalog row is renamed later.

Applied to prod before feature code ships.

## Admin — `src/pages/admin/manage-tours.astro`

Add a full-width row **above** the existing `Entrance ticket per person / Number of tickets` grid, in both the Add form and the Edit modal. Full-width (not a third grid column) keeps the form readable on mobile and visually establishes name → price/count as a group.

```
TICKET NAME
[  e.g. Knossos Entry Ticket                                  ]
Optional. Shown to customers next to the ticket price.
```

- Input IDs: `f-entrance-name` (Add), `e-entrance-name` (Edit) — matching the existing `f-entrance-*` / `e-entrance-*` convention.
- `type="text"`, `maxlength="80"`, no `required`.
- Trim on submit. Empty string → send `null`.
- Insert/update payload gains `entrance_ticket_name: <trimmed value or null>`.
- Row mapper in the grid picks up `d.entrance_ticket_name` alongside existing `entrance_ticket_per_person` / `entrance_ticket_count`.
- Edit-modal open: populate input from `item.entranceName ?? ''`.

## Customer — passenger.astro + payment.astro

### passenger.astro

1. Extend the existing catalog fetch to also `select('entrance_ticket_name')`.
2. When `ticketUnitPrice > 0`, before revealing the block, resolve the display label:
   - `const ticketLabel = (tourRow.entrance_ticket_name || '').trim() || 'Entrance tickets';`
3. Set the block heading text (currently a static `<p>Entrance tickets</p>` at line 106) and the sidebar row label (currently `<span>Entrance tickets</span>` at line 218) to `ticketLabel`. Both use the same value.
4. Forward the name through URL as `ticketName` (URI-encoded). Omit the param entirely when blank, to keep clean URLs for the default case.

### payment.astro

1. Parse `ticketName` from URL: `const ticketName = (params.get('ticketName') || '').trim();`.
2. Resolve display label the same way: `ticketName || 'Entrance tickets'`.
3. Apply to the sidebar row label (currently `<span>Entrance tickets</span>` at line 245).
4. The `tours` insert payload gains `entrance_tickets_name: ticketName || null` alongside the existing `entrance_tickets_count` / `entrance_tickets_total`.

## Admin — `src/components/ReservationDetailModal.astro`

Update the existing `field('Entrance tickets', …)` call (line 89) so the field's label uses the snapshotted booking name when present:

```ts
${field(
  (r.entrance_tickets_name || '').trim() || 'Entrance tickets',
  (r.entrance_tickets_count || 0) > 0
    ? `${r.entrance_tickets_count} × €${(Number(r.entrance_tickets_total) / Number(r.entrance_tickets_count)).toFixed(2)} = €${Number(r.entrance_tickets_total).toFixed(2)}`
    : ''
)}
```

The `field` helper already hides rows with an empty value, so a day-tour booking with `count = 0` still renders nothing regardless of whether a name is set.

## Testing

Playwright + Supabase SQL:

1. **Admin can save a name.** In `/admin/manage-tours`, edit an existing priced tour, enter "Knossos Entry Ticket", save. SQL: `select entrance_ticket_name from public.tours_catalog where id = <id>` returns `"Knossos Entry Ticket"`.
2. **Admin can clear a name.** Edit the same tour, empty the field, save. SQL returns `null` (not the empty string).
3. **Passenger block heading uses the name.** Navigate `/book/tour/passenger?tourId=<id>…` for that tour. Block heading reads "Knossos Entry Ticket", sidebar row reads "Knossos Entry Ticket".
4. **Passenger block falls back when name is blank.** Find a priced tour with `entrance_ticket_name IS NULL`. Block heading reads "Entrance tickets", sidebar reads "Entrance tickets".
5. **Payment sidebar uses the forwarded name.** Continue from step 3 to `/book/tour/payment`. URL carries `ticketName=Knossos%20Entry%20Ticket`. Payment sidebar reads "Knossos Entry Ticket".
6. **Booking row snapshots the name.** Complete with Cash on-site. SQL: `select entrance_tickets_name from public.tours where id::text like '<ref>%'` returns `"Knossos Entry Ticket"`.
7. **Admin reservation modal uses the snapshotted name.** Open the new booking's detail modal. The entrance tickets row label reads "Knossos Entry Ticket: 3 × €12.00 = €36.00". A control booking made before this feature shipped (name IS NULL) still reads "Entrance tickets: …".
8. **Rename-after-booking is safe.** After step 6, admin renames the catalog row to "Knossos Palace Ticket". Re-open the *already-persisted* booking's modal — it still reads "Knossos Entry Ticket" (the snapshot). A *new* booking on that tour shows "Knossos Palace Ticket".

## Files expected to change

| File | Type | Responsibility |
|---|---|---|
| `db/migrations/2026-04-24-tours-entrance-ticket-name.sql` | Create | Add nullable `entrance_ticket_name` to `tours_catalog` and `entrance_tickets_name` to `tours`. |
| `src/pages/admin/manage-tours.astro` | Modify | Add input to Add form + Edit modal; wire insert/update/edit-load; extend row mapper. |
| `src/pages/book/tour/passenger.astro` | Modify | Fetch name with catalog row; set block heading + sidebar row label; forward `ticketName` in URL. |
| `src/pages/book/tour/payment.astro` | Modify | Parse `ticketName` from URL; set sidebar row label; insert `entrance_tickets_name` on `tours` row. |
| `src/components/ReservationDetailModal.astro` | Modify | Use snapshotted `entrance_tickets_name` as the row label when present. |

## Out of scope

- Experiences and transfers booking flows — they don't expose `entrance_ticket_per_person`.
- Customer surfaces outside the booking flow (tour cards, results page, tour detail). The name currently only appears in the purchase context; tour-card treatment is a separate design question.
- Changes to commission, discount, or partner pricing logic.
- Backfilling existing rows — the nullable column and the fallback label handle pre-existing data naturally.
