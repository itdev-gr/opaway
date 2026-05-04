-- Make stripe_session_id and stripe_payment_intent_id partial indexes UNIQUE.
--
-- Why: session-status.ts and apply_stripe_event() both look up bookings by these
-- ids and assume a single row matches. The original migration created plain
-- (non-unique) partial indexes; this migration upgrades them to UNIQUE so the
-- DB enforces the invariant the code already assumes. Each Stripe Checkout
-- Session and PaymentIntent are 1:1 with a booking by construction, so any
-- duplicate would indicate a bug — fail fast at INSERT time rather than
-- silently corrupting two rows in apply_stripe_event UPDATE.
--
-- Idempotent: drop-then-create. Safe to apply on a database where the original
-- 2026-05-04-stripe-server-capture.sql has been applied OR not.

-- transfers
drop index if exists public.transfers_stripe_session_id_idx;
create unique index if not exists transfers_stripe_session_id_idx
  on public.transfers (stripe_session_id) where stripe_session_id is not null;

drop index if exists public.transfers_stripe_payment_intent_idx;
create unique index if not exists transfers_stripe_payment_intent_idx
  on public.transfers (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- tours
drop index if exists public.tours_stripe_session_id_idx;
create unique index if not exists tours_stripe_session_id_idx
  on public.tours (stripe_session_id) where stripe_session_id is not null;

drop index if exists public.tours_stripe_payment_intent_idx;
create unique index if not exists tours_stripe_payment_intent_idx
  on public.tours (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
