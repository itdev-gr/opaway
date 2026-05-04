import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/stripe/server';

export const prerender = false;

type Flow = 'transfer' | 'hourly' | 'tour';

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return jsonError(400, 'Missing or invalid session_id');
  }

  const { data: t } = await supabaseAdmin
    .from('transfers')
    .select('id, payment_status, booking_type, "from", "to", date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (t) {
    const flow: Flow = t.booking_type === 'hourly' ? 'hourly' : 'transfer';
    return new Response(JSON.stringify({
      payment_status: t.payment_status,
      booking_id: t.id,
      flow,
      summary: {
        ref: String(t.id).substring(0, 8).toUpperCase(),
        route: `${t.from} → ${t.to}`,
        date: `${t.date} ${t.time}`,
        vehicle: t.vehicle_name,
        total: t.total_price,
        email: t.email,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  const { data: tour } = await supabaseAdmin
    .from('tours')
    .select('id, payment_status, tour_name, pickup, destination, date, time, vehicle_name, total_price, email')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (tour) {
    return new Response(JSON.stringify({
      payment_status: tour.payment_status,
      booking_id: tour.id,
      flow: 'tour' as Flow,
      summary: {
        ref: String(tour.id).substring(0, 8).toUpperCase(),
        route: `${tour.pickup} → ${tour.destination}`,
        date: `${tour.date} ${tour.time}`,
        vehicle: tour.vehicle_name,
        total: tour.total_price,
        email: tour.email,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return jsonError(404, 'Booking not found for this session');
};
