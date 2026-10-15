import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PARTNER_TAG = 'vmone-21';

// Same auth logic
async function getAmazonAccessToken() {
  const response = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.AMAZON_CREATORS_CLIENT_ID,
      client_secret: process.env.AMAZON_CREATORS_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    })
  });
  const data = await response.json();
  if (data.access_token) return data.access_token;
  throw new Error('Failed to get token: ' + JSON.stringify(data));
}

// 1. Try getItems bypass
async function fetchWithGetItems(accessToken: string, asin: string) {
  const response = await fetch('https://creatorsapi.amazon.com/catalog/v1/getItems', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'x-marketplace': 'www.amazon.in'
    },
    body: JSON.stringify({
      itemIds: [asin],
      partnerTag: PARTNER_TAG,
      marketplace: 'www.amazon.in',
      resources: ["itemInfo.title", "itemInfo.features"]
    })
  });
  
  if (response.status === 401) throw new Error('TOKEN_EXPIRED');
  if (!response.ok) return null;
  const data = await response.json();
  return data.items?.[0] || null;
}

// 2. Gemini fallback
async function generateSpecsWithGemini(categorySlug: string, productName: string, brand: string) {
  const prompt = "You are an expert appliance advisor for the Indian market. I have a product named: " + brand + " " + productName + ". Please generate a realistic, structured JSON object containing its technical specifications. Do not include markdown blocks, just return pure JSON.";
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    return JSON.parse(res.text || '{}');
  } catch(e) {
    console.error('Gemini Error:', e);
    return null;
  }
}

async function run() {
  console.log('Finding products that failed the first sync...');
  const { data: products } = await supabase.from('products').select('id, name, brand, model, categories(slug), product_links(amazon_url)').eq('status', 'active');
  
  let allSpecs = [];
  let start = 0, hasMore = true;
  while(hasMore) {
    const { data } = await supabase.from('product_specs').select('product_id').range(start, start+999);
    if (!data || data.length === 0) hasMore = false;
    else { allSpecs.push(...data); start += 1000; }
  }
  const finishedIds = new Set(allSpecs.map(s => s.product_id));
  
  const missingProducts = products?.filter(p => !finishedIds.has(p.id)) || [];
  console.log('Found ' + missingProducts.length + ' missing products. Starting Bypass Sync...');
  
  let token = await getAmazonAccessToken();
  
  for (const product of missingProducts) {
    console.log('\nRescue: ' + product.name);
    
    // Extract ASIN
    const rawUrl = Array.isArray(product.product_links) ? product.product_links[0]?.amazon_url : product.product_links?.amazon_url;
    let asin = rawUrl ? rawUrl.match(/dp\/([A-Z0-9]{10})/) : null;
    asin = asin ? asin[1] : null;

    let specs = null;
    
    // Attempt 1: getItems
    if (asin) {
      try {
        const itemData = await fetchWithGetItems(token, asin);
        if (itemData) {
          console.log('? Found data using getItems bypass!');
          // Send to Gemini for cleaning
          specs = await generateSpecsWithGemini('unknown', itemData.itemInfo?.title?.displayValue, product.brand);
        }
      } catch (e: any) {
         if (e.message === 'TOKEN_EXPIRED') {
            token = await getAmazonAccessToken();
            // Retry
            const itemData = await fetchWithGetItems(token, asin);
            if (itemData) specs = await generateSpecsWithGemini('unknown', itemData.itemInfo?.title?.displayValue, product.brand);
         }
      }
    }
    
    // Attempt 2: Full Gemini Generation
    if (!specs) {
       console.log('? getItems failed. Using Gemini internal knowledge...');
       specs = await generateSpecsWithGemini('unknown', product.name, product.brand);
    }
    
    if (specs) {
       const specInserts = Object.entries(specs).map(([key, value]) => ({
          product_id: product.id,
          spec_key: key,
          spec_value: String(value)
        }));
        await supabase.from('product_specs').delete().eq('product_id', product.id);
        await supabase.from('product_specs').insert(specInserts);
        console.log('?? Successfully saved rescued specs!');
    }
    
    // Sleep to avoid ratelimits
    await new Promise(r => setTimeout(r, 6000));
  }
}

run();
