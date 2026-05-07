import type { APIRoute } from 'astro';
import { supabaseAdmin, supabaseForUser } from '../../../lib/supabase-server';

export const prerender = false;

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

export const POST: APIRoute = async ({ request }) => {
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!accessToken) return jsonError(401, 'Missing access token');

  const sb = supabaseForUser(accessToken);
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, 'Not authenticated');
  const callerId = userData.user.id;

  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(callerId);
  if (deleteErr) {
    console.error('[account/delete] auth deletion failed', { callerId, error: deleteErr });
    return jsonError(500, deleteErr.message || 'Delete failed');
  }

  return jsonOk({ ok: true });
};
