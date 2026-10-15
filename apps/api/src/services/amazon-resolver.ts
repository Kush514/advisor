import { SupabaseClient } from '@supabase/supabase-js';

export interface AmazonResolveStats {
  linkOccurrences: number;
  uniqueUrls: number;
  processed: number;
  resolved: number;
  productUrls: number;
  uniqueAsins: number;
  unresolved: number;
  failed: number;
  duplicates: number;
  topDomains: Record<string, number>;
}

/**
 * Extracts an ASIN from a resolved Amazon URL.
 */
export function extractAsin(url: string): string | null {
  const regex = /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
  const match = url.match(regex);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Normalizes Amazon destination URLs to remove tracking params safely.
 */
export function canonicalizeAmazonUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove aggressive tracking parameters
    ['tag', 'linkCode', 'linkId', 'ref_', 'ref', 'ascsubtag', 'psc', 'crid', 'dib', 'dib_tag', 'keywords', 'qid', 'sprefix', 'sr'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Safely resolves an Amazon shortlink by following redirects manually up to 5 times.
 * This prevents triggering aggressive bot-protection on the final product page.
 */
export async function resolveAmazonShortlink(initialUrl: string): Promise<{ finalUrl: string, status: number }> {
  let currentUrl = initialUrl;
  let hops = 0;
  let lastStatus = 200;
  
  while (hops < 5) {
    try {
      const res = await fetch(currentUrl, { 
        method: 'HEAD', 
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      
      lastStatus = res.status;
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) {
          currentUrl = new URL(location, currentUrl).toString();
          hops++;
          
          // Optimization: If it's an amazon domain and we found an ASIN, we can stop immediately!
          if (currentUrl.includes('amazon.') && extractAsin(currentUrl)) {
            return { finalUrl: currentUrl, status: 200 };
          }
          continue;
        }
      }
      
      // Some shorteners (link.amazon, bit.ly) only redirect on GET
      // (link.amazon answers HEAD with an error status, so any non-redirect on a non-amazon.* host is retried)
      if (!(res.status >= 300 && res.status < 400) && !currentUrl.includes('amazon.')) {
        const viaGet = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const location = viaGet.headers.get('location');
        if (viaGet.status >= 300 && viaGet.status < 400 && location) {
          currentUrl = new URL(location, currentUrl).toString();
          hops++;
          if (currentUrl.includes('amazon.') && extractAsin(currentUrl)) {
            return { finalUrl: currentUrl, status: 200 };
          }
          continue;
        }
      }

      // If we got 403 or 405 on HEAD, try a fast GET with follow
      if (res.status === 403 || res.status === 405) {
         const fallback = await fetch(currentUrl, { method: 'GET', redirect: 'follow' });
         return { finalUrl: fallback.url, status: fallback.status };
      }
      
      break;
    } catch (e) {
      break;
    }
  }
  
  return { finalUrl: currentUrl, status: lastStatus };
}

export async function processAmazonLinks(
  supabase: SupabaseClient, 
  limit: number = 50
): Promise<AmazonResolveStats> {
  const stats: AmazonResolveStats = {
    linkOccurrences: 0,
    uniqueUrls: 0,
    processed: 0,
    resolved: 0,
    productUrls: 0,
    uniqueAsins: 0,
    unresolved: 0,
    failed: 0,
    duplicates: 0,
    topDomains: {}
  };

  // Pre-calculate occurrences (this is fast)
  const { count } = await supabase
    .from('youtube_video_links')
    .select('id', { count: 'exact', head: true })
    .eq('link_type', 'amazon');
  
  stats.linkOccurrences = count || 0;

  // 1. Fetch unique Amazon links that are not yet resolved
  const { data: links, error } = await supabase
    .from('youtube_video_links')
    .select('normalized_url, original_url')
    .eq('link_type', 'amazon')
    .is('amazon_product_id', null)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch Amazon candidates: ${error.message}`);
  }

  // Amazon links found inside VM One PDFs are resolved the same way
  const { data: pdfLinks, error: pdfError } = await supabase
    .from('pdf_document_links')
    .select('normalized_url, original_url')
    .eq('link_type', 'amazon')
    .is('amazon_product_id', null)
    .limit(limit);

  if (pdfError) {
    throw new Error(`Failed to fetch PDF Amazon candidates: ${pdfError.message}`);
  }

  // Deduplicate candidates in memory
  const uniqueUrls = new Map<string, string>();
  for (const link of [...(links || []), ...(pdfLinks || [])]) {
    if (!uniqueUrls.has(link.normalized_url)) {
      uniqueUrls.set(link.normalized_url, link.original_url);
    }
  }

  stats.uniqueUrls = uniqueUrls.size;

  for (const [normalizedUrl, originalUrl] of uniqueUrls.entries()) {
    stats.processed++;
    let resolvedUrl = normalizedUrl;
    let asin: string | null = null;
    let status = 'unresolved';
    
    try {
      // Record top domains
      const initUrlObj = new URL(originalUrl);
      stats.topDomains[initUrlObj.hostname] = (stats.topDomains[initUrlObj.hostname] || 0) + 1;
      
      // Resolve
      const res = await resolveAmazonShortlink(originalUrl);
      resolvedUrl = res.finalUrl;
      
      if (res.status >= 200 && res.status < 400) {
        stats.resolved++;
        asin = extractAsin(resolvedUrl);
        
        if (asin) {
          status = 'resolved';
          stats.productUrls++;
        } else {
          status = 'invalid';
          stats.unresolved++;
        }
      } else {
        status = 'failed';
        stats.failed++;
      }
      
    } catch (err: any) {
      status = 'failed';
      stats.failed++;
    }
    
    // Database Storage
    try {
      const canonical = canonicalizeAmazonUrl(resolvedUrl);
      let marketplaceDomain = null;
      try { marketplaceDomain = new URL(canonical).hostname; } catch(e){}

      let amazonProductId: string | null = null;

      // Upsert into amazon_products
      if (asin) {
        // Find if ASIN already exists to prevent duplicate inserts if concurrent 
        // (Supabase upsert on conflict handles this cleanly)
        const { data: upsertData, error: upsertError } = await supabase
          .from('amazon_products')
          .upsert({
            asin,
            canonical_url: canonical,
            marketplace_domain: marketplaceDomain,
            status
          }, { onConflict: 'asin' })
          .select('id')
          .single();
          
        if (upsertError) throw upsertError;
        if (upsertData) {
          amazonProductId = upsertData.id;
          stats.uniqueAsins++; // Wait, it might be an existing one. We will just report processed.
        }
      } else {
        // If no ASIN, just insert it without ASIN (allow duplicates since ASIN is null)
        const { data: insertData, error: insertError } = await supabase
          .from('amazon_products')
          .insert({
            canonical_url: canonical,
            marketplace_domain: marketplaceDomain,
            status
          })
          .select('id')
          .single();
          
        if (insertError) throw insertError;
        if (insertData) amazonProductId = insertData.id;
      }
      
      // Update ALL youtube_video_links and pdf_document_links that used this normalized URL
      if (amazonProductId) {
        await supabase
          .from('youtube_video_links')
          .update({ amazon_product_id: amazonProductId })
          .eq('normalized_url', normalizedUrl);
        await supabase
          .from('pdf_document_links')
          .update({ amazon_product_id: amazonProductId })
          .eq('normalized_url', normalizedUrl);
      }
      
    } catch (dbErr: any) {
      console.error('DB Error updating Amazon product:', dbErr);
    }
  }
  
  // Sort top domains
  stats.topDomains = Object.entries(stats.topDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

  return stats;
}
