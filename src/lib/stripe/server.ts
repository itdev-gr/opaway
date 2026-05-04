import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STRIPE_SECRET_KEY        = import.meta.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET    = import.meta.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL             = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE    = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY        = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!STRIPE_SECRET_KEY)     throw new Error('STRIPE_SECRET_KEY is not set');
if (!SUPABASE_URL)          throw new Error('PUBLIC_SUPABASE_URL is not set');
if (!SUPABASE_SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
if (!SUPABASE_ANON_KEY)     throw new Error('PUBLIC_SUPABASE_ANON_KEY is not set');

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

export const stripeWebhookSecret = STRIPE_WEBHOOK_SECRET ?? '';

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

/** Builds the absolute origin (e.g. https://www.opawey.com) from the incoming request. */
export function originFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Booking flow union — used by every endpoint. */
export type Flow = 'transfer' | 'hourly' | 'tour';
export const FLOWS: readonly Flow[] = ['transfer', 'hourly', 'tour'] as const;
export function isFlow(x: unknown): x is Flow {
  return typeof x === 'string' && (FLOWS as readonly string[]).includes(x);
}
