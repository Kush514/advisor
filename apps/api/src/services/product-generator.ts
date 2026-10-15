import { SupabaseClient } from '@supabase/supabase-js';

// Define structures
export interface CanonicalCandidate {
  sourceType: 'amazon' | 'flipkart';
  sourceId: string;
  sourceIdentifier: string;
  canonicalUrl: string;
  brand: string | null;
  model: string | null;
  productName: string | null;
  category: string | null;
  youtubeVideoIds: string[];
  pdfDocumentIds: string[];
  evidenceStrength: 'strong' | 'medium' | 'weak';
}

function normalizeBrand(raw: string | null): string | null {
  if (!raw) return null;
  let b = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (b === 'lg') return 'LG';
  if (b === 'samsung') return 'Samsung';
  if (b === 'sony') return 'Sony';
  if (b === 'bosch') return 'Bosch';
  if (b === 'ifb') return 'IFB';
  if (b === 'haier') return 'Haier';
  if (b === 'whirlpool') return 'Whirlpool';
  if (b === 'hisense') return 'Hisense';
  if (b === 'tcl') return 'TCL';
  if (b === 'xiaomi' || b === 'mi') return 'Xiaomi';
  if (b === 'vu') return 'VU';
  if (b === 'panasonic') return 'Panasonic';
  if (b === 'daikin') return 'Daikin';
  if (b === 'voltas') return 'Voltas';
  if (b === 'hitachi') return 'Hitachi';
  if (b === 'lloyd') return 'Lloyd';
  if (b === 'godrej') return 'Godrej';
  return raw.trim(); // fallback
}

function normalizeModel(raw: string | null): string | null {
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, '').replace(/-/g, '').replace(/_/g, '').trim();
}

// Very basic regex extractor to pull some brands and models from URLs
function extractDetailsFromUrl(url: string) {
  let brand = null;
  let model = null;
  let productName = null;
  
  const decoded = decodeURIComponent(url).toLowerCase();
  
  // Try to find known brands in the URL path
  const knownBrands = ['lg', 'samsung', 'sony', 'bosch', 'ifb', 'haier', 'whirlpool', 'hisense', 'tcl', 'xiaomi', 'vu', 'panasonic', 'daikin', 'voltas', 'hitachi', 'lloyd', 'godrej'];
  
  for (const b of knownBrands) {
    if (decoded.includes(`/${b}-`) || decoded.includes(`-${b}-`) || decoded.includes(`-${b}/`)) {
      brand = normalizeBrand(b);
      break;
    }
  }

  // Extract a plausible product name from the URL slug
  let slugMatch = url.match(/amazon\.in\/([^\/]+)\/dp/i) || url.match(/flipkart\.com\/([^\/]+)\/p/i);
  if (slugMatch && slugMatch[1]) {
    productName = slugMatch[1].replace(/-/g, ' ').replace(/\+/g, ' ').toUpperCase();
    if (!brand) {
      for (const b of knownBrands) {
        if (productName.toLowerCase().includes(b)) {
          brand = normalizeBrand(b);
          break;
        }
      }
    }
  }
  
  // Model number heuristic (looks like a mix of letters and numbers, length 5+)
  if (productName) {
    const parts = productName.split(' ');
    for (const p of parts) {
      if (p.length >= 5 && /[A-Z]/.test(p) && /[0-9]/.test(p)) {
        model = normalizeModel(p);
        break; // take first plausible model
      }
    }
  }

  return { brand, model, productName };
}

