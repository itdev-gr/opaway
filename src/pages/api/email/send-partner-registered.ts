import type { APIRoute } from 'astro';
import { sendPartnerRegistered } from '../../../lib/email/send';

export const prerender = false;

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export const POST: APIRoute = async ({ request }) => {
  let body: { partner_id?: unknown };
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const id = typeof body.partner_id === 'string' ? body.partner_id.trim() : '';
  if (!id) return json(400, { error: 'Missing partner_id' });

  const result = await sendPartnerRegistered(id);
  if (!result.ok) {
    if (result.status === 'not-found') return json(404, { error: 'partner not found' });
    if (result.status === 'no-email')  return json(200, { ok: false, status: 'no-email' });
    return json(500, { ok: false, error: result.error || 'send failed' });
  }
  return json(200, { ok: true, status: result.status });
};
