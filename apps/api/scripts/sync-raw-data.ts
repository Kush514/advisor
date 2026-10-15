import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

import { syncYouTubeVideos } from '../src/services/youtube.js';
import { processAllVideoDescriptions } from '../src/services/youtube-description-parser.js';
import { resolvePdfCandidates } from '../src/services/pdf-resolver.js';
import { parsePdfLinks } from '../src/services/pdf-link-parser.js';
import { processAmazonLinks } from '../src/services/amazon-resolver.js';
import { generateProducts } from '../src/services/product-generator.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const apiKey = process.env.YOUTUBE_API_KEY!;
const startDate = process.env.YOUTUBE_SYNC_START_DATE || '2024-10-01';

const SKIP_PDFS = process.argv.includes('--no-pdf');

async function run() {
  console.log(`\n======================================================`);
  console.log(`📡 PHASE 1: DATA EXTRACTION ENGINE`);
  console.log(`======================================================`);

  try {
    console.log(`\n1️⃣ Fetching latest YouTube videos since ${startDate}...`);
    const videoStats = await syncYouTubeVideos(apiKey, supabase, startDate);
    console.log(`✅ Inserted ${videoStats.inserted}, Updated ${videoStats.updated}, Skipped ${videoStats.skipped}.`);
    
    console.log(`\n2️⃣ Parsing video descriptions for links...`);
    const parseStats = await processAllVideoDescriptions(supabase);
    console.log(`✅ Extracted ${parseStats.links_found} URLs from video descriptions.`);

    // --no-pdf: only follow product links written in video descriptions (used by the automatic sync)
    if (SKIP_PDFS) {
      console.log(`\n3️⃣ / 4️⃣ Skipping PDF steps (--no-pdf).`);
    } else {
      console.log(`\n3️⃣ Resolving PDF links (Bit.ly -> PDF)...`);
      const pdfResolveStats = await resolvePdfCandidates(supabase, 50);
      console.log(`✅ Confirmed ${pdfResolveStats.confirmedPdfs} new PDFs.`);

      console.log(`\n4️⃣ Extracting Amazon/Flipkart links FROM inside the PDFs...`);
      const pdfLinkStats = await parsePdfLinks(supabase, 50);
      console.log(`✅ Parsed ${pdfLinkStats.pdfsInspected} PDFs and found ${pdfLinkStats.totalLinksFound} internal links!`);
    }

    // PDFs parsed before link.amazon short links were recognised stored them as brand links
    const { data: relabelled } = await supabase
      .from('pdf_document_links')
      .update({ link_type: 'amazon' })
      .ilike('normalized_url', '%link.amazon%')
      .neq('link_type', 'amazon')
      .select('id');
    if (relabelled?.length) console.log(`✅ Re-labelled ${relabelled.length} link.amazon PDF links as Amazon.`);

    console.log(`\n5️⃣ Resolving raw Amazon links into clean ASINs...`);
    let resolvedTotal = 0;
    let withAsin = 0;
    for (let round = 1; round <= 30; round++) {
      const amazonStats = await processAmazonLinks(supabase, 200);
      if (amazonStats.processed === 0) break;
      resolvedTotal += amazonStats.processed;
      withAsin += amazonStats.productUrls;
      console.log(`   round ${round}: ${amazonStats.processed} links checked, ${amazonStats.productUrls} are products, ${amazonStats.failed} failed`);
    }
    console.log(`✅ Checked ${resolvedTotal} Amazon links, ${withAsin} resolved to a product.`);

    console.log(`\n6️⃣ Generating/Merging into Final Products table...`);
    const genStats = await generateProducts(supabase, false);
    console.log(`✅ Generated ${genStats.stats.created} NEW products and updated ${genStats.stats.updated} existing!`);

    console.log(`\n🎉 EXTRACTION PHASE COMPLETE! 🎉\n`);
  } catch (err: any) {
    console.error('❌ Failed Extraction Phase:', err.message);
    process.exit(1);
  }
}

run();
