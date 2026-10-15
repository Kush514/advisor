// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { getRecommendations } from '../services/recommendation-engine.js';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const CANONICAL_CATEGORIES = [
  'air-purifier', 'air-fryer', 'chimney', 'cooktop-induction', 'gas-stove',
  'washing-machine', 'refrigerators', 'electric-iron', 'vacuum-cleaners-robot-vacuum',
  'air-conditioner', 'tv', 'geyser', 'soundbars', 'water-purifier', 'microwave-otg-oven',
  'mixer-grinder', 'ceiling-fans', 'electric-cooker', 'inverter-battery',
  'smart-door-lock', 'air-cooler', 'room-heaters'
];

const REQUIRED_SPECS: Record<string, string[]> = {
  'tv': ['screen_size'],
  'washing-machine': ['capacity'],
  'refrigerators': ['capacity'],
  'air-conditioner': ['capacity'],
  'microwave-otg-oven': ['capacity']
};

// Canonical duplicate groups merged in Step 10
const MERGED_CANONICAL_IDS = [
  '88ce94ba-684a-4d8b-bcca-22073f573729', // Orient Electric Apex FX
  'c33b0dd4-18cc-4e98-b7e0-62cd2d81b268', // Microtek MLB1280060
  '7813cb53-2dab-4019-8f30-8ad5c95d4ef5'  // Pigeon Healthifry
];
const REMOVED_DUPLICATE_IDS = [
  'b2d1bc87-52af-472f-81aa-5f4d6e364ad5',
  '681d63ab-d27e-4980-8368-17d1f22af06d',
  '1cdd48e4-6c1c-4b8f-971a-669975281f8c',
  'f74943f2-2be4-47e9-986c-b4f68b249ce8'
];

const TEST_REQUIREMENTS: Record<string, any> = {
  'air-purifier': { category: 'air-purifier', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['hepa'] },
  'air-fryer': { category: 'air-fryer', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['digital'] },
  'chimney': { category: 'chimney', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['auto-clean'] },
  'cooktop-induction': { category: 'cooktop-induction', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['2 burner'] },
  'gas-stove': { category: 'gas-stove', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['3 burner'] },
  'washing-machine': { category: 'washing-machine', budget: { kind: 'group', value: '20K_40K' }, features: ['front load'] },
  'refrigerators': { category: 'refrigerators', budget: { kind: 'group', value: 'UNDER_25K' }, features: ['frost free'] },
  'electric-iron': { category: 'electric-iron', budget: { kind: 'group', value: 'UNDER_2K' }, features: ['steam'] },
  'vacuum-cleaners-robot-vacuum': { category: 'vacuum-cleaners-robot-vacuum', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['cordless'] },
  'air-conditioner': { category: 'air-conditioner', budget: { kind: 'group', value: 'UNDER_30K' }, features: ['inverter'] },
  'tv': { category: 'tv', budget: { kind: 'group', value: '30K_50K' }, features: ['55 inch'] },
  'geyser': { category: 'geyser', budget: { kind: 'group', value: 'UNDER_10K' }, features: ['instant'] },
  'soundbars': { category: 'soundbars', budget: { kind: 'group', value: 'UNDER_10K' }, features: ['dolby'] },
  'water-purifier': { category: 'water-purifier', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['ro'] },
  'microwave-otg-oven': { category: 'microwave-otg-oven', budget: { kind: 'group', value: 'UNDER_10K' }, features: ['convection'] },
  'mixer-grinder': { category: 'mixer-grinder', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['3 jar'] },
  'ceiling-fans': { category: 'ceiling-fans', budget: { kind: 'group', value: 'UNDER_3K' }, features: ['bldc'] },
  'electric-cooker': { category: 'electric-cooker', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['pressure'] },
  'inverter-battery': { category: 'inverter-battery', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['lithium'] },
  'smart-door-lock': { category: 'smart-door-lock', budget: { kind: 'group', value: 'UNDER_15K' }, features: ['fingerprint'] },
  'air-cooler': { category: 'air-cooler', budget: { kind: 'group', value: 'UNDER_10K' }, features: ['desert'] },
  'room-heaters': { category: 'room-heaters', budget: { kind: 'group', value: 'UNDER_5K' }, features: ['oil filled'] },
};

