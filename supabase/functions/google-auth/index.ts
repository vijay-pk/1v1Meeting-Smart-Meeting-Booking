import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    const redirectUrlParam = url.searchParams.get('redirectUrl');

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
    const redirectUri = redirectUrlParam || Deno.env.get('GOOGLE_REDIRECT_URI') || 'http://localhost:5173/admin/settings?tab=calendar';

    if (!clientId) {
      return new Response(JSON.stringify({
        error: 'GOOGLE_CLIENT_ID not configured in Supabase Edge Function environment',
        mockUrl: `${redirectUri}&connected=true&email=demo@gmail.com`,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events');
    const state = encodeURIComponent(JSON.stringify({ userId, redirectUri }));

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;

    return new Response(JSON.stringify({ url: googleAuthUrl }), {
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
