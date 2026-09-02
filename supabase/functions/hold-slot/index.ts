import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { generateSecureToken } from '../_shared/crypto.ts';

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
    const { meetingTypeId, startTime, endTime, timezone, customerEmail, customerName, customerPhone, notes, customAnswers } = await req.json();

    if (!meetingTypeId || !startTime || !endTime || !customerEmail || !customerName) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    // 1. Verify meeting type exists and is active
    const { data: meetingType, error: mtErr } = await supabase
      .from('meeting_types')
      .select('*')
      .eq('id', meetingTypeId)
      .eq('is_active', true)
      .single();

    if (mtErr || !meetingType) {
      return new Response(JSON.stringify({ error: 'Meeting type not found or inactive' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const startUtc = new Date(startTime).toISOString();
    const endUtc = new Date(endTime).toISOString();

    // 2. Check for conflicting active bookings (overlapping intervals)
    const { data: conflictingBookings, error: conflictErr } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, status')
      .eq('host_id', meetingType.user_id)
      .in('status', ['confirmed', 'payment_received_calendar_pending'])
      .lt('start_time', endUtc)
      .gt('end_time', startUtc);

    if (conflictErr) throw conflictErr;

    if (conflictingBookings && conflictingBookings.length > 0) {
      return new Response(JSON.stringify({ error: 'That time slot is no longer available. Please choose another time.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Check for active holds on the same slot (not expired)
    const nowIso = new Date().toISOString();
    const { data: conflictingHolds, error: holdErr } = await supabase
      .from('booking_holds')
      .select('id, hold_token, expires_at')
      .eq('host_id', meetingType.user_id)
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .lt('start_time', endUtc)
      .gt('end_time', startUtc);

    if (holdErr) throw holdErr;

    if (conflictingHolds && conflictingHolds.length > 0) {
      return new Response(JSON.stringify({ error: 'This time slot is currently on hold by another customer. Please try again shortly or choose another time.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Create customer record or fetch existing
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', customerEmail.toLowerCase().trim())
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: newCustErr } = await supabase
        .from('customers')
        .insert({
          email: customerEmail.toLowerCase().trim(),
          name: customerName.trim(),
          phone: customerPhone || null,
        })
        .select('id')
        .single();
      if (!newCustErr && newCustomer) {
        customerId = newCustomer.id;
      }
    }

    // 5. Generate secure tokens & Hold record
    const holdToken = generateSecureToken('hold_');
    const cancellationToken = generateSecureToken('cncl_');
    const rescheduleToken = generateSecureToken('rsch_');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes hold

    // 6. Create booking record in pending_payment status
    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .insert({
        host_id: meetingType.user_id,
        meeting_type_id: meetingType.id,
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail.toLowerCase().trim(),
        customer_phone: customerPhone || null,
        customer_notes: notes || null,
        custom_answers: customAnswers || {},
        start_time: startUtc,
        end_time: endUtc,
        timezone: timezone || 'UTC',
        amount: meetingType.price,
        currency: meetingType.currency || 'INR',
        status: 'pending_payment',
        payment_status: 'pending',
        calendar_status: 'none',
        cancellation_token: cancellationToken,
        reschedule_token: rescheduleToken,
      })
      .select('*')
      .single();

    if (bookErr || !booking) {
      throw bookErr || new Error('Failed to create booking draft');
    }

    // 7. Insert booking hold
    const { error: insertHoldErr } = await supabase
      .from('booking_holds')
      .insert({
        booking_id: booking.id,
        meeting_type_id: meetingType.id,
        host_id: meetingType.user_id,
        hold_token: holdToken,
        start_time: startUtc,
        end_time: endUtc,
        expires_at: expiresAt,
        status: 'active',
      });

    if (insertHoldErr) {
      console.error('[Hold Error]', insertHoldErr);
    }

    return new Response(JSON.stringify({
      success: true,
      bookingId: booking.id,
      publicId: booking.public_id,
      holdToken,
      expiresAt,
      amount: meetingType.price,
      currency: meetingType.currency || 'INR',
      meetingType: {
        id: meetingType.id,
        title: meetingType.title,
        durationMinutes: meetingType.duration_minutes,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[hold-slot Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
