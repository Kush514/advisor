// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runAudit() {
  console.log("Starting Read-Only Audit...\n");

  // Fetch all 885 products
  const { data: products } = await supabase.from('products').select('*');
  const { data: productLinks } = await supabase.from('product_links').select('*');
  const { data: pdfDocLinks } = await supabase.from('pdf_document_links').select('*');
  
  // 5. DUPLICATE PRODUCT AUDIT
  console.log("--- 5. DUPLICATE PRODUCT AUDIT ---");
  const duplicates = [];
  const seenBrandModel = new Map();
  let exactDuplicates = 0;
  
  for (const p of products) {
    if (!p.brand || !p.model) continue;
    const key = `${p.brand.trim().toLowerCase()}|${p.model.trim().toLowerCase()}`;
    if (seenBrandModel.has(key)) {
      exactDuplicates++;
      duplicates.push({ id1: seenBrandModel.get(key).id, id2: p.id, name: p.name, brand: p.brand, model: p.model });
    } else {
      seenBrandModel.set(key, p);
    }
  }
  console.log(`Found ${exactDuplicates} high-confidence duplicate pairs based on Brand + Model.`);
  
  // 6. URL DATA QUALITY AUDIT
  console.log("\n--- 6. URL DATA QUALITY AUDIT ---");
  let amzCount = 0, fkCount = 0, noLink = 0;
  let amzUrls = new Set(), fkUrls = new Set();
  let dupAmz = 0, dupFk = 0;
  
  const pIdsWithLinks = new Set();
  for (const link of productLinks || []) {
    pIdsWithLinks.add(link.product_id);
    if (link.amazon_url) {
      amzCount++;
      if (amzUrls.has(link.amazon_url)) dupAmz++;
      amzUrls.add(link.amazon_url);
    }
    if (link.flipkart_url) {
      fkCount++;
      if (fkUrls.has(link.flipkart_url)) dupFk++;
      fkUrls.add(link.flipkart_url);
    }
  }
  for (const p of products) {
    if (!pIdsWithLinks.has(p.id)) noLink++;
  }
  
  console.log(`Total product_links rows: ${productLinks?.length || 0}`);
  console.log(`Amazon links: ${amzCount} (${dupAmz} duplicates)`);
  console.log(`Flipkart links: ${fkCount} (${dupFk} duplicates)`);
  console.log(`Products with no marketplace link: ${noLink}`);
  
  // 8. PDF RELATIONSHIP AUDIT
  console.log("\n--- 8. PDF RELATIONSHIP AUDIT ---");
  const { data: pdfDocs } = await supabase.from('pdf_documents').select('*');
  const { data: pPdfDocs } = await supabase.from('product_pdf_documents').select('*');
  
  const withText = pdfDocs.filter(d => d.extracted_text != null).length;
  console.log(`Total PDF documents: ${pdfDocs.length}`);
  console.log(`PDFs with extracted_text: ${withText}`);
  console.log(`PDFs with no extracted_text: ${pdfDocs.length - withText}`);
  
  const pPdfUnique = new Set(pPdfDocs.map(r => r.product_id)).size;
  console.log(`Products linked to PDFs: ${pPdfUnique}`);
  console.log(`PDF-to-product relationship count: ${pPdfDocs.length}`);
  
  // 13. PRODUCT COMPLETENESS & 14. READINESS
  console.log("\n--- 13. PRODUCT COMPLETENESS & 14. RECOMMENDATION READINESS ---");
  const { data: pVideos } = await supabase.from('product_videos').select('*');
  const pVidSet = new Set(pVideos.map(r => r.product_id));
  
  const { data: pSpecs } = await supabase.from('product_specs').select('product_id');
  const pSpecSet = new Set((pSpecs || []).map(r => r.product_id));
  
  let fullyReady = 0, missingCat = 0, missingRev = 0, missingSpecs = 0;
  for (const p of products) {
    if (!p.category_id) missingCat++;
    if (!p.reviewed_by_vmone) missingRev++;
    if (!pSpecSet.has(p.id)) missingSpecs++;
    
    if (p.category_id && p.reviewed_by_vmone && pVidSet.has(p.id) && pSpecSet.has(p.id) && p.brand && p.model) {
      fullyReady++;
    }
  }
  console.log(`Products that WOULD satisfy readiness criteria: ${fullyReady}`);
  console.log(`Products missing category: ${missingCat}`);
  console.log(`Products missing review flag: ${missingRev}`);
  console.log(`Products missing specs: ${missingSpecs}`);
}

runAudit();
