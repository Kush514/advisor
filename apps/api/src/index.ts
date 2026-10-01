import { HealthResponse } from '@vmone/shared';

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

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

export interface Env {
  // Bindings will go here
}
