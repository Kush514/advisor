import { SupabaseClient } from '@supabase/supabase-js';
import { ProductSpec, BudgetRequirement, ProductRequirements, FinderProduct, VMOneContent, VMOneContentClassification } from '@vmone/shared';
import { CATEGORY_ATTRIBUTES, getSize, getType } from './attributes';
import { getPreference, isStrictPreference, preferenceState, productText } from './preferences';

/**
 * Soft preference match: does the product mention this value in its specs, name or description?
 * Matches whole values only, so "7" does not match "7.5 kg" or "17".
 */
export function matchesFeature(
  product: { name?: string | null; description?: string | null; product_specs?: { spec_key: string; spec_value: string; spec_unit?: string | null }[] | null },
  feature: string
): boolean {
  const needle = feature.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!needle) return false;
  const pattern = new RegExp(`(^|[^a-z0-9.])${needle}($|[^a-z0-9])`);
  const specString = (product.product_specs || []).map(s => `${s.spec_key} ${s.spec_value} ${s.spec_unit || ''}`).join(' | ');
  return pattern.test(`${specString} | ${product.name || ''} | ${product.description || ''}`.toLowerCase());
}

export type MatchCriterion = {
  key: string;
  label: string;
  requirement: string;
  productValue: string;
  matched: boolean;
};

export type RecommendationResult = {
  productId: string;
  product: any;
  matchScore: number;
  matchedCriteria: MatchCriterion[];
  unmatchedCriteria: MatchCriterion[];
  unknownCriteria: MatchCriterion[];
};

// A product can appear in several VM One videos. Show an actual review/buying guide rather than a
// sale round-up or live stream, and the most recent one first.
const DEAL_VIDEO = /\b(deals?|sale|live|offers?)\b/i;
function pickBestVideo(videos: any[]): any | null {
  if (!videos || videos.length === 0) return null;
  return [...videos].sort((a, b) => {
    const dealDiff = Number(DEAL_VIDEO.test(a.title || '')) - Number(DEAL_VIDEO.test(b.title || ''));
    if (dealDiff !== 0) return dealDiff;
    return String(b.published_at || '').localeCompare(String(a.published_at || ''));
  })[0];
}

