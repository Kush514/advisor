import { HealthResponse } from '@vmone/shared';
import { getSupabaseClient } from './lib/supabase';
import { syncYouTubeVideos } from './services/youtube';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  YOUTUBE_API_KEY: string;
  ADMIN_SYNC_SECRET: string;
  YOUTUBE_SYNC_START_DATE?: string;
  YOUTUBE_SYNC_END_DATE?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Minimal CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const response: HealthResponse = {
        status: 'ok',
        message: 'VM One API is running'
      };
      
      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    if (url.pathname === '/api/health/db' && request.method === 'GET') {
      try {
        const supabase = getSupabaseClient(env);
        // Simple ping to the database (e.g. check if we can query any table or just get an empty response)
        // Since we might not have records yet, we'll just do a limit 0 query to see if it responds.
        const { error } = await supabase.from('categories').select('id').limit(0);
        
        if (error) {
          console.error('Supabase health check error:', error);
          return new Response(JSON.stringify({ ok: false, error: 'Database connection failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        console.error('Supabase health check exception:', err);
        return new Response(JSON.stringify({ ok: false, error: 'Configuration error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/youtube/sync' && request.method === 'POST') {
      // Internal protection check
      const authHeader = request.headers.get('Authorization');
      if (!env.ADMIN_SYNC_SECRET || authHeader !== `Bearer ${env.ADMIN_SYNC_SECRET}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      try {
        const supabase = getSupabaseClient(env);
        const result = await syncYouTubeVideos(
          env.YOUTUBE_API_KEY,
          supabase,
          env.YOUTUBE_SYNC_START_DATE,
          env.YOUTUBE_SYNC_END_DATE
        );
        
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err: any) {
        console.error('YouTube sync exception:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  },
};
