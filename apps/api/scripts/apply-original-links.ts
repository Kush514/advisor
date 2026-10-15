import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Amazon links only. For every product link:
//   - If VM One's original Amazon link (from a video description / PDF) works and carries a tracking tag,
//     use it exactly as published.
//   - Otherwise use https://www.amazon.in/dp/<ASIN>?tag=<partner tag>.
// When several originals qualify, the one from the most recent video wins (PDF links rank after videos).
// Flipkart and brand links are not touched.
// Usage: npx tsx scripts/apply-original-links.ts [--apply]   (requires migration 0006 for --apply)

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APPLY = process.argv.includes('--apply');
// Only products whose link is not yet a VM One original (used by the automatic sync)
const ONLY_NEW = process.argv.includes('--only-new');
const PARTNER_TAG = process.env.AMAZON_CREATORS_PARTNER_TAG || 'vmone-21';
const CACHE_PATH = path.resolve('link-resolve-cache.json');
const CONCURRENCY = 4;

type Resolved = { finalUrl: string | null; asin: string | null; tag: string | null; ok: boolean };
type SourceLink = { url: string; rank: number };

const isAmazon = (u: string) => /(^|\/\/|\.)(amazon\.|amzn\.|link\.amazon)/i.test(u);
const isShortener = (u: string) => /amzn\.|link\.amazon|bit\.ly|tinyurl\.com|cutt\.ly/i.test(u.split('/')[2] || '');
const extractTag = (url: string) => url.match(/[?&]tag=([^&#]+)/)?.[1] || null;

function extractAsin(url: string): string | null {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// Follow redirects manually until the Amazon product page (ASIN) is reached
async function resolve(url: string): Promise<Resolved> {
  let cur = url;
  let tag: string | null = null;
  for (let hop = 0; hop < 8; hop++) {
    tag = tag || extractTag(cur);
    const asin = isAmazon(cur) && !isShortener(cur) ? extractAsin(cur) : null;
    if (asin) return { finalUrl: cur, asin, tag, ok: true };
    try {
      const opts = { redirect: 'manual' as const, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }, signal: AbortSignal.timeout(12000) };
      let res = await fetch(cur, { ...opts, method: 'HEAD' });
      // Some shorteners only redirect on GET
      if (!(res.status >= 300 && res.status < 400)) res = await fetch(cur, { ...opts, method: 'GET' });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        cur = new URL(loc, cur).toString();
        continue;
      }
      return { finalUrl: cur, asin: null, tag, ok: false };
    } catch {
      return { finalUrl: null, asin: null, tag, ok: false };
    }
  }
  return { finalUrl: cur, asin: null, tag, ok: false };
}

async function resolveAll(urls: string[], cache: Record<string, Resolved>) {
  const todo = urls.filter(u => !cache[u]);
  console.log(`Resolving ${todo.length} links (${urls.length - todo.length} cached)...`);
  let done = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const u = queue.shift()!;
      cache[u] = await resolve(u);
      if (++done % 200 === 0) {
        console.log(`  ${done}/${todo.length}`);
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
      }
    }
  }));
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));

  // Short-link services rate-limit bursts, which looks exactly like a dead link. Before a link is
  // treated as "not working" (and replaced by a generated one) it is checked again, slowly.
  const retry = todo.filter(u => !cache[u]?.asin);
  if (retry.length) {
    console.log(`Re-checking ${retry.length} links that did not open a product, one at a time...`);
    let recovered = 0;
    for (const u of retry) {
      await new Promise(r => setTimeout(r, 700));
      const again = await resolve(u);
      if (again.asin) { cache[u] = again; recovered++; }
    }
    console.log(`  ${recovered} of them work after all.`);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  }
}

