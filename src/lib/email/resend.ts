// Server-only Resend wrapper.
// Env is validated lazily so importing this file from a critical path (e.g. the
// Stripe webhook) never fails module load if RESEND_API_KEY is missing — a missing
// key just makes sendEmail() return { ok:false }, which the caller logs.

import { Resend } from 'resend';

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  const key = import.meta.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}

export function adminEmail(): string {
  return import.meta.env.ADMIN_EMAIL || '';
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** When set, also BCC the admin so the team has a copy of every transactional email. */
  copyAdmin?: boolean;
  /** Resend-side dedup; combined with our DB sentinel for full idempotency. */
  idempotencyKey?: string;
}

/**
 * Send a transactional email. Returns { ok, id, error } — never throws.
 * Caller decides whether to surface or swallow the failure.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const resend = getResend();
  const from = import.meta.env.EMAIL_FROM;
  if (!resend || !from) {
    const missing = [!resend && 'RESEND_API_KEY', !from && 'EMAIL_FROM'].filter(Boolean).join(', ');
    console.error('[resend] not configured', { missing });
    return { ok: false, error: `email not configured (missing ${missing})` };
  }
  const admin = adminEmail();
  const bcc = args.copyAdmin && admin && admin !== args.to ? [admin] : undefined;
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [args.to],
      bcc,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.idempotencyKey ? { headers: { 'Idempotency-Key': args.idempotencyKey } } : {}),
    });
    if (error) {
      console.error('[resend] send failed', { to: args.to, subject: args.subject, error });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[resend] send threw', { to: args.to, subject: args.subject, message });
    return { ok: false, error: message };
  }
}
