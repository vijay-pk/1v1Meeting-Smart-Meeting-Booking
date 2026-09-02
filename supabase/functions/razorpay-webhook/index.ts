import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { hmacSha256Hex } from '../_shared/crypto.ts';

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
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || '';

    // 1. Verify Webhook Signature if secret configured
    if (webhookSecret && signature) {
      const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody);
      if (expectedSignature.toLowerCase() !== signature.toLowerCase()) {
        console.error('[Razorpay Webhook] Invalid signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const payload = JSON.parse(rawBody);
    const eventId = payload.event_id || `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const eventType = payload.event || 'unknown';

    const supabase = getServiceSupabaseClient();

    // 2. Webhook Idempotency Check: check if event already processed
    const { data: existingEvent } = await supabase
      .from('webhook_events')
      .select('id, processed')
      .eq('event_id', eventId)
      .single();

    if (existingEvent && existingEvent.processed) {
      console.log(`[Razorpay Webhook] Event ${eventId} already processed. Skipping.`);
      return new Response(JSON.stringify({ status: 'already_processed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Record webhook event
    await supabase.from('webhook_events').upsert({
      provider: 'razorpay',
      event_id: eventId,
      event_type: eventType,
      payload,
      processed: false,
    }, { onConflict: 'event_id' });

    // 3. Handle Payment Captured / Order Paid Events
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id || payload.payload?.order?.entity?.id;
      const paymentId = paymentEntity?.id;

      if (orderId) {
        // Find booking by razorpay_order_id
        const { data: booking } = await supabase
          .from('bookings')
          .select('id, status, payment_status')
          .eq('razorpay_order_id', orderId)
          .single();

        if (booking && booking.status !== 'confirmed') {
          // Trigger server-side verify-payment flow if not already confirmed
          console.log(`[Razorpay Webhook] Auto-confirming booking ${booking.id} from webhook`);
          await supabase
            .from('bookings')
            .update({
              payment_status: 'paid',
              razorpay_payment_id: paymentId,
              status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking.id);
        }
      }
    }

    // Mark event as processed
    await supabase
      .from('webhook_events')
      .update({ processed: true })
      .eq('event_id', eventId);

    return new Response(JSON.stringify({ status: 'success' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[Razorpay Webhook Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Webhook processing failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
