// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'apps/api/.dev.vars' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const API_URL = 'http://127.0.0.1:8787/api/admin/enrich-products';
const ADMIN_SECRET = process.env.ADMIN_SYNC_SECRET;

async function runEnrichment() {
  const isDryRun = process.argv.includes('--run') ? false : true;
  console.log(`--- Starting PDF Enrichment (${isDryRun ? 'DRY RUN' : 'LIVE RUN'}) ---`);

  const { data: pdfs, error } = await supabase
    .from('pdf_documents')
    .select('id, resolved_url')
    .not('extracted_text', 'is', null)
    .neq('extracted_text', '');

  if (error || !pdfs) {
    console.error('Failed to fetch PDFs', error);
    return;
  }

  console.log(`Discovered ${pdfs.length} PDFs ready for enrichment.`);

  const grandStats = {
    pdfsProcessed: 0,
    productsExtracted: 0,
    existingProductsMatched: 0,
    unmatchedProducts: 0,
    productsWithCategoryAssigned: 0,
    productsWithDescriptionsAdded: 0,
    specsUpserted: 0,
    errors: 0
  };

  const perPdfStats: Record<string, any> = {};

  for (const pdf of pdfs) {
    console.log(`\nProcessing: ${pdf.resolved_url}...`);
    try {
      const res = await fetch(`${API_URL}?dryRun=${isDryRun}&pdfId=${pdf.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ADMIN_SECRET}`
        },
        signal: AbortSignal.timeout(60000)
      });
      
      const data = await res.json();
      
      if (!data.ok) {
        console.error(`  -> Failed: ${data.error}`);
        grandStats.errors++;
        perPdfStats[pdf.resolved_url] = { error: data.error };
        continue;
      }
      
      const st = data.stats;
      grandStats.pdfsProcessed += st.pdfsProcessed;
      grandStats.productsExtracted += st.productsExtracted;
      grandStats.existingProductsMatched += st.existingProductsMatched;
      grandStats.unmatchedProducts += st.unmatchedProducts;
      grandStats.productsWithCategoryAssigned += st.productsWithCategoryAssigned;
      grandStats.productsWithDescriptionsAdded += st.productsWithDescriptionsAdded;
      grandStats.specsUpserted += st.specsUpserted;
      grandStats.errors += st.errors;

      perPdfStats[pdf.resolved_url] = {
        extracted: st.productsExtracted,
        matched: st.existingProductsMatched,
        unmatched: st.unmatchedProducts,
        errors: st.errors
      };

      console.log(`  -> Extracted: ${st.productsExtracted}, Matched: ${st.existingProductsMatched}`);
      
      // Sleep to respect Gemini rate limits
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (err: any) {
      console.error(`  -> Fetch error: ${err.message}`);
      grandStats.errors++;
      perPdfStats[pdf.resolved_url] = { error: err.message };
    }
  }

  console.log('\n========================================');
  console.log('ENRICHMENT SUMMARY');
  console.log('========================================');
  console.log(`PDFs discovered: ${pdfs.length}`);
  console.log(`PDFs processed: ${grandStats.pdfsProcessed}`);
  console.log(`Products extracted: ${grandStats.productsExtracted}`);
  console.log(`Products matched: ${grandStats.existingProductsMatched}`);
  console.log(`Products unmatched: ${grandStats.unmatchedProducts}`);
  console.log(`Products enriched (categories): ${grandStats.productsWithCategoryAssigned}`);
  console.log(`Products enriched (descriptions): ${grandStats.productsWithDescriptionsAdded}`);
  console.log(`Products with specs upserted: ${grandStats.specsUpserted}`);
  console.log(`Errors: ${grandStats.errors}`);
  
  console.log('\nPER-PDF RESULTS:');
  for (const [url, st] of Object.entries(perPdfStats)) {
    console.log(`PDF: ${url}`);
    if (st.error) {
      console.log(`  Errors: ${st.error}`);
    } else {
      console.log(`  Extracted: ${st.extracted}`);
      console.log(`  Matched: ${st.matched}`);
      console.log(`  Unmatched: ${st.unmatched}`);
      console.log(`  Errors: ${st.errors}`);
    }
  }

}

runEnrichment();
