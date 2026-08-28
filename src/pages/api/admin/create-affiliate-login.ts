// Create a portal login for an affiliate (public.influencers row).
//
// Admin-only. Mirrors the gate in ./delete-user.ts: the caller is identified
// with an RLS-bound client from their bearer token, checked against
// users.type === 'admin', and only then does the service-role client act.
//
// Creating an auth user for someone else is impossible from the browser —
// there is no admin INSERT policy on public.users — so this route exists.

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

/** Deliberately permissive shape check — Supabase is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD_LENGTH = 8;

export const POST: APIRoute = async ({ request }) => {
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!accessToken) return jsonError(401, 'Missing access token');

  let body: { affiliateId?: unknown; email?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON body'); }

  const affiliateId = typeof body.affiliateId === 'string' ? body.affiliateId.trim() : '';
  const email       = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password    = typeof body.password === 'string' ? body.password : '';

  if (!affiliateId) return jsonError(400, 'Missing affiliateId');
  if (!EMAIL_RE.test(email)) return jsonError(400, 'Enter a valid email address');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // ── Identify + authorize the caller (RLS-bound client) ──
  const sb = supabaseForUser(accessToken);
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return jsonError(401, 'Not authenticated');

  const { data: callerRow, error: callerErr } = await sb
    .from('users').select('type').eq('id', userData.user.id).maybeSingle();
  if (callerErr) {
    console.error('[admin/create-affiliate-login] caller lookup failed', { error: callerErr });
    return jsonError(500, 'Authorization check failed');
  }
  if (!callerRow || callerRow.type !== 'admin') return jsonError(403, 'Admin access required');

  // ── The affiliate must exist and not already have a login ──
  const { data: affiliate, error: affErr } = await supabaseAdmin
    .from('influencers').select('id, name, user_id').eq('id', affiliateId).maybeSingle();
  if (affErr) {
    console.error('[admin/create-affiliate-login] affiliate lookup failed', { affiliateId, error: affErr });
    return jsonError(500, 'Could not load the affiliate');
  }
  if (!affiliate) return jsonError(404, 'Affiliate not found');
  if (affiliate.user_id) return jsonError(409, 'This affiliate already has a login');

  // ── Create the auth user ──
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,                       // admin-created: no confirmation mail
    user_metadata: { full_name: affiliate.name },
  });
  if (createErr || !created?.user) {
    const msg = String(createErr?.message ?? '');
    if (/already|registered|exists/i.test(msg)) {
      return jsonError(409, 'That email already has an account');
    }
    console.error('[admin/create-affiliate-login] createUser failed', { error: createErr });
    return jsonError(500, msg || 'Could not create the account');
  }
  const uid = created.user.id;

  // Anything past this point must undo the auth user on failure, or we leave an
  // orphan account that blocks the email forever.
  const rollback = async (label: string, error: unknown) => {
    console.error(`[admin/create-affiliate-login] ${label}`, { uid, affiliateId, error });
    await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
  };

  // ── Profile row with the affiliate role (routes the portal at login) ──
  const { error: usersErr } = await supabaseAdmin.from('users').upsert({
    id: uid,
    email,
    display_name: affiliate.name,
    provider: 'email',
    type: 'affiliate',
  });
  if (usersErr) {
    await rollback('users upsert failed', usersErr);
    return jsonError(500, 'Could not create the user profile');
  }

  // ── Link the affiliate row ──
  const { error: linkErr } = await supabaseAdmin
    .from('influencers').update({ user_id: uid, email }).eq('id', affiliateId);
  if (linkErr) {
    // Deleting the auth user cascades to public.users (id references
    // auth.users on delete cascade), so the rollback is enough on its own.
    await rollback('affiliate link failed', linkErr);
    return jsonError(500, 'Could not link the account to the affiliate');
  }

  return jsonOk({ ok: true, userId: uid, email });
};
