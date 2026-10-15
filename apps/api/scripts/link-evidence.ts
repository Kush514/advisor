import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Attaches every VM One video and PDF to every product it links to.
// The product generator only does this when it first creates a product, so videos uploaded later
// (or PDFs resolved later) were never connected to products that already existed.
// Safe to re-run: existing pairs are left alone.
// Usage (from apps/api): npx tsx scripts/link-evidence.ts

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function fetchAll(table: string, cols: string, filter?: (q: any) => any) {
  const rows: any[] = [];
  for (let s = 0; ; s += 1000) {
    let q = supabase.from(table).select(cols).order('id').range(s, s + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  return rows;
}

async function insertMissing(table: string, rows: any[], keyOf: (r: any) => string, existing: Set<string>) {
  const fresh = [...new Map(rows.map(r => [keyOf(r), r])).values()].filter(r => !existing.has(keyOf(r)));
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await supabase.from(table).insert(fresh.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return fresh.length;
}

async function run() {
  const amazon = await fetchAll('amazon_products', 'id, product_id', q => q.not('product_id', 'is', null));
  const flipkart = await fetchAll('flipkart_products', 'id, product_id', q => q.not('product_id', 'is', null));
  const productOfAmazon = new Map(amazon.map(a => [a.id, a.product_id]));

  // A Flipkart identity is only trusted when it maps one-to-one (an old reconciliation pointed many at one product)
  const perProduct = new Map<string, number>();
  flipkart.forEach(f => perProduct.set(f.product_id, (perProduct.get(f.product_id) || 0) + 1));
  const productOfFlipkart = new Map(flipkart.filter(f => perProduct.get(f.product_id) === 1).map(f => [f.id, f.product_id]));

  const productFor = (l: any) => productOfAmazon.get(l.amazon_product_id) || productOfFlipkart.get(l.flipkart_product_id);

  const videoLinks = await fetchAll('youtube_video_links', 'id, youtube_video_id, amazon_product_id, flipkart_product_id');
  const pdfLinks = await fetchAll('pdf_document_links', 'id, pdf_document_id, amazon_product_id, flipkart_product_id');

  const videoPairs = videoLinks.filter(productFor).map(l => ({ product_id: productFor(l), youtube_video_id: l.youtube_video_id }));
  const pdfPairs = pdfLinks.filter(productFor).map(l => ({ product_id: productFor(l), pdf_document_id: l.pdf_document_id }));

  const haveVideos = new Set((await fetchAll('product_videos', 'id, product_id, youtube_video_id')).map(r => `${r.product_id}|${r.youtube_video_id}`));
  const havePdfs = new Set((await fetchAll('product_pdf_documents', 'id, product_id, pdf_document_id')).map(r => `${r.product_id}|${r.pdf_document_id}`));

  const addedVideos = await insertMissing('product_videos', videoPairs, r => `${r.product_id}|${r.youtube_video_id}`, haveVideos);
  const addedPdfs = await insertMissing('product_pdf_documents', pdfPairs, r => `${r.product_id}|${r.pdf_document_id}`, havePdfs);

  console.log(`Linked ${addedVideos} new product-video pairs and ${addedPdfs} new product-PDF pairs.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
