import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runCleanup() {
  console.log('Fetching all products...');
  
  let products: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase.from('products').select('*').range(start, start + 999);
    if (!data || data.length === 0) hasMore = false;
    else { products = [...products, ...data]; start += 1000; }
  }
  
  // Group by Name + Model
  const groups = new Map<string, any[]>();
  for (const p of products) {
    const key = `${p.name || ''}-${p.model || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  
  let deletedCount = 0;
  let movedSpecsCount = 0;
  
  for (const [key, list] of groups.entries()) {
    if (list.length > 1) {
      // Sort by created_at (oldest is the true original)
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      const keep = list[0];
      const clones = list.slice(1);
      
      for (const clone of clones) {
        // Move any specs attached to the clone over to the original
        const { data: specs } = await supabase.from('product_specs').select('id').eq('product_id', clone.id);
        if (specs && specs.length > 0) {
          await supabase.from('product_specs').update({ product_id: keep.id }).eq('product_id', clone.id);
          movedSpecsCount++;
        }
        
        // Ensure amazon_products points to the original
        await supabase.from('amazon_products').update({ product_id: keep.id }).eq('product_id', clone.id);
        await supabase.from('flipkart_products').update({ product_id: keep.id }).eq('product_id', clone.id);
        
        // Safely delete the clone
        await supabase.from('products').delete().eq('id', clone.id);
        deletedCount++;
      }
    }
  }
  
  console.log(`\n✅ CLEANUP COMPLETE`);
  console.log(`Original Unique Products preserved: ${groups.size}`);
  console.log(`Ghost Clones deleted: ${deletedCount}`);
  console.log(`Product Specs safely moved to originals: ${movedSpecsCount}`);
}

runCleanup();
