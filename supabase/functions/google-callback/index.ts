import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceSupabaseClient } from '../_shared/supabaseClient.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { code, state, redirectUri } = await req.json();

    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing authorization code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
    const resolvedRedirectUri = redirectUri || Deno.env.get('GOOGLE_REDIRECT_URI') || 'http://localhost:5173/admin/settings?tab=calendar';

    let parsedState: any = {};
    try {
      if (state) parsedState = JSON.parse(decodeURIComponent(state));
    } catch (_) {
      // ignore
    }

    const userId = parsedState.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID missing in OAuth state' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Exchange code for tokens with Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: resolvedRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[Google Token Exchange Error]', tokenData);
      throw new Error(tokenData.error_description || 'Failed to exchange Google OAuth code');
    }

    // Fetch user info from Google (email)
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();
    const connectedEmail = googleUser.email || 'connected@gmail.com';

    const supabase = getServiceSupabaseClient();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Store in google_calendar_connections table
    await supabase.from('google_calendar_connections').upsert({
      user_id: userId,
      google_email: connectedEmail,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      calendar_id: 'primary',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return new Response(JSON.stringify({
      success: true,
      email: connectedEmail,
      calendarId: 'primary',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[google-callback Exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'OAuth callback failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
