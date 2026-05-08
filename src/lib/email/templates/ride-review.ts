// Post-ride review email — sent after the driver marks ride_status='completed'.
// Copy is verbatim from the brief; only the booking reference is injected.

export interface RideReviewData {
  booking_id: string;
  customer_first_name?: string | null;
}

const REVIEW_URL = 'https://g.page/r/CQvjBfZ0vaQGEAE/review';

export function renderRideReview(d: RideReviewData): { subject: string; html: string; text: string } {
  const greetName = d.customer_first_name ? `Dear ${d.customer_first_name},` : 'Dear Valued Guest,';
  const subject = 'Thank you for choosing Opawey Luxury Tours & Transfers';

  const html = `<!doctype html>
<html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#0C6B95;">Opawey Luxury Tours &amp; Transfers</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${greetName}</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for choosing Opawey Luxury Tours &amp; Transfers.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">It would be our pleasure if you could take a moment to share your experience with a review on Google.</p>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${REVIEW_URL}" style="display:inline-block;background:#0C6B95;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">Leave a Google review</a>
          </p>
          <p style="margin:0 0 24px;font-size:13px;color:#6b7280;line-height:1.6;text-align:center;">If the button doesn't work, copy and paste this link:<br><a href="${REVIEW_URL}" style="color:#0C6B95;word-break:break-all;">${REVIEW_URL}</a></p>
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
    'It would be our pleasure if you could take a moment to share your experience with a review on Google.',
    '',
    `Link: ${REVIEW_URL}`,
    '',
    'Warm regards,',
    'Opawey Luxury Tours & Transfers',
    'info@opawey.com  ·  WhatsApp +30 6972680618',
  ].join('\n');

  return { subject, html, text };
}
