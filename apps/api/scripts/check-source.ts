import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  console.log('Fetching all products with specs...');
  // Get all products with specs
  let allSpecs: any[] = [];
  let sStart = 0, sHasMore = true;
  while(sHasMore) {
    const { data } = await supabase.from('product_specs').select('product_id').range(sStart, sStart+999);
    if(!data || data.length === 0) sHasMore = false; else { allSpecs = [...allSpecs, ...data]; sStart+=1000; }
  }
  const completedIds = Array.from(new Set(allSpecs.map(s => s.product_id)));
  console.log('Total Completed (with specs):', completedIds.length);
  
  // Check Amazon mapping
  let amazonProducts: any[] = [];
  let aStart = 0, aHasMore = true;
  while(aHasMore) {
    const { data } = await supabase.from('amazon_products').select('product_id').not('product_id', 'is', null).range(aStart, aStart+999);
    if(!data || data.length === 0) aHasMore = false; else { amazonProducts = [...amazonProducts, ...data]; aStart+=1000; }
  }
  const amzSet = new Set(amazonProducts.map(a => a.product_id));
  
  // Check Flipkart mapping
  let flipkartProducts: any[] = [];
  let fStart = 0, fHasMore = true;
  while(fHasMore) {
    const { data } = await supabase.from('flipkart_products').select('product_id').not('product_id', 'is', null).range(fStart, fStart+999);
    if(!data || data.length === 0) fHasMore = false; else { flipkartProducts = [...flipkartProducts, ...data]; fStart+=1000; }
  }
  const flpSet = new Set(flipkartProducts.map(f => f.product_id));
  
  let amazonCount = 0;
  let flipkartCount = 0;
  let otherCount = 0;
  
  for (const id of completedIds) {
    if (amzSet.has(id)) amazonCount++;
    else if (flpSet.has(id)) flipkartCount++;
    else otherCount++;
  }
  
  console.log('--- COMPLETED PRODUCTS BY SOURCE ---');
  console.log('Amazon:', amazonCount);
  console.log('Flipkart:', flipkartCount);
  console.log('Brand/Other:', otherCount);
  
  // Now let's count TOTAL ACTIVE products
  let allProducts: any[] = [];
  let pStart = 0, pHasMore = true;
  while(pHasMore) {
    const { data } = await supabase.from('products').select('id, status').range(pStart, pStart+999);
    if(!data || data.length === 0) pHasMore = false; else { allProducts = [...allProducts, ...data]; pStart+=1000; }
  }
  
  const activeProducts = allProducts.filter(p => p.status === 'active');
  const inactiveProducts = allProducts.filter(p => p.status !== 'active');
  
  console.log('--- DATABASE HEALTH ---');
  console.log('Total Active Products:', activeProducts.length);
  console.log('Total Inactive Products:', inactiveProducts.length);
  console.log('Genuinely Remaining to Sync:', activeProducts.length - completedIds.length);
}

check();
