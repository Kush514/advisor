import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('apps/api/.dev.vars') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const AMAZON_CLIENT_ID = process.env.AMAZON_CREATORS_CLIENT_ID || '';
const AMAZON_CLIENT_SECRET = process.env.AMAZON_CREATORS_CLIENT_SECRET || '';
const AMAZON_PARTNER_TAG = process.env.AMAZON_CREATORS_PARTNER_TAG || 'vmone-21';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function extractASIN(text: string): string | null {
  if (!text) return null;
  const asinMatch = text.match(/(?:dp|o|gp|-)\/([A-Z0-9]{10})(?:[/?]|$)/i) || 
                    text.match(/\b([A-Z0-9]{10})\b/i);
  if (asinMatch && asinMatch[1].length === 10 && asinMatch[1].toUpperCase().startsWith('B0')) {
    return asinMatch[1].toUpperCase();
  }
  return null;
}

async function getAmazonAccessToken() {
  const tokenUrl = 'https://api.amazon.co.uk/auth/o2/token';
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: AMAZON_CLIENT_ID,
      client_secret: AMAZON_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    })
  });
  if (!response.ok) throw new Error('Auth Error');
  const data = await response.json();
  return data.access_token;
}

async function fetchLivePrice(accessToken: string, asin: string) {
  const apiUrl = 'https://creatorsapi.amazon/catalog/v1/searchItems';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-marketplace': 'www.amazon.in'
    },
    body: JSON.stringify({
      keywords: asin,
      partnerTag: AMAZON_PARTNER_TAG,
      marketplace: 'www.amazon.in',
      resources: ["offersV2.listings.price"]
    })
  });
  
  if (!response.ok) return null;
  const data = await response.json();
  const item = data.searchResult?.items?.[0] || data.items?.[0];
  if (!item) return null;
  return item.offersV2?.listings?.[0]?.price?.money?.amount || item.offers?.listings?.[0]?.price?.money?.amount || null;
}

async function run() {
  console.log('Fetching active products...');
  let products: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, model, product_links(*)')
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

  console.log(`Found ${products.length} products. Authenticating with Amazon...`);
  const token = await getAmazonAccessToken();
  console.log('✅ Successfully authenticated!');

  let successCount = 0;
  
  // Process in chunks to not overwhelm Amazon
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    let asin = null;
    const existingLink = Array.isArray(product.product_links) ? product.product_links[0] : product.product_links;
    // Prefer the stored ASIN: amazon_url may be a VM One short link (amzn.to) with no ASIN in it
    asin = existingLink?.asin || (existingLink?.amazon_url ? extractASIN(existingLink.amazon_url) : null);
    if (!asin) asin = extractASIN(product.name || '');
    if (!asin) asin = extractASIN(product.model || '');

    let searchQuery = asin;
    
    // If we have no Amazon ASIN (e.g. it's a Flipkart or Brand product), use Step 2 Logic (Universal Lookup)
    if (!searchQuery) {
      const brandStr = product.brand || '';
      const modelStr = product.model || '';
      const fallbackKeyword = `${brandStr} ${modelStr}`.trim();
      
      if (fallbackKeyword.length > 2) {
        searchQuery = fallbackKeyword;
      }
    }

    if (!searchQuery) {
      console.log(`[${i+1}/${products.length}] ⏭️ Skipping ${product.name} (No ASIN, Brand, or Model to search)`);
      continue;
    }

    try {
      // Small delay to respect Amazon rate limits
      await new Promise(r => setTimeout(r, 300));
      
      const price = await fetchLivePrice(token, searchQuery);
      if (price !== null) {
        await supabase.from('products').update({ price: price }).eq('id', product.id);
        
        if (asin) {
          console.log(`[${i+1}/${products.length}] 💰 Updated (ASIN): ${product.name?.substring(0, 30)}... -> ₹${price}`);
        } else {
          console.log(`[${i+1}/${products.length}] 🔍 Updated (Lookup): ${product.name?.substring(0, 30)}... -> ₹${price}`);
        }
        successCount++;
      } else {
        console.log(`[${i+1}/${products.length}] ❌ Out of Stock / No Price: ${product.name?.substring(0, 30)}...`);
      }
    } catch (e) {
      console.error(`[${i+1}/${products.length}] ⚠️ Error fetching price for ${asin}`);
    }
    
    // Tiny delay to respect Amazon rate limits
    await new Promise(r => setTimeout(r, 250));
  }
  
  console.log(`\n🎉 Successfully updated live prices for ${successCount} products!`);
}

run();
