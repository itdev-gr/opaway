-- Fix apply_stripe_event for payment_intent.payment_failed when the booking row
-- has no stripe_payment_intent_id yet.
--
-- Why: declines fire BEFORE checkout.session.completed, so the booking row has
-- payment_status='awaiting_payment' and stripe_payment_intent_id=NULL. The
-- previous version of apply_stripe_event tried to UPDATE WHERE
-- stripe_payment_intent_id = $1, matched zero rows, and the row stayed in
-- 'awaiting_payment' forever. The webhook handler now passes metadata.booking_id
-- and metadata.booking_table; this version uses them as a fallback path so the
-- decline is reflected on the booking row.
--
-- Idempotent (`create or replace`). Safe to apply on a database where the
-- original 2026-05-04-stripe-server-capture.sql has already been applied.

create or replace function public.apply_stripe_event(
  p_event_id   text,
  p_event_type text,
  p_payload    jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id text;
  v_booking_table text;
  v_booking_id    text;
begin
  insert into public.stripe_events(id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing
    returning id into inserted_id;

  if inserted_id is null then
    return 'duplicate';
  end if;

  case p_event_type
    when 'checkout.session.completed' then
      update public.transfers set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';
      update public.tours set
        payment_status           = 'paid',
        stripe_payment_intent_id = p_payload->>'payment_intent',
        stripe_charge_id         = p_payload->>'charge_id'
      where stripe_session_id = p_payload->>'session_id';

    when 'payment_intent.payment_failed' then
      -- Try the lookup by stripe_payment_intent_id first (works for PI-failed
      -- events that arrive AFTER checkout.session.completed, e.g. a chargeable
      -- decline of a 3DS challenge).
      update public.transfers set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent'
          and payment_status = 'awaiting_payment';
      update public.tours set payment_status = 'failed'
        where stripe_payment_intent_id = p_payload->>'payment_intent'
          and payment_status = 'awaiting_payment';

      -- Fallback: a decline before completion never attaches the PI to the row.
      -- Use metadata.booking_id + booking_table to reach the right row directly,
      -- and stamp the PI on the way through so future events resolve normally.
      v_booking_table := p_payload->>'booking_table';
      v_booking_id    := p_payload->>'booking_id';
      if v_booking_id is not null then
        if v_booking_table = 'transfers' then
          update public.transfers set
            payment_status           = 'failed',
            stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payload->>'payment_intent')
          where id = v_booking_id::uuid
            and payment_status = 'awaiting_payment';
        elsif v_booking_table = 'tours' then
          update public.tours set
            payment_status           = 'failed',
            stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payload->>'payment_intent')
          where id = v_booking_id::uuid
            and payment_status = 'awaiting_payment';
        end if;
      end if;

    when 'charge.refunded' then
      update public.transfers set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';
      update public.tours set payment_status = case
        when (p_payload->>'amount_refunded')::numeric = (p_payload->>'amount')::numeric
          then 'refunded' else 'partially_refunded' end
        where stripe_charge_id = p_payload->>'charge_id';

    else
      null;
  end case;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_event(text, text, jsonb) from public;
-- Not granted to anon/authenticated; called only from server endpoint via service role.
