// Booking confirmation email — sent for transfers / tours / hourly / experiences
// after Stripe payment OR when the customer chose cash / card-on-site.

export type BookingTable = 'transfers' | 'tours' | 'experiences';
export type BookingFlow = 'transfer' | 'tour' | 'hourly' | 'experience';
export type PaymentMethod = 'stripe' | 'cash' | 'card-onsite';
export type PaymentStatus = 'paid' | 'pending' | 'paid_to_driver';

export interface BookingConfirmationData {
  booking_id: string;
  flow: BookingFlow;
  date: string;
  time?: string | null;
  // Identifying info — only populate the relevant fields per flow
  from?: string | null;
  to?: string | null;
  tour_name?: string | null;
  experience_name?: string | null;
  hours?: number | null;
  // Common
  passengers?: number | null;
  vehicle_name?: string | null;
  total_price?: number | null;
  card_surcharge?: number | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  payment_method?: PaymentMethod | null;
  payment_status?: PaymentStatus | null;
}

const FLOW_LABEL: Record<BookingFlow, string> = {
  transfer:   'Transfer',
  tour:       'Tour',
  hourly:     'Hourly Service',
  experience: 'Experience',
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return `€${Number(n).toFixed(2)}`;
}

function paymentBlock(d: BookingConfirmationData): { html: string; text: string } {
  const total = fmtMoney(d.total_price);
  const method = d.payment_method ?? 'stripe';
  if (method === 'cash') {
    const text = `Payment: ${total} in cash, paid to your driver upon arrival.`;
    return {
      html: `<p style="margin:0 0 12px;"><strong>Payment:</strong> ${total} in cash, paid to your driver upon arrival.</p>`,
      text,
    };
  }
  if (method === 'card-onsite') {
    const surcharge = d.card_surcharge ? ` (incl. ${fmtMoney(d.card_surcharge)} processing fee)` : '';
    const text = `Payment: ${total}${surcharge}, charged to your card by the driver upon arrival.`;
    return {
      html: `<p style="margin:0 0 12px;"><strong>Payment:</strong> ${total}${surcharge}, charged to your card by the driver upon arrival.</p>`,
      text,
    };
  }
  // stripe
  const text = `Payment: ${total} received. No further action required.`;
  return {
    html: `<p style="margin:0 0 12px;"><strong>Payment:</strong> ${total} received. No further action required.</p>`,
    text,
  };
}

function detailRow(label: string, value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:140px;">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${value}</td></tr>`;
}

export function renderBookingConfirmation(d: BookingConfirmationData): { subject: string; html: string; text: string } {
  const ref = d.booking_id.slice(0, 8).toUpperCase();
  const flowLabel = FLOW_LABEL[d.flow];
  const greetName = d.customer_first_name ? `Dear ${d.customer_first_name},` : 'Dear Valued Guest,';

  const routeOrName =
    d.flow === 'transfer' && d.from && d.to ? `${d.from} → ${d.to}` :
    d.flow === 'tour'      ? (d.tour_name ?? '—') :
    d.flow === 'experience'? (d.experience_name ?? '—') :
    d.flow === 'hourly'    ? `${d.hours ?? '—'}h hourly service` : '—';

  const dateTime = d.time ? `${d.date} at ${d.time}` : d.date;
  const pay = paymentBlock(d);

  const subject = `Opawey — ${flowLabel} confirmed (${ref})`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0C6B95;">Opawey Luxury Tours &amp; Transfers</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${greetName}</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for choosing Opawey Luxury Tours &amp; Transfers.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Your reservation has been successfully confirmed. Every detail has been carefully arranged to ensure a seamless, personalized, and high-end experience throughout your journey in Greece.</p>
          ${pay.html}
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">For any special requests or additional arrangements, our team remains at your full disposal.</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <div style="background:#f9fafb;border-radius:12px;padding:16px 20px;">
            <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600;">Reservation details</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${detailRow('Reference',   ref)}
              ${detailRow('Service',     flowLabel)}
              ${detailRow(d.flow === 'transfer' ? 'Route' : 'Booking', routeOrName)}
              ${detailRow('Date',        dateTime)}
              ${detailRow('Passengers',  d.passengers != null ? String(d.passengers) : null)}
              ${detailRow('Vehicle',     d.vehicle_name ?? null)}
              ${detailRow('Total',       fmtMoney(d.total_price))}
            </table>
          </div>
        </td></tr>
        <tr><td style="padding:0 32px 32px;border-top:1px solid #e5e7eb;padding-top:20px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Warm regards,</p>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;font-weight:500;">Opawey Luxury Tours &amp; Transfers</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">
            <a href="mailto:info@opawey.com" style="color:#0C6B95;text-decoration:none;">info@opawey.com</a>
            &nbsp;·&nbsp; WhatsApp +30 6972680618
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greetName,
    '',
    'Thank you for choosing Opawey Luxury Tours & Transfers.',
    '',
    'Your reservation has been successfully confirmed. Every detail has been carefully arranged to ensure a seamless, personalized, and high-end experience throughout your journey in Greece.',
    '',
    pay.text,
    '',
    'For any special requests or additional arrangements, our team remains at your full disposal.',
    '',
    'Reservation details',
    `  Reference:  ${ref}`,
    `  Service:    ${flowLabel}`,
    `  ${d.flow === 'transfer' ? 'Route' : 'Booking'}:      ${routeOrName}`,
    `  Date:       ${dateTime}`,
    d.passengers != null ? `  Passengers: ${d.passengers}` : null,
    d.vehicle_name ? `  Vehicle:    ${d.vehicle_name}` : null,
    `  Total:      ${fmtMoney(d.total_price)}`,
    '',
    'Warm regards,',
    'Opawey Luxury Tours & Transfers',
    'info@opawey.com  ·  WhatsApp +30 6972680618',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
