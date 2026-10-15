import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// --- Configuration ---
// Make sure you have these in a .env file or export them in your terminal
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Amazon Creator API Credentials
const AMAZON_CLIENT_ID = process.env.AMAZON_CREATORS_CLIENT_ID || '';
const AMAZON_CLIENT_SECRET = process.env.AMAZON_CREATORS_CLIENT_SECRET || '';
const AMAZON_VERSION = process.env.AMAZON_CREATORS_VERSION || '1.0';
const AMAZON_PARTNER_TAG = process.env.AMAZON_CREATORS_PARTNER_TAG || '';
const AMAZON_API_ENDPOINT = process.env.AMAZON_CREATORS_ENDPOINT || 'https://api.amazon.com/creator/v1/products';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// Pause between products to stay inside the Gemini rate limit (override with GEMINI_DELAY_MS)
const GEMINI_DELAY_MS = Number(process.env.GEMINI_DELAY_MS || 4500);

// Extract ASIN from standard Amazon URL
function extractASIN(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:\/dp\/|\/product\/|\/asin\/|ASIN=)([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

// --- Authentication: Get OAuth2 Token ---
// --- Authentication: Get OAuth2 Token ---
async function getAmazonAccessToken() {
  console.log('Authenticating with Amazon...');
  
  // Clean up endpoint URL in case it's missing https://
  let baseUrl = AMAZON_API_ENDPOINT || 'api.amazon.co.uk/auth/o2/token';
  if (!baseUrl.startsWith('http')) {
    baseUrl = `https://${baseUrl}`;
  }
  // The token endpoint is usually .../auth/o2/token
  const tokenUrl = baseUrl.includes('/auth/o2/token') ? baseUrl : `https://api.amazon.co.uk/auth/o2/token`;
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: AMAZON_CLIENT_ID,
      client_secret: AMAZON_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Auth Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.access_token;
}

// --- Fetch Product Data ---
async function fetchFromAmazonAPI(accessToken: string, asin: string, brandStr: string, modelStr: string) {
  // With an ASIN we fetch that exact item (GetItems). A keyword search can return a different
  // product as its first result, so it is only used when there is no ASIN at all.
  const apiUrl = `https://creatorsapi.amazon/catalog/v1/${asin ? 'getItems' : 'searchItems'}`;
  const lookup = asin ? { itemIds: [asin], itemIdType: 'ASIN' } : { keywords: `${brandStr} ${modelStr}` };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-marketplace': 'www.amazon.in'
    },
    body: JSON.stringify({
      ...lookup,
      partnerTag: AMAZON_PARTNER_TAG,
      marketplace: 'www.amazon.in',
      resources: [
        "itemInfo.title",
        "itemInfo.features",
        "itemInfo.byLineInfo",
        "offersV2.listings.price"
      ]
    })
  });

  if (response.status === 401) {
    throw new Error('TOKEN_EXPIRED');
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Amazon API Error details:`, errText);
    throw new Error(`API Error: ${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  
  const item = data.itemsResult?.items?.[0] || data.searchResult?.items?.[0] || data.items?.[0];
  if (!item) return null;

  return {
    title: item.itemInfo?.title?.displayValue || '',
    price: item.offersV2?.listings?.[0]?.price?.money?.amount ?? null,
    affiliateUrl: item.detailPageURL || '',
    brand: item.itemInfo?.byLineInfo?.brand?.displayValue || '',
    features: item.itemInfo?.features?.displayValues || []
  };
}

// Use Gemini to clean the messy Amazon data into strict Category-Specific Specs
async function cleanDataWithLLM(categorySlug: string, messyTitle: string, messyFeatures: string[], categoryChoices: string[] = []) {
  const prompt = `
  You are an expert appliance data cleaner.
  Category: ${categorySlug}${categoryChoices.length ? `
  The category is not known yet. Choose it from this list of slugs: ${categoryChoices.join(', ')}.
  Return it as 'categorySlug'. If the product is NOT one of these appliances (an accessory, cover, stand, stabilizer, cable, remote, power bank, phone, hair dryer, or anything else), return "categorySlug": null. Never force a product into the closest category.` : ''}
  Amazon Title: ${messyTitle}
  Amazon Features: ${JSON.stringify(messyFeatures)}

  Extract a short, clean 'ProductName'.
  Extract the manufacturer's model number as 'model' (e.g. "WA70BG4441YYTL"), or null if the title does not contain one.
  Extract the key specs based on the category (e.g., if AC, extract Ton and Star Rating; if TV, Screen Size; if Fridge, Capacity; etc.).
  Ensure the specs are standardized (e.g., "1.5 Ton", "55 Inch").
  
  Return strictly valid JSON in this format:
  {
    "productName": "Clean Name",
    "categorySlug": "only when asked to choose the category",
    "model": "MODEL123",
    "specs": {
      "Ton": "1.5 Ton",
      "Star Rating": "5 Star"
    }
  }
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-lite-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    }
  });

  if (!response.text) return null;
  return JSON.parse(response.text);
}

async function run() {
  const { data: categoryRows } = await supabase.from('categories').select('id, slug');
  const categoryIdBySlug = new Map((categoryRows || []).map(c => [c.slug, c.id]));

  console.log('Fetching active products from Supabase...');
  
  let products: any[] = [];
  let pStart = 0;
  let pHasMore = true;

  while (pHasMore) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, name, brand, model, status, recommendable,
        categories (slug),
        product_links (id, amazon_url, asin, amazon_link_source)
      `)
      .eq('status', 'active')
      .range(pStart, pStart + 999);

    if (error) {
      console.error('Failed to fetch products:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      pHasMore = false;
    } else {
      products = [...products, ...data];
      pStart += 1000;
    }
  }

  console.log(`Found ${products.length} products. Checking for existing specs...`);
  
  // Handle Supabase 1000 row limit by paginating
  let allSpecs: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from('product_specs')
      .select('product_id, spec_key')
      .range(start, start + 999);
      
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allSpecs = [...allSpecs, ...data];
      start += 1000;
    }
  }
  
  // A product only counts as synced once it has real specs. The product generator adds a lone
  // 'model' spec, which used to make these products look finished and left their names uncleaned.
  const finishedProductIds = new Set(allSpecs.filter(s => s.spec_key !== 'model').map(s => s.product_id));
  
  const productsToSync = products.filter(p => !finishedProductIds.has(p.id));
  console.log(`Skipping ${finishedProductIds.size} already synced products.`);
  console.log(`Resuming sync for the remaining ${productsToSync.length} products...`);

  try {
    let accessToken = await getAmazonAccessToken();
    console.log('✅ Successfully authenticated with Amazon!');

    for (const product of productsToSync) {
      try {
        console.log(`\nProcessing: ${product.name || product.model} (${product.id})`);
        
        const pLinks = Array.isArray(product.product_links) ? product.product_links[0] : product.product_links;
        const rawUrl = pLinks?.amazon_url || '';
        // VM One's original short links (amzn.to/...) carry no ASIN, so prefer the stored one
        const asin = pLinks?.asin || extractASIN(rawUrl);
        
        console.log(`Extracted ASIN: ${asin || 'None - Falling back to Keyword Search'}`);

        // 1. Fetch from Amazon Creator API
        let amazonData;
        try {
          amazonData = await fetchFromAmazonAPI(accessToken, asin || '', product.brand || '', product.model || '');
        } catch (e: any) {
          if (e.message === 'TOKEN_EXPIRED') {
             console.log('🔄 Amazon Token expired! Fetching a new one...');
             accessToken = await getAmazonAccessToken();
             amazonData = await fetchFromAmazonAPI(accessToken, asin || '', product.brand || '', product.model || '');
          } else {
             throw e;
          }
        }
      
      if (!amazonData) {
        console.log(`❌ No data found on Amazon for this product.`);
        continue;
      }

      console.log(`✅ Amazon Data Retrieved. Live Price: ${amazonData.price}`);

      // 2. Clean data with Gemini
      const categorySlug = Array.isArray(product.categories) ? product.categories[0]?.slug : product.categories?.slug;
      
      console.log('Cleaning messy Amazon data with Gemini...');
      const cleanData = await cleanDataWithLLM(categorySlug || 'unknown', amazonData.title, amazonData.features, categorySlug ? [] : [...categoryIdBySlug.keys()]);
      
      if (!cleanData) {
        console.log('❌ LLM cleaning failed.');
        continue;
      }

      console.log(`✅ Cleaned Name: ${cleanData.productName}${!categorySlug ? ` | category: ${cleanData.categorySlug ?? 'none'}` : ''}`);
      console.log(`✅ Extracted Specs:`, cleanData.specs);

      // 3. Update the Product (Name, Brand, Price)
      // Note: Assuming you have a 'price' column. If not, you might need to add it to your schema.
      const { error: pErr } = await supabase
        .from('products')
        .update({
          name: cleanData.productName,
          brand: amazonData.brand || product.brand,
          ...(cleanData.model ? { model: String(cleanData.model) } : {}),
          // Category chosen from the real Amazon title; unknown / not-an-appliance stays uncategorized (hidden)
          ...(!categorySlug && categoryIdBySlug.has(cleanData.categorySlug) ? { category_id: categoryIdBySlug.get(cleanData.categorySlug) } : {}),
          ...(amazonData.price != null ? { price: amazonData.price } : {})
        })
        .eq('id', product.id);

      if (pErr) throw pErr;

      // 4. Update the Affiliate Link
      // Never replace VM One's own working affiliate link (see apply-original-links.ts)
      if (pLinks?.id && amazonData.affiliateUrl && pLinks.amazon_link_source !== 'vmone_original') {
        const { error: lErr } = await supabase
          .from('product_links')
          .update({ amazon_url: amazonData.affiliateUrl })
          .eq('id', pLinks.id);
        if (lErr) throw lErr;
      }

      // 5. Overwrite the Product Specs
      // First, delete old specs
      await supabase.from('product_specs').delete().eq('product_id', product.id);
      
      // Then insert new standardized specs
      const specInserts = Object.entries(cleanData.specs).map(([key, value]) => ({
        product_id: product.id,
        spec_key: key,
        spec_value: String(value),
        spec_unit: null // You can adjust LLM to separate unit if needed
      }));

      if (specInserts.length > 0) {
        const { error: sErr } = await supabase.from('product_specs').insert(specInserts);
        if (sErr) throw sErr;
      }

      console.log(`🎉 Successfully synced and updated!`);
      
      // Sleep 12.5 seconds to prevent hitting Gemini's 5 Requests Per Minute limit
      await new Promise(r => setTimeout(r, GEMINI_DELAY_MS));

    } catch (err: any) {
      console.error(`❌ Error processing ${product.id}:`, err.message);
      // Even on error, sleep so we don't spam and get completely blocked
      await new Promise(r => setTimeout(r, /429|RESOURCE_EXHAUSTED|quota/i.test(err.message || '') ? 30000 : GEMINI_DELAY_MS));
    }
  }
  } catch (authErr: any) {
    console.error('❌ Failed to authenticate with Amazon:', authErr.message);
  }
}

run();