export async function generateProducts(supabase: SupabaseClient, dryRun = true) {
  const stats = {
    totalSourceCandidates: 0,
    uniqueCanonicalCandidates: 0,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    potentialDuplicates: 0,
    amazonLinked: 0,
    flipkartLinked: 0,
    youtubeLinked: 0,
    pdfLinked: 0,
    withModel: 0,
    withoutModel: 0,
    reviewedByVmone: 0,
    recommendable: 0,
    strongCandidates: 0,
    mediumCandidates: 0,
    weakCandidates: 0,
    sample: [] as any[]
  };

  // 1. Fetch Amazon resolved identities (ONLY the ones that haven't been generated yet!)
  const { data: amazonProducts, error: err1 } = await supabase
    .from('amazon_products')
    .select('id, asin, canonical_url, status, product_id')
    .eq('status', 'resolved')
    .not('asin', 'is', null)
    .is('product_id', null);
    
  if (err1) console.error('Amazon fetch error:', err1);

  // 2. Fetch Flipkart resolved identities (ONLY the ones that haven't been generated yet!)
  const { data: flipkartProducts, error: err2 } = await supabase
    .from('flipkart_products')
    .select('id, product_identifier, canonical_url, status, product_id')
    .eq('status', 'resolved')
    .not('product_identifier', 'is', null)
    .is('product_id', null);
    
  if (err2) console.error('Flipkart fetch error:', err2);

  // 3. Fetch evidence links (YouTube & PDF)
  // We need to know which video/pdf links to which amazon/flipkart ID
  const { data: ytLinks } = await supabase
    .from('youtube_video_links')
    .select('youtube_video_id, amazon_product_id, flipkart_product_id');

  const { data: pdfLinks } = await supabase
    .from('pdf_document_links')
    .select('pdf_document_id, amazon_product_id, flipkart_product_id');

  const candidates: CanonicalCandidate[] = [];

  // Group evidence by Amazon Product ID using Maps for O(1) lookup
  const ytAmazonMap = new Map<string, string[]>();
  const pdfAmazonMap = new Map<string, string[]>();
  
  if (ytLinks) {
    for (const l of ytLinks) {
      if (!l.amazon_product_id) continue;
      if (!ytAmazonMap.has(l.amazon_product_id)) ytAmazonMap.set(l.amazon_product_id, []);
      ytAmazonMap.get(l.amazon_product_id)!.push(l.youtube_video_id);
    }
  }
  
  if (pdfLinks) {
    for (const l of pdfLinks) {
      if (!l.amazon_product_id) continue;
      if (!pdfAmazonMap.has(l.amazon_product_id)) pdfAmazonMap.set(l.amazon_product_id, []);
      pdfAmazonMap.get(l.amazon_product_id)!.push(l.pdf_document_id);
    }
  }

  if (amazonProducts) {
    for (const amz of amazonProducts) {
      const vids = ytAmazonMap.get(amz.id) || [];
      const pdfs = pdfAmazonMap.get(amz.id) || [];
      const uniqueVids = [...new Set(vids)];
      const uniquePdfs = [...new Set(pdfs)];

      const details = extractDetailsFromUrl(amz.canonical_url);

      let strength: 'strong' | 'medium' | 'weak' = 'weak';
      if (details.model && (uniqueVids.length > 0 || uniquePdfs.length > 0)) strength = 'strong';
      else if (uniqueVids.length > 0 || uniquePdfs.length > 0) strength = 'medium';

      candidates.push({
        sourceType: 'amazon',
        sourceId: amz.id,
        sourceIdentifier: amz.asin!,
        canonicalUrl: amz.canonical_url,
        brand: details.brand,
        model: details.model,
        productName: details.productName,
        category: null,
        youtubeVideoIds: uniqueVids,
        pdfDocumentIds: uniquePdfs,
        evidenceStrength: strength
      });
    }
  }

  // Group evidence by Flipkart Product ID
  const ytFlipkartMap = new Map<string, string[]>();
  const pdfFlipkartMap = new Map<string, string[]>();
  
  if (ytLinks) {
    for (const l of ytLinks) {
      if (!l.flipkart_product_id) continue;
      if (!ytFlipkartMap.has(l.flipkart_product_id)) ytFlipkartMap.set(l.flipkart_product_id, []);
      ytFlipkartMap.get(l.flipkart_product_id)!.push(l.youtube_video_id);
    }
  }
  
  if (pdfLinks) {
    for (const l of pdfLinks) {
      if (!l.flipkart_product_id) continue;
      if (!pdfFlipkartMap.has(l.flipkart_product_id)) pdfFlipkartMap.set(l.flipkart_product_id, []);
      pdfFlipkartMap.get(l.flipkart_product_id)!.push(l.pdf_document_id);
    }
  }

  if (flipkartProducts) {
    for (const fkrt of flipkartProducts) {
      const vids = ytFlipkartMap.get(fkrt.id) || [];
      const pdfs = pdfFlipkartMap.get(fkrt.id) || [];
      const uniqueVids = [...new Set(vids)];
      const uniquePdfs = [...new Set(pdfs)];

      const details = extractDetailsFromUrl(fkrt.canonical_url);

      let strength: 'strong' | 'medium' | 'weak' = 'weak';
      if (details.model && (uniqueVids.length > 0 || uniquePdfs.length > 0)) strength = 'strong';
      else if (uniqueVids.length > 0 || uniquePdfs.length > 0) strength = 'medium';

      candidates.push({
        sourceType: 'flipkart',
        sourceId: fkrt.id,
        sourceIdentifier: fkrt.product_identifier!,
        canonicalUrl: fkrt.canonical_url,
        brand: details.brand,
        model: details.model,
        productName: details.productName,
        category: null,
        youtubeVideoIds: uniqueVids,
        pdfDocumentIds: uniquePdfs,
        evidenceStrength: strength
      });
    }
  }

  stats.totalSourceCandidates = candidates.length;
  stats.uniqueCanonicalCandidates = candidates.length; // Before deduplication check

  // Sort candidates so strong ones process first
  candidates.sort((a, b) => {
    const s = { strong: 3, medium: 2, weak: 1 };
    return s[b.evidenceStrength] - s[a.evidenceStrength];
  });

  // Simple in-memory deduplication index for this batch
  const seenModels = new Map<string, CanonicalCandidate>();

  for (const c of candidates) {
    if (c.evidenceStrength === 'strong') stats.strongCandidates++;
    else if (c.evidenceStrength === 'medium') stats.mediumCandidates++;
    else stats.weakCandidates++;

    if (c.model) stats.withModel++;
    else stats.withoutModel++;

    // Deduplication check: If we have a model and brand, see if we already processed it
    let isDuplicate = false;
    if (c.model && c.brand) {
      const key = `${c.brand}-${c.model}`;
      if (seenModels.has(key)) {
        isDuplicate = true;
        stats.potentialDuplicates++;
        // We could merge evidence here in memory before inserting!
        const existing = seenModels.get(key)!;
        existing.youtubeVideoIds = [...new Set([...existing.youtubeVideoIds, ...c.youtubeVideoIds])];
        existing.pdfDocumentIds = [...new Set([...existing.pdfDocumentIds, ...c.pdfDocumentIds])];
      } else {
        seenModels.set(key, c);
      }
    }

    if (isDuplicate) {
      stats.skipped++;
      continue;
    }

    // Determine reviewed_by_vmone safely
    const reviewed = c.pdfDocumentIds.length > 0 || c.youtubeVideoIds.length > 0;
    if (reviewed) stats.reviewedByVmone++;
    
    // Default recommendable to false for now unless we do sentiment analysis
    const recommendable = false;

    if (c.sourceType === 'amazon') stats.amazonLinked++;
    if (c.sourceType === 'flipkart') stats.flipkartLinked++;
    if (c.youtubeVideoIds.length > 0) stats.youtubeLinked++;
    if (c.pdfDocumentIds.length > 0) stats.pdfLinked++;

    if (stats.sample.length < 5 && c.evidenceStrength === 'strong') {
      stats.sample.push({
        Brand: c.brand,
        Model: c.model,
        Name: c.productName?.substring(0, 30) + '...',
        Amazon: c.sourceType === 'amazon' ? c.sourceIdentifier : null,
        Flipkart: c.sourceType === 'flipkart' ? c.sourceIdentifier : null,
        YouTubeEvidences: c.youtubeVideoIds.length,
        PDFEvidences: c.pdfDocumentIds.length,
        Strength: c.evidenceStrength
      });
    }

    if (!dryRun) {
      try {
        // Insert product
        const { data: newProd, error: prodErr } = await supabase
          .from('products')
          .insert({
            name: c.productName,
            brand: c.brand,
            model: c.model,
            status: 'active',
            reviewed_by_vmone: reviewed,
            recommendable: recommendable
          })
          .select('id')
          .single();

        if (prodErr || !newProd) {
          console.error('Failed to create product:', prodErr);
          stats.failed++;
          continue;
        }

        stats.created++;

        // Link Identity
        if (c.sourceType === 'amazon') {
          await supabase.from('amazon_products').update({ product_id: newProd.id }).eq('id', c.sourceId);
          await supabase.from('product_links').insert({ product_id: newProd.id, amazon_url: c.canonicalUrl });
        } else {
          await supabase.from('flipkart_products').update({ product_id: newProd.id }).eq('id', c.sourceId);
          await supabase.from('product_links').insert({ product_id: newProd.id, flipkart_url: c.canonicalUrl });
        }

        // Link YouTube Videos
        if (c.youtubeVideoIds.length > 0) {
          const ytInserts = c.youtubeVideoIds.map(vid => ({ product_id: newProd.id, youtube_video_id: vid }));
          await supabase.from('product_videos').insert(ytInserts);
        }

        // Link PDFs
        if (c.pdfDocumentIds.length > 0) {
          const pdfInserts = c.pdfDocumentIds.map(pid => ({ product_id: newProd.id, pdf_document_id: pid }));
          await supabase.from('product_pdf_documents').insert(pdfInserts);
        }
        
        // Add specs if we extracted them
        if (c.model) {
          await supabase.from('product_specs').insert({ product_id: newProd.id, spec_key: 'model', spec_value: c.model });
        }
      } catch (e) {
        console.error('Product Generation Error:', e);
      }
    } else {
      stats.created++; // simulate creation for dry run reporting
    }
  }

  return { ok: true, stats };
}
