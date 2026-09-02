// Abstract Transactional Email Provider

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  fromEmail?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get('EMAIL_PROVIDER_API_KEY') || Deno.env.get('RESEND_API_KEY') || '';
  const defaultFromName = Deno.env.get('EMAIL_FROM_NAME') || 'BookMyMeet';
  const defaultFromEmail = Deno.env.get('EMAIL_FROM_ADDRESS') || 'bookings@bookmymeet.app';

  const from = `${options.fromName || defaultFromName} <${options.fromEmail || defaultFromEmail}>`;

  if (!apiKey) {
    console.log(`[Email Mock/Dev] Would send email to ${options.to}: ${options.subject}`);
    return { success: true, id: 'mock-email-' + Date.now() };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Email Error]', data);
      return { success: false, error: data.message || 'Failed to send email' };
    }

    return { success: true, id: data.id };
  } catch (err: any) {
    console.error('[Email Exception]', err);
    return { success: false, error: err.message };
  }
}

export function buildBookingConfirmationHtml(params: {
  customerName: string;
  meetingTitle: string;
  formattedDate: string;
  formattedTime: string;
  timezone: string;
  googleMeetUrl?: string | null;
  calendarLink?: string | null;
  bookingId: string;
  amountFormatted: string;
  cancellationUrl: string;
  rescheduleUrl: string;
  cancellationPolicyNotice?: string;
}): string {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
      .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
      .header { text-align: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 24px; }
      .badge { display: inline-block; background: #ecfdf5; color: #059669; font-weight: 600; padding: 6px 16px; border-radius: 9999px; font-size: 14px; margin-bottom: 12px; }
      .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
      .details { background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
      .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; }
      .btn { display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; text-align: center; margin: 8px 4px; }
      .btn-secondary { background: #f1f5f9; color: #334155; }
      .footer { text-align: center; font-size: 13px; color: #64748b; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <div class="badge">✓ Booking Confirmed</div>
        <h1 class="title">${params.meetingTitle}</h1>
      </div>
      <p>Hi ${params.customerName},</p>
      <p>Your appointment has been successfully scheduled and paid. Here are your booking details:</p>
      <div class="details">
        <div class="detail-row"><strong>Date:</strong> <span>${params.formattedDate}</span></div>
        <div class="detail-row"><strong>Time:</strong> <span>${params.formattedTime} (${params.timezone})</span></div>
        <div class="detail-row"><strong>Booking ID:</strong> <span>${params.bookingId}</span></div>
        <div class="detail-row"><strong>Amount Paid:</strong> <span>${params.amountFormatted}</span></div>
      </div>
      ${params.googleMeetUrl ? `
        <div style="text-align: center; margin: 24px 0;">
          <a href="${params.googleMeetUrl}" class="btn" style="color: #ffffff; background-color: #2563eb;">Join Google Meet</a>
        </div>
      ` : ''}
      <div style="text-align: center; margin-top: 16px;">
        <a href="${params.rescheduleUrl}" class="btn btn-secondary">Reschedule</a>
        <a href="${params.cancellationUrl}" class="btn btn-secondary">Cancel Meeting</a>
      </div>
      <div class="footer">
        <p>${params.cancellationPolicyNotice || 'Free cancellation according to configured meeting policy.'}</p>
        <p>Powered by BookMyMeet</p>
      </div>
    </div>
  </body>
  </html>
  `;
}
