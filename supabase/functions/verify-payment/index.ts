import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { verifyRazorpaySignature } from '../_shared/crypto.ts';
import {
  refreshGoogleAccessToken,
  createGoogleCalendarEvent,
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
    const {
      bookingId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      isFree,
    } = await req.json();

    if (!bookingId) {
      return new Response(JSON.stringify({ error: 'Missing booking ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    // 1. Fetch booking with host profile & meeting type
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('*, meeting_types(*)')
      .eq('id', bookingId)
      .single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const meetingType = booking.meeting_types;
    const isFreeMeeting = isFree || Number(meetingType?.price || 0) === 0;

    // 2. Server-side Payment Verification
    if (!isFreeMeeting) {
      if (!razorpayOrderId || !razorpayPaymentId) {
        return new Response(JSON.stringify({ error: 'Missing payment identifiers' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET') || '';

      if (razorpayKeySecret && razorpaySignature) {
        const isValid = await verifyRazorpaySignature(
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          razorpayKeySecret
        );

        if (!isValid) {
          console.error('[Payment Verification Failed] Signature mismatch');
          await supabase
            .from('bookings')
            .update({ payment_status: 'failed', status: 'payment_failed', updated_at: new Date().toISOString() })
            .eq('id', booking.id);

          return new Response(JSON.stringify({ error: 'Payment signature could not be verified' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.warn('[Payment Verify] Running in mock/test mode without signature validation.');
      }

      // Record successful payment
      await supabase.from('payments').upsert({
        booking_id: booking.id,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature || 'test_sig',
        amount: booking.amount,
        currency: booking.currency || 'INR',
        status: 'captured',
      }, { onConflict: 'razorpay_order_id' });

      await supabase
        .from('bookings')
        .update({
          payment_status: 'paid',
          razorpay_payment_id: razorpayPaymentId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
    } else {
      // Free meeting marked as paid
      await supabase
        .from('bookings')
        .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
        .eq('id', booking.id);
    }

    // 3. Double-check slot availability before calendar creation
    const { data: overlappingConfirmed } = await supabase
      .from('bookings')
      .select('id')
      .eq('host_id', booking.host_id)
      .eq('status', 'confirmed')
      .neq('id', booking.id)
      .lt('start_time', booking.end_time)
      .gt('end_time', booking.start_time);

    if (overlappingConfirmed && overlappingConfirmed.length > 0) {
      console.warn('[Host Busy on Confirm] Querying other available admins to select randomly');
      // Fetch other active admins
      const { data: otherAdmins } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .neq('id', booking.host_id);

      if (otherAdmins && otherAdmins.length > 0) {
        // Find which ones are free during this slot
        const availableOtherAdmins = [];
        for (const adm of otherAdmins) {
          const { data: conflict } = await supabase
            .from('bookings')
            .select('id')
            .eq('host_id', adm.id)
            .eq('status', 'confirmed')
            .lt('start_time', booking.end_time)
            .gt('end_time', booking.start_time);
          if (!conflict || conflict.length === 0) {
            availableOtherAdmins.push(adm);
          }
        }

        if (availableOtherAdmins.length > 0) {
          // Select randomly among available admins
          const chosen = availableOtherAdmins[Math.floor(Math.random() * availableOtherAdmins.length)];
          booking.host_id = chosen.id;
          await supabase.from('bookings').update({ host_id: chosen.id }).eq('id', booking.id);
          console.log(`[Auto-Reassign] Selected available admin at random: ${chosen.full_name} (${chosen.email})`);
        }
      }
    }

    // 4. Fetch Google Calendar Connection for host
    const { data: gConn } = await supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', booking.host_id)
      .eq('is_active', true)
      .single();

    let calendarEventId: string | null = null;
    let googleMeetUrl: string | null = null;
    let calendarStatus = 'none';

    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';

    if (gConn && gConn.refresh_token) {
      try {
        let accessToken = gConn.access_token;
        const isExpired = !accessToken || (gConn.token_expires_at && new Date(gConn.token_expires_at).getTime() <= Date.now() + 60000);

        if (isExpired && googleClientId && googleClientSecret) {
          const refreshed = await refreshGoogleAccessToken(
            gConn.refresh_token,
            googleClientId,
            googleClientSecret
          );
          accessToken = refreshed.accessToken;

          const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
          await supabase
            .from('google_calendar_connections')
            .update({ access_token: accessToken, token_expires_at: newExpiresAt, updated_at: new Date().toISOString() })
            .eq('id', gConn.id);
        }

        const title = `${meetingType?.title || 'Consultation'} with ${booking.customer_name}`;
        const description = `Customer: ${booking.customer_name}\nEmail: ${booking.customer_email}\nPhone: ${booking.customer_phone || 'N/A'}\nBooking ID: ${booking.public_id || booking.id}\nService: ${meetingType?.title}\nPayment: ${booking.currency} ${booking.amount}`;

        const gEvent = await createGoogleCalendarEvent({
          accessToken,
          calendarId: gConn.calendar_id || 'primary',
          title,
          description,
          startTimeUtc: booking.start_time,
          endTimeUtc: booking.end_time,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          requestId: `bkm_${booking.id}`,
        });

        calendarEventId = gEvent.eventId;
        googleMeetUrl = gEvent.meetUrl;
        calendarStatus = 'synced';

      } catch (calErr: any) {
        console.error('[Google Calendar Integration Error]', calErr);
        // Calendar creation failed edge case
        await supabase
          .from('bookings')
          .update({
            calendar_status: 'failed',
            status: 'payment_received_calendar_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);

        return new Response(JSON.stringify({
          success: true,
          status: 'payment_received_calendar_pending',
          message: 'Payment received. Meeting calendar event is being scheduled by our system.',
          bookingId: booking.id,
          publicId: booking.public_id,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Mock / direct fallback meet link if Google calendar is not linked yet
      googleMeetUrl = `https://meet.google.com/bkm-${booking.id.substring(0, 4)}-${booking.id.substring(4, 7)}`;
      calendarStatus = 'mock_synced';
    }

    // 5. Final Confirmation State Update
    const { data: updatedBooking, error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        calendar_status: calendarStatus,
        google_calendar_event_id: calendarEventId,
        google_meet_url: googleMeetUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // 6. Release Hold
    await supabase
      .from('booking_holds')
      .update({ status: 'converted', updated_at: new Date().toISOString() })
      .eq('booking_id', booking.id);

    // 7. Send Confirmation Email
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';
    const cancellationUrl = `${appUrl}/booking/cancel/${booking.cancellation_token}`;
    const rescheduleUrl = `${appUrl}/booking/reschedule/${booking.reschedule_token}`;

    const formattedDate = new Date(booking.start_time).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = new Date(booking.start_time).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const emailHtml = buildBookingConfirmationHtml({
      customerName: booking.customer_name,
      meetingTitle: meetingType?.title || 'Consultation',
      formattedDate,
      formattedTime,
      timezone: booking.timezone || 'UTC',
      googleMeetUrl,
      bookingId: booking.public_id || booking.id,
      amountFormatted: `${booking.currency} ${booking.amount}`,
      cancellationUrl,
      rescheduleUrl,
    });

    // 1. Send Confirmation Email to Client
    await sendEmail({
      to: booking.customer_email,
      subject: `Booking Confirmed — ${meetingType?.title || 'Consultation Session'}`,
      html: emailHtml,
    });

    // 2. Send Alert Email to Host / Admin
    const hostEmail = booking.host?.email || 'mahir@adwaysacademy.com';
    await sendEmail({
      to: hostEmail,
      subject: `New Paid Booking Alert: ${booking.customer_name} — ${meetingType?.title || 'Consultation Session'}`,
      html: emailHtml,
    });

    return new Response(JSON.stringify({
      success: true,
      status: 'confirmed',
      booking: updatedBooking,
      googleMeetUrl,
      calendarEventId,
      publicId: booking.public_id,
      cancellationToken: booking.cancellation_token,
      rescheduleToken: booking.reschedule_token,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[verify-payment Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
