import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const type = url.searchParams.get('type') || 'cancellation'; // 'cancellation' | 'reschedule' | 'public'

    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing secure token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    let query = supabase.from('bookings').select('*, meeting_types(*), profiles:host_id(*)');

    if (type === 'cancellation') {
      query = query.eq('cancellation_token', token);
    } else if (type === 'reschedule') {
      query = query.eq('reschedule_token', token);
    } else {
      query = query.eq('public_id', token);
    }

    const { data: booking, error: bErr } = await query.single();
    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found or invalid token' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mask sensitive server fields for privacy
    const sanitizedBooking = {
      id: booking.id,
      publicId: booking.public_id,
      customerName: booking.customer_name,
      customerEmail: booking.customer_email,
      customerPhone: booking.customer_phone,
      startTime: booking.start_time,
      endTime: booking.end_time,
      timezone: booking.timezone,
      status: booking.status,
      paymentStatus: booking.payment_status,
      googleMeetUrl: booking.google_meet_url,
      amount: booking.amount,
      currency: booking.currency,
      meetingType: booking.meeting_types,
      host: {
        name: booking.profiles?.full_name || 'Consultant',
        avatarUrl: booking.profiles?.avatar_url,
        bio: booking.profiles?.bio,
      },
    };

    return new Response(JSON.stringify({ success: true, booking: sanitizedBooking }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
