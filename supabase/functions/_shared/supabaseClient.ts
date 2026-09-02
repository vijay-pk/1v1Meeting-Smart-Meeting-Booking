import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function getServiceSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing.');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
