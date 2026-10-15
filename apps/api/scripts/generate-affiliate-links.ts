import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('apps/api/.dev.vars') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const PARTNER_TAG = 'vmone-21';

// Same ASIN extractor we used in the sync script
function extractASIN(text: string): string | null {
  if (!text) return null;
  const asinMatch = text.match(/(?:dp|o|gp|-)\/([A-Z0-9]{10})(?:[/?]|$)/i) || 
                    text.match(/\b([A-Z0-9]{10})\b/i);
  
  if (asinMatch && asinMatch[1].length === 10 && asinMatch[1].toUpperCase().startsWith('B0')) {
    return asinMatch[1].toUpperCase();
  }
  return null;
}

// The asin / amazon_link_source columns only exist after migration 0006
let hasLinkCols = false;
const linkMeta = (link: any, asin: string) => (link && 'asin' in link ? { asin, amazon_link_source: 'generated' } : {});

async function run() {
  hasLinkCols = !(await supabase.from('product_links').select('asin').limit(1)).error;
  console.log('Fetching all active products...');
  let products: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, brand, model, description, product_links(*)')
      .eq('status', 'active')
      .range(start, start + 999);

    if (error) {
      console.error('Failed to fetch products:', error);
      return;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      products = [...products, ...data];
      start += 1000;
    }
  }

  console.log('Found ' + products.length + ' products. Generating affiliate links...');
  
  let successCount = 0;
  let missingAsinCount = 0;

  for (const product of products) {
    // 1. Try to find the ASIN
    let asin = null;
    
    // First check existing link
    const existingLink = Array.isArray(product.product_links) ? product.product_links[0] : product.product_links;

    // Never replace VM One's own working affiliate link (see apply-original-links.ts)
    if (existingLink?.amazon_link_source === 'vmone_original') continue;

    asin = existingLink?.asin || null;
    if (!asin && existingLink?.amazon_url) {
      asin = extractASIN(existingLink.amazon_url);
    }
    
    // If not found in link, check name, model, or description
    if (!asin) asin = extractASIN(product.name || '');
    if (!asin) asin = extractASIN(product.model || '');
    if (!asin) asin = extractASIN(product.description || '');

    if (!asin) {
      console.log('⚠️ No ASIN found for: ' + product.name + ' (' + product.id + ')');
      missingAsinCount++;
      continue;
    }

    // 2. Generate the perfect affiliate link
    const affiliateUrl = 'https://www.amazon.in/dp/' + asin + '?tag=' + PARTNER_TAG;

    // 3. Save it to the database
    if (existingLink && existingLink.id) {
      // Update existing link
      const { error: updateErr } = await supabase
        .from('product_links')
        .update({ amazon_url: affiliateUrl, ...linkMeta(existingLink, asin) })
        .eq('id', existingLink.id);
        
      if (updateErr) console.error('Error updating ' + product.id + ':', updateErr);
      else successCount++;
    } else {
      // Insert new link
      const { error: insertErr } = await supabase
        .from('product_links')
        .insert({ product_id: product.id, amazon_url: affiliateUrl, ...(hasLinkCols ? { asin, amazon_link_source: 'generated' } : {}) });
        
      if (insertErr) console.error('Error inserting ' + product.id + ':', insertErr);
      else successCount++;
    }
  }

  console.log('\n--- Affiliate Link Injection Complete ---');
  console.log('✅ Successfully injected vmone-21 tag into ' + successCount + ' products!');
  console.log('⚠️ Could not find an ASIN for ' + missingAsinCount + ' products.');
}

run();
