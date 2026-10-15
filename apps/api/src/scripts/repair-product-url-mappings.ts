import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const isDryRun = !process.argv.includes('--run');

// Normalization function (reuses logic from legacy services)
function canonicalizeAmazonUrl(url: string): string {
  try {
    const u = new URL(url);
    ['tag', 'linkCode', 'linkId', 'ref_', 'ref', 'ascsubtag', 'psc', 'crid', 'dib', 'dib_tag', 'keywords', 'qid', 'sprefix', 'sr'].forEach(p => u.searchParams.delete(p));
    let final = u.toString();
    if (final.endsWith('/') || final.endsWith('?') || final.endsWith('#')) final = final.slice(0, -1);
    return final;
  } catch {
    return url;
  }
}

function extractAsin(url: string): string | null {
  const regex = /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
  const match = url.match(regex);
  return match ? match[1].toUpperCase() : null;
}

async function resolveAmazonShortlink(initialUrl: string): Promise<{ finalUrl: string, status: number }> {
  let currentUrl = initialUrl;
  let hops = 0;
  let lastStatus = 200;
  
  while (hops < 5) {
    try {
      const res = await fetch(currentUrl, { 
        method: 'HEAD', 
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000)
      });
      lastStatus = res.status;
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) {
          currentUrl = new URL(location, currentUrl).toString();
          hops++;
        } else break;
      } else break;
    } catch (e) {
      break;
    }
  }
  return { finalUrl: currentUrl, status: lastStatus };
}

