// Experience request received email — sent when a customer submits an
// experience inquiry form.

export interface ExperienceRequestData {
  request_id: string;
  experience_name?: string | null;
  date?: string | null;
  time?: string | null;
  participants?: number | null;
  customer_first_name?: string | null;
}

export function renderExperienceRequest(d: ExperienceRequestData): { subject: string; html: string; text: string } {
  const ref = d.request_id.slice(0, 8).toUpperCase();
  const greetName = d.customer_first_name ? `Dear ${d.customer_first_name},` : 'Dear Valued Guest,';
  const exp = d.experience_name || 'experience';
  const subject = `Opawey — Experience inquiry received (${ref})`;

  const dateLine = d.date ? (d.time ? `${d.date} at ${d.time}` : d.date) : null;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0C6B95;">Opawey Luxury Tours &amp; Transfers</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${greetName}</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for your interest in <strong>${exp}</strong>. We have received your inquiry and our team will reach out shortly with availability and a tailored proposal.</p>
          ${dateLine || d.participants
            ? `<div style="background:#f9fafb;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
                 <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600;">Inquiry summary</h2>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                   <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:140px;">Reference</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${ref}</td></tr>
                   <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Experience</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${exp}</td></tr>
                   ${dateLine ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Preferred date</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${dateLine}</td></tr>` : ''}
                   ${d.participants ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Participants</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${d.participants}</td></tr>` : ''}
                 </table>
               </div>`
            : ''}
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">If anything in your request changes in the meantime, simply reply to this email and we'll update the inquiry.</p>
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
    `Thank you for your interest in ${exp}. We have received your inquiry and our team will reach out shortly with availability and a tailored proposal.`,
    '',
    'Inquiry summary',
    `  Reference:      ${ref}`,
    `  Experience:     ${exp}`,
    dateLine ? `  Preferred date: ${dateLine}` : null,
    d.participants ? `  Participants:   ${d.participants}` : null,
    '',
    `If anything in your request changes in the meantime, simply reply to this email and we'll update the inquiry.`,
    '',
    'Warm regards,',
    'Opawey Luxury Tours & Transfers',
    'info@opawey.com  ·  WhatsApp +30 6972680618',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
