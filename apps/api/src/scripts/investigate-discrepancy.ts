// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const REQUIRED_SPECS: Record<string, string[]> = {
  'tv': ['screen_size'],
  'washing-machine': ['capacity', 'load_type'],
  'refrigerators': ['capacity'],
  'air-conditioner': ['capacity'],
  'microwave-otg-oven': ['capacity']
};

const CANONICAL_CATEGORIES = [
  'air-purifier', 'air-fryer', 'chimney', 'cooktop-induction', 'gas-stove',
  'washing-machine', 'refrigerators', 'electric-iron', 'vacuum-cleaners-robot-vacuum',
  'air-conditioner', 'tv', 'geyser', 'soundbars', 'water-purifier', 'microwave-otg-oven',
  'mixer-grinder', 'ceiling-fans', 'electric-cooker', 'inverter-battery',
  'smart-door-lock', 'air-cooler', 'room-heaters'
];

async function investigate() {
  const { data: products } = await supabase.from('products').select(`
    id, name, brand, model, category_id, subcategory, status, reviewed_by_vmone,
    categories(id, slug, name),
    product_specs(spec_key, spec_value),
    product_links(amazon_url, flipkart_url),
    product_videos(youtube_video_id, youtube_videos(id))
  `).eq('status', 'active').eq('reviewed_by_vmone', true);

  if (!products) return;

  // Filter to those with valid video
  const withVideo = products.filter(p => 
    p.product_videos && p.product_videos.length > 0 && 
    p.product_videos.some((pv: any) => pv.youtube_video_id && pv.youtube_videos)
  );
  console.log(`Active + reviewed + valid video: ${withVideo.length}`);

  // Eligibility service perspective (loose): category_id OR subcategory
  const eligByService = withVideo.filter(p => p.category_id || p.subcategory);
  console.log(`Eligibility service (loose) would count: ${eligByService.length}`);

  // My strict audit: must have category_id pointing to canonical 22
  const withCanonicalCat = withVideo.filter(p => 
    p.category_id && p.categories && CANONICAL_CATEGORIES.includes(p.categories.slug)
  );
  console.log(`With canonical category: ${withCanonicalCat.length}`);

  // Products that pass loose but fail strict (subcategory-only)
  const subcatOnly = withVideo.filter(p => !p.category_id && p.subcategory);
  console.log(`\nSubcategory-only (no category_id): ${subcatOnly.length}`);
  subcatOnly.forEach(p => console.log(`  - ${p.id} | ${p.name} | subcat: ${p.subcategory}`));

  // Products that fail identity check
  const missingIdentity = withCanonicalCat.filter(p => !p.name || (!p.brand && !p.model));
  console.log(`\nMissing identity (no brand AND no model): ${missingIdentity.length}`);
  missingIdentity.forEach(p => console.log(`  - ${p.id} | name: ${p.name} | brand: ${p.brand} | model: ${p.model}`));

  // Products that fail link check
  const missingLinks = withCanonicalCat.filter(p => 
    !p.product_links || p.product_links.length === 0 || 
    (!p.product_links[0].amazon_url && !p.product_links[0].flipkart_url)
  );
  console.log(`\nMissing product links: ${missingLinks.length}`);
  missingLinks.forEach(p => console.log(`  - ${p.id} | ${p.name}`));

  // Products that fail required specs for their category
  const missingReqSpecs = withCanonicalCat.filter(p => {
    if (!p.categories) return false;
    const req = REQUIRED_SPECS[p.categories.slug] || [];
    if (req.length === 0) return false;
    const specKeys = (p.product_specs || []).map((s: any) => s.spec_key);
    return req.some((r: string) => !specKeys.includes(r));
  });
  console.log(`\nMissing required specs for category: ${missingReqSpecs.length}`);
  missingReqSpecs.forEach(p => {
    const req = REQUIRED_SPECS[p.categories.slug] || [];
    const specKeys = (p.product_specs || []).map((s: any) => s.spec_key);
    const missing = req.filter((r: string) => !specKeys.includes(r));
    console.log(`  - ${p.id} | ${p.name} | cat: ${p.categories.slug} | missing: ${missing.join(', ')} | has: ${specKeys.join(', ')}`);
  });

  // Now compute the strict eligible set
  const strictEligible = withCanonicalCat.filter(p => {
    // Identity
    if (!p.name || (!p.brand && !p.model)) return false;
    // Links
    if (!p.product_links || p.product_links.length === 0 || (!p.product_links[0].amazon_url && !p.product_links[0].flipkart_url)) return false;
    // Required specs
    if (p.categories) {
      const req = REQUIRED_SPECS[p.categories.slug] || [];
      const specKeys = (p.product_specs || []).map((s: any) => s.spec_key);
      if (req.some((r: string) => !specKeys.includes(r))) return false;
    }
    return true;
  });
  console.log(`\nStrict eligible: ${strictEligible.length}`);

  // Summary of exclusion reasons
  const totalExcluded = withCanonicalCat.length - strictEligible.length;
  console.log(`\nExcluded from strict eligibility: ${totalExcluded}`);
}

investigate();
