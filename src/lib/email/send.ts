// In-process helpers that load a row, render the template, send via Resend,
// and stamp the *_sent_at sentinel for idempotency. Used by both the
// /api/email/* endpoints AND the Stripe webhook (no HTTP hop server-side).

import { supabaseAdmin } from '../supabase-server';
import { sendEmail } from './resend';
import { renderBookingConfirmation, type BookingFlow, type BookingTable, type PaymentMethod, type PaymentStatus } from './templates/booking-confirmation';
import { renderPartnerRegistered, type PartnerType } from './templates/partner-registered';
import { renderExperienceRequest } from './templates/experience-request';
import { renderRideReview } from './templates/ride-review';

type Result = { ok: boolean; status: 'sent' | 'already-sent' | 'no-email' | 'not-found' | 'error'; error?: string };

async function alreadySent(table: string, id: string, column: string): Promise<boolean | 'missing'> {
  const { data, error } = await supabaseAdmin.from(table).select(column).eq('id', id).maybeSingle();
  if (error) {
    // Column missing → migration not applied yet; treat as not-sent so we don't block.
    if (/column .* does not exist/i.test(error.message)) return 'missing';
    return false;
  }
  return !!(data as Record<string, unknown> | null)?.[column];
}

async function stamp(table: string, id: string, column: string): Promise<void> {
  const { error } = await supabaseAdmin.from(table).update({ [column]: new Date().toISOString() }).eq('id', id);
  if (error && !/column .* does not exist/i.test(error.message)) {
    console.error(`[email] stamp ${table}.${column} for ${id} failed:`, error.message);
  }
}

// ── booking confirmation (transfers / tours / experiences) ─────────────────
const BOOKING_TABLES: ReadonlyArray<BookingTable> = ['transfers', 'tours', 'experiences'];

function tableToFlow(table: BookingTable, row: Record<string, unknown>): BookingFlow {
  if (table === 'tours')       return 'tour';
  if (table === 'experiences') return 'experience';
  return row.booking_type === 'hourly' ? 'hourly' : 'transfer';
}

export async function sendBookingConfirmation(table: BookingTable, bookingId: string): Promise<Result> {
  if (!BOOKING_TABLES.includes(table)) return { ok: false, status: 'error', error: 'invalid table' };

  const sent = await alreadySent(table, bookingId, 'confirmation_email_sent_at');
  if (sent === true) return { ok: true, status: 'already-sent' };

  const { data: row, error } = await supabaseAdmin.from(table).select('*').eq('id', bookingId).maybeSingle();
  if (error || !row) return { ok: false, status: 'not-found', error: error?.message };

  const to = String(row.email || '').trim();
  if (!to) return { ok: false, status: 'no-email' };

  const flow = tableToFlow(table, row as Record<string, unknown>);
  const firstName =
    typeof row.first_name === 'string' && row.first_name ? row.first_name :
    typeof row.name === 'string' && row.name ? String(row.name).split(' ')[0] : null;

  const tpl = renderBookingConfirmation({
    booking_id: row.id,
    flow,
    date: String(row.date || ''),
    time: row.time ?? null,
    from: row.from ?? null,
    to:   row.to   ?? null,
    tour_name:       row.tour_name       ?? null,
    experience_name: row.experience_name ?? null,
    hours: row.hours ?? null,
    passengers: row.passengers ?? row.participants ?? null,
    vehicle_name: row.vehicle_name ?? null,
    total_price: row.total_price ?? null,
    card_surcharge: row.card_surcharge ?? null,
    customer_first_name: firstName,
    payment_method: (row.payment_method ?? null) as PaymentMethod | null,
    payment_status: (row.payment_status ?? null) as PaymentStatus | null,
  });

  const send = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    copyAdmin: true,
    idempotencyKey: `booking-confirmation:${table}:${bookingId}`,
  });
  if (!send.ok) return { ok: false, status: 'error', error: send.error };

  await stamp(table, bookingId, 'confirmation_email_sent_at');
  return { ok: true, status: 'sent' };
}