export async function getRecommendations(
  supabase: SupabaseClient,
  requirements: ProductRequirements,
  ignoreEligibilityForTesting = false
): Promise<FinderProduct[]> {
  
  let query = supabase
    .from('products')
    .select(`
      id, name, brand, model, description, category_id, subcategory, status, recommendable, price,
      categories!inner(id, slug),
      product_specs ( spec_key, spec_value, spec_unit ),
      product_links ( amazon_url, flipkart_url, brand_url, asin ),
      product_videos ( youtube_videos ( id, youtube_video_id, title, thumbnail_url, youtube_url, published_at ) )
    `)
    .eq('status', 'active');
    
  if (requirements.category) {
    query = query.eq('categories.slug', requirements.category);
  }

  if (!ignoreEligibilityForTesting) {
    query = query.eq('recommendable', true);
  }
  
  const { data: eligibleProducts, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch eligible products: ${error.message}`);
  }

  // If there are zero eligible products, return early
  if (!eligibleProducts || eligibleProducts.length === 0) {
    return [];
  }

  const results: RecommendationResult[] = [];

  // PHASE 4 - DETERMINISTIC MATCHING
  for (const product of eligibleProducts) {
    let score = 0;
    const matchedCriteria: MatchCriterion[] = [];
    const unmatchedCriteria: MatchCriterion[] = [];
    const unknownCriteria: MatchCriterion[] = [];

    // Category Match
    if (requirements.category) {
      const cats: any = product.categories;
      const productSlug = cats?.slug || (Array.isArray(cats) && cats[0]?.slug);
      if (productSlug?.toLowerCase() === requirements.category.toLowerCase() || 
          product.subcategory?.toLowerCase() === requirements.category.toLowerCase()) {
        score += 10;
        matchedCriteria.push({
          key: 'category',
          label: 'Category',
          requirement: requirements.category,
          productValue: productSlug || product.subcategory || 'Unknown',
          matched: true
        });
      } else {
        unmatchedCriteria.push({
          key: 'category',
          label: 'Category',
          requirement: requirements.category,
          productValue: productSlug || product.subcategory || 'Unknown',
          matched: false
        });
      }
    }

    // Brand Match
    if (requirements.brand && requirements.brand.length > 0) {
      if (product.brand && requirements.brand.map(b => b.toLowerCase()).includes(product.brand.toLowerCase())) {
        score += 5;
        matchedCriteria.push({
          key: 'brand',
          label: 'Brand',
          requirement: requirements.brand.join(' or '),
          productValue: product.brand,
          matched: true
        });
      } else if (product.brand) {
        unmatchedCriteria.push({
          key: 'brand',
          label: 'Brand',
          requirement: requirements.brand.join(' or '),
          productValue: product.brand,
          matched: false
        });
      } else {
        unknownCriteria.push({
          key: 'brand',
          label: 'Brand',
          requirement: requirements.brand.join(' or '),
          productValue: 'Unknown',
          matched: false
        });
      }
    }

    // Size / type: the answers people expect to be honoured exactly (see attributes.ts)
    const attrs = requirements.category ? CATEGORY_ATTRIBUTES[requirements.category] : undefined;
    if (requirements.attributes?.size && attrs?.size) {
      const { min, max } = requirements.attributes.size;
      const size = getSize(product, attrs.size);
      // Strict: a different size, or a size we cannot confirm, is never recommended
      if (size === null || size < min || size > max) continue;
      score += 10;
      matchedCriteria.push({ key: 'size', label: 'Size', requirement: `${min}-${max}`, productValue: attrs.size.format(size), matched: true });
    }
    if (requirements.attributes?.type && attrs?.type) {
      const wanted = requirements.attributes.type;
      const type = getType(product, attrs.type);
      // A known different type is excluded; an unknown type stays but earns no points
      if (type !== null && type !== wanted) continue;
      const label = attrs.type.choices.find(c => c.value === wanted)?.label || wanted;
      if (type === wanted) {
        score += 10;
        matchedCriteria.push({ key: 'type', label: 'Type', requirement: wanted, productValue: label, matched: true });
      } else {
        unknownCriteria.push({ key: 'type', label: 'Type', requirement: wanted, productValue: 'Unknown', matched: false });
      }
    }

    // Preferences: a match ranks the product higher. Strict ones (star rating, power, room size)
    // also remove products that clearly state a different value (see preferences.ts)
    if (requirements.preferences?.length) {
      const text = productText(product);
      let excluded = false;
      for (const { key, value } of requirements.preferences) {
        const pref = getPreference(requirements.category, key);
        const option = pref?.options.find(o => o.value === value);
        if (!pref || !option) continue;
        const state = preferenceState(pref, option, text);
        if (state === 'mismatch' && isStrictPreference(requirements.category, key)) { excluded = true; break; }
        if (state === 'match') {
          score += 5;
          matchedCriteria.push({ key, label: 'Preference', requirement: value, productValue: option.reason || option.label, matched: true });
        } else {
          unmatchedCriteria.push({ key, label: 'Preference', requirement: value, productValue: 'Not listed', matched: false });
        }
      }
      if (excluded) continue;
    }

    // Features Match
    if (requirements.features && requirements.features.length > 0) {
      for (const feature of requirements.features) {
        if (matchesFeature(product, feature)) {
          score += 3;
          matchedCriteria.push({
            key: 'feature',
            label: 'Feature',
            requirement: feature,
            productValue: feature,
            matched: true
          });
        } else if (product.product_specs && product.product_specs.length > 0) {
          unmatchedCriteria.push({
            key: 'feature',
            label: 'Feature',
            requirement: feature,
            productValue: 'Not explicitly supported',
            matched: false
          });
        } else {
          unknownCriteria.push({
            key: 'feature',
            label: 'Feature',
            requirement: feature,
            productValue: 'Unknown',
            matched: false
          });
        }
      }
    }

    // Model Match
    if (requirements.model) {
      if (product.model?.toLowerCase().includes(requirements.model.toLowerCase()) || product.name?.toLowerCase().includes(requirements.model.toLowerCase())) {
        score += 8;
        matchedCriteria.push({
          key: 'model',
          label: 'Model',
          requirement: requirements.model,
          productValue: product.model || product.name,
          matched: true
        });
      }
    }

    // Budget Matching
    if (requirements.budget) {
      if (requirements.budget.kind === 'group') {
        // Normalize questionnaire option (e.g., 'UNDER_30K' -> 'under 30k')
        const requiredGroup = requirements.budget.value.toLowerCase().replace(/_/g, ' ').trim();
        const productBudgetRaw = product.product_specs?.find((s: any) => s.spec_key.toLowerCase() === 'budget_group')?.spec_value;
        const productBudgetGroup = productBudgetRaw ? productBudgetRaw.toLowerCase().replace(/_/g, ' ').trim() : null;
        
        if (productBudgetGroup) {
          if (productBudgetGroup === requiredGroup) {
            score += 15;
            matchedCriteria.push({
              key: 'budget',
              label: 'Budget',
              requirement: requiredGroup,
              productValue: productBudgetGroup,
              matched: true
            });
          } else {
            score -= 10;
            unmatchedCriteria.push({
              key: 'budget',
              label: 'Budget',
              requirement: requiredGroup,
              productValue: productBudgetGroup,
              matched: false
            });
          }
        } else {
          unknownCriteria.push({
            key: 'budget',
            label: 'Budget',
            requirement: requiredGroup,
            productValue: 'Unknown budget group',
            matched: false
          });
        }
      } else {
        const { min, max } = requirements.budget;
        const requirement = `₹${(min || 0).toLocaleString('en-IN')} - ${max ? '₹' + max.toLocaleString('en-IN') : 'Any'}`;
        const price = typeof product.price === 'number' ? product.price : null;

        if (price !== null) {
          // Hard filter: a known price outside the selected range is never recommended
          if ((min !== undefined && price < min) || (max !== undefined && price > max)) {
            continue;
          }
          score += 15;
          matchedCriteria.push({
            key: 'budget',
            label: 'Budget',
            requirement,
            productValue: `₹${price.toLocaleString('en-IN')}`,
            matched: true
          });
        } else {
          // Unknown price can't be shown to honour a budget, so exclude it
          continue;
        }
      }
    }

    // If there were requirements but it matched absolutely nothing, and unmatched things exist, penalize
    if (Object.keys(requirements).length > 0 && matchedCriteria.length === 0 && unmatchedCriteria.length > 0) {
      score -= 5;
    }

    results.push({
      productId: product.id,
      product,
      matchScore: score,
      matchedCriteria,
      unmatchedCriteria,
      unknownCriteria
    });
  }

  // Rank matching products (highest score first)
  results.sort((a, b) => {
    const scoreDiff = b.matchScore - a.matchScore;
    if (scoreDiff !== 0) return scoreDiff;
    return a.productId.localeCompare(b.productId);
  });

  const maxPossibleScore = 
    (requirements.category ? 10 : 0) +
    (requirements.brand && requirements.brand.length > 0 ? 5 : 0) +
    (requirements.features ? requirements.features.length * 3 : 0) +
    (requirements.model ? 8 : 0) +
    (requirements.attributes?.size ? 10 : 0) +
    (requirements.attributes?.type ? 10 : 0) +
    (requirements.preferences?.length || 0) * 5 +
    (requirements.budget ? 15 : 0);

  // Pre-extract all videos in this category for fallback
  const allCategoryVideos = results
    .flatMap(r => r.product.product_videos?.map((pv: any) => pv.youtube_videos).filter(Boolean) || []);

  const finderResults: FinderProduct[] = results.map(r => {
    let percentage = 0;
    if (maxPossibleScore > 0) {
      percentage = Math.round((r.matchScore / maxPossibleScore) * 100);
      percentage = Math.max(0, Math.min(100, percentage));
    }
    
    const ytVideos = r.product.product_videos?.map((pv: any) => pv.youtube_videos).filter(Boolean) || [];
    let mainVideo = pickBestVideo(ytVideos);
    let classification: VMOneContentClassification = mainVideo ? 'EXACT_PRODUCT' : 'NO_RELEVANT_CONTENT';
    
    if (!mainVideo && allCategoryVideos.length > 0) {
      mainVideo = pickBestVideo(allCategoryVideos);
      classification = 'RELEVANT_CATEGORY';
    }
    
    const vmOneContent: VMOneContent = {
      classification,
      video: mainVideo ? {
        id: mainVideo.youtube_video_id || mainVideo.id,
        title: mainVideo.title,
        thumbnailUrl: mainVideo.thumbnail_url,
        youtubeUrl: mainVideo.youtube_url
      } : null
    };

    return {
      id: r.product.id,
      name: r.product.name,
      brand: r.product.brand,
      model: r.product.model,
      category: r.product.categories?.slug || 'unknown',
      subcategory: r.product.subcategory,
      imageUrl: null, // Gap: no image source
      asin: r.product.product_links?.[0]?.asin || null,
      price: {
        amount: typeof r.product.price === 'number' ? r.product.price : null,
        currency: 'INR',
        source: typeof r.product.price === 'number' ? 'amazon' : null
      },
      links: {
        amazon: r.product.product_links?.[0]?.amazon_url || null,
        flipkart: r.product.product_links?.[0]?.flipkart_url || null,
        brand: r.product.product_links?.[0]?.brand_url || null
      },
      match: {
        score: r.matchScore,
        maxScore: maxPossibleScore > 0 ? maxPossibleScore : null,
        percentage
      },
      whyItMatches: {
        matched: r.matchedCriteria.map(c => c.label + ': ' + c.productValue),
        unmatched: r.unmatchedCriteria.map(c => c.label + ': ' + c.productValue)
      },
      vmOneContent
    };
  });

  return finderResults;
}
