import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeUrl } from './pdf-link-parser';

export interface EnrichmentStats {
  pdfsProcessed: number;
  productsExtracted: number;
  existingProductsMatched: number;
  unmatchedProducts: number;
  productsWithCategoryAssigned: number;
  productsWithDescriptionsAdded: number;
  specsUpserted: number;
  errors: number;
  perPdfStats: Record<string, any>;
}

export async function processPdfEnrichment(
  supabase: SupabaseClient,
  env: { GEMINI_API_KEY?: string },
  pdfId?: string,
  dryRun = false
): Promise<{ ok: boolean; stats: EnrichmentStats; sampleData?: any[] }> {
  const stats: EnrichmentStats = {
    pdfsProcessed: 0,
    productsExtracted: 0,
    existingProductsMatched: 0,
    unmatchedProducts: 0,
    productsWithCategoryAssigned: 0,
    productsWithDescriptionsAdded: 0,
    specsUpserted: 0,
    errors: 0,
    perPdfStats: {}
  };

  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  // 1. Fetch categories for mapping validation
  const { data: categories, error: catError } = await supabase.from('categories').select('id, slug, name');
  if (catError || !categories) {
    throw new Error('Failed to fetch categories');
  }
  const categoryMap = new Map(categories.map((c) => [c.slug.toLowerCase(), c.id]));
  const validCategorySlugs = categories.map((c) => c.slug);

  // 2. Fetch PDFs
  let query = supabase.from('pdf_documents')
    .select('id, resolved_url, extracted_text')
    .not('extracted_text', 'is', null)
    .neq('extracted_text', '');
    
  if (pdfId) {
    query = query.eq('id', pdfId);
  } else {
    // For safety during full runs, process one by one ordered
    query = query.order('created_at', { ascending: false });
  }
  
  const { data: pdfs, error: pdfError } = await query;
  if (pdfError || !pdfs) {
    throw new Error('Failed to fetch PDFs');
  }

  const sampleData: any[] = [];

  // 3. Process Each PDF
  for (const pdf of pdfs) {
    console.log(`[Gemini Enricher] Processing PDF: ${pdf.resolved_url}`);
    stats.pdfsProcessed++;
    
    // Pass the entire text as a single chunk. Gemini 1.5/2.5 Flash easily handles 10k chars.
    // Process the PDF text in manageable chunks (limit to 40k chars per chunk to avoid timeouts)
    const textChunk = pdf.extracted_text!;
    const CHUNK_SIZE = 15000;
    let extractedProducts: any[] = [];
    
    try {
      for (let i = 0; i < textChunk.length; i += CHUNK_SIZE) {
      const slice = textChunk.slice(i, i + CHUNK_SIZE);
      try {
        const chunkProducts = await callGeminiForExtraction(slice, env.GEMINI_API_KEY, validCategorySlugs);
        extractedProducts = extractedProducts.concat(chunkProducts);
      } catch (e: any) {
        console.error(`[Gemini Enricher] Chunk failure on ${pdf.resolved_url}:`, e);
      }
    }
    
    if (dryRun && stats.pdfsProcessed === 1) {
      sampleData.push(...extractedProducts);
    }
    
    stats.productsExtracted += extractedProducts.length;

    // Match and Enrich
    for (const extracted of extractedProducts) {
      if (!extracted.product_url) {
        stats.unmatchedProducts++;
        continue;
      }

      const normalizedExtractedUrl = normalizeUrl(extracted.product_url);
      const searchPattern = `%${normalizedExtractedUrl.split('?')[0].replace('https://', '').replace('http://', '')}%`;

      let productId: string | null = null;

      // Strategy 1: Match directly in product_links
      const { data: matchedLinks, error: matchErr } = await supabase
        .from('product_links')
        .select('product_id')
        .or(`amazon_url.ilike.${searchPattern},flipkart_url.ilike.${searchPattern}`);
        
      if (matchedLinks && matchedLinks.length > 0) {
        productId = matchedLinks[0].product_id;
      } else {
        // Strategy 2: Check pdf_document_links for amzn.to shortlinks
        const { data: pdfLinkMatch } = await supabase
          .from('pdf_document_links')
          .select('amazon_product_id, flipkart_product_id')
          .ilike('original_url', searchPattern)
          .limit(1)
          .single();
          
        if (pdfLinkMatch) {
          if (pdfLinkMatch.amazon_product_id) {
            const { data: amzProd } = await supabase.from('amazon_products').select('product_id').eq('id', pdfLinkMatch.amazon_product_id).single();
            if (amzProd?.product_id) productId = amzProd.product_id;
          } else if (pdfLinkMatch.flipkart_product_id) {
            const { data: fkProd } = await supabase.from('flipkart_products').select('product_id').eq('id', pdfLinkMatch.flipkart_product_id).single();
            if (fkProd?.product_id) productId = fkProd.product_id;
          }
        }
      }

      if (!productId) {
        console.warn(`[Gemini Enricher] No product found for URL: ${normalizedExtractedUrl}`);
        stats.unmatchedProducts++;
        continue;
      }

      stats.existingProductsMatched++;

        if (dryRun) continue; // Skip DB updates if dry run

        // Fetch current product to avoid overwriting good data with nulls
        const { data: currentProduct } = await supabase
          .from('products')
          .select('name, brand, model, category_id, description')
          .eq('id', productId)
          .single();

        if (currentProduct) {
          const updates: any = {};
          
          if (extracted.product_name && !currentProduct.name) updates.name = extracted.product_name;
          if (extracted.brand && !currentProduct.brand) updates.brand = extracted.brand;
          if (extracted.model && !currentProduct.model) updates.model = extracted.model;
          if (extracted.description && !currentProduct.description) {
            updates.description = extracted.description;
            stats.productsWithDescriptionsAdded++;
          }
          if (extracted.subcategory) updates.subcategory = extracted.subcategory;

          // Category Validation
          if (extracted.category_slug && categoryMap.has(extracted.category_slug.toLowerCase())) {
            // Only update if it didn't already have one
            if (!currentProduct.category_id) {
              updates.category_id = categoryMap.get(extracted.category_slug.toLowerCase());
              stats.productsWithCategoryAssigned++;
            }
          } else if (extracted.category_slug) {
            console.warn(`[Gemini Enricher] Invalid category slug: ${extracted.category_slug}`);
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from('products').update(updates).eq('id', productId);
          }
          
          // Ensure product_pdf_documents relationship exists
          await supabase.from('product_pdf_documents').upsert(
            { product_id: productId, pdf_document_id: pdf.id },
            { onConflict: 'product_id,pdf_document_id' }
          );

          // Upsert Specs
          if (extracted.specs && extracted.specs.length > 0) {
            for (const spec of extracted.specs) {
              if (!spec.key || !spec.value) continue;
              const cleanKey = spec.key.toLowerCase().replace(/[^a-z0-9]/g, '_');
              
              await supabase.from('product_specs').upsert(
                {
                  product_id: productId,
                  spec_key: cleanKey,
                  spec_value: String(spec.value),
                  spec_unit: spec.unit || null
                },
                { onConflict: 'product_id,spec_key' }
              );
              stats.specsUpserted++;
            }
          }
          
          // Store budget_group as a spec
          if (extracted.budget_group) {
            await supabase.from('product_specs').upsert(
              {
                product_id: productId,
                spec_key: 'budget_group',
                spec_value: extracted.budget_group,
              },
              { onConflict: 'product_id,spec_key' }
            );
            stats.specsUpserted++;
          }
        }
      }

    } catch (err: any) {
      console.error(`[Gemini Enricher] Failed processing PDF ${pdf.resolved_url}:`, err);
      stats.errors++;
    }
  }

  return { ok: true, stats, sampleData: dryRun ? sampleData : undefined };
}

