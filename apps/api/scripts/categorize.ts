import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  console.log('Fetching all categories from the database...');
  const { data: categories, error: catError } = await supabase.from('categories').select('id, name, slug');
  
  if (catError || !categories) {
    console.error('Failed to fetch categories:', catError);
    return;
  }

  console.log('Found ' + categories.length + ' categories.');
  const categoryListString = categories.map(c => 'ID: ' + c.id + ' | Name: ' + c.name).join('\n');

  console.log('Fetching all uncategorized products...');
  let products: any[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, brand, model, category_id')
      .eq('status', 'active')
      .is('category_id', null)
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

  console.log('Found ' + products.length + ' products. Starting Smart AI Categorization...');
  
  let successCount = 0;

  for (const product of products) {
    const productName = `${product.brand || ''} ${product.name || ''}`.trim();
    
    if (!productName || productName === 'null null' || productName === 'null') {
      console.log('\n⏭️ Skipping perfectly blank product (No Name or Brand)');
      continue;
    }

    console.log('\nAnalyzing: ' + productName);

    const prompt = "You are an expert appliance sorter. I have a product named: '" + productName + "' (Model: " + product.model + ").\n\nHere is the exact list of available categories in my database:\n" + categoryListString + "\n\nWhich category does this product belong to? Reply with a raw JSON object containing ONLY the exact ID of the matching category. Example: {\"category_id\": \"123e4567-e89b-12d3-a456-426614174000\"}\n\nIf the product is NOT one of these appliances (for example an accessory, cover, stand, voltage stabilizer, cable, remote, power bank, phone, hair dryer, or any other kind of product), reply {\"category_id\": null}. Do not force a product into the closest category.";

    try {
      const res = await ai.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      
      const responseText = res.text || '{}';
      const parsed = JSON.parse(responseText);
      
      // Only accept an ID that really exists; anything else leaves the product uncategorized (and hidden)
      if (parsed.category_id && categories.some(c => c.id === parsed.category_id)) {
        const { error: updateError } = await supabase
          .from('products')
          .update({ category_id: parsed.category_id })
          .eq('id', product.id);
          
        if (updateError) {
          console.error('❌ Error updating database:', updateError);
        } else {
          const catName = categories.find(c => c.id === parsed.category_id)?.name;
          console.log('✅ Placed in: ' + catName);
          successCount++;
        }
      } else {
        console.log('⚠️ AI could not determine the category.');
      }
    } catch (e) {
      console.error('❌ Gemini Error:', e);
    }
    
    // Wait 5 seconds between requests to avoid the 15 RPM rate limit
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n🎉 Categorization Complete! Successfully organized ' + successCount + ' products.');
}

run();
