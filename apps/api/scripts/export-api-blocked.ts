import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Review list for VM One: products hidden from the Finder because Amazon's affiliate API will not
// return them (API_BLOCKED), says the ASIN is invalid, or does not have them. Their live price and
// stock cannot be checked, so they are not shown. Open each Amazon page to see whether the product is
// still sold; if it is, a newer link to the same model in a VM One video brings it back.
//
// Writes a CSV (opens in Excel / Google Sheets). The daily GitHub run uploads it as a download.
// Usage (from apps/api): npx tsx scripts/export-api-blocked.ts [output.csv]

dotenv.config({ path: path.resolve('.dev.vars') });
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const OUT = path.resolve(process.argv[2] || 'amazon-api-blocked-products.csv');

const STATUS_TEXT: Record<string, string> = {
  API_BLOCKED: 'Amazon API does not share this product (page may still be live)',
  INVALID_ASIN: 'Amazon says the ASIN is invalid',
  NOT_FOUND: 'Not found on Amazon'
};

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

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function run() {
  const products = await fetchAll(
    'products',
    'id, name, brand, amazon_availability, availability_checked_at, categories(name), product_links(asin, amazon_url), product_videos(youtube_videos(title, youtube_url, published_at))',
    q => q.in('amazon_availability', Object.keys(STATUS_TEXT)).eq('status', 'active')
  );

  const rows = products
    .map(p => {
      const link = p.product_links?.[0] || {};
      const videos = (p.product_videos || []).map((pv: any) => pv.youtube_videos).filter(Boolean)
        .sort((a: any, b: any) => String(b.published_at).localeCompare(String(a.published_at)));
      return {
        category: p.categories?.name || '(no category)',
        product: p.name || '(no name)',
        brand: p.brand || '',
        status: STATUS_TEXT[p.amazon_availability] || p.amazon_availability,
        asin: link.asin || '',
        amazonPage: link.asin ? `https://www.amazon.in/dp/${link.asin}` : '',
        vmoneLink: link.amazon_url || '',
        latestVideo: videos[0]?.title || '',
        videoUrl: videos[0]?.youtube_url || '',
        checked: p.availability_checked_at ? new Date(p.availability_checked_at).toISOString().slice(0, 10) : ''
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.product.localeCompare(b.product));

  const header = ['Category', 'Product', 'Brand', 'Why it is hidden', 'ASIN', 'Amazon page', "VM One's link", 'Latest VM One video', 'Video link', 'Last checked'];
  const lines = [header, ...rows.map(r => [r.category, r.product, r.brand, r.status, r.asin, r.amazonPage, r.vmoneLink, r.latestVideo, r.videoUrl, r.checked])];
  // UTF-8 BOM so Excel shows ₹ and accents correctly
  fs.writeFileSync(OUT, '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n'));

  const counts: Record<string, number> = {};
  rows.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
  console.log(`Wrote ${rows.length} products to ${OUT}`);
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
