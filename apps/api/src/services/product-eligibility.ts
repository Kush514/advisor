import { SupabaseClient } from '@supabase/supabase-js';

export interface EligibilityReport {
  totalProducts: number;
  activeProducts: number;
  categorizedProducts: number;
  uncategorizedProducts: number;
  validLinks: number;
  missingLinks: number;
  specsComplete: number;
  specsMissing: number;
  vmoneEvidence: {
    EXACT_PRODUCT: number;
    RELEVANT_PRODUCT_TYPE: number;
    RELEVANT_CATEGORY: number;
    RELEVANT_USE_CASE: number;
    NO_RELEVANT_CONTENT: number;
  };
  brandAvailable: number;
  brandInferable: number;
  brandUnknown: number;
  productsEligible: number;
  productsNotEligible: number;
  categoryBreakdown: Record<string, CategoryStats>;
  eligibleProductIds: string[];
}

export interface CategoryStats {
  total: number;
  active: number;
  specsComplete: number;
  vmoneEvidence: number;
  eligible: number;
}

export const CANONICAL_CATEGORIES = [
  'air-purifier', 'air-fryer', 'chimney', 'cooktop-induction', 'gas-stove',
  'washing-machine', 'refrigerators', 'electric-iron', 'vacuum-cleaners-robot-vacuum',
  'air-conditioner', 'tv', 'geyser', 'soundbars', 'water-purifier', 'microwave-otg-oven',
  'mixer-grinder', 'ceiling-fans', 'electric-cooker', 'inverter-battery',
  'smart-door-lock', 'air-cooler', 'room-heaters', 'dishwasher'
];

export const REQUIRED_SPECS_BY_CAT: Record<string, string[]> = {
  'tv': ['screen_size'],
  'washing-machine': ['capacity'],
  'refrigerators': ['capacity'],
  'air-conditioner': ['capacity'],
  'microwave-otg-oven': ['capacity']
};

export const KNOWN_BRANDS = [
  'samsung', 'lg', 'sony', 'panasonic', 'whirlpool', 'bosch', 'ifb', 'haier',
  'godrej', 'voltas', 'daikin', 'hitachi', 'lloyd', 'blue star', 'carrier',
  'o general', 'toshiba', 'xiaomi', 'mi', 'oneplus', 'tcl', 'hisense', 'acer',
  'vu', 'motorola', 'nokia', 'realme', 'philips', 'bajaj', 'havells', 'crompton',
  'orient', 'usha', 'v-guard', 'symphony', 'kenstar', 'pigeon', 'prestige',
  'butterfly', 'wonderchef', 'agararo', 'eureka forbes', 'kent', 'livpure',
  'pureit', 'ao smith', 'racold', 'venus', 'hindware', 'elica', 'faber',
  'glen', 'sunflame', 'ecovacs', 'dreame', 'roborock', 'milagrow', 'dyson',
  'karcher', 'black+decker', 'siemens', 'miele'
];

export function getInferredBrand(name?: string, currentBrand?: string): string | null {
  if (currentBrand) return currentBrand;
  const nameLower = (name || '').toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (nameLower.startsWith(b + ' ') || nameLower === b) {
      return b;
    }
  }
  return null;
}

