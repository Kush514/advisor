// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function test() {
  const { data } = await supabase.from('pdf_documents').select('resolved_url, extracted_text').ilike('resolved_url', '%Soundbar%').single();
  const text = data.extracted_text;
  console.log('Total characters:', text.length);
  
  // Find amzn URLs
  const amznMatches = text.match(/(https?:\/\/)?(www\.)?(amzn\.to|amazon\.in)[^\s"'<>]+/gi) || [];
  console.log('amzn matches:', amznMatches.length);
  console.log('First 5 matches:', amznMatches.slice(0,5));

  // Find flipkart URLs
  const fkrtMatches = text.match(/(https?:\/\/)?(www\.)?(flipkart\.com|fkrt\.lt|fkrt\.it)[^\s"'<>]+/gi) || [];
  console.log('flipkart matches:', fkrtMatches.length);
  console.log('First 5 matches:', fkrtMatches.slice(0,5));
}
test();
