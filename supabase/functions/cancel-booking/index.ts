import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { cancelGoogleCalendarEvent, refreshGoogleAccessToken } from '../_shared/googleCalendar.ts';
import { sendEmail } from '../_shared/email.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { token, reason, bookingId } = await req.json();

    if (!token && !bookingId) {
      return new Response(JSON.stringify({ error: 'Missing cancellation token or booking ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    let query = supabase.from('bookings').select('*, meeting_types(*)');
    if (token) {
      query = query.eq('cancellation_token', token);
    } else {
      query = query.eq('id', bookingId);
    }

    const { data: booking, error: bErr } = await query.single();
    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (booking.status === 'cancelled') {
      return new Response(JSON.stringify({ error: 'Booking has already been cancelled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check cancellation window policy
    const meetingType = booking.meeting_types;
    const cancelWindowHours = meetingType?.cancellation_window_hours ?? 24;
    const bookingStart = new Date(booking.start_time).getTime();
    const hoursUntilMeeting = (bookingStart - Date.now()) / (1000 * 60 * 60);

    const isEligibleForRefund = hoursUntilMeeting >= cancelWindowHours;

    // 1. Cancel Google Calendar event if exists
    if (booking.google_calendar_event_id) {
      const { data: gConn } = await supabase
        .from('google_calendar_connections')
        .select('*')
        .eq('user_id', booking.host_id)
        .eq('is_active', true)
        .single();

      if (gConn && gConn.refresh_token) {
        try {
          let accessToken = gConn.access_token;
          const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
          const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';

          if (googleClientId && googleClientSecret) {
            const refreshed = await refreshGoogleAccessToken(gConn.refresh_token, googleClientId, googleClientSecret);
            accessToken = refreshed.accessToken;
          }

          await cancelGoogleCalendarEvent({
            accessToken,
            calendarId: gConn.calendar_id || 'primary',
            eventId: booking.google_calendar_event_id,
          });
        } catch (calErr) {
          console.warn('[Cancel Booking] Failed to delete event from Google Calendar:', calErr);
        }
      }
    }

    // 2. Mark booking status as cancelled
    const { data: updatedBooking, error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: reason || 'Customer requested cancellation',
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // 3. Send Cancellation Email
    await sendEmail({
      to: booking.customer_email,
      subject: `Booking Cancelled — ${meetingType?.title || 'Appointment'}`,
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
          <h2>Booking Cancellation Notice</h2>
          <p>Hi ${booking.customer_name},</p>
          <p>Your meeting <strong>${meetingType?.title || 'Consultation'}</strong> scheduled for <strong>${new Date(booking.start_time).toLocaleString()}</strong> has been cancelled.</p>
          <p><strong>Refund Status:</strong> ${isEligibleForRefund ? 'Eligible for standard refund under policy.' : 'Non-refundable (cancelled within minimum window).'}</p>
          <p>If you have any questions, please reply to this email.</p>
        </div>
      `,
    });

    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking,
      isEligibleForRefund,
      message: 'Booking cancelled successfully and time slot released.',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[cancel-booking Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to cancel booking' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