// ── ride review (transfers / tours / experiences after completion) ──────────
export async function sendRideReview(table: BookingTable, bookingId: string): Promise<Result> {
  if (!BOOKING_TABLES.includes(table)) return { ok: false, status: 'error', error: 'invalid table' };

  const sent = await alreadySent(table, bookingId, 'review_email_sent_at');
  if (sent === true) return { ok: true, status: 'already-sent' };

  // Column names differ across booking tables: transfers has first_name + last_name,
  // tours and experiences have a single `name` field. Selecting * keeps this generic.
  const { data: row, error } = await supabaseAdmin.from(table).select('*').eq('id', bookingId).maybeSingle();
  if (error || !row) return { ok: false, status: 'not-found', error: error?.message };
  if (row.ride_status !== 'completed') return { ok: false, status: 'error', error: 'ride not completed' };

  const to = String(row.email || '').trim();
  if (!to) return { ok: false, status: 'no-email' };

  const firstName =
    typeof row.first_name === 'string' && row.first_name ? row.first_name :
    typeof row.name === 'string' && row.name ? String(row.name).split(' ')[0] : null;

  const tpl = renderRideReview({ booking_id: row.id, customer_first_name: firstName });

  const send = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    copyAdmin: false, // admin doesn't need a review email per ride
    idempotencyKey: `ride-review:${table}:${bookingId}`,
  });
  if (!send.ok) return { ok: false, status: 'error', error: send.error };

  await stamp(table, bookingId, 'review_email_sent_at');
  return { ok: true, status: 'sent' };
}

// ── partner registered ─────────────────────────────────────────────────────
export async function sendPartnerRegistered(partnerId: string): Promise<Result> {
  const sent = await alreadySent('partners', partnerId, 'confirmation_email_sent_at');
  if (sent === true) return { ok: true, status: 'already-sent' };

  const { data: row, error } = await supabaseAdmin.from('partners').select('*').eq('id', partnerId).maybeSingle();
  if (error || !row) return { ok: false, status: 'not-found', error: error?.message };

  const to = String(row.email || '').trim();
  if (!to) return { ok: false, status: 'no-email' };

  const businessName: string | null =
    row.type === 'hotel'  ? (row.hotel_name  ?? null) :
    row.type === 'agency' ? (row.agency_name ?? null) :
    row.type === 'driver' ? (row.full_name   ?? null) : null;

  const tpl = renderPartnerRegistered({
    partner_id: row.id,
    type: row.type as PartnerType,
    display_name: row.display_name ?? null,
    business_name: businessName,
  });

  const send = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    copyAdmin: true,
    idempotencyKey: `partner-registered:${partnerId}`,
  });
  if (!send.ok) return { ok: false, status: 'error', error: send.error };

  await stamp('partners', partnerId, 'confirmation_email_sent_at');
  return { ok: true, status: 'sent' };
}

// ── experience request received ────────────────────────────────────────────
export async function sendExperienceRequest(requestId: string): Promise<Result> {
  const sent = await alreadySent('requests', requestId, 'confirmation_email_sent_at');
  if (sent === true) return { ok: true, status: 'already-sent' };

  const { data: row, error } = await supabaseAdmin.from('requests').select('*').eq('id', requestId).maybeSingle();
  if (error || !row) return { ok: false, status: 'not-found', error: error?.message };

  const to = String(row.email || '').trim();
  if (!to) return { ok: false, status: 'no-email' };

  const firstName =
    typeof row.name === 'string' && row.name ? String(row.name).split(' ')[0] :
    null;

  const tpl = renderExperienceRequest({
    request_id: row.id,
    experience_name: row.experience_name ?? null,
    date: row.date ?? null,
    time: row.time ?? null,
    participants: row.participants ?? null,
    customer_first_name: firstName,
  });

  const send = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    copyAdmin: true,
    idempotencyKey: `experience-request:${requestId}`,
  });
  if (!send.ok) return { ok: false, status: 'error', error: send.error };

  await stamp('requests', requestId, 'confirmation_email_sent_at');
  return { ok: true, status: 'sent' };
}
