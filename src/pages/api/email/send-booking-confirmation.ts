import type { APIRoute } from 'astro';
import { sendBookingConfirmation } from '../../../lib/email/send';
import type { BookingTable } from '../../../lib/email/templates/booking-confirmation';

export const prerender = false;

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const ALLOWED: BookingTable[] = ['transfers', 'tours', 'experiences'];

export const POST: APIRoute = async ({ request }) => {
  let body: { booking_id?: unknown; table?: unknown };
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const id = typeof body.booking_id === 'string' ? body.booking_id.trim() : '';
  const table = body.table as BookingTable;
  if (!id) return json(400, { error: 'Missing booking_id' });
  if (!ALLOWED.includes(table)) return json(400, { error: 'Invalid table' });

  const result = await sendBookingConfirmation(table, id);
  if (!result.ok) {
    if (result.status === 'not-found') return json(404, { error: 'booking not found' });
    if (result.status === 'no-email')  return json(200, { ok: false, status: 'no-email' });
    return json(500, { ok: false, error: result.error || 'send failed' });
  }
  return json(200, { ok: true, status: result.status });
};