async function fetchAll(table: string, cols: string) {
  const rows: any[] = [];
  for (let s = 0; ; s += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(s, s + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  return rows;
}

async function run() {
  const cache: Record<string, Resolved> = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};

  // Which product links to decide: all of them, or (--only-new) only those not yet on a VM One original
  const allProductLinks = await fetchAll('product_links', 'id, product_id, amazon_url, asin, amazon_link_source');
  const productLinks = ONLY_NEW ? allProductLinks.filter(pl => pl.amazon_link_source !== 'vmone_original') : allProductLinks;
  if (productLinks.length === 0) {
    console.log('All product links already use a VM One original link. Nothing to do.');
    return;
  }

  // 1. Every original link from VM One that could be an Amazon link, ranked by video recency
  const videos = await fetchAll('youtube_videos', 'id, published_at');
  const published = new Map(videos.map(v => [v.id, new Date(v.published_at || 0).getTime()]));
  const ytLinks = await fetchAll('youtube_video_links', 'youtube_video_id, original_url, amazon_product_id');
  const pdfLinks = await fetchAll('pdf_document_links', 'original_url, amazon_product_id');

  // --only-new: only check the original links already known (from the Amazon resolver) to point at
  // one of these products, instead of re-checking every link VM One has ever published
  let relevant = (_l: any) => true;
  if (ONLY_NEW) {
    const asinOfAmazonProduct = new Map((await fetchAll('amazon_products', 'id, asin')).map(a => [a.id, a.asin]));
    const wanted = new Set(productLinks.map(pl => pl.asin || extractAsin(pl.amazon_url || '')).filter(Boolean));
    relevant = (l: any) => wanted.has(asinOfAmazonProduct.get(l.amazon_product_id));
  }

  const sources: SourceLink[] = [
    ...ytLinks.filter(relevant).map(l => ({ url: l.original_url, rank: published.get(l.youtube_video_id) || 0 })),
    ...pdfLinks.filter(relevant).map(l => ({ url: l.original_url, rank: -1 }))
  ].filter(s => isAmazon(s.url) || /bit\.ly|tinyurl\.com|cutt\.ly/i.test(s.url));

  await resolveAll([...new Set(sources.map(s => s.url))], cache);

  // 2. Working + tagged originals, grouped by the ASIN they open
  const originalsByAsin = new Map<string, SourceLink[]>();
  let notWorking = 0;
  let noTag = 0;
  for (const s of sources) {
    const r = cache[s.url];
    if (!r?.ok || !r.asin) { if (isAmazon(s.url)) notWorking++; continue; }
    if (!r.tag) { noTag++; continue; }
    if (!originalsByAsin.has(r.asin)) originalsByAsin.set(r.asin, []);
    originalsByAsin.get(r.asin)!.push(s);
  }

  // 3. Decide each product's Amazon link
  const products = await fetchAll('products', 'id, name, recommendable');
  const productById = new Map(products.map(p => [p.id, p]));

  const plans: any[] = [];
  const tagCounts: Record<string, number> = {};
  let skippedNoAsin = 0;
  for (const pl of productLinks) {
    if (!pl.amazon_url) continue;
    const asin = pl.asin || extractAsin(pl.amazon_url); // after the first run amazon_url may be a short link
    if (!asin) { skippedNoAsin++; continue; }

    const product = productById.get(pl.product_id);
    const pick = originalsByAsin.get(asin)?.sort((a, b) => b.rank - a.rank)[0];
    const plan: any = { linkId: pl.id, name: product?.name, recommendable: product?.recommendable, asin, current: pl.amazon_url };
    if (pick) {
      plan.amazon_url = pick.url;
      plan.amazon_link_source = 'vmone_original';
      plan.tag = cache[pick.url].tag;
      tagCounts[plan.tag] = (tagCounts[plan.tag] || 0) + 1;
    } else {
      plan.amazon_url = `https://www.amazon.in/dp/${asin}?tag=${PARTNER_TAG}`;
      plan.amazon_link_source = 'generated';
    }
    plans.push(plan);
  }

  // 4. Report
  const original = plans.filter(p => p.amazon_link_source === 'vmone_original');
  const generated = plans.filter(p => p.amazon_link_source === 'generated');
  const reportPath = path.resolve('original-links-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ tagCounts, plans }, null, 2));

  console.log('\n=== Amazon product links ===');
  console.log(`  VM One original (working + tracking ID), used as-is : ${original.length}  (${original.filter(p => p.recommendable).length} shown to users)`);
  console.log(`  No working tagged original -> dp/ASIN?tag=${PARTNER_TAG}   : ${generated.length}  (${generated.filter(p => p.recommendable).length} shown to users)`);
  console.log(`  Skipped (no ASIN in current link)                    : ${skippedNoAsin}`);
  console.log(`  Original links ignored: ${notWorking} not working, ${noTag} without tracking ID`);
  console.log('  Tracking IDs kept:', Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '));
  console.log(`\nFull plan: ${reportPath}`);

  if (!APPLY) {
    console.log('Dry run only. Apply migration 0006, then re-run with --apply.');
    return;
  }

  let updated = 0;
  for (const p of plans) {
    const { error } = await supabase
      .from('product_links')
      .update({ amazon_url: p.amazon_url, asin: p.asin, amazon_link_source: p.amazon_link_source })
      .eq('id', p.linkId);
    if (error) console.error(`  ${p.linkId}: ${error.message}`);
    else updated++;
  }
  console.log(`Applied to ${updated} product_links rows.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