async function repair() {
  console.log(`Starting URL Repair & Resolution (${isDryRun ? 'DRY RUN' : 'LIVE RUN'})...`);

  const stats = {
    totalUnresolved: 0,
    resolvableUrls: 0,
    exactMatches: 0,
    highConfidenceMatches: 0,
    possibleMatches: 0,
    unresolvedNewProduct: 0,
    errors: 0,
    soundbarRecovered: 0,
    airCoolerRecovered: 0
  };

  const pdfStats: Record<string, { extracted: number, urlsFound: number, existingMappings: number, newMappings: number, unresolved: number }> = {};

  // 1. Recover Missing PDFs (Soundbar & Air Cooler)
  console.log('\n--- Recovering Missing PDF Links ---');
  const targetPdfs = ['Soundbar', 'Air-Cooler'];
  for (const t of targetPdfs) {
    const { data: pdf } = await supabase.from('pdf_documents').select('id, resolved_url, extracted_text').ilike('resolved_url', `%${t}%`).single();
    if (!pdf) continue;
    
    pdfStats[pdf.resolved_url] = { extracted: 0, urlsFound: 0, existingMappings: 0, newMappings: 0, unresolved: 0 };
    
    const URL_REGEX = /(https?:\/\/)?(www\.)?(amzn\.to|amazon\.in|flipkart\.com|fkrt\.it)[^\s"'<>]+/gi;
    const matches = pdf.extracted_text.match(URL_REGEX) || [];
    
    const uniqueLinks = new Set<string>();
    matches.forEach((m: string) => uniqueLinks.add(m.replace(/\)$|\.$|,$/, '')));
    
    pdfStats[pdf.resolved_url].urlsFound = uniqueLinks.size;
    if (t === 'Soundbar') stats.soundbarRecovered = uniqueLinks.size;
    if (t === 'Air-Cooler') stats.airCoolerRecovered = uniqueLinks.size;
    
    if (!isDryRun) {
      for (const link of uniqueLinks) {
        const { data: existing } = await supabase.from('pdf_document_links').select('id').eq('pdf_document_id', pdf.id).eq('original_url', link).single();
        if (!existing) {
          await supabase.from('pdf_document_links').insert({
            pdf_document_id: pdf.id,
            original_url: link,
            normalized_url: link,
            link_type: link.includes('amzn') ? 'amazon' : 'flipkart',
            position: 0
          });
        }
      }
    }
  }

  // 2. Fetch all unresolved pdf_document_links
  const { data: unresolvedLinks } = await supabase
    .from('pdf_document_links')
    .select('id, original_url, pdf_document_id, pdf_documents(resolved_url)')
    .is('amazon_product_id', null)
    .is('flipkart_product_id', null)
    .ilike('original_url', '%amzn%'); // Only amazon for now

  stats.totalUnresolved = unresolvedLinks?.length || 0;
  console.log(`\nFound ${stats.totalUnresolved} unresolved pdf_document_links... resolving now.`);

  if (!unresolvedLinks) return;

  const urlCache = new Map<string, string>(); // original_url -> finalUrl
  let count = 0;

  // Process in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < unresolvedLinks.length; i += BATCH_SIZE) {
    const batch = unresolvedLinks.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (link) => {
      const pdfUrl = (link.pdf_documents as any).resolved_url;
      if (!pdfStats[pdfUrl]) pdfStats[pdfUrl] = { extracted: 0, urlsFound: 0, existingMappings: 0, newMappings: 0, unresolved: 0 };
      pdfStats[pdfUrl].urlsFound++;
      
      try {
        let finalUrl = urlCache.get(link.original_url);
        if (!finalUrl) {
          const resolution = await resolveAmazonShortlink(link.original_url);
          finalUrl = resolution.finalUrl;
          urlCache.set(link.original_url, finalUrl);
        }

        const canonical = canonicalizeAmazonUrl(finalUrl);
        const asin = extractAsin(canonical);
        
        let matchedProductId: string | null = null;
        let matchConfidence = 'UNRESOLVED';
        let amazonProductId: string | null = null;

        const searchPattern = canonical.split('?')[0].replace('https://', '').replace('http://', '');
        const { data: prodLinks } = await supabase.from('product_links').select('product_id').ilike('amazon_url', `%${searchPattern}%`).limit(1);
        
        if (prodLinks && prodLinks.length > 0) {
          matchedProductId = prodLinks[0].product_id;
          matchConfidence = 'RESOLVED_EXACT';
        } 
        else if (asin) {
          const { data: amzProds } = await supabase.from('amazon_products').select('id, product_id').eq('asin', asin).limit(1);
          if (amzProds && amzProds.length > 0) {
            amazonProductId = amzProds[0].id;
            if (amzProds[0].product_id) {
              matchedProductId = amzProds[0].product_id;
              matchConfidence = 'RESOLVED_HIGH_CONFIDENCE';
            }
          }
        }

        if (matchedProductId) {
          if (matchConfidence === 'RESOLVED_EXACT') stats.exactMatches++;
          else stats.highConfidenceMatches++;
          pdfStats[pdfUrl].newMappings++;

          if (!isDryRun) {
            if (!amazonProductId && asin) {
               const { data: newAmz } = await supabase.from('amazon_products').upsert({
                 asin: asin,
                 canonical_url: canonical,
                 product_id: matchedProductId
               }, { onConflict: 'asin' }).select('id').single();
               if (newAmz) amazonProductId = newAmz.id;
            }
            
            if (amazonProductId) {
              await supabase.from('pdf_document_links').update({ amazon_product_id: amazonProductId }).eq('id', link.id);
            }
          }
        } else {
          stats.unresolvedNewProduct++;
          pdfStats[pdfUrl].unresolved++;
        }
      } catch (err) {
        stats.errors++;
      }
      count++;
    }));
    console.log(`Processed ${count}/${unresolvedLinks.length}...`);
  }

  console.log('\n========================================');
  console.log('REPAIR SUMMARY');
  console.log('========================================');
  console.log(`Total unresolved pdf_document_links: ${stats.totalUnresolved}`);
  console.log(`Resolvable URLs: ${stats.totalUnresolved - stats.errors}`);
  console.log(`Exact matches: ${stats.exactMatches}`);
  console.log(`High-confidence matches: ${stats.highConfidenceMatches}`);
  console.log(`Possible matches: ${stats.possibleMatches}`);
  console.log(`Unresolved (Likely new product): ${stats.unresolvedNewProduct}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Soundbar URL recovery count: ${stats.soundbarRecovered}`);
  console.log(`Air Cooler URL recovery count: ${stats.airCoolerRecovered}`);
  
  console.log('\nPER-PDF SUMMARY:');
  for (const [pdfUrl, s] of Object.entries(pdfStats)) {
    console.log(`PDF: ${pdfUrl}`);
    console.log(`  URLs found: ${s.urlsFound}`);
    console.log(`  New deterministic mappings: ${s.newMappings}`);
    console.log(`  Unresolved: ${s.unresolved}`);
  }
}

repair();
