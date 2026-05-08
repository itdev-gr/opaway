// Partner registration confirmation email — sent when a hotel/agency/driver
// completes the partner application form.

export type PartnerType = 'hotel' | 'agency' | 'driver';

export interface PartnerRegisteredData {
  partner_id: string;
  type: PartnerType;
  display_name?: string | null;
  business_name?: string | null;
}

const TYPE_LABEL: Record<PartnerType, string> = {
  hotel:  'Hotel',
  agency: 'Agency',
  driver: 'Driver',
};

export function renderPartnerRegistered(d: PartnerRegisteredData): { subject: string; html: string; text: string } {
  const typeLabel = TYPE_LABEL[d.type];
  const greetName = d.display_name ? `Dear ${d.display_name},` : 'Dear Partner,';
  const subject = `Opawey — ${typeLabel} application received`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0C6B95;">Opawey Luxury Tours &amp; Transfers</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${greetName}</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for applying to join the Opawey partner network as a <strong>${typeLabel}</strong>${d.business_name ? ` — <strong>${d.business_name}</strong>` : ''}.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Your application has been received and is now under review. Our team will evaluate your details and reach out within 1–2 business days with the next steps.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">In the meantime, if you have any questions or would like to add information to your application, please reply to this email or contact us via WhatsApp.</p>
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
    `Thank you for applying to join the Opawey partner network as a ${typeLabel}${d.business_name ? ` — ${d.business_name}` : ''}.`,
    '',
    'Your application has been received and is now under review. Our team will evaluate your details and reach out within 1–2 business days with the next steps.',
    '',
    'In the meantime, if you have any questions or would like to add information to your application, please reply to this email or contact us via WhatsApp.',
    '',
    'Warm regards,',
    'Opawey Luxury Tours & Transfers',
    'info@opawey.com  ·  WhatsApp +30 6972680618',
  ].join('\n');

  return { subject, html, text };
}
