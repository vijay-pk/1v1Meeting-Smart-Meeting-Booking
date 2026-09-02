import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';
import { fetchGoogleBusyIntervals, refreshGoogleAccessToken } from '../_shared/googleCalendar.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const meetingTypeId = url.searchParams.get('meetingTypeId');
    const dateStr = url.searchParams.get('date'); // YYYY-MM-DD
    const timezone = url.searchParams.get('timezone') || 'UTC';

    if (!meetingTypeId || !dateStr) {
      return new Response(JSON.stringify({ error: 'Missing meetingTypeId or date parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceSupabaseClient();

    // 1. Fetch meeting type
    const { data: meetingType, error: mtErr } = await supabase
      .from('meeting_types')
      .select('*')
      .eq('id', meetingTypeId)
      .single();

    if (mtErr || !meetingType) {
      return new Response(JSON.stringify({ error: 'Meeting type not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hostId = meetingType.user_id;
    const durationMinutes = meetingType.duration_minutes || 30;
    const bufferBefore = meetingType.buffer_before_minutes || 0;
    const bufferAfter = meetingType.buffer_after_minutes || 0;
    const minAdvanceMinutes = meetingType.min_notice_hours ? meetingType.min_notice_hours * 60 : 60;

    // 2. Fetch Availability Rules for the day of week
    const targetDate = new Date(`${dateStr}T00:00:00Z`);
    const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday, 1 = Monday...

    const { data: rules } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('user_id', hostId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true);

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ availableSlots: [], message: 'No working hours configured for this day' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch custom unavailable dates / holidays
    const { data: exceptions } = await supabase
      .from('availability_exceptions')
      .select('*')
      .eq('user_id', hostId)
      .eq('exception_date', dateStr);

    if (exceptions && exceptions.some(e => !e.is_available && !e.start_time)) {
      return new Response(JSON.stringify({ availableSlots: [], message: 'Host is unavailable on this date' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Day start and end in UTC
    const dayStartUtc = new Date(`${dateStr}T00:00:00Z`).toISOString();
    const dayEndUtc = new Date(`${dateStr}T23:59:59Z`).toISOString();

    // 4. Fetch Google Calendar busy slots
    const busyIntervals: Array<{ start: string; end: string }> = [];

    const { data: gConn } = await supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', hostId)
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

        const gBusy = await fetchGoogleBusyIntervals({
          accessToken,
          calendarId: gConn.calendar_id || 'primary',
          timeMin: dayStartUtc,
          timeMax: dayEndUtc,
        });
        busyIntervals.push(...gBusy);
      } catch (err) {
        console.warn('[Calendar Availability] Failed to fetch Google FreeBusy, continuing with DB availability:', err);
      }
    }

    // 5. Fetch confirmed DB bookings
    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('start_time, end_time')
      .eq('host_id', hostId)
      .in('status', ['confirmed', 'payment_received_calendar_pending'])
      .gte('end_time', dayStartUtc)
      .lte('start_time', dayEndUtc);

    if (existingBookings) {
      for (const b of existingBookings) {
        busyIntervals.push({ start: b.start_time, end: b.end_time });
      }
    }

    // 6. Fetch active holds
    const nowIso = new Date().toISOString();
    const { data: activeHolds } = await supabase
      .from('booking_holds')
      .select('start_time, end_time')
      .eq('host_id', hostId)
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .gte('end_time', dayStartUtc)
      .lte('start_time', dayEndUtc);

    if (activeHolds) {
      for (const h of activeHolds) {
        busyIntervals.push({ start: h.start_time, end: h.end_time });
      }
    }

    // 7. Generate Candidate Slots from Availability Windows
    const generatedSlots: string[] = [];
    const minBookingTime = new Date(Date.now() + minAdvanceMinutes * 60 * 1000);

    for (const rule of rules) {
      // rule.start_time and end_time are in "HH:MM:SS"
      const [sh, sm] = (rule.start_time || '10:00:00').split(':').map(Number);
      const [eh, em] = (rule.end_time || '18:00:00').split(':').map(Number);

      const windowStart = new Date(`${dateStr}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00Z`);
      const windowEnd = new Date(`${dateStr}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00Z`);

      let current = new Date(windowStart.getTime());

      while (current.getTime() + durationMinutes * 60000 <= windowEnd.getTime()) {
        const slotStart = new Date(current.getTime());
        const slotEnd = new Date(current.getTime() + durationMinutes * 60000);

        // Account for buffers
        const slotWithBufferStart = new Date(slotStart.getTime() - bufferBefore * 60000);
        const slotWithBufferEnd = new Date(slotEnd.getTime() + bufferAfter * 60000);

        // Must be ahead of minimum notice
        if (slotStart >= minBookingTime) {
          // Check overlap with any busy interval
          const overlaps = busyIntervals.some(interval => {
            const bStart = new Date(interval.start);
            const bEnd = new Date(interval.end);
            return slotWithBufferStart < bEnd && slotWithBufferEnd > bStart;
          });

          if (!overlaps) {
            generatedSlots.push(slotStart.toISOString());
          }
        }

        // Advance by slot interval (step by 30 mins or duration)
        const stepMinutes = Math.min(30, durationMinutes);
        current = new Date(current.getTime() + stepMinutes * 60000);
      }
    }

    return new Response(JSON.stringify({
      date: dateStr,
      timezone,
      durationMinutes,
      availableSlots: generatedSlots,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[calendar-availability Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to calculate availability' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
