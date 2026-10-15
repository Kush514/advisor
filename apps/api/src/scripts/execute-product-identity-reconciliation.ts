// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function extractNameFromUrl(url: string | null) {
  if (!url) return "Unknown Product";
  const match = url.match(/amazon\.in\/([^\/]+)\/dp/);
  if (match && match[1]) {
    return match[1].replace(/-/g, ' ').toUpperCase();
  }
  return "Unknown Product";
}

async function executeMigration() {
  console.log("Starting Product Identity Reconciliation EXECUTION...\n");

  const { data: products } = await supabase.from('products').select(`
    id, name, brand, model, category_id,
    product_specs(spec_key, spec_value),
    product_links(amazon_url, flipkart_url),
    product_videos(youtube_video_id, youtube_videos(id)),
    product_pdf_documents(pdf_document_id)
  `);

  if (!products) {
    console.error("Failed to fetch products");
    return;
  }

  // --- PHASE 17: EXECUTE SAFE DUPLICATE MIGRATIONS ---
  const mergeTargets = [
    { canonical: '88ce94ba-684a-4d8b-bcca-22073f573729', duplicates: ['b2d1bc87-52af-472f-81aa-5f4d6e364ad5'] },
    { canonical: 'c33b0dd4-18cc-4e98-b7e0-62cd2d81b268', duplicates: ['681d63ab-d27e-4980-8368-17d1f22af06d', '1cdd48e4-6c1c-4b8f-971a-669975281f8c'] },
    { canonical: '7813cb53-2dab-4019-8f30-8ad5c95d4ef5', duplicates: ['f74943f2-2be4-47e9-986c-b4f68b249ce8'] }
  ];

  let mergedCount = 0;
  for (const target of mergeTargets) {
    const { canonical, duplicates } = target;
    for (const dupId of duplicates) {
      console.log(`Merging duplicate ${dupId} into ${canonical}...`);
      
      // Update videos
      await supabase.from('product_videos').update({ product_id: canonical }).eq('product_id', dupId);
      // Update links
      await supabase.from('product_links').update({ product_id: canonical }).eq('product_id', dupId);
      // Update PDFs
      await supabase.from('product_pdf_documents').update({ product_id: canonical }).eq('product_id', dupId);
      // Update amazon_products
      await supabase.from('amazon_products').update({ product_id: canonical }).eq('product_id', dupId);
      // Specs might conflict, we'll try to update one by one
      const { data: specs } = await supabase.from('product_specs').select('*').eq('product_id', dupId);
      if (specs) {
        for (const spec of specs) {
          const { error } = await supabase.from('product_specs').upsert({
            product_id: canonical,
            spec_key: spec.spec_key,
            spec_value: spec.spec_value,
            spec_unit: spec.spec_unit
          }, { onConflict: 'product_id,spec_key' });
        }
      }

      // Delete old product
      const { error: delErr } = await supabase.from('products').delete().eq('id', dupId);
      if (delErr) {
        console.log(`Failed to delete duplicate ${dupId}: ${delErr.message}`);
      } else {
        mergedCount++;
      }
    }
  }
  console.log(`Successfully merged ${mergedCount} duplicates.`);

  // --- PHASE 16: EXECUTE SAFE PRODUCT INGESTION ---
  console.log("\nStarting ingestion of NEW_CONFIRMED products...");
  const { data: amazonProducts } = await supabase.from('amazon_products').select('*').is('product_id', null);
  
  if (!amazonProducts) return;

  const validAmazonProducts = amazonProducts.filter(ap => ap.status === 'resolved' && ap.asin);
  
  let insertedCount = 0;

  for (const ap of validAmazonProducts) {
    const existingWithLink = products.find(p => p.product_links?.some((pl: any) => pl.amazon_url && pl.amazon_url.includes(ap.asin!)));
    
    if (!existingWithLink) {
      // NEW_CONFIRMED
      const derivedName = extractNameFromUrl(ap.canonical_url);
      
      const { data: newProd, error: insertErr } = await supabase.from('products').insert({
        name: derivedName,
        status: 'active',
        recommendable: false,
        reviewed_by_vmone: false
      }).select().single();

      if (newProd) {
        insertedCount++;
        
        // Map amazon_product to the new product
        await supabase.from('amazon_products').update({ product_id: newProd.id }).eq('id', ap.id);
        
        // Map pdf_document_links directly? No need, they already point to amazon_products.id
        // But we DO need to link product_pdf_documents and product_links!
        
        // Link to product_links
        await supabase.from('product_links').insert({
          product_id: newProd.id,
          amazon_url: ap.canonical_url
        });
        
        // Find which PDF this came from
        const { data: relatedPdfLinks } = await supabase.from('pdf_document_links').select('pdf_document_id').eq('amazon_product_id', ap.id);
        if (relatedPdfLinks && relatedPdfLinks.length > 0) {
          for (const link of relatedPdfLinks) {
            await supabase.from('product_pdf_documents').upsert({
              product_id: newProd.id,
              pdf_document_id: link.pdf_document_id
            }, { onConflict: 'product_id,pdf_document_id' });
          }
        }
      }
    }
  }

  console.log(`Inserted ${insertedCount} NEW_CONFIRMED products.`);

  // --- POST MUTATION AUDIT ---
  console.log("\n--- POST-MUTATION AUDIT ---");
  const { count: finalProducts } = await supabase.from('products').select('*', { count: 'exact', head: true });
  console.log(`Total products after mutation: ${finalProducts}`);

  console.log("\nReconciliation Execution Complete.");
}

executeMigration();
