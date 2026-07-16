import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { stripe, supabaseAdmin, supabaseForUser, originFromRequest, isFlow, type Flow } from '../../../lib/stripe/server';
import { isPastBookingDate } from '../../../lib/booking-date';

export const prerender = false;

type CheckoutBody = {
  flow?: unknown;
  booking?: Record<string, unknown>;
};

const MIN_TOTAL_EUR = 1;
const MAX_TOTAL_EUR = 5000;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpcNameFor(flow: Flow): 'create_transfer_booking' | 'create_tour_booking' {
  return flow === 'tour' ? 'create_tour_booking' : 'create_transfer_booking';
}

function tableNameFor(flow: Flow): 'transfers' | 'tours' {
  return flow === 'tour' ? 'tours' : 'transfers';
}

function productNameFor(flow: Flow): string {
  if (flow === 'tour') return 'Tour booking';
  if (flow === 'hourly') return 'Hourly hire';
  return 'Transfer booking';
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutBody;
  try {
    body = await request.json() as CheckoutBody;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { flow, booking } = body;
  if (!isFlow(flow))                    return jsonError(400, 'Missing or invalid `flow`');
  if (!booking || typeof booking !== 'object') return jsonError(400, 'Missing `booking`');

  const email = String(booking.email ?? '').trim();
  if (!email) return jsonError(400, 'booking.email is required');

  const totalPrice = Number(booking.total_price);
  if (!Number.isFinite(totalPrice))                         return jsonError(400, 'booking.total_price must be a number');
  if (totalPrice < MIN_TOTAL_EUR || totalPrice > MAX_TOTAL_EUR) {
    return jsonError(400, `booking.total_price must be between €${MIN_TOTAL_EUR} and €${MAX_TOTAL_EUR}`);
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const bookingDate = String(booking.date ?? '').trim();
  if (!DATE_RE.test(bookingDate) || isPastBookingDate(bookingDate)) {
    return jsonError(400, 'BOOKING_DATE_PAST');
  }
  const bookingReturnDate = String(booking.return_date ?? '').trim();
  if (bookingReturnDate && (!DATE_RE.test(bookingReturnDate) || bookingReturnDate < bookingDate)) {
    return jsonError(400, 'BOOKING_DATE_PAST');
  }

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const sb = supabaseForUser(accessToken);

  const insertPayload = {
    ...booking,
    payment_method: 'stripe',
    payment_status: 'awaiting_payment',
  };

  const { data: bookingId, error: rpcErr } = await sb.rpc(rpcNameFor(flow), { payload: insertPayload });
  if (rpcErr || !bookingId) {
    console.error('[create-checkout-session] RPC failed', { flow, error: rpcErr });
    return jsonError(500, 'Failed to create booking');
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(totalPrice * 100),
          product_data: { name: productNameFor(flow) },
        },
      }],
      customer_email: email,
      metadata:                  { booking_id: String(bookingId), booking_table: tableNameFor(flow), flow },
      payment_intent_data: { metadata: { booking_id: String(bookingId), booking_table: tableNameFor(flow), flow } },
      success_url: `${originFromRequest(request)}/book/${flow}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${originFromRequest(request)}/book/${flow}/payment/cancelled?booking_id=${bookingId}`,
    });
  } catch (err) {
    // Stripe error objects can echo card-detail metadata; log only the structured fields.
    const safe = err instanceof Stripe.errors.StripeError
      ? { type: err.type, code: err.code, message: err.message, requestId: err.requestId }
      : { message: String(err) };
    console.error('[create-checkout-session] Stripe session create failed', { flow, bookingId, err: safe });
    return jsonError(502, 'Failed to start payment session');
  }

  const { error: updateErr } = await supabaseAdmin
    .from(tableNameFor(flow))
    .update({ stripe_session_id: session.id })
    .eq('id', bookingId);

  if (updateErr) {
    // The webhook (Task 6) MUST fall back to looking up by metadata.booking_id when the
    // session_id lookup misses zero rows, otherwise this booking becomes unreconcilable.
    console.error('[create-checkout-session] Failed to attach session_id', { bookingId, sessionId: session.id, error: updateErr });
  }

  return new Response(JSON.stringify({ url: session.url, booking_id: bookingId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
