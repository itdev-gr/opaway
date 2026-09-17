// Pulls the latest Google reviews for the business into google_reviews.
//
//   GET  — Vercel cron (vercel.json). Authorised by `Authorization: Bearer
//          <CRON_SECRET>`, which Vercel attaches automatically when that env
//          var exists on the project.
//   POST — the "Sync now" button on /admin/reviews, authorised like the other
//          admin routes: the caller's session token must belong to a users
//          row of type 'admin'.
//
// New reviews land as 'pending'. A review already stored keeps its status;
// only the mutable bits (text, rating, photo, Maps link, raw) are refreshed.
// Either Places endpoint may fail on its own (the legacy one is optional on
// newer Cloud projects); the run records the errors and carries on with what
// it got.

import type { APIRoute } from 'astro';
import { supabaseAdmin, supabaseForUser } from '../../../lib/supabase-server';
import {
  mergeReviews, normalizeLegacyMeta, normalizeLegacyReview, normalizeNewMeta, normalizeNewReview,
  placesRequests, type PlaceMeta, type ReviewRow,
} from '../../../lib/google-reviews';

export const prerender = false;

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function bearer(request: Request): string | null {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;
}

async function isAdminToken(token: string): Promise<boolean> {
  const sb = supabaseForUser(token);
  const { data: userData, error } = await sb.auth.getUser();
  if (error || !userData?.user) return false;
  const { data: row } = await sb.from('users').select('type').eq('id', userData.user.id).maybeSingle();
  return row?.type === 'admin';
}

interface SyncResult {
  ok: boolean;
  new: number;
  seen: number;
  errors: string[];
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`);
  return body;
}

export async function syncGoogleReviews(): Promise<SyncResult> {
  const apiKey = import.meta.env.GOOGLE_PLACES_API_KEY as string | undefined;
  const placeId = import.meta.env.GOOGLE_PLACE_ID as string | undefined;
  if (!apiKey || !placeId) {
    return { ok: false, new: 0, seen: 0, errors: ['GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID not set'] };
  }

  const req = placesRequests(placeId, apiKey);
  const errors: string[] = [];
  const rows: (ReviewRow | null)[] = [];
  let meta: PlaceMeta | null = null;

  // Legacy: newest five. Optional — a REQUEST_DENIED here just means the
  // Cloud project cannot use the legacy endpoint.
  try {
    const body = await fetchJson(req.legacy.url);
    if (body?.status === 'OK' && body.result) {
      for (const r of body.result.reviews ?? []) rows.push(normalizeLegacyReview(r));
      meta = normalizeLegacyMeta(body.result);
    } else {
      errors.push(`legacy: ${body?.status ?? 'no status'}${body?.error_message ? ` — ${body.error_message}` : ''}`);
    }
  } catch (err) {
    errors.push(`legacy: ${err instanceof Error ? err.message : String(err)}`);
  }

  // New: most relevant five, with a Google Maps link per review.
  try {
    const place = await fetchJson(req.modern.url, req.modern.headers);
    for (const r of place?.reviews ?? []) rows.push(normalizeNewReview(r));
    const m = normalizeNewMeta(place);
    meta = meta
      ? { ...meta, rating: meta.rating ?? m.rating, user_ratings_total: meta.user_ratings_total ?? m.user_ratings_total, place_name: meta.place_name ?? m.place_name, place_url: meta.place_url ?? m.place_url }
      : m;
  } catch (err) {
    errors.push(`new: ${err instanceof Error ? err.message : String(err)}`);
  }

  const merged = mergeReviews(rows);
  let inserted = 0;

  if (merged.length) {
    const keys = merged.map((r) => r.dedupe_key);
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('google_reviews').select('dedupe_key').in('dedupe_key', keys);
    if (existErr) {
      errors.push(`db: ${existErr.message}`);
    } else {
      const known = new Set((existing ?? []).map((r: any) => r.dedupe_key));
      const now = new Date().toISOString();
      for (const r of merged) {
        if (known.has(r.dedupe_key)) {
          const { error } = await supabaseAdmin.from('google_reviews')
            .update({ text: r.text, rating: r.rating, author_photo_url: r.author_photo_url, author_url: r.author_url, google_maps_uri: r.google_maps_uri, raw: r.raw, last_seen_at: now })
            .eq('dedupe_key', r.dedupe_key);
          if (error) errors.push(`db update ${r.dedupe_key}: ${error.message}`);
        } else {
          const { error } = await supabaseAdmin.from('google_reviews')
            .insert({ ...r, status: 'pending', first_seen_at: now, last_seen_at: now });
          if (error) errors.push(`db insert ${r.dedupe_key}: ${error.message}`);
          else inserted += 1;
        }
      }
    }
  }

  const { error: metaErr } = await supabaseAdmin.from('google_reviews_meta').upsert({
    id: 1,
    ...(meta ?? {}),
    last_sync_at: new Date().toISOString(),
    last_sync_error: errors.length ? errors.join(' | ') : null,
    last_sync_new: inserted,
  });
  if (metaErr) errors.push(`db meta: ${metaErr.message}`);

  const ok = merged.length > 0 || errors.length === 0;
  if (errors.length) console.error('[admin/sync-google-reviews] issues', { errors, seen: merged.length, inserted });
  return { ok, new: inserted, seen: merged.length, errors };
}

// Vercel cron.
export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET as string | undefined;
  if (!secret || bearer(request) !== secret) return json(401, { error: 'Unauthorized' });
  const result = await syncGoogleReviews();
  return json(result.ok ? 200 : 502, result);
};

// Admin "Sync now".
export const POST: APIRoute = async ({ request }) => {
  const token = bearer(request);
  if (!token) return json(401, { error: 'Missing access token' });
  if (!(await isAdminToken(token))) return json(403, { error: 'Admin access required' });
  const result = await syncGoogleReviews();
  return json(result.ok ? 200 : 502, result);
};
