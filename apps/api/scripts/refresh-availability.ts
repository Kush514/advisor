import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { CANONICAL_CATEGORIES } from '../src/services/product-eligibility';

// Daily job: keeps every product shown to users buyable on Amazon.
//   1. Checks Amazon stock + price for every product's ASIN (Creators API GetItems).
//   2. (Optional, --with-replacements) Unavailable product -> searches the same model under another ASIN; if one is in stock,
//      switches the link to amazon.in/dp/<ASIN>?tag=<partner tag>.
//   3. Recomputes `recommendable`: buyable + complete (name, brand, category, price) + not an accessory,
//      keeping ONE product per ASIN / per identical name so the same item is never shown twice.
// Usage (from apps/api): npx tsx scripts/refresh-availability.ts [--apply] [--with-replacements]
//   Replacements are off by default: with today's product names/models the search matches wrong items too often.
//   Works without migrations 0006/0007, but stock status is only stored once 0007 is applied.

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APPLY = process.argv.includes('--apply');
const WITH_REPLACEMENTS = process.argv.includes('--with-replacements');
const PARTNER_TAG = process.env.AMAZON_CREATORS_PARTNER_TAG || 'vmone-21';
const API = 'https://creatorsapi.amazon/catalog/v1';
const BUYABLE = ['IN_STOCK', 'IN_STOCK_SCARCE'];
// Accessories that can be linked from a video but are not the appliance itself (never shown as one)
const ACCESSORY = /\b(cover|stand|bracket|trolley|pouch|wall mount kit|stabili[sz]ers?|hdmi|cables?|power\s*bank|magic\s*remote|tv\s*remote|replacement\s*remote)\b/i;
// Listings that merely mention a model number ("Cover compatible with WA90BG...") are not the product
const ACCESSORY_TITLE = /\b(covers?|compatible|stand|brackets?|trolley|pouch|replacement|spares?|filters?|bulbs?|lights?|mats?|pipes?|hoses?|bags?|remote control)\b/i;

type Item = { asin: string; availability: string; price: number | null; title: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const extractAsin = (url: string) => url?.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase() || null;
const normName = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const compact = (s: string) => s.toUpperCase().replace(/[\s\-/.]/g, '');

async function getToken(): Promise<string> {
  const res = await fetch('https://api.amazon.co.uk/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.AMAZON_CREATORS_CLIENT_ID,
      client_secret: process.env.AMAZON_CREATORS_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    })
  });
  if (!res.ok) throw new Error(`Amazon auth failed: ${res.status}`);
  return ((await res.json()) as any).access_token;
}

async function callApi(token: string, op: 'getItems' | 'searchItems', body: object): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/${op}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-marketplace': 'www.amazon.in' },
      body: JSON.stringify({ partnerTag: PARTNER_TAG, marketplace: 'www.amazon.in', ...body })
    });
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${op} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  throw new Error(`${op} failed after retries`);
}

/**
 * Why Amazon left ASINs out of a GetItems reply:
 *   API_BLOCKED   "ItemNotAccessible": the listing may well be live, but Amazon does not expose it to the
 *                 affiliate API, so we cannot get its price or stock (product stays hidden)
 *   INVALID_ASIN  "InvalidParameterValue": the ASIN itself is wrong or no longer exists
 * Anything else not returned is NOT_FOUND.
 */
export function missingReasons(data: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of data?.errors || []) {
    const asin = String(e.message || '').match(/ItemId\s+([A-Z0-9]{10})/i)?.[1]?.toUpperCase();
    if (!asin) continue;
    out.set(asin, e.code === 'ItemNotAccessible' ? 'API_BLOCKED' : e.code === 'InvalidParameterValue' ? 'INVALID_ASIN' : 'NOT_FOUND');
  }
  return out;
}

function toItem(it: any): Item {
  const listing = it.offersV2?.listings?.[0];
  return {
    asin: it.asin,
    availability: listing?.availability?.type || 'NO_OFFER',
    price: listing?.price?.money?.amount ?? null,
    title: it.itemInfo?.title?.displayValue || ''
  };
}

