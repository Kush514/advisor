import { HealthResponse } from '@vmone/shared';
import { getSupabaseClient } from './lib/supabase';
import { syncYouTubeVideos } from './services/youtube';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  YOUTUBE_API_KEY: string;
  ADMIN_SYNC_SECRET: string;
  GEMINI_API_KEY?: string;
  YOUTUBE_SYNC_START_DATE?: string;
  YOUTUBE_SYNC_END_DATE?: string;
  FRONTEND_URL?: string;
  // Amazon Creators API, for live prices on results
  AMAZON_CREATORS_CLIENT_ID?: string;
  AMAZON_CREATORS_CLIENT_SECRET?: string;
  AMAZON_CREATORS_PARTNER_TAG?: string;
  // The built website (see wrangler.jsonc "assets")
  ASSETS?: Fetcher;
}

// Questions kept in the database but not asked to users (e.g. brand preference)
const HIDDEN_QUESTION_KEYS = ['brand'];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The website is served by this same Worker (wrangler.jsonc "assets"). Existing files are
    // served before this code runs; any other non-API path (e.g. /ask) is a page of the React app.
    if (!url.pathname.startsWith('/api/') && env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      // Ask for "/" (not "/index.html", which Cloudflare answers with a redirect to "/", sending the
      // browser to the home page) so the browser stays on /ask and the React app shows that page
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    // Strict CORS headers
    const origin = request.headers.get('Origin') || '';
    // Use env.FRONTEND_URL if provided, else fallback to common local dev ports and standard production domain patterns
    const allowedOrigins = [
      'http://localhost:5173', 
      'http://127.0.0.1:5173',
      ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : [])
    ];
    
    // Allow any origin for the public API if needed, or strictly valid origins.
    // For production hardening, only allow known origins.
    const corsOrigin = allowedOrigins.includes(origin) ? origin : (env.FRONTEND_URL || allowedOrigins[0]);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
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
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
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

    if (url.pathname === '/api/admin/youtube/parse-links' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      try {
        const supabase = getSupabaseClient(env);
        const { processAllVideoDescriptions } = await import('./services/youtube-description-parser');
        const stats = await processAllVideoDescriptions(supabase);
        
        return new Response(JSON.stringify({ ok: true, ...stats }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err: any) {
        console.error('Parser exception:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/youtube/resolve-pdfs' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      try {
        const supabase = getSupabaseClient(env);
        const { resolvePdfCandidates } = await import('./services/pdf-resolver');
        
        // Parse limit from query string if available
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 20;

        const stats = await resolvePdfCandidates(supabase, limit);
        
        return new Response(JSON.stringify({ ok: true, ...stats }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err: any) {
        console.error('PDF Resolver exception:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/youtube/resolve-amazon-links' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      try {
        const supabase = getSupabaseClient(env);
        const { processAmazonLinks } = await import('./services/amazon-resolver');
        
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;

        const stats = await processAmazonLinks(supabase, limit);
        
        return new Response(JSON.stringify({ ok: true, ...stats }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err: any) {
        console.error('Amazon Resolver exception:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (url.pathname === '/api/admin/youtube/parse-pdf-links' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      try {
        const supabase = getSupabaseClient(env);
        const { parsePdfLinks } = await import('./services/pdf-link-parser');
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 10;
        const stats = await parsePdfLinks(supabase, limit);
        return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/admin/youtube/resolve-flipkart-links' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      try {
        const supabase = getSupabaseClient(env);
        const { processFlipkartLinks } = await import('./services/flipkart-resolver');
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const stats = await processFlipkartLinks(supabase, limit);
        return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/admin/products/generate' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      try {
        const supabase = getSupabaseClient(env);
        const { generateProducts } = await import('./services/product-generator');
        const dryRun = url.searchParams.get('dryRun') !== 'false'; // default to true for safety
        const result = await generateProducts(supabase, dryRun);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/admin/enrich-products' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      try {
        const supabase = getSupabaseClient(env);
        const { processPdfEnrichment } = await import('./services/gemini-enricher');
        const dryRun = url.searchParams.get('dryRun') !== 'false';
        const pdfId = url.searchParams.get('pdfId') || undefined;
        const result = await processPdfEnrichment(supabase, env, pdfId, dryRun);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/admin/validate-eligibility' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      const expectedToken = env.ADMIN_SYNC_SECRET?.trim();
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      try {
        const supabase = getSupabaseClient(env);
        const { validateAndMarkEligibility } = await import('./services/product-eligibility');
        const dryRun = url.searchParams.get('dryRun') !== 'false';
        const result = await validateAndMarkEligibility(supabase, dryRun);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/ask' && request.method === 'POST') {
      try {
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 1024 * 50) {
          return new Response(JSON.stringify({ ok: false, error: 'Payload too large' }), { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        if (!env.GEMINI_API_KEY) {
          throw new Error('GEMINI_API_KEY is not configured in environment variables');
        }

        const body = await request.json().catch(() => null) as any;
        if (!body) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        const { messages, requirements: currentRequirements } = body;
        
        if (!messages && (!body.answers || !body.category)) {
          return new Response(JSON.stringify({ ok: false, error: 'messages array OR (category and answers) is required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        let requirements = currentRequirements || {};
        let aiResult: any = { status: 'ready', message: 'Recommendations found' };

        if (body.answers && body.category) {
          if (typeof body.category !== 'string' || body.category.length > 100) {
             return new Response(JSON.stringify({ ok: false, error: 'Invalid category' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
          if (typeof body.answers !== 'object' || Array.isArray(body.answers)) {
             return new Response(JSON.stringify({ ok: false, error: 'Invalid answers format' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
          const answerKeys = Object.keys(body.answers);
          if (answerKeys.length === 0 || answerKeys.length > 20) {
             return new Response(JSON.stringify({ ok: false, error: 'Invalid answers payload length' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }

          const supabase = getSupabaseClient(env);
          
          // Rebuild the questions for these answers: this validates every answer against the options
          // that were really on offer, and tells us which answers are strict filters.
          const { buildFinderQuestions, SIZE_KEY, TYPE_KEY, ANY_VALUE } = await import('./services/finder-questions');
          const { parseSizeAnswer } = await import('./services/attributes');
          const finder = await buildFinderQuestions(supabase, body.category, body.answers, HIDDEN_QUESTION_KEYS);
          if (!finder) {
            return new Response(JSON.stringify({ ok: false, error: 'Category not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }

          if (finder.questions.some(q => q.questionKey === 'price') && !body.answers.price) {
            return new Response(JSON.stringify({ ok: false, error: 'Missing required answer: price' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }

          // Static Finder path (deterministic mapping)
          requirements = { category: body.category, features: [] };
          // Strict answers (budget, size, type) always apply, even if that combination has no products:
          // the honest result is then "no match", never a product of a different size.
          const answerOf = (key: string) => {
            const value = String(body.answers[key] ?? '').substring(0, 100);
            return value && value !== ANY_VALUE ? value : null;
          };
          const priceRange = (answerOf('price') || '').match(/^(\d+)\s*-\s*(\d+)$/);
          if (priceRange) requirements.budget = { kind: 'range', min: Number(priceRange[1]), max: Number(priceRange[2]) };
          const size = parseSizeAnswer(answerOf(SIZE_KEY));
          if (size) requirements.attributes = { ...requirements.attributes, size };
          const type = answerOf(TYPE_KEY);
          if (type && /^[a-z0-9-]+$/.test(type)) requirements.attributes = { ...requirements.attributes, type };

          // Preferences only count when they were really on offer for these answers
          for (const question of finder.questions) {
            const key = question.questionKey;
            if (key === 'price' || key === SIZE_KEY || key === TYPE_KEY) continue;
            const value = answerOf(key);
            if (!value || !(question.options || []).some(o => o.value === value)) continue;
            if (key.startsWith('pref-')) {
              requirements.preferences = [...(requirements.preferences || []), { key, value }];
            } else {
              requirements.features.push(value.replace(/_/g, ' '));
            }
          }
          // The static flow bypasses Gemini completely
          aiResult.requirements = requirements;
        } else {
          // Fallback to legacy chat path if answers not provided
          if (messages.length > 50) {
            return new Response(JSON.stringify({ ok: false, error: 'Conversation history exceeds maximum length' }), { status: 400, headers: corsHeaders });
          }
          const { processAskFlow } = await import('./services/ai-ask');
          aiResult = await processAskFlow(env.GEMINI_API_KEY, { messages, currentRequirements });
          requirements = aiResult.requirements;
        }

        let recommendedProducts = [] as any[];
        if (aiResult.status === 'ready') {
          const supabase = getSupabaseClient(env);
          const { getRecommendations } = await import('./services/recommendation-engine');
          
          try {
            recommendedProducts = await getRecommendations(supabase, requirements);
          } catch (dbErr: any) {
            // Distinct failure for DB/Recommendation Engine issues vs 0 results
            console.error('Recommendation Engine Error:', dbErr);
            throw new Error(`Internal Recommendation Engine Error`);
          }

          // Live Amazon price + stock for the products about to be shown; anything no longer buyable
          // or no longer within budget is dropped. Fresh prices are saved after the response is sent.
          if (recommendedProducts.length > 0) {
            const { applyLivePrices } = await import('./services/live-prices');
            const budget = requirements.budget?.kind === 'range' ? requirements.budget : undefined;
            const live = await applyLivePrices(env, supabase, recommendedProducts, budget);
            recommendedProducts = live.products;
            ctx.waitUntil(live.persist);
          }
          
          if (recommendedProducts.length === 0) {
            // Because small models like gemini-flash-lite often hallucinate success despite system notes,
            // we intercept zero-results deterministically to guarantee accuracy.
            return new Response(JSON.stringify({ 
              ok: true, 
              status: 'needs_information',
              message: "I couldn't find any eligible products matching those exact requirements right now. Would you like to adjust your budget or change any preferences?",
              requirements: aiResult.requirements,
              suggested_replies: ["Increase budget", "Remove constraints", "Change brand"],
              products: []
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
        
        const responseObj: any = {
          ...aiResult,
          ok: true,
          products: recommendedProducts
        };
        return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        console.error('API /ask Error:', err);
        return new Response(JSON.stringify({ ok: false, error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    if (url.pathname === '/api/recommendations' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        const requirements = body.requirements || {};
        
        const supabase = getSupabaseClient(env);
        const { getRecommendations } = await import('./services/recommendation-engine');
        
        const results = await getRecommendations(supabase, requirements);
        
        return new Response(JSON.stringify({ ok: true, results }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }


    if (url.pathname === '/api/categories' && request.method === 'GET') {
      try {
        const supabase = getSupabaseClient(env);
        const { data: categories, error } = await supabase
          .from('categories')
          .select('*')
          .order('name');
          
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, categories }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...corsHeaders } });
      } catch (err: any) {
        console.error('API /categories Error:', err);
        return new Response(JSON.stringify({ ok: false, error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    const questionsMatch = url.pathname.match(/^\/api\/categories\/([a-zA-Z0-9-]+)\/questions$/);
    if (questionsMatch && (request.method === 'GET' || request.method === 'POST')) {
      try {
        const slug = questionsMatch[1];
        const supabase = getSupabaseClient(env);

        // POST carries the answers given so far, so later questions only offer what still exists
        let answers: Record<string, unknown> = {};
        if (request.method === 'POST') {
          const body = await request.json().catch(() => null) as any;
          if (body?.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) && Object.keys(body.answers).length <= 20) {
            answers = body.answers;
          }
        }

        const { buildFinderQuestions } = await import('./services/finder-questions');
        const finder = await buildFinderQuestions(supabase, slug, answers, HIDDEN_QUESTION_KEYS);

        if (!finder) {
          return new Response(JSON.stringify({ ok: false, error: 'Category not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        if (finder.questions.length === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'No products are available in this category right now' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        return new Response(JSON.stringify({ ok: true, ...finder }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': request.method === 'GET' ? 'public, max-age=300' : 'no-store', ...corsHeaders }
        });
      } catch (err: any) {
        console.error('API /categories/questions Error:', err);
        return new Response(JSON.stringify({ ok: false, error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    const knownApiPaths = [
      '/api/ask',
      '/api/recommendations',
      '/api/categories',
      '/api/health'
    ];
    
    if (knownApiPaths.includes(url.pathname) || url.pathname.match(/^\/api\/categories\/([a-zA-Z0-9-]+)\/questions$/)) {
      return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  },
};
