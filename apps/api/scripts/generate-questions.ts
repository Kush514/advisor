import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function generateQuestionsForCategory(category: { id: string, name: string }) {
  console.log(`\nProcessing Category: ${category.name}`);

  // 1. Get all active products & their prices
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, price')
    .eq('category_id', category.id)
    .eq('status', 'active')
    .eq('recommendable', true); // only products users can actually be shown

  if (pErr || !products || products.length === 0) {
    console.log(`No recommendable products found for ${category.name}. Skipping.`);
    return;
  }

  const productIds = products.map(p => p.id);
  
  // Calculate sensible price ranges for this category
  const prices = products.map(p => p.price).filter(p => p !== null && p > 0);
  let priceContext = "No prices available.";
  if (prices.length > 0) {
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    priceContext = `The cheapest product is ₹${minPrice} and the most expensive is ₹${maxPrice}.`;
  }

  // 2. Get all specs for these products
  const { data: specs, error: sErr } = await supabase
    .from('product_specs')
    .select('spec_key, spec_value')
    .in('product_id', productIds);

  let cleanSpecMap: Record<string, string[]> = {};
  if (!sErr && specs && specs.length > 0) {
    const specMap: Record<string, Set<string>> = {};
    for (const spec of specs) {
      if (!specMap[spec.spec_key]) specMap[spec.spec_key] = new Set();
      specMap[spec.spec_key].add(spec.spec_value);
    }
    for (const [key, valueSet] of Object.entries(specMap)) {
      // Brand is never asked; model/ASIN-like keys are not useful filters
      if (valueSet.size > 1 && !/brand|model|asin|warranty|colou?r/i.test(key)) {
        cleanSpecMap[key] = Array.from(valueSet);
      }
    }
  }

  console.log(`Found ${Object.keys(cleanSpecMap).length} filterable specs & price data. Generating questions...`);

  // 4. Ask Gemini to generate the 5 most important questions
  const prompt = `
You are an expert e-commerce product manager.
I have a category called "${category.name}".

Here is the PRICE DATA for this category:
${priceContext}

Here are the AVAILABLE SPECIFICATIONS and their EXACT distinct values:
${JSON.stringify(cleanSpecMap, null, 2)}

Your task is to generate EXACTLY 4 to 5 questions to help a customer filter down products.

CRITICAL RULES:
1. You MUST generate one question for "price" (e.g., "What is your budget?"). 
   - The question_key MUST be exactly "price".
   - The options 'value' MUST be formatted as "MIN-MAX" with no commas or symbols (e.g. "0-10000", "10000-30000", "30000-9999999").
   - Make the buckets sensible based on the Price Data provided above.
   - The 'label' can be friendly (e.g., "Under ₹10,000", "₹10k to ₹30k").

2. Pick the 3-4 most important specifications from the JSON above for the other questions.
   - Choose specs a normal shopper understands and cares about (size, capacity, type, star rating).
   - NEVER ask about brand, model number, colour or warranty.
   - Give each question 2 to 5 options.
   - The question_key MUST exactly match the JSON key.
   - The options 'value' MUST exactly match one of the string values in the JSON array.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question_key: { type: Type.STRING, description: "The exact spec_key (or 'price')." },
              question_text: { type: Type.STRING, description: "The friendly question." },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING, description: "Display label." },
                    value: { type: Type.STRING, description: "Exact match string or MIN-MAX for price." }
                  },
                  required: ["label", "value"]
                }
              }
            },
            required: ["question_key", "question_text", "options"]
          }
        }
      }
    });

    if (!response.text) throw new Error("Empty response from Gemini");

    const questionsJSON = JSON.parse(response.text);

    // 5. Delete existing questions for this category
    await supabase.from('question_templates').delete().eq('category_id', category.id);

    // 6. Insert new questions
    const inserts = questionsJSON.map((q: any, index: number) => ({
      category_id: category.id,
      question_key: q.question_key,
      question_text: q.question_text,
      question_type: 'single_select',
      options: q.options,
      required: true,
      display_order: index + 1
    }));

    const { error: insertErr } = await supabase.from('question_templates').insert(inserts);
    
    if (insertErr) {
      console.error(`Failed to insert questions for ${category.name}:`, insertErr);
    } else {
      console.log(`✅ Successfully generated and saved ${questionsJSON.length} questions for ${category.name}`);
    }

  } catch (error: any) {
    console.error(`Error generating questions for ${category.name}:`, error.message);
  }
}

async function main() {
  console.log('Starting Dynamic Question Generator with Prices...');
  
  // Optional: pass category slugs to regenerate only those (e.g. `generate-questions.ts tv air-conditioner`)
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  let query = supabase.from('categories').select('id, name, slug');
  if (only.length) query = query.in('slug', only);
  const { data: categories, error } = await query;
  if (error || !categories) {
    console.error('Failed to fetch categories');
    return;
  }

  for (const category of categories) {
    await generateQuestionsForCategory(category);
    // Delay to respect rate limits
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n🎉 Finished generating questions for all categories!');
}

main();