// A model number such as "WA70BG4441YYTL" or "55Q6C"; ignores sizes like "190L" and junk like "ATMOS%C2%AE"
function modelToken(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const tokens = c.replace(/%[0-9A-F]{2}/gi, ' ').toUpperCase().match(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{5,}\b/g) || [];
    const t = tokens.find(t =>
      t.length >= 6 &&
      (t.match(/\d/g) || []).length >= 2 &&
      (t.match(/[A-Z]/g) || []).length >= 2 &&
      !/^\d+(\.\d+)?(KG|L|LTR|W|MM|CM|HZ|INCH|TON|STAR)$/.test(t) &&
      !/^B0[A-Z0-9]{8}$/.test(t)
    );
    if (t) return t;
  }
  return null;
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
  const products = await fetchAll('products', 'id, name, brand, model, status, recommendable, price, created_at, categories(slug), product_videos(id), product_specs(spec_key)');
  const links = await fetchAll('product_links', '*');
  const linkByProduct = new Map(links.map(l => [l.product_id, l]));
  const asinOf = (productId: string) => {
    const l = linkByProduct.get(productId);
    return l ? l.asin || extractAsin(l.amazon_url) : null;
  };

  const token = await getToken();

  // 1. Stock + price for every ASIN
  const asins = [...new Set(products.map(p => asinOf(p.id)).filter(Boolean))] as string[];
  const items = new Map<string, Item>();
  console.log(`Checking ${asins.length} ASINs on Amazon...`);
  for (let i = 0; i < asins.length; i += 10) {
    const batch = asins.slice(i, i + 10);
    const data = await callApi(token, 'getItems', { itemIds: batch, itemIdType: 'ASIN', resources: ['itemInfo.title', 'offersV2.listings.availability', 'offersV2.listings.price'] });
    for (const it of data.itemsResult?.items || []) items.set(it.asin, toItem(it));
    // Amazon says why an ASIN was not returned; "not accessible" does NOT mean removed
    const reasons = missingReasons(data);
    for (const a of batch) if (!items.has(a)) items.set(a, { asin: a, availability: reasons.get(a) || 'NOT_FOUND', price: null, title: '' });
    await sleep(1100);
  }

  const isComplete = (p: any) => p.status === 'active' && p.name && p.brand && CANONICAL_CATEGORIES.includes(p.categories?.slug) && !ACCESSORY.test(p.name);

  // 2. Replacement listings for unavailable products that are otherwise complete
  const replacements = new Map<string, Item>(); // productId -> replacement
  const searched = new Map<string, Item | null>(); // model token -> result
  const needReplacement = !WITH_REPLACEMENTS ? [] : products.filter(p => isComplete(p) && asinOf(p.id) && !BUYABLE.includes(items.get(asinOf(p.id)!)!.availability));
  console.log(`Searching replacements for ${needReplacement.length} unavailable products...`);
  for (const p of needReplacement) {
    const token_ = modelToken(items.get(asinOf(p.id)!)?.title, p.model, p.name);
    if (!token_) continue;
    if (!searched.has(token_)) {
      const data = await callApi(token, 'searchItems', { keywords: `${p.brand} ${token_}`, itemCount: 10, resources: ['itemInfo.title', 'offersV2.listings.availability', 'offersV2.listings.price'] });
      const match = (data.searchResult?.items || []).map(toItem).find((it: Item) =>
        BUYABLE.includes(it.availability) && it.price !== null &&
        !ACCESSORY_TITLE.test(it.title) &&
        compact(it.title).includes(compact(token_)) &&
        compact(it.title).startsWith(compact(p.brand))
      ) || null;
      searched.set(token_, match);
      await sleep(1100);
    }
    const match = searched.get(token_);
    // Price sanity: the same model should cost roughly the same
    if (match && (p.price == null || (match.price! >= p.price * 0.6 && match.price! <= p.price * 1.6))) {
      replacements.set(p.id, match);
    }
  }

  // 3. Decide what is shown: buyable + complete, one product per ASIN and per identical name
  const effective = (p: any): Item | null => replacements.get(p.id) || items.get(asinOf(p.id) || '') || null;
  const rank = (p: any) => (p.recommendable ? 1000 : 0) + (p.product_videos?.length ? 100 : 0) + (p.product_specs?.length || 0);
  const pool = products
    .filter(p => isComplete(p) && effective(p) && BUYABLE.includes(effective(p)!.availability) && (effective(p)!.price ?? p.price) != null)
    .sort((a, b) => rank(b) - rank(a) || a.created_at.localeCompare(b.created_at));

  const seenAsin = new Set<string>();
  const seenName = new Set<string>();
  const show = new Set<string>();
  for (const p of pool) {
    const asin = effective(p)!.asin;
    const nameKey = `${p.categories.slug}|${normName(p.name)}`;
    if (seenAsin.has(asin) || seenName.has(nameKey)) continue;
    seenAsin.add(asin);
    seenName.add(nameKey);
    show.add(p.id);
  }

  // 4. Report
  const counts: Record<string, number> = {};
  products.forEach(p => { const a = asinOf(p.id) ? items.get(asinOf(p.id)!)!.availability : 'NO_ASIN'; counts[a] = (counts[a] || 0) + 1; });
  const wasShown = products.filter(p => p.recommendable);
  const perCat: Record<string, number> = {};
  products.filter(p => show.has(p.id)).forEach(p => perCat[p.categories.slug] = (perCat[p.categories.slug] || 0) + 1);

  console.log('\n=== Amazon availability (all products) ===');
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`));
  const replacementList = [...replacements.entries()].map(([id, r]) => {
    const p = products.find(x => x.id === id);
    return { product: p.name, oldAsin: asinOf(id), oldPrice: p.price, newAsin: r.asin, newPrice: r.price, newTitle: r.title };
  });
  fs.writeFileSync(path.resolve('replacements-report.json'), JSON.stringify(replacementList, null, 2));
  console.log(`\nReplacement in-stock listings found: ${replacements.size} products (all listed in replacements-report.json)`);
  replacementList.slice(0, 15).forEach(r => console.log(`  ${r.oldAsin} -> ${r.newAsin}  ${(r.product || '').slice(0, 38).padEnd(38)} | ${r.newTitle.slice(0, 55)}`));
  console.log('\n=== Shown to users ===');
  console.log(`  Before: ${wasShown.length} (${wasShown.filter(p => BUYABLE.includes(items.get(asinOf(p.id) || '')?.availability || '')).length} buyable)`);
  console.log(`  After : ${show.size} (all buyable, no duplicates)`);
  console.log(`  Newly shown: ${[...show].filter(id => !products.find(p => p.id === id).recommendable).length} | hidden: ${wasShown.filter(p => !show.has(p.id)).length}`);
  console.log('  Per category:', Object.entries(perCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
    return;
  }

  // 5. Write
  // Migrations 0006/0007 add the tracking columns; without them we still update price + recommendable
  const hasAvailabilityCols = !(await supabase.from('products').select('amazon_availability').limit(1)).error;
  const hasLinkCols = !(await supabase.from('product_links').select('asin').limit(1)).error;
  if (!hasAvailabilityCols) console.log('Note: migration 0007 not applied - stock status is used for this run but not stored.');

  const now = new Date().toISOString();
  for (const p of products) {
    const asin = asinOf(p.id);
    const item = effective(p);
    const update: any = { recommendable: show.has(p.id) };
    if (hasAvailabilityCols) {
      update.availability_checked_at = now;
      update.amazon_availability = asin ? item!.availability : 'NO_ASIN';
    }
    if (item?.price != null) update.price = item.price;
    const { error } = await supabase.from('products').update(update).eq('id', p.id);
    if (error) console.error(`  product ${p.id}: ${error.message}`);
  }
  for (const [productId, r] of replacements) {
    const link = linkByProduct.get(productId);
    const { error } = await supabase
      .from('product_links')
      .update({ amazon_url: `https://www.amazon.in/dp/${r.asin}?tag=${PARTNER_TAG}`, ...(hasLinkCols ? { asin: r.asin, amazon_link_source: 'replacement' } : {}) })
      .eq('id', link.id);
    if (error) console.error(`  link ${link.id}: ${error.message}`);
  }
  console.log(`\nApplied: ${products.length} products refreshed, ${replacements.size} links replaced, ${show.size} recommendable.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
