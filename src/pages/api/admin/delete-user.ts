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

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) return jsonError(400, 'Missing userId');

  const sb = supabaseForUser(accessToken);
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, 'Not authenticated');
  const callerId = userData.user.id;

  if (callerId === userId) return jsonError(400, 'Cannot delete your own account');

  const { data: callerRow, error: callerErr } = await sb
    .from('users')
    .select('type')
    .eq('id', callerId)
    .maybeSingle();
  if (callerErr) {
    console.error('[admin/delete-user] caller lookup failed', { callerId, error: callerErr });
    return jsonError(500, 'Authorization check failed');
  }
  if (!callerRow || callerRow.type !== 'admin') return jsonError(403, 'Admin access required');

  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteErr) {
    console.error('[admin/delete-user] auth deletion failed', { userId, error: deleteErr });
    return jsonError(500, deleteErr.message || 'Delete failed');
  }

  return jsonOk({ ok: true });
};
