import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { stripe, stripeWebhookSecret, supabaseAdmin } from '../../../lib/stripe/server';

export const prerender = false;

type NormalizedPayload = Record<string, string | number | null | undefined>;

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.payment_failed',
  'charge.refunded',
]);

/** Logs only structured Stripe error fields; never the raw `err` (may contain PII). */
function safeError(err: unknown): Record<string, unknown> {
  if (err instanceof Stripe.errors.StripeError) {
    return { type: err.type, code: err.code, message: err.message, requestId: err.requestId };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

async function normalize(event: Stripe.Event): Promise<NormalizedPayload | null> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!piId) return null;
      const pi = await stripe.paymentIntents.retrieve(piId);
      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
      return { session_id: s.id, payment_intent: pi.id, charge_id: chargeId };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { payment_intent: pi.id };
    }
    case 'charge.refunded': {
      const ch = event.data.object as Stripe.Charge;
      return { charge_id: ch.id, amount: ch.amount, amount_refunded: ch.amount_refunded };
    }
    default:
      return null;
  }
}

/**
 * Defensive repair: if create-checkout-session.ts logged "Failed to attach session_id",
 * the booking row exists but has no stripe_session_id, so apply_stripe_event will find
 * nothing on the checkout.session.completed event. Use the metadata we plumbed onto the
 * Checkout Session to set stripe_session_id before the RPC runs. The .is('stripe_session_id', null)
 * filter ensures we never overwrite an already-attached id.
 */
async function repairOrphan(session: Stripe.Checkout.Session): Promise<void> {
  const bookingId = session.metadata?.booking_id;
  const bookingTable = session.metadata?.booking_table;
  if (!bookingId) return;
  if (bookingTable !== 'transfers' && bookingTable !== 'tours') return;
  const { error } = await supabaseAdmin
    .from(bookingTable)
    .update({ stripe_session_id: session.id })
    .eq('id', bookingId)
    .is('stripe_session_id', null);
  if (error) {
    console.error('[stripe-webhook] Orphan repair failed', { bookingId, sessionId: session.id, error });
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!stripeWebhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 503 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const rawBody = Buffer.from(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed', safeError(err));
    return new Response('Bad signature', { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return new Response('ok', { status: 200 });
  }

  if (event.type === 'checkout.session.completed') {
    await repairOrphan(event.data.object as Stripe.Checkout.Session);
  }

  let payload: NormalizedPayload | null;
  try {
    payload = await normalize(event);
  } catch (err) {
    console.error('[stripe-webhook] Failed to normalize', { type: event.type, err: safeError(err) });
    return new Response('Internal error', { status: 500 });
  }
  if (!payload) {
    return new Response('ok', { status: 200 });
  }

  const { error } = await supabaseAdmin.rpc('apply_stripe_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload: payload as Record<string, unknown>,
  });
  if (error) {
    console.error('[stripe-webhook] RPC failed', { eventId: event.id, type: event.type, error });
    return new Response('Internal error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
};
