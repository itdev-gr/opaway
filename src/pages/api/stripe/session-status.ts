import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/stripe/server';

export const prerender = false;

type Flow = 'transfer' | 'hourly' | 'tour';

const NO_CACHE_JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: NO_CACHE_JSON_HEADERS });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: NO_CACHE_JSON_HEADERS });
}

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return jsonError(400, 'Missing or invalid session_id');
  }

  const { data: t, error: tErr } = await supabaseAdmin
    .from('transfers')
    .select('id, payment_status, booking_type, "from", "to", date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (tErr) {
    console.error('[session-status] transfers lookup failed', { sessionId, error: tErr });
    return jsonError(500, 'Lookup failed');
  }

  if (t) {
    const flow: Flow = t.booking_type === 'hourly' ? 'hourly' : 'transfer';
    return jsonOk({
      payment_status: t.payment_status,
      booking_id: t.id,
      flow,
      summary: {
        ref: String(t.id).substring(0, 8).toUpperCase(),
        route: `${t.from} → ${t.to}`,
        date: `${t.date} ${t.time}`,
        vehicle: t.vehicle_name,
        total: Number(t.total_price),
        email: t.email,
      },
    });
  }

  const { data: tour, error: tourErr } = await supabaseAdmin
    .from('tours')
    .select('id, payment_status, pickup, destination, date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (tourErr) {
    console.error('[session-status] tours lookup failed', { sessionId, error: tourErr });
    return jsonError(500, 'Lookup failed');
  }

  if (tour) {
    return jsonOk({
      payment_status: tour.payment_status,
      booking_id: tour.id,
      flow: 'tour' as Flow,
      summary: {
        ref: String(tour.id).substring(0, 8).toUpperCase(),
        route: `${tour.pickup} → ${tour.destination}`,
        date: `${tour.date} ${tour.time}`,
        vehicle: tour.vehicle_name,
        total: Number(tour.total_price),
        email: tour.email,
      },
    });
  }

  return jsonError(404, 'Booking not found for this session');
};
