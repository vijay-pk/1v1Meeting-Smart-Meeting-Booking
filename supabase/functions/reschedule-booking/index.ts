import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import {
  cancelGoogleCalendarEvent,
  createGoogleCalendarEvent,
  refreshGoogleAccessToken,
} from '../_shared/googleCalendar.ts';
import { sendEmail, buildBookingConfirmationHtml } from '../_shared/email.ts';

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
    const { token, bookingId, newStartTime, newEndTime } = await req.json();

    if ((!token && !bookingId) || !newStartTime || !newEndTime) {
      return new Response(JSON.stringify({ error: 'Missing required rescheduling parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    let query = supabase.from('bookings').select('*, meeting_types(*)');
    if (token) {
      query = query.eq('reschedule_token', token);
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

    const meetingType = booking.meeting_types;
    if (meetingType && meetingType.rescheduling_allowed === false) {
      return new Response(JSON.stringify({ error: 'Rescheduling is not permitted for this meeting type.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newStartUtc = new Date(newStartTime).toISOString();
    const newEndUtc = new Date(newEndTime).toISOString();

    // Check slot availability for new time
    const { data: conflicting } = await supabase
      .from('bookings')
      .select('id')
      .eq('host_id', booking.host_id)
      .eq('status', 'confirmed')
      .neq('id', booking.id)
      .lt('start_time', newEndUtc)
      .gt('end_time', newStartUtc);

    if (conflicting && conflicting.length > 0) {
      return new Response(JSON.stringify({ error: 'The newly requested time slot is not available.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update Google Calendar event
    let newCalendarEventId = booking.google_calendar_event_id;
    let newMeetUrl = booking.google_meet_url;

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

        // Delete old event if existed
        if (booking.google_calendar_event_id) {
          await cancelGoogleCalendarEvent({
            accessToken,
            calendarId: gConn.calendar_id || 'primary',
            eventId: booking.google_calendar_event_id,
          });
        }

        // Create new event
        const title = `${meetingType?.title || 'Consultation'} with ${booking.customer_name}`;
        const description = `Customer: ${booking.customer_name}\nEmail: ${booking.customer_email}\nBooking ID: ${booking.public_id || booking.id}\n(Rescheduled)`;

        const gEvent = await createGoogleCalendarEvent({
          accessToken,
          calendarId: gConn.calendar_id || 'primary',
          title,
          description,
          startTimeUtc: newStartUtc,
          endTimeUtc: newEndUtc,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          requestId: `bkm_resched_${booking.id}_${Date.now()}`,
        });

        newCalendarEventId = gEvent.eventId;
        newMeetUrl = gEvent.meetUrl || newMeetUrl;
      } catch (calErr) {
        console.warn('[Reschedule Google Cal Error]', calErr);
      }
    }

    // Update booking in DB
    const { data: updatedBooking, error: updateErr } = await supabase
      .from('bookings')
      .update({
        start_time: newStartUtc,
        end_time: newEndUtc,
        google_calendar_event_id: newCalendarEventId,
        google_meet_url: newMeetUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // Send confirmation email for rescheduled meeting
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';
    const emailHtml = buildBookingConfirmationHtml({
      customerName: booking.customer_name,
      meetingTitle: meetingType?.title || 'Consultation (Rescheduled)',
      formattedDate: new Date(newStartUtc).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      formattedTime: new Date(newStartUtc).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      timezone: booking.timezone || 'UTC',
      googleMeetUrl: newMeetUrl,
      bookingId: booking.public_id || booking.id,
      amountFormatted: `${booking.currency} ${booking.amount} (Paid)`,
      cancellationUrl: `${appUrl}/booking/cancel/${booking.cancellation_token}`,
      rescheduleUrl: `${appUrl}/booking/reschedule/${booking.reschedule_token}`,
    });

    await sendEmail({
      to: booking.customer_email,
      subject: `Rescheduled: ${meetingType?.title || 'Developer Consultation'}`,
      html: emailHtml,
    });

    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking,
      googleMeetUrl: newMeetUrl,
      message: 'Meeting successfully rescheduled!',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[reschedule-booking Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to reschedule booking' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
