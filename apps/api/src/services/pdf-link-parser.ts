import { SupabaseClient } from '@supabase/supabase-js';
import { LinkType } from '@vmone/shared';
// We'll duplicate the classification logic here to keep the service self-contained, 
// or import it if we exported it from youtube-description-parser.ts. 
// We will just copy it for simplicity and correctness.

const VMONE_PDF_PREFIXES = [
  'https://bit.ly/vm-ka', 'https://bit.ly/vm-tv', 'https://bit.ly/vm-wm',
  'https://bit.ly/vm-ha', 'https://bit.ly/vm-gy', 'https://bit.ly/vm-su',
  'https://bit.ly/vm-ref', 'https://bit.ly/vm-mic', 'https://bit.ly/vm-gft',
  'https://bit.ly/vm-ac', 'https://bit.ly/vm-aco', 'https://bit.ly/vm-fa',
  'https://bit.ly/vm-in'
];

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'crid', 'dib', 'dib_tag', 'keywords', 'qid', 'sprefix', 'sr', 'linkCode', 'tag', 'linkId'];
    trackingParams.forEach(p => u.searchParams.delete(p));
    let finalUrl = u.toString();
    // Remove trailing punctuation that regex might have grabbed
    if (finalUrl.endsWith(')') || finalUrl.endsWith('.') || finalUrl.endsWith(',')) {
      finalUrl = finalUrl.slice(0, -1);
    }
    return finalUrl;
  } catch {
    return url;
  }
}

export function classifyUrl(normalizedUrl: string): LinkType {
  const lowerUrl = normalizedUrl.toLowerCase();
  
  if (lowerUrl.includes('amazon.') || lowerUrl.includes('amzn.') || lowerUrl.includes('link.amazon')) return 'amazon';
  if (lowerUrl.includes('flipkart.com') || lowerUrl.includes('fkrt.lt') || lowerUrl.includes('fkrt.it')) return 'flipkart';
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  
  if (lowerUrl.endsWith('.pdf') || VMONE_PDF_PREFIXES.some(prefix => lowerUrl.startsWith(prefix))) {
    return 'pdf_candidate';
  }
  
  if (lowerUrl.includes('bit.ly') || lowerUrl.includes('tinyurl') || lowerUrl.includes('t.co')) {
    return 'shortened';
  }

  // Broad classification for external/brands
  const knownBrands = ['vmone.in', 'livfast.in', 'bosch', 'lg.com', 'samsung.com', 'sony.co.in'];
  if (knownBrands.some(b => lowerUrl.includes(b))) {
    return 'brand_or_external';
  }

  const socials = ['facebook.com', 'instagram.com', 'twitter.com', 't.me', 'linkedin.com'];
  if (socials.some(s => lowerUrl.includes(s))) {
    return 'other';
  }
  
  return 'brand_or_external'; // default fallback for random websites
}

export async function parsePdfLinks(supabase: SupabaseClient, limit = 10) {
  const stats = {
    pdfsInspected: 0,
    pdfsWithLinks: 0,
    totalLinksFound: 0,
    uniqueUrls: 0,
    amazon: 0,
    flipkart: 0,
    brand: 0,
    other: 0,
    duplicatesIgnored: 0
  };

  const { data: pdfs, error } = await supabase
    .from('pdf_documents')
    .select('id, extracted_text')
    .not('extracted_text', 'is', null)
    .limit(limit);

  if (error) throw new Error(error.message);

  stats.pdfsInspected = pdfs.length;

  for (const pdf of pdfs) {
    if (!pdf.extracted_text) continue;
    
    // Check if we already parsed links for this PDF to avoid duplicate running
    const { count } = await supabase
      .from('pdf_document_links')
      .select('id', { count: 'exact', head: true })
      .eq('pdf_document_id', pdf.id);
      
    if (count && count > 0) {
      // Already parsed
      continue;
    }

    const URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;
    const lines = pdf.extracted_text.split('\n');
    let hasLink = false;
    let matchCount = 0;
    
    const linksToInsert: any[] = [];
    const seenNormalizedUrls = new Set<string>();

    for (const line of lines) {
      let match;
      while ((match = URL_REGEX.exec(line)) !== null) {
        hasLink = true;
        matchCount++;
        
        let originalUrl = match[0];
        if (originalUrl.endsWith(')') || originalUrl.endsWith('.') || originalUrl.endsWith(',')) {
          originalUrl = originalUrl.slice(0, -1);
        }
        
        const normalizedUrl = normalizeUrl(originalUrl);
        const linkType = classifyUrl(normalizedUrl);
        
        // Deduplicate within the same PDF? The prompt says "A PDF can contain many links. The same URL may appear in multiple PDFs. Therefore use appropriate uniqueness constraints. Do not create duplicate link records unnecessarily."
        // We will deduplicate exact normalized URLs within the SAME PDF.
        if (seenNormalizedUrls.has(normalizedUrl)) {
           stats.duplicatesIgnored++;
           continue;
        }
        seenNormalizedUrls.add(normalizedUrl);

        stats.totalLinksFound++;
        if (linkType === 'amazon') stats.amazon++;
        else if (linkType === 'flipkart') stats.flipkart++;
        else if (linkType === 'brand_or_external') stats.brand++;
        else stats.other++;

        // Context text: grab up to 100 chars before the link
        const startIndex = Math.max(0, match.index - 100);
        const contextText = line.substring(startIndex, match.index).trim() || null;

        linksToInsert.push({
          pdf_document_id: pdf.id,
          original_url: originalUrl,
          normalized_url: normalizedUrl,
          link_type: linkType,
          position: match.index,
          context_text: contextText
        });
      }
    }
    
    if (hasLink) stats.pdfsWithLinks++;
    stats.uniqueUrls += seenNormalizedUrls.size;

    // Batch insert
    if (linksToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('pdf_document_links')
        .insert(linksToInsert);
        
      if (insertError) {
        console.error('Insert error for PDF:', pdf.id, insertError);
      }
    }
  }

  return stats;
}