export async function validateAndMarkEligibility(
  supabase: SupabaseClient,
  dryRun = true
): Promise<{ ok: boolean; report: EligibilityReport }> {
  
  const report: EligibilityReport = {
    totalProducts: 0,
    activeProducts: 0,
    categorizedProducts: 0,
    uncategorizedProducts: 0,
    validLinks: 0,
    missingLinks: 0,
    specsComplete: 0,
    specsMissing: 0,
    vmoneEvidence: { EXACT_PRODUCT: 0, RELEVANT_PRODUCT_TYPE: 0, RELEVANT_CATEGORY: 0, RELEVANT_USE_CASE: 0, NO_RELEVANT_CONTENT: 0 },
    brandAvailable: 0,
    brandInferable: 0,
    brandUnknown: 0,
    productsEligible: 0,
    productsNotEligible: 0,
    categoryBreakdown: {},
    eligibleProductIds: []
  };

  CANONICAL_CATEGORIES.forEach(c => {
    report.categoryBreakdown[c] = { total: 0, active: 0, specsComplete: 0, vmoneEvidence: 0, eligible: 0 };
  });

  const { data: youtubeVideos } = await supabase.from('youtube_videos').select('id, title, description, published_at');
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select(`
      *,
      categories(id, slug, name),
      product_specs ( spec_key, spec_value ),
      product_links ( amazon_url, flipkart_url ),
      product_videos ( youtube_video_id ),
      product_pdf_documents ( pdf_document_id )
    `);

  if (pErr || !products || !youtubeVideos) throw new Error('Failed to fetch data for eligibility');

  report.totalProducts = products.length;

  for (const prod of products) {
    if (prod.status === 'active') report.activeProducts++;

    const cats = prod.categories as any;
    let catSlug = Array.isArray(cats) ? cats[0]?.slug : cats?.slug;
    
    // Removed the dishwasher fallback so eligibility strictly depends on DB category existence
    const isCanonical = CANONICAL_CATEGORIES.includes(catSlug || '');

    if (isCanonical) report.categorizedProducts++;
    else report.uncategorizedProducts++;

    const hasLink = prod.product_links && prod.product_links.length > 0 && prod.product_links.some((l: any) => l.amazon_url || l.flipkart_url);
    if (hasLink) report.validLinks++;
    else report.missingLinks++;

    const reqSpecs = REQUIRED_SPECS_BY_CAT[catSlug || ''] || [];
    const specKeys = (prod.product_specs || []).map((s: any) => s.spec_key.toLowerCase());
    const missingSpecs = reqSpecs.filter(rs => !specKeys.includes(rs));
    const hasRequiredSpecs = missingSpecs.length === 0;

    if (hasRequiredSpecs) report.specsComplete++;
    else report.specsMissing++;

    // Determine evidence
    let evidence = 'NO_RELEVANT_CONTENT';
    if (prod.product_videos && prod.product_videos.length > 0) {
      evidence = 'EXACT_PRODUCT';
    } else if (prod.product_pdf_documents && prod.product_pdf_documents.length > 0) {
       evidence = 'RELEVANT_PRODUCT_TYPE'; // Mapping PDF to product type
    } else if (isCanonical && catSlug) {
      const keywords = catSlug.split('-');
      const hasCatVideo = youtubeVideos.some(v => {
        const t = v.title.toLowerCase();
        return keywords.some((k: string) => k.length > 3 && t.includes(k));
      });
      if (hasCatVideo) evidence = 'RELEVANT_CATEGORY';
    }

    report.vmoneEvidence[evidence as keyof typeof report.vmoneEvidence]++;

    let brandClass = 'unknown';
    if (prod.brand) {
      report.brandAvailable++;
      brandClass = 'available';
    } else if (getInferredBrand(prod.name, prod.brand)) {
      report.brandInferable++;
      brandClass = 'inferable';
    } else {
      report.brandUnknown++;
    }

    const isEligible = 
      prod.status === 'active' &&
      isCanonical &&
      hasLink &&
      hasRequiredSpecs &&
      brandClass !== 'unknown' &&
      // Never re-enable a product users can't buy (kept up to date by scripts/refresh-availability.ts).
      // The column only exists after migration 0007; until then stock isn't known here.
      (prod.amazon_availability == null || ['IN_STOCK', 'IN_STOCK_SCARCE'].includes(prod.amazon_availability));

    if (isEligible) {
      report.productsEligible++;
      report.eligibleProductIds.push(prod.id);
    } else {
      report.productsNotEligible++;
    }

    if (isCanonical && catSlug) {
      const cb = report.categoryBreakdown[catSlug];
      if (cb) {
        cb.total++;
        if (prod.status === 'active') cb.active++;
        if (hasRequiredSpecs) cb.specsComplete++;
        if (evidence !== 'NO_RELEVANT_CONTENT') cb.vmoneEvidence++;
        if (isEligible) cb.eligible++;
      }
    }
  }

  // Safe Update Mode
  if (!dryRun && report.eligibleProductIds.length > 0) {
    // Process in batches of 100 for safety
    for (let i = 0; i < report.eligibleProductIds.length; i += 100) {
      const batch = report.eligibleProductIds.slice(i, i + 100);
      await supabase
        .from('products')
        .update({ recommendable: true })
        .in('id', batch);
    }
  }

  return { ok: true, report };
}