async function callGeminiForExtraction(text: string, apiKey: string, validSlugs: string[]): Promise<any[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`;
  
  const systemInstruction = `You are an expert data extraction assistant for VM ONE Product Finder.
Extract a list of products from the provided text document. 
The document contains category headers (e.g. "RECOMMENDED FRONT LOAD WASHING MACHINES") and budget headers (e.g. "UNDER 60K").
Preserve this context and assign it to the products underneath the headers.

Respond ONLY with a strictly formatted JSON object matching this schema:
{
  "products": [
    {
      "product_url": "string (the Amazon/Flipkart/Brand URL inline with or near the product)",
      "product_name": "string",
      "brand": "string",
      "model": "string",
      "category_slug": "string (MUST exactly match one of the provided valid slugs, or null if unknown)",
      "subcategory": "string (e.g. 'Front Load Washing Machines', 'Desert Air Coolers')",
      "budget_group": "string (e.g. 'UNDER 60K', 'UNDER 35000', or null)",
      "description": "string (A brief summary if available, else null)",
      "specs": [
        { "key": "string (e.g. 'screen_size', 'refresh_rate', 'capacity')", "value": "string", "unit": "string (e.g. 'inch', 'L', 'W')" }
      ]
    }
  ]
}

Valid category slugs: [${validSlugs.join(', ')}]`;

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('No content returned from Gemini');
  }

  try {
    const parsed = JSON.parse(content);
    return parsed.products || [];
  } catch (e) {
    throw new Error('Failed to parse Gemini JSON output');
  }
}
