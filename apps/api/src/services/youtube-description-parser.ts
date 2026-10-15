import { SupabaseClient } from '@supabase/supabase-js';
import { LinkType } from '@vmone/shared';

// Constants
const VMONE_PDF_PREFIXES = [
  'https://bit.ly/vm-ka',
  'https://bit.ly/vm-tv',
  'https://bit.ly/vm-wm',
  'https://bit.ly/vm-ha',
  'https://bit.ly/vm-gy',
  'https://bit.ly/vm-su',
  'https://bit.ly/vm-ref',
  'https://bit.ly/vm-mic',
  'https://bit.ly/vm-gft',
  'https://bit.ly/vm-ac',
  'https://bit.ly/vm-aco',
  'https://bit.ly/vm-fa',
  'https://bit.ly/vm-in'
];

const COMMON_SOCIAL_DOMAINS = [
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 
  'telegram.me', 't.me', 'drive.google.com', 'wa.me', 'whatsapp.com'
];

/**
 * Normalizes a URL by converting the host to lowercase and removing obvious tracking parameters.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.toLowerCase();
    
    // Remove common tracking/referral parameters while preserving meaningful product identifiers
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref_', 'ref', 'fbclid', 'gclid'];
    paramsToRemove.forEach(p => url.searchParams.delete(p));
    
    return url.toString();
  } catch (e) {
    // If it fails to parse, return as-is
    return rawUrl;
  }
}

/**
 * Deterministically classifies a URL into one of the LinkType categories.
 */
export function classifyUrl(normalizedUrl: string): LinkType {
  const lowerUrl = normalizedUrl.toLowerCase();
  
  if (lowerUrl.includes('amazon.') || lowerUrl.includes('amzn.') || lowerUrl.includes('link.amazon')) return 'amazon';
  if (lowerUrl.includes('flipkart.com') || lowerUrl.includes('fkrt.lt') || lowerUrl.includes('fkrt.it')) return 'flipkart';
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  
  if (lowerUrl.endsWith('.pdf') || VMONE_PDF_PREFIXES.some(prefix => lowerUrl.startsWith(prefix))) {
    return 'pdf_candidate';
  }
  
  if (lowerUrl.includes('bit.ly') || lowerUrl.includes('cutt.ly') || lowerUrl.includes('tinyurl.com')) {
    return 'shortened';
  }
  
  try {
    const urlObj = new URL(lowerUrl);
    const host = urlObj.hostname;
    
    // Check if it's a known generic social/other domain
    if (COMMON_SOCIAL_DOMAINS.some(d => host.includes(d))) {
      return 'other';
    }
    
    // Everything else that is a clean valid domain is assumed to be a brand/external link
    return 'brand_or_external';
  } catch {
    return 'other';
  }
}

/**
 * Extracts a reasonable snippet of context surrounding the URL (mostly the text immediately preceding it).
 */
export function extractContext(description: string, matchIndex: number): string {
  // Grab up to 80 characters before the URL
  const start = Math.max(0, matchIndex - 80);
  const beforeText = description.substring(start, matchIndex);
  
  const lines = beforeText.split('\n');
  let context = lines[lines.length - 1].trim();
  
  // If the URL is at the very start of a line, the context might be empty. Look at the previous line.
  if (context.length < 5 && lines.length > 1) {
    context = lines[lines.length - 2].trim() + ' ' + context;
  }
  
  // Clean up trailing punctuation or weird prefixes
  context = context.replace(/^[-\s*>•]+/, '').trim();
  return context.substring(0, 100);
}

/**
 * Extracts all URLs from a description string, normalizes, classifies, and attaches context.
 */
export function extractUrlsFromDescription(description: string) {
  // Regex matches http:// or https:// followed by non-whitespace/quotes/brackets
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
  const links = [];
  let match;
  let position = 1;
  
  while ((match = urlRegex.exec(description)) !== null) {
    // Strip trailing punctuation often captured by regex at the end of sentences
    const rawUrl = match[0].replace(/[.,;)]+$/, '');
    
    const context = extractContext(description, match.index);
    const normalized = normalizeUrl(rawUrl);
    const linkType = classifyUrl(normalized);
    
    links.push({
      original_url: rawUrl,
      normalized_url: normalized,
      link_type: linkType,
      position: position++,
      context_text: context
    });
  }
  
  return links;
}

export interface ParseStats {
  videos_processed: number;
  videos_with_links: number;
  links_found: number;
  amazon: number;
  flipkart: number;
  pdf: number;
  youtube: number;
  shortened: number;
  brand: number;
  other: number;
  duplicates_ignored: number;
  top_domains: Record<string, number>;
}

/**
 * Processes all YouTube videos in batches to extract and upsert their URLs into `youtube_video_links`.
 */
export async function processAllVideoDescriptions(supabase: SupabaseClient): Promise<ParseStats> {
  const stats: ParseStats = {
    videos_processed: 0,
    videos_with_links: 0,
    links_found: 0,
    amazon: 0,
    flipkart: 0,
    pdf: 0,
    youtube: 0,
    shortened: 0,
    brand: 0,
    other: 0,
    duplicates_ignored: 0,
    top_domains: {}
  };
  
  let hasMore = true;
  let offset = 0;
  const limit = 100;
  
  while (hasMore) {
    const { data: videos, error } = await supabase
      .from('youtube_videos')
      .select('id, description')
      .range(offset, offset + limit - 1);
      
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    if (!videos || videos.length === 0) {
      hasMore = false;
      break;
    }
    
    const allLinksToUpsert = [];
    
    for (const video of videos) {
      stats.videos_processed++;
      if (!video.description) continue;
      
      const links = extractUrlsFromDescription(video.description);
      if (links.length > 0) stats.videos_with_links++;
      
      const seenNormalizedUrls = new Set<string>();

      for (const link of links) {
        if (seenNormalizedUrls.has(link.normalized_url)) {
          stats.duplicates_ignored++;
          continue;
        }
        seenNormalizedUrls.add(link.normalized_url);
        stats.links_found++;
        
        switch (link.link_type) {
          case 'amazon': stats.amazon++; break;
          case 'flipkart': stats.flipkart++; break;
          case 'pdf_candidate': stats.pdf++; break;
          case 'youtube': stats.youtube++; break;
          case 'shortened': stats.shortened++; break;
          case 'brand_or_external': stats.brand++; break;
          default: stats.other++; break;
        }
        
        try {
          const urlObj = new URL(link.normalized_url);
          stats.top_domains[urlObj.hostname] = (stats.top_domains[urlObj.hostname] || 0) + 1;
        } catch (e) {}

        allLinksToUpsert.push({
          youtube_video_id: video.id,
          original_url: link.original_url,
          normalized_url: link.normalized_url,
          link_type: link.link_type,
          position: link.position,
          context_text: link.context_text
        });
      }
    }
    
    // Batch upsert the extracted links for this chunk
    if (allLinksToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('youtube_video_links')
        .upsert(allLinksToUpsert, { onConflict: 'youtube_video_id, normalized_url' });
        
      if (upsertError) {
        // We log the error but optionally can continue so one bad chunk doesn't crash the whole process
        console.error('Error upserting links batch:', upsertError.message);
        throw new Error(`Failed to upsert links: ${upsertError.message}`);
      }
    }
    
    offset += limit;
    if (videos.length < limit) {
      hasMore = false;
    }
  }
  
  // Sort and trim the top domains for reporting
  const sortedDomains = Object.entries(stats.top_domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
    
  stats.top_domains = sortedDomains as Record<string, number>;
  
  return stats;
}
