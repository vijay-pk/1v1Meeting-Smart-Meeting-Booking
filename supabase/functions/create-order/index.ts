import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';

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
    const { bookingId } = await req.json();

    if (!bookingId) {
      return new Response(JSON.stringify({ error: 'Missing booking ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    // 1. Fetch booking with verified meeting type price from DB
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

    if (booking.status === 'confirmed') {
      return new Response(JSON.stringify({ error: 'Booking is already confirmed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const meetingType = booking.meeting_types;
    if (!meetingType) {
      return new Response(JSON.stringify({ error: 'Meeting type associated with booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Amount from server-side database (in INR subunits: paise)
    const priceInPaise = Math.round(Number(meetingType.price) * 100);
    const currency = (meetingType.currency || 'INR').toUpperCase();

    // If free meeting (0 price)
    if (priceInPaise <= 0) {
      return new Response(JSON.stringify({
        isFree: true,
        amount: 0,
        currency,
        bookingId: booking.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID') || '';
    const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET') || '';

    if (!razorpayKeyId || !razorpayKeySecret) {
      console.warn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment. Generating simulated test order.');
      // Return simulated test order for local dev if keys not populated yet
      const mockOrderId = 'order_mock_' + Math.random().toString(36).substring(2, 12);
      
      await supabase.from('payments').insert({
        booking_id: booking.id,
        razorpay_order_id: mockOrderId,
        amount: meetingType.price,
        currency,
        status: 'created',
      });

      return new Response(JSON.stringify({
        orderId: mockOrderId,
        amount: priceInPaise,
        currency,
        keyId: 'rzp_test_bookmymeet',
        isMock: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Real Razorpay API Order Creation
    const authHeader = 'Basic ' + btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: priceInPaise,
        currency,
        receipt: `rcpt_${booking.public_id || booking.id.substring(0, 8)}`,
        notes: {
          bookingId: booking.id,
          meetingTypeId: meetingType.id,
          customerEmail: booking.customer_email,
        },
      }),
    });

    const orderData = await rzpRes.json();
    if (!rzpRes.ok) {
      console.error('[Razorpay Order Creation Error]', orderData);
      throw new Error(orderData.error?.description || 'Failed to create Razorpay order');
    }

    // Save payment record
    await supabase.from('payments').insert({
      booking_id: booking.id,
      razorpay_order_id: orderData.id,
      amount: meetingType.price,
      currency,
      status: 'created',
    });

    // Update booking razorpay_order_id
    await supabase
      .from('bookings')
      .update({ razorpay_order_id: orderData.id, updated_at: new Date().toISOString() })
      .eq('id', booking.id);

    return new Response(JSON.stringify({
      orderId: orderData.id,
      amount: orderData.amount,
      currency: orderData.currency,
      keyId: razorpayKeyId,
      customerName: booking.customer_name,
      customerEmail: booking.customer_email,
      customerPhone: booking.customer_phone,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[create-order Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
