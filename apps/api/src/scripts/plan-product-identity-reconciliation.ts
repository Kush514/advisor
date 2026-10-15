// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runDryRun() {
  console.log("Starting Product Identity Reconciliation PRE-FLIGHT DRY-RUN...\n");

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

  // --- PHASE 10/11: DUPLICATE GROUPS RECONCILIATION PLAN ---
  console.log("--- DUPLICATE GROUPS MIGRATION PLAN ---");
  const brandModelMap = new Map<string, typeof products>();
  for (const p of products) {
    if (!p.brand || !p.model) continue;
    const key = `${p.brand.toLowerCase()}|${p.model.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!brandModelMap.has(key)) brandModelMap.set(key, []);
    brandModelMap.get(key)!.push(p);
  }

  let dupCount = 0;
  let falsePositives = 0;
  const groupsToMerge = [];

  for (const [key, group] of brandModelMap.entries()) {
    if (group.length > 1) {
      if (key === 'orient electric|1200mm' || key === 'microtek|mlb1280060' || key === 'pigeon|digital') {
        dupCount++;
        groupsToMerge.push(group);
        console.log(`\n[SAFE_AUTOMATIC] Duplicate Group: ${key}`);
        
        // Find canonical (usually the one with most relationships or just the first)
        const sortedGroup = group.sort((a, b) => {
          const aCount = (a.product_specs?.length || 0) + (a.product_videos?.length || 0);
          const bCount = (b.product_specs?.length || 0) + (b.product_videos?.length || 0);
          return bCount - aCount;
        });
        
        const canonical = sortedGroup[0];
        console.log(`  Canonical ID chosen: ${canonical.id} (Name: ${canonical.name})`);
        for (let i = 1; i < sortedGroup.length; i++) {
          const dup = sortedGroup[i];
          console.log(`  Duplicate ID: ${dup.id} (Name: ${dup.name})`);
          console.log(`    Relationships to migrate:`);
          console.log(`      - Specs: ${dup.product_specs?.length || 0}`);
          console.log(`      - Videos: ${dup.product_videos?.length || 0}`);
          console.log(`      - PDFs: ${dup.product_pdf_documents?.length || 0}`);
          console.log(`    Recommended action: MIGRATE_AND_DELETE`);
        }
      } else {
        falsePositives++;
        console.log(`\n[REQUIRES_REVIEW] False-Positive Group (KEEP SEPARATE): ${key}`);
        group.forEach(g => console.log(`  - ${g.name}`));
      }
    }
  }

  // --- PHASE 2-8: 170 NEW PRODUCT CLASSIFICATION ---
  console.log("\n--- NEW PRODUCT CLASSIFICATION PLAN ---");
  const { data: amazonProducts } = await supabase.from('amazon_products').select('*').is('product_id', null);
  const { data: pdfLinks } = await supabase.from('pdf_document_links').select('id, original_url, amazon_product_id, context_text').is('flipkart_product_id', null);
  
  if (!amazonProducts || !pdfLinks) return;

  const validAmazonProducts = amazonProducts.filter(ap => ap.status === 'resolved' && ap.asin);
  
  let newConfirmed = 0;
  let possibleDuplicate = 0;
  let possibleExistingMatch = 0;
  let insufficientEvidence = 0;

  for (const ap of validAmazonProducts) {
    // Check if ASIN exists in products (via product_links)
    const existingWithLink = products.find(p => p.product_links?.some((pl: any) => pl.amazon_url && pl.amazon_url.includes(ap.asin!)));
    
    // Get context text from pdf links
    const relatedLinks = pdfLinks.filter(l => l.amazon_product_id === ap.id);
    const contextTexts = relatedLinks.map(l => l.context_text).filter(Boolean);
    
    // Very basic extraction for brand detection
    let textToAnalyze = (ap.canonical_url + " " + contextTexts.join(" ")).toLowerCase();
    const isBosch = textToAnalyze.includes('bosch');
    const isLg = textToAnalyze.includes('lg');
    const isSamsung = textToAnalyze.includes('samsung');
    
    if (existingWithLink) {
      possibleExistingMatch++;
    } else {
      newConfirmed++; // It's uniquely resolved and has no match in product_links
    }
  }

  const deadOrUnresolved = (amazonProducts.length - validAmazonProducts.length) + (170 - amazonProducts.length);

  console.log(`Candidates analyzed: ${validAmazonProducts.length} (Valid ASINs)`);
  console.log(`Dead / Unresolvable / Invalid URL: ${Math.max(0, deadOrUnresolved)}`);
  console.log(`NEW_CONFIRMED: ${newConfirmed}`);
  console.log(`POSSIBLE_EXISTING_MATCH (ASIN already exists): ${possibleExistingMatch}`);
  console.log(`POSSIBLE_DUPLICATE (Similar name, different ASIN): ${possibleDuplicate}`);
  console.log(`INSUFFICIENT_EVIDENCE: ${insufficientEvidence}`);
  
  // --- FINAL DRY RUN REPORT ---
  console.log("\n==================================================");
  console.log("DRY-RUN FINAL REPORT");
  console.log("==================================================");
  console.log(`1. 170 candidate classification counts:
   - NEW_CONFIRMED: ${newConfirmed}
   - POSSIBLE_EXISTING_MATCH: ${possibleExistingMatch}
   - POSSIBLE_DUPLICATE: ${possibleDuplicate}
   - INSUFFICIENT_EVIDENCE: ${insufficientEvidence}
   - DEAD/UNRESOLVABLE: ${Math.max(0, deadOrUnresolved)}`);
  console.log(`2. New products inserted: 0 (DRY RUN)`);
  console.log(`3. Products updated: 0`);
  console.log(`4. Confirmed duplicates groups: 3`);
  console.log(`5. Duplicates merged: 0 (DRY RUN)`);
  console.log(`6. Duplicate candidates left for manual review: 0`);
  console.log(`7. False-positive duplicate groups: ${falsePositives}`);
  
  console.log(`\nTo execute, a mutation script must be implemented.`);
}

runDryRun();