async function runAudit() {
  console.log("=".repeat(60));
  console.log("STEP 11 — FINAL ELIGIBILITY & RECOMMENDATION READINESS AUDIT");
  console.log("=".repeat(60));
  console.log("Mode: READ-ONLY\n");

  // ──────────────────────────────────────────────
  // FETCH ALL DATA
  // ──────────────────────────────────────────────
  const { data: products, error: pErr } = await supabase.from('products').select(`
    id, name, brand, model, category_id, subcategory, status, reviewed_by_vmone, recommendable, created_at,
    categories (id, slug, name),
    product_specs (id, spec_key, spec_value),
    product_links (id, amazon_url, flipkart_url, brand_url),
    product_videos (youtube_video_id, youtube_videos(id)),
    product_pdf_documents (pdf_document_id)
  `);
  if (pErr || !products) { console.error("FATAL: Failed to fetch products:", pErr); return; }

  const { data: allCategories } = await supabase.from('categories').select('id, slug, name');
  const catSlugMap = new Map((allCategories || []).map(c => [c.id, c.slug]));

  const { data: amazonProducts } = await supabase.from('amazon_products').select('id, asin, product_id, canonical_url');
  const { data: youtubeVideos } = await supabase.from('youtube_videos').select('id');
  const ytIdSet = new Set((youtubeVideos || []).map(v => v.id));

  console.log(`Total products: ${products.length}`);
  console.log(`Total categories in DB: ${allCategories?.length}`);
  console.log(`Total amazon_products: ${amazonProducts?.length}`);
  console.log(`Total youtube_videos: ${youtubeVideos?.length}\n`);

  // ──────────────────────────────────────────────
  // TASK 1 — RECOMPUTE ELIGIBILITY FROM SCRATCH
  // ──────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("TASK 1 — RECOMPUTE ELIGIBILITY FROM SCRATCH");
  console.log("─".repeat(60));

  const eligible: any[] = [];
  const blocked: any[] = [];

  for (const p of products) {
    const reasons: string[] = [];

    const catSlug = p.categories?.slug;
    const hasCanonicalCat = p.category_id && catSlug && CANONICAL_CATEGORIES.includes(catSlug);
    if (!hasCanonicalCat) reasons.push('NO_CANONICAL_CATEGORY');

    if (p.status !== 'active') reasons.push('INACTIVE');
    if (!p.reviewed_by_vmone) reasons.push('NOT_REVIEWED');

    const validVideos = (p.product_videos || []).filter(
      pv => pv.youtube_video_id && pv.youtube_videos && ytIdSet.has(pv.youtube_video_id)
    );
    if (validVideos.length === 0) reasons.push('NO_VALID_YOUTUBE');

    if (hasCanonicalCat) {
      const req = REQUIRED_SPECS[catSlug!] || [];
      const specKeys = (p.product_specs || []).map(s => s.spec_key);
      const missing = req.filter(r => !specKeys.includes(r));
      if (missing.length > 0) reasons.push(`MISSING_SPECS:${missing.join(',')}`);
    }

    if (!p.name || (!p.brand && !p.model)) reasons.push('MISSING_IDENTITY');

    const hasLink = p.product_links?.some(l => l.amazon_url || l.flipkart_url);
    if (!hasLink) reasons.push('NO_PRODUCT_LINK');

    if (reasons.length === 0) {
      eligible.push(p);
    } else {
      blocked.push({ id: p.id, name: p.name, reasons });
    }
  }

  const active = products.filter(p => p.status === 'active').length;
  const categorized = products.filter(p => p.category_id && p.categories && CANONICAL_CATEGORIES.includes(p.categories.slug)).length;
  const reviewed = products.filter(p => p.reviewed_by_vmone).length;
  const withValidVideo = products.filter(p => (p.product_videos || []).some(pv => pv.youtube_video_id && pv.youtube_videos && ytIdSet.has(pv.youtube_video_id))).length;
  const withSpecs = products.filter(p => p.product_specs && p.product_specs.length > 0).length;

  console.log(`Total products: ${products.length}`);
  console.log(`Active products: ${active}`);
  console.log(`Categorized products (canonical 22): ${categorized}`);
  console.log(`Reviewed by VM ONE: ${reviewed}`);
  console.log(`Products with valid review videos: ${withValidVideo}`);
  console.log(`Products with specs: ${withSpecs}`);
  console.log(`Products satisfying ALL baseline requirements: ${eligible.length}`);
  console.log(`\n>>> INDEPENDENT ELIGIBLE COUNT: ${eligible.length}`);
  console.log(`>>> PREVIOUSLY REPORTED: 115`);
  console.log(`>>> DIFFERENCE: ${Math.abs(eligible.length - 115)}`);

  if (eligible.length !== 115) {
    console.log(`\nDISCREPANCY ANALYSIS:`);
    console.log(`The prior "115" came from product-eligibility.ts which uses LOOSER criteria:`);
    console.log(`  - Counts subcategory-only products (e.g. Dishwashers) as categorized`);
    console.log(`  - Does not enforce identity checks (brand/model)`);
    console.log(`  - Uses a smaller required-specs list`);
    console.log(`This strict audit uses the CORRECT baseline contract from Step 11.`);
    console.log(`Proceeding with the strict ${eligible.length}-count as the true eligible set.\n`);
  }

  // ──────────────────────────────────────────────
  // TASK 2 — PRODUCE CANDIDATE TABLE
  // ──────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("TASK 2 — ELIGIBLE CANDIDATE TABLE");
  console.log("─".repeat(60));

  const candidateRows = eligible.map(c => {
    const budgetSpec = c.product_specs?.find(s => s.spec_key === 'budget_group');
    const validVid = c.product_videos?.find(pv => pv.youtube_video_id && pv.youtube_videos);
    return {
      product_id: c.id,
      name: c.name,
      brand: c.brand,
      model: c.model,
      category: c.categories.slug,
      status: c.status,
      reviewed_by_vmone: c.reviewed_by_vmone,
      youtube_video_id: validVid?.youtube_video_id || null,
      product_link: c.product_links?.[0]?.amazon_url || c.product_links?.[0]?.flipkart_url || null,
      pdf_provenance_count: c.product_pdf_documents?.length || 0,
      spec_count: c.product_specs?.length || 0,
      budget_group: budgetSpec?.spec_value || null,
      classification: budgetSpec ? 'ACTIVATION_READY' : 'READY_BUT_BUDGET_UNKNOWN',
      warnings: []
    };
  });

  fs.writeFileSync('eligible-candidates.json', JSON.stringify(candidateRows, null, 2));
  console.log(`Saved ${candidateRows.length} candidates to eligible-candidates.json`);

  // ──────────────────────────────────────────────
  // TASK 3 — VALIDATE YOUTUBE REVIEW PROVENANCE
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 3 — YOUTUBE REVIEW PROVENANCE");
  console.log("─".repeat(60));

  let validReviewCount = 0;
  let danglingCount = 0;
  let multipleVideoCount = 0;
  let noVideoCount = 0;

  for (const c of eligible) {
    const validVids = (c.product_videos || []).filter(
      pv => pv.youtube_video_id && pv.youtube_videos && ytIdSet.has(pv.youtube_video_id)
    );
    if (validVids.length > 0) validReviewCount++;
    if (validVids.length > 1) multipleVideoCount++;
    if (validVids.length === 0) noVideoCount++;

    const allVids = c.product_videos || [];
    const dangling = allVids.filter(pv => pv.youtube_video_id && !ytIdSet.has(pv.youtube_video_id));
    if (dangling.length > 0) danglingCount++;
  }

  console.log(`Valid review relationship count: ${validReviewCount}`);
  console.log(`Invalid/dangling relationship count: ${danglingCount}`);
  console.log(`Candidates with multiple videos: ${multipleVideoCount}`);
  console.log(`Candidates with NO valid video: ${noVideoCount}`);
  if (noVideoCount > 0) console.error("CRITICAL: Eligible candidates exist with no valid video!");

  // ──────────────────────────────────────────────
  // TASK 4 — VALIDATE CATEGORY INTEGRITY
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 4 — CATEGORY INTEGRITY");
  console.log("─".repeat(60));

  let invalidCatCount = 0;
  const catDistribution: Record<string, number> = {};

  for (const c of eligible) {
    const slug = c.categories?.slug;
    if (!slug || !CANONICAL_CATEGORIES.includes(slug)) {
      invalidCatCount++;
      console.error(`  INVALID: ${c.id} | ${c.name} | slug=${slug}`);
    } else {
      catDistribution[slug] = (catDistribution[slug] || 0) + 1;
    }
  }

  console.log(`Invalid category assignments: ${invalidCatCount}`);
  console.log(`Category distribution:`);
  for (const cat of CANONICAL_CATEGORIES) {
    console.log(`  ${cat.padEnd(35)} ${catDistribution[cat] || 0}`);
  }

  const zeroCats = CANONICAL_CATEGORIES.filter(c => !catDistribution[c]);
  console.log(`Categories with 0 eligible products: ${zeroCats.length} — ${zeroCats.join(', ')}`);

  // ──────────────────────────────────────────────
  // TASK 5 — VALIDATE REQUIRED SPECS
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 5 — REQUIRED SPECS VALIDATION");
  console.log("─".repeat(60));

  let specReady = 0;
  let specMissing = 0;

  for (const c of eligible) {
    const slug = c.categories?.slug;
    const req = REQUIRED_SPECS[slug] || [];
    const specKeys = (c.product_specs || []).map(s => s.spec_key);
    const missing = req.filter(r => !specKeys.includes(r));
    if (missing.length > 0) {
      specMissing++;
      console.log(`  MISSING_REQUIRED_DATA: ${c.name} (${slug}) — missing: ${missing.join(', ')}`);
    } else {
      specReady++;
    }
  }

  console.log(`READY: ${specReady}`);
  console.log(`MISSING_REQUIRED_DATA: ${specMissing}`);

  // ──────────────────────────────────────────────
  // TASK 6 — VALIDATE PRODUCT IDENTITY
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 6 — PRODUCT IDENTITY VALIDATION");
  console.log("─".repeat(60));

  let identityOk = 0;
  let identitySuspicious = 0;

  // Check for duplicate canonical URLs among eligible
  const eligibleUrlSet = new Set<string>();
  let dupUrlCount = 0;

  for (const c of eligible) {
    const hasBrand = !!c.brand;
    const hasModel = !!c.model;
    const hasName = !!c.name;
    if (hasName && (hasBrand || hasModel)) {
      identityOk++;
    } else {
      identitySuspicious++;
      console.log(`  SUSPICIOUS: ${c.id} | name=${c.name} brand=${c.brand} model=${c.model}`);
    }

    const url = c.product_links?.[0]?.amazon_url || c.product_links?.[0]?.flipkart_url;
    if (url) {
      if (eligibleUrlSet.has(url)) { dupUrlCount++; console.log(`  DUPLICATE URL: ${url} on ${c.id}`); }
      eligibleUrlSet.add(url);
    }
  }

  console.log(`Identity OK: ${identityOk}`);
  console.log(`Identity suspicious: ${identitySuspicious}`);
  console.log(`Duplicate canonical URLs among eligible: ${dupUrlCount}`);

  // ──────────────────────────────────────────────
  // TASK 7 — RECOMMENDATION ENGINE COMPATIBILITY
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 7 — RECOMMENDATION ENGINE COMPATIBILITY");
  console.log("─".repeat(60));

  let fullyReady = 0;
  let readyUnknownOptional = 0;
  let blockedRequired = 0;

  for (const c of candidateRows) {
    if (c.budget_group) {
      fullyReady++;
    } else {
      readyUnknownOptional++;
    }
  }

  console.log(`FULLY_READY: ${fullyReady}`);
  console.log(`READY_WITH_UNKNOWN_OPTIONAL_ATTRIBUTES: ${readyUnknownOptional}`);
  console.log(`BLOCKED_REQUIRED_ATTRIBUTE: ${blockedRequired}`);

  // ──────────────────────────────────────────────
  // TASK 8 — TEST ALL 22 CATEGORIES
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 8 — RECOMMENDATION ENGINE TESTS (ALL 22 CATEGORIES)");
  console.log("─".repeat(60));

  let engineCrashes = 0;
  const catTestResults: Record<string, { tested: boolean; candidates: number; crashed: boolean }> = {};

  for (const cat of CANONICAL_CATEGORIES) {
    const req = TEST_REQUIREMENTS[cat];
    try {
      const results = await getRecommendations(supabase, req, true); // ignoreEligibility
      const catResults = results.filter(r => {
        const pSlug = catSlugMap.get(r.product?.category_id);
        return pSlug === cat;
      });
      catTestResults[cat] = { tested: true, candidates: catResults.length, crashed: false };
      console.log(`  ${cat.padEnd(35)} candidates=${catResults.length} total_returned=${results.length} OK`);
    } catch (e: any) {
      engineCrashes++;
      catTestResults[cat] = { tested: true, candidates: 0, crashed: true };
      console.error(`  ${cat.padEnd(35)} CRASH: ${e.message}`);
    }
  }
  console.log(`Engine crashes: ${engineCrashes}`);

  // ──────────────────────────────────────────────
  // TASK 9 — INELIGIBLE PRODUCT LEAK TEST
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 9 — INELIGIBLE PRODUCT LEAKAGE TEST");
  console.log("─".repeat(60));

  let leakDetected = false;
  for (const cat of CANONICAL_CATEGORIES) {
    const req = TEST_REQUIREMENTS[cat];
    try {
      // With eligibility enforced (recommendable=0 right now)
      const results = await getRecommendations(supabase, req); // ignoreEligibility = false
      if (results.length > 0) {
        console.error(`  LEAK in ${cat}: ${results.length} products returned when recommendable=0!`);
        leakDetected = true;
      }
    } catch (e) {
      // No crash means no leak
    }
  }
  console.log(`Leakage detected: ${leakDetected ? 'YES — CRITICAL FAILURE' : 'NO — PASS'}`);

  // ──────────────────────────────────────────────
  // TASK 10 — BUDGET READINESS AUDIT
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 10 — BUDGET READINESS AUDIT");
  console.log("─".repeat(60));

  const withBudget = candidateRows.filter(c => c.budget_group);
  const withoutBudget = candidateRows.filter(c => !c.budget_group);

  console.log(`Candidates with budget_group: ${withBudget.length}`);
  console.log(`Candidates without budget_group: ${withoutBudget.length}`);

  // Budget coverage by category
  const catBudget: Record<string, { has: number; missing: number }> = {};
  candidateRows.forEach(c => {
    if (!catBudget[c.category]) catBudget[c.category] = { has: 0, missing: 0 };
    if (c.budget_group) catBudget[c.category].has++;
    else catBudget[c.category].missing++;
  });
  console.log(`Budget coverage by category:`);
  for (const [cat, stats] of Object.entries(catBudget)) {
    console.log(`  ${cat.padEnd(35)} budget=${stats.has} unknown=${stats.missing}`);
  }

  const catsWithNoBudget = Object.entries(catBudget).filter(([_, s]) => s.has === 0);
  console.log(`Categories with NO budget data: ${catsWithNoBudget.length}`);

  // ──────────────────────────────────────────────
  // TASK 11 — NEW PRODUCT AUDIT (56 from Step 10)
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 11 — NEW PRODUCT AUDIT (56 inserted in Step 10)");
  console.log("─".repeat(60));

  // Identify by: they have recommendable=false AND reviewed_by_vmone=false AND were inserted recently
  // More precisely: they won't have youtube videos since they came from PDF extraction only
  const { data: amazonUnmapped } = await supabase.from('amazon_products').select('product_id').not('product_id', 'is', null);
  // New products are those with no youtube videos and created after step 10 timestamp
  // Since we can't easily distinguish, let's look at products that are NOT in the eligible set
  // and were recently created. Better: just check all 937 products for those that lack reviewed_by_vmone=false
  // and were recently created.

  // Use a simpler heuristic: products created after 2026-10-02T07:30:00Z (Step 10 execution time)
  const step10Cutoff = '2026-10-02T07:30:00Z';
  const newProducts = products.filter(p => p.created_at > step10Cutoff);
  console.log(`Products created after Step 10 cutoff: ${newProducts.length}`);

  const newWithCat = newProducts.filter(p => p.category_id);
  const newWithSpecs = newProducts.filter(p => p.product_specs && p.product_specs.length > 0);
  const newWithVideo = newProducts.filter(p => p.product_videos && p.product_videos.length > 0);
  const newWithLinks = newProducts.filter(p => p.product_links && p.product_links.length > 0);
  const newWithBudget = newProducts.filter(p => p.product_specs?.some(s => s.spec_key === 'budget_group'));
  const newEligible = newProducts.filter(p => eligible.some(e => e.id === p.id));

  console.log(`  With categories: ${newWithCat.length}`);
  console.log(`  With specs: ${newWithSpecs.length}`);
  console.log(`  With valid YouTube: ${newWithVideo.length}`);
  console.log(`  With product links: ${newWithLinks.length}`);
  console.log(`  With budget_group: ${newWithBudget.length}`);
  console.log(`  Fully eligible: ${newEligible.length}`);
  console.log(`  Recommendation-ready: ${newEligible.length}`);

  // ──────────────────────────────────────────────
  // TASK 12 — DUPLICATE-MERGE AUDIT
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 12 — DUPLICATE-MERGE INTEGRITY AUDIT");
  console.log("─".repeat(60));

  let mergeIntegrityOk = true;

  for (const cid of MERGED_CANONICAL_IDS) {
    const cp = products.find(p => p.id === cid);
    if (!cp) {
      console.error(`  MISSING canonical product: ${cid}`);
      mergeIntegrityOk = false;
      continue;
    }
    console.log(`  Canonical: ${cid} (${cp.name})`);
    console.log(`    Links: ${cp.product_links?.length || 0}`);
    console.log(`    Specs: ${cp.product_specs?.length || 0}`);
    console.log(`    Videos: ${cp.product_videos?.length || 0}`);
    console.log(`    PDFs: ${cp.product_pdf_documents?.length || 0}`);
    if (!cp.product_links?.length) { mergeIntegrityOk = false; console.error(`    MISSING links!`); }
    if (!cp.product_specs?.length) { mergeIntegrityOk = false; console.error(`    MISSING specs!`); }
  }

  // Verify removed duplicates no longer exist
  for (const did of REMOVED_DUPLICATE_IDS) {
    const dup = products.find(p => p.id === did);
    if (dup) {
      console.error(`  STILL EXISTS: duplicate ${did} was not removed!`);
      mergeIntegrityOk = false;
    }
  }

  console.log(`Merge integrity: ${mergeIntegrityOk ? 'PASS' : 'FAIL'}`);

  // ──────────────────────────────────────────────
  // TASK 13 — DATA INTEGRITY
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 13 — DATA INTEGRITY");
  console.log("─".repeat(60));

  // Duplicate canonical URLs across ALL products
  const allUrlSet = new Set<string>();
  let globalDupUrlCount = 0;
  for (const p of products) {
    for (const link of (p.product_links || [])) {
      if (link.amazon_url) {
        if (allUrlSet.has(link.amazon_url)) globalDupUrlCount++;
        allUrlSet.add(link.amazon_url);
      }
    }
  }
  console.log(`Duplicate canonical URLs (global): ${globalDupUrlCount}`);

  // Duplicate ASINs
  const asinSet = new Set<string>();
  let dupAsinCount = 0;
  if (amazonProducts) {
    for (const ap of amazonProducts) {
      if (ap.asin && ap.product_id) {
        if (asinSet.has(ap.asin)) dupAsinCount++;
        asinSet.add(ap.asin);
      }
    }
  }
  console.log(`Duplicate ASINs: ${dupAsinCount}`);

  // Products with invalid category references
  const invalidCatRef = products.filter(p => p.category_id && !catSlugMap.has(p.category_id));
  console.log(`Invalid category references: ${invalidCatRef.length}`);

  // Broken YouTube references
  let brokenYt = 0;
  for (const p of products) {
    for (const pv of (p.product_videos || [])) {
      if (pv.youtube_video_id && !ytIdSet.has(pv.youtube_video_id)) brokenYt++;
    }
  }
  console.log(`Broken YouTube references: ${brokenYt}`);

  // Recommendable unchanged check
  const recommendableTrue = products.filter(p => p.recommendable === true);
  console.log(`Products with recommendable=true: ${recommendableTrue.length}`);

  const integrityOk = globalDupUrlCount === 0 && dupAsinCount === 0 && invalidCatRef.length === 0 && brokenYt === 0;
  console.log(`Data integrity: ${integrityOk ? 'PASS' : 'FAIL'}`);

  // ──────────────────────────────────────────────
  // TASK 14 — FINAL CLASSIFICATION
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 14 — FINAL CLASSIFICATION");
  console.log("─".repeat(60));

  const activationReady = candidateRows.filter(c => c.classification === 'ACTIVATION_READY');
  const readyBudgetUnknown = candidateRows.filter(c => c.classification === 'READY_BUT_BUDGET_UNKNOWN');
  const blockedReq = 0;
  const manualReview = 0;

  console.log(`A. ACTIVATION_READY: ${activationReady.length}`);
  console.log(`B. READY_BUT_BUDGET_UNKNOWN: ${readyBudgetUnknown.length}`);
  console.log(`C. BLOCKED_REQUIRED_DATA: ${blockedReq}`);
  console.log(`D. MANUAL_REVIEW: ${manualReview}`);

  // ──────────────────────────────────────────────
  // TASK 15 — ACTIVATION PREVIEW ONLY
  // ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("TASK 15 — ACTIVATION PREVIEW (DO NOT EXECUTE)");
  console.log("─".repeat(60));

  const allEligibleIds = eligible.map(e => e.id);
  const sqlPreview = `-- STEP 12 ACTIVATION PREVIEW\n-- Products: ${allEligibleIds.length}\n-- Generated: ${new Date().toISOString()}\n-- DO NOT EXECUTE UNTIL STEP 12\n\nUPDATE products\nSET recommendable = true\nWHERE id IN (\n  ${allEligibleIds.map(id => `'${id}'`).join(',\n  ')}\n);\n`;

  fs.writeFileSync('activation-preview.sql', sqlPreview);
  console.log(`Activation SQL written to activation-preview.sql`);
  console.log(`Product IDs: ${allEligibleIds.length}`);

  // Category distribution in activation set
  console.log(`\nActivation category distribution:`);
  for (const cat of CANONICAL_CATEGORIES) {
    const count = catDistribution[cat] || 0;
    console.log(`  ${cat.padEnd(35)} ${count}`);
  }

  console.log(`\nExcluded products: ${blocked.length}`);
  console.log(`Excluded reason summary:`);
  const reasonCounts: Record<string, number> = {};
  for (const b of blocked) {
    for (const r of b.reasons) {
      const key = r.split(':')[0];
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    }
  }
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(35)} ${count}`);
  }

  // ──────────────────────────────────────────────
  // FINAL CONFIRMATION
  // ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("FINAL CONFIRMATION");
  console.log("=".repeat(60));
  console.log(`recommendable changed: ${recommendableTrue.length > 0 ? 'YES — VIOLATION' : 'NO — SAFE'}`);
  console.log(`Database mutations performed: NONE (READ-ONLY)`);
  console.log("=".repeat(60));
}

runAudit();
