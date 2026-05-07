// Server-only Supabase clients. Validates required env vars at import time.
// Keep this module free of unrelated dependencies (e.g. Stripe) so endpoints
// that don't need them aren't gated behind unrelated env requirements.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL          = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY     = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL)          throw new Error('PUBLIC_SUPABASE_URL is not set');
if (!SUPABASE_SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
if (!SUPABASE_ANON_KEY)     throw new Error('PUBLIC_SUPABASE_ANON_KEY is not set');

/** Service-role client. Bypasses RLS. Use ONLY for server-side trusted writes. */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Anon client bound to a user's access token. Use this for inserts/queries
 * that should respect RLS and use auth.uid() for ownership.
 */
export function supabaseForUser(accessToken: string | null): SupabaseClient {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers },
  });
}
