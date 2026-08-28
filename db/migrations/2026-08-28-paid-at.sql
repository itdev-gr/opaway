-- Payment date (`paid_at`) for the Sales Report.
--
-- Why: /admin/sales bucketed revenue by `created_at` (when the booking was
-- MADE), so money collected in September for a ride booked in July landed in
-- July's revenue. Nothing in the schema recorded WHEN a booking was actually
-- paid — the Stripe RPC, the driver's ride-completion flow and the three admin
-- payment dropdowns all flipped `payment_status` with no timestamp.
--
-- Rather than patching every writer, a BEFORE trigger stamps `paid_at` whenever
-- a row ENTERS a collected status ('paid' | 'paid_to_driver') and clears it when
-- the row leaves one. That covers apply_stripe_event(), driver/ride.astro,
-- admin/{transfers,tours,experiences}.astro and any future path automatically.
--
-- An explicitly supplied `paid_at` is preserved (so an admin can backdate a
-- payment later without the trigger overwriting it).
--
-- Backfill: existing paid rows have no recoverable payment date, so they are
-- stamped with `created_at` — the report then shows exactly what it showed
-- before for historical rows, and only new payments get true payment dates.
--
-- Idempotent and additive. Safe to run repeatedly on a live DB.

-- ── 1. Column ────────────────────────────────────────────────────────────────
alter table public.transfers   add column if not exists paid_at timestamptz;
alter table public.tours       add column if not exists paid_at timestamptz;
alter table public.experiences add column if not exists paid_at timestamptz;

-- ── 2. Trigger function ──────────────────────────────────────────────────────
-- NOTE: OLD is unassigned on INSERT and PL/pgSQL does not guarantee
-- short-circuit evaluation of AND, so TG_OP is checked in a separate IF rather
-- than folded into the boolean expression.
create or replace function public.set_paid_at() returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_collected  boolean;
  was_collected boolean := false;
begin
  is_collected := coalesce(new.payment_status, '') in ('paid', 'paid_to_driver');

  if tg_op = 'UPDATE' then
    was_collected := coalesce(old.payment_status, '') in ('paid', 'paid_to_driver');
  end if;

  if is_collected and not was_collected then
    -- Entering a collected status: stamp now, unless the caller supplied a date.
    new.paid_at := coalesce(new.paid_at, now());
  elsif not is_collected then
    -- Not collected (any longer): there is no payment date.
    new.paid_at := null;
  end if;
  -- Still collected and already was: leave paid_at untouched, so the original
  -- payment date survives later edits (and manual backdating is possible).

  return new;
end;
$$;

-- ── 3. Triggers ──────────────────────────────────────────────────────────────
-- `update of payment_status, paid_at` keeps the trigger off unrelated writes
-- (driver assignment, email timestamps, ride_status changes).
drop trigger if exists trg_set_paid_at on public.transfers;
create trigger trg_set_paid_at
  before insert or update of payment_status, paid_at on public.transfers
  for each row execute function public.set_paid_at();

drop trigger if exists trg_set_paid_at on public.tours;
create trigger trg_set_paid_at
  before insert or update of payment_status, paid_at on public.tours
  for each row execute function public.set_paid_at();

drop trigger if exists trg_set_paid_at on public.experiences;
create trigger trg_set_paid_at
  before insert or update of payment_status, paid_at on public.experiences
  for each row execute function public.set_paid_at();

-- ── 4. Backfill ──────────────────────────────────────────────────────────────
update public.transfers   set paid_at = created_at
  where paid_at is null and payment_status in ('paid', 'paid_to_driver');
update public.tours       set paid_at = created_at
  where paid_at is null and payment_status in ('paid', 'paid_to_driver');
update public.experiences set paid_at = created_at
  where paid_at is null and payment_status in ('paid', 'paid_to_driver');

-- ── 5. Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_transfers_paid_at   on public.transfers(paid_at desc);
create index if not exists idx_tours_paid_at       on public.tours(paid_at desc);
create index if not exists idx_experiences_paid_at on public.experiences(paid_at desc);
