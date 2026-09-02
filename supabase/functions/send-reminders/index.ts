import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { sendEmail } from '../_shared/email.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = getServiceSupabaseClient();
    const now = new Date();

    // 1. Find Confirmed Bookings due in 24 hours (between now+23.5h and now+24.5h) that haven't received reminder_24h
    const in24hStart = new Date(now.getTime() + 23.5 * 3600 * 1000).toISOString();
    const in24hEnd = new Date(now.getTime() + 24.5 * 3600 * 1000).toISOString();

    const { data: bookings24h } = await supabase
      .from('bookings')
      .select('*, meeting_types(*)')
      .eq('status', 'confirmed')
      .eq('reminder_24h_sent', false)
      .gte('start_time', in24hStart)
      .lte('start_time', in24hEnd);

    let sent24hCount = 0;
    if (bookings24h && bookings24h.length > 0) {
      for (const b of bookings24h) {
        await sendEmail({
          to: b.customer_email,
          subject: `Reminder: Meeting Tomorrow — ${b.meeting_types?.title || 'Developer Consultation'}`,
          html: `
            <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
              <h2>Upcoming Meeting Reminder (24 Hours)</h2>
              <p>Hi ${b.customer_name},</p>
              <p>This is a reminder that your meeting <strong>${b.meeting_types?.title || 'Consultation'}</strong> is scheduled for tomorrow at <strong>${new Date(b.start_time).toLocaleString()} (${b.timezone})</strong>.</p>
              ${b.google_meet_url ? `<p><a href="${b.google_meet_url}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Join Google Meet</a></p>` : ''}
            </div>
          `,
        });

        await supabase
          .from('bookings')
          .update({ reminder_24h_sent: true, updated_at: new Date().toISOString() })
          .eq('id', b.id);

        sent24hCount++;
      }
    }

    // 2. Find Confirmed Bookings due in 1 hour (between now+50m and now+70m) that haven't received reminder_1h
    const in1hStart = new Date(now.getTime() + 50 * 60 * 1000).toISOString();
    const in1hEnd = new Date(now.getTime() + 70 * 60 * 1000).toISOString();

    const { data: bookings1h } = await supabase
      .from('bookings')
      .select('*, meeting_types(*)')
      .eq('status', 'confirmed')
      .eq('reminder_1h_sent', false)
      .gte('start_time', in1hStart)
      .lte('start_time', in1hEnd);

    let sent1hCount = 0;
    if (bookings1h && bookings1h.length > 0) {
      for (const b of bookings1h) {
        await sendEmail({
          to: b.customer_email,
          subject: `Starting Soon: Meeting in 1 Hour — ${b.meeting_types?.title || 'Developer Consultation'}`,
          html: `
            <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
              <h2>Meeting Starting Soon (1 Hour)</h2>
              <p>Hi ${b.customer_name},</p>
              <p>Your meeting <strong>${b.meeting_types?.title || 'Consultation'}</strong> starts in 1 hour at <strong>${new Date(b.start_time).toLocaleString()} (${b.timezone})</strong>.</p>
              ${b.google_meet_url ? `<p><a href="${b.google_meet_url}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Join Google Meet</a></p>` : ''}
            </div>
          `,
        });

        await supabase
          .from('bookings')
          .update({ reminder_1h_sent: true, updated_at: new Date().toISOString() })
          .eq('id', b.id);

        sent1hCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      sent24h: sent24hCount,
      sent1h: sent1hCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[send-reminders Exception]', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
