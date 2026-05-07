// Server-only module: validates required env vars at import time and throws if any are missing.
// Import ONLY from `prerender = false` endpoints under src/pages/api/. Importing from a
// prerendered (.astro) page would crash the static build if env is unset in CI.

import Stripe from 'stripe';

// Re-export the server-side Supabase clients from their dedicated module so
// existing imports from this file keep working. Endpoints that don't need
// Stripe should import from `../supabase-server` directly to avoid pulling
// in the Stripe init (and its STRIPE_SECRET_KEY requirement).
export { supabaseAdmin, supabaseForUser } from '../supabase-server';

const STRIPE_SECRET_KEY     = import.meta.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = import.meta.env.STRIPE_WEBHOOK_SECRET;

if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

export const stripeWebhookSecret = STRIPE_WEBHOOK_SECRET ?? '';

/**
 * Builds the absolute origin (e.g. https://www.opawey.com) from the incoming
 * request. On Vercel serverless functions, request.url often points to the
 * internal hostname ("localhost" or similar), so prefer the x-forwarded-* headers
 * that Vercel populates with the original public hostname/protocol. Fall back to
 * the request's own host header, then to request.url as a last resort.
 */
export function originFromRequest(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto');
  if (fwdHost) return `${fwdProto || 'https'}://${fwdHost}`;
  const host = request.headers.get('host');
  if (host && host !== 'localhost' && !host.startsWith('localhost:')) {
    const proto = fwdProto || (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Booking flow union — used by every endpoint. */
export type Flow = 'transfer' | 'hourly' | 'tour';
export const FLOWS: readonly Flow[] = ['transfer', 'hourly', 'tour'] as const;
export function isFlow(x: unknown): x is Flow {
  return typeof x === 'string' && (FLOWS as readonly string[]).includes(x);
}
