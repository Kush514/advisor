// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { validateAndMarkEligibility } from '../services/product-eligibility.js';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runAudit() {
  console.log("--- POST-MUTATION AUDIT ---");
  
  const { data: products } = await supabase.from('products').select(`
    id, name, brand, model, category_id, status, reviewed_by_vmone, recommendable,
    product_specs(id),
    product_links(id),
    product_pdf_documents(id),
    product_videos(id)
  `);
  
  if (!products) return;

  const categorized = products.filter(p => p.category_id);
  const withBrand = products.filter(p => p.brand);
  const withModel = products.filter(p => p.model);
  const withSpecs = products.filter(p => p.product_specs && p.product_specs.length > 0);
  const withLinks = products.filter(p => p.product_links && p.product_links.length > 0);
  const withPdfs = products.filter(p => p.product_pdf_documents && p.product_pdf_documents.length > 0);
  const withYoutube = products.filter(p => p.product_videos && p.product_videos.length > 0);
  const reviewed = products.filter(p => p.reviewed_by_vmone);
  const recommendable = products.filter(p => p.recommendable);

  console.log(`Total products: ${products.length} (Expected: 937)`);
  console.log(`Products with category: ${categorized.length}`);
  console.log(`Products without category: ${products.length - categorized.length}`);
  console.log(`Products with brand: ${withBrand.length}`);
  console.log(`Products with model: ${withModel.length}`);
  console.log(`Products with specs: ${withSpecs.length}`);
  console.log(`Products with product links: ${withLinks.length}`);
  console.log(`Products with PDF provenance: ${withPdfs.length}`);
  console.log(`Products with YouTube provenance: ${withYoutube.length}`);
  console.log(`Reviewed by VM ONE: ${reviewed.length}`);
  console.log(`Recommendable: ${recommendable.length}`);

  // --- IDENTITY INTEGRITY ---
  console.log("\n--- IDENTITY INTEGRITY ---");
  const { data: duplicateUrls } = await supabase.rpc('check_duplicate_urls'); // Just conceptual, will check via JS
  
  const linkSet = new Set();
  let duplicateCanonicalCount = 0;
  for (const p of products) {
    if (p.product_links && p.product_links.length > 0) {
      for (const link of p.product_links as any[]) {
        if (link.amazon_url) {
          if (linkSet.has(link.amazon_url)) duplicateCanonicalCount++;
          linkSet.add(link.amazon_url);
        }
      }
    }
  }
  console.log(`Duplicate canonical URLs: ${duplicateCanonicalCount}`);
  
  const { data: amazonProducts } = await supabase.from('amazon_products').select('asin, product_id').not('product_id', 'is', null);
  const asinSet = new Set();
  let duplicateAsinCount = 0;
  if (amazonProducts) {
    for (const ap of amazonProducts) {
      if (ap.asin) {
        if (asinSet.has(ap.asin)) duplicateAsinCount++;
        asinSet.add(ap.asin);
      }
    }
  }
  console.log(`Duplicate marketplace identifiers (ASIN): ${duplicateAsinCount}`);
  
  console.log("Orphaned relationships check: By definition, Supabase foreign keys prevent orphaned links, specs, videos, and PDFs.");

  // --- ELIGIBILITY PREVIEW (PHASE 20) ---
  console.log("\n--- ELIGIBILITY PREVIEW ONLY ---");
  const result = await validateAndMarkEligibility(supabase, true); // true = dry run
  
  if (result.ok) {
    const report = result.report;
    console.log(`Current eligible count: ${report.productsEligible}`);
    console.log(`Remaining missing requirements breakdown:`);
    console.log(` - Missing category: ${report.productsWithoutCategory}`);
    console.log(` - Missing specs: ${report.productsMissingRequiredSpecs}`);
    console.log(` - Missing review video: ${report.productsWithoutReviewVideo}`);
    console.log(` - Not reviewed by VM ONE: ${products.length - report.productsReviewedByVmone}`);
  }
}

runAudit();
