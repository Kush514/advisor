import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runAudit() {
  const [
    { count: total },
    { count: withCat },
    { count: noCat },
    { count: withBrand },
    { count: withModel },
    { count: withDesc },
    { count: withSpecs },
    { count: linkedYt },
    { count: linkedPdf },
    { count: reviewed },
    { count: recommendable }
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('products').select('*', { count: 'exact', head: true }).not('category_id', 'is', null),
    supabase.from('products').select('*', { count: 'exact', head: true }).is('category_id', null),
    supabase.from('products').select('*', { count: 'exact', head: true }).not('brand', 'is', null).neq('brand', ''),
    supabase.from('products').select('*', { count: 'exact', head: true }).not('model', 'is', null).neq('model', ''),
    supabase.from('products').select('*', { count: 'exact', head: true }).not('description', 'is', null).neq('description', ''),
    // Products with specs: we count distinct product_ids in product_specs
    supabase.from('product_specs').select('product_id').then(res => ({ count: new Set((res.data || []).map(r => r.product_id)).size })),
    // Products linked to YT
    supabase.from('product_videos').select('product_id').then(res => ({ count: new Set((res.data || []).map(r => r.product_id)).size })),
    // Products linked to PDFs
    supabase.from('product_pdf_documents').select('product_id').then(res => ({ count: new Set((res.data || []).map(r => r.product_id)).size })),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('reviewed_by_vmone', true),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('recommendable', true)
  ]);

  console.log('--- DATABASE AUDIT ---');
  console.log(`Total products: ${total}`);
  console.log(`Products with category_id: ${withCat}`);
  console.log(`Products without category_id: ${noCat}`);
  console.log(`Products with brand: ${withBrand}`);
  console.log(`Products with model: ${withModel}`);
  console.log(`Products with description: ${withDesc}`);
  console.log(`Products with product_specs: ${withSpecs}`);
  console.log(`Products linked to YouTube: ${linkedYt}`);
  console.log(`Products linked to PDFs: ${linkedPdf}`);
  console.log(`Products reviewed_by_vmone: ${reviewed}`);
  console.log(`Products recommendable: ${recommendable}`);
}

runAudit();
