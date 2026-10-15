import { SupabaseClient } from '@supabase/supabase-js';

export interface FlipkartResolveStats {
  occurrences: number;
  uniqueUrls: number;
  processed: number;
  resolved: number;
  productDestinations: number;
  identifiersFound: number;
  unresolved: number;
  failed: number;
  duplicateIdentities: number;
}

export function extractFlipkartPid(url: string): string | null {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/pid=([A-Z0-9]{16})/i);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveFlipkartLink(initialUrl: string): Promise<{ finalUrl: string, status: number }> {
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
          if (extractFlipkartPid(currentUrl)) {
            return { finalUrl: currentUrl, status: 200 };
          }
          continue;
        }
      }
      
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

export async function processFlipkartLinks(supabase: SupabaseClient, limit = 50): Promise<FlipkartResolveStats> {
  const stats: FlipkartResolveStats = {
    occurrences: 0,
    uniqueUrls: 0,
    processed: 0,
    resolved: 0,
    productDestinations: 0,
    identifiersFound: 0,
    unresolved: 0,
    failed: 0,
    duplicateIdentities: 0
  };

  // Pre-calculate occurrences from both youtube and pdf
  const ytCount = await supabase.from('youtube_video_links').select('id', { count: 'exact', head: true }).eq('link_type', 'flipkart');
  const pdfCount = await supabase.from('pdf_document_links').select('id', { count: 'exact', head: true }).eq('link_type', 'flipkart');
  stats.occurrences = (ytCount.count || 0) + (pdfCount.count || 0);

  // Fetch unique Flipkart links that are not yet resolved
  const { data: ytLinks } = await supabase.from('youtube_video_links').select('normalized_url, original_url').eq('link_type', 'flipkart').is('flipkart_product_id', null).limit(limit);
  const { data: pdfLinks } = await supabase.from('pdf_document_links').select('normalized_url, original_url').eq('link_type', 'flipkart').is('flipkart_product_id', null).limit(limit);

  const allLinks = [...(ytLinks || []), ...(pdfLinks || [])];
  
  const uniqueUrls = new Map<string, string>();
  for (const link of allLinks) {
    if (!uniqueUrls.has(link.normalized_url)) {
      uniqueUrls.set(link.normalized_url, link.original_url);
    }
  }

  stats.uniqueUrls = uniqueUrls.size;

  for (const [normalizedUrl, originalUrl] of uniqueUrls.entries()) {
    stats.processed++;
    let resolvedUrl = normalizedUrl;
    let pid: string | null = null;
    let status = 'unresolved';
    
    try {
      const res = await resolveFlipkartLink(originalUrl);
      resolvedUrl = res.finalUrl;
      
      if (res.status >= 200 && res.status < 400) {
        stats.resolved++;
        pid = extractFlipkartPid(resolvedUrl);
        
        if (pid) {
          status = 'resolved';
          stats.productDestinations++;
          stats.identifiersFound++;
        } else {
          status = 'unresolved';
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
      let marketplaceDomain = null;
      try { marketplaceDomain = new URL(resolvedUrl).hostname; } catch(e){}

      let flipkartProductId: string | null = null;

      if (pid) {
        const { data: upsertData, error: upsertError } = await supabase
          .from('flipkart_products')
          .upsert({
            product_identifier: pid,
            canonical_url: resolvedUrl,
            marketplace_domain: marketplaceDomain,
            status
          }, { onConflict: 'product_identifier' })
          .select('id')
          .single();
          
        if (upsertError) throw upsertError;
        if (upsertData) {
          flipkartProductId = upsertData.id;
          stats.duplicateIdentities++; // Will report accurately
        }
      } else {
        const { data: insertData, error: insertError } = await supabase
          .from('flipkart_products')
          .insert({
            canonical_url: resolvedUrl,
            marketplace_domain: marketplaceDomain,
            status
          })
          .select('id')
          .single();
          
        if (insertError) throw insertError;
        if (insertData) flipkartProductId = insertData.id;
      }
      
      // Update ALL youtube_video_links AND pdf_document_links that used this normalized URL
      if (flipkartProductId) {
        await supabase.from('youtube_video_links').update({ flipkart_product_id: flipkartProductId }).eq('normalized_url', normalizedUrl);
        await supabase.from('pdf_document_links').update({ flipkart_product_id: flipkartProductId }).eq('normalized_url', normalizedUrl);
      }
      
    } catch (dbErr: any) {
      console.error('DB Error updating Flipkart product:', dbErr);
    }
  }
  
  return stats;
}
