// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { processPdfEnrichment } from '../services/gemini-enricher.js';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runDirect() {
  console.log("Direct Node Enrichment (Bypassing Miniflare 30s limit)");
  
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY!
  };
  
  const { data: pdfs } = await supabase.from('pdf_documents').select('id, resolved_url').not('extracted_text', 'is', null);
  
  if (pdfs) {
    for (const pdf of pdfs) {
      console.log('Processing:', pdf.resolved_url);
      try {
        const result = await processPdfEnrichment(supabase, env, pdf.id, false); // false = LIVE RUN
        console.log('Finished:', result.stats);
      } catch (e) {
        console.error('Error:', e);
      }
    }
  }
}

runDirect();
