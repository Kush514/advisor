import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Global cache for the Supabase client in the worker context
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }): SupabaseClient {
  if (!supabaseClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase environment variables are missing');
    }
    
    // We use the service role key to bypass RLS since this is a secure backend worker
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return supabaseClient;
}
