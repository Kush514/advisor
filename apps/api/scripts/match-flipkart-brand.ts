import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Attaches VM One's Flipkart and brand-store links (from video descriptions & PDFs) to the right
// product, exactly as VM One published them.
//
// Name matching alone is unreliable here (two Daikin 1.5 Ton models, a link labelled "Orient Zeno"
// that opens a Crompton fan...), so Gemini matches each link using what VM One wrote next to it,
// where the link really opens, and a shortlist of our products from the same brand. A match is only
// accepted when Gemini is confident AND picks from that shortlist; anything else is skipped.
// Broken placeholder Flipkart links (ad.admitad.com/dummy) are removed.
//
// Usage (from apps/api): npx tsx scripts/match-flipkart-brand.ts [--apply]

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const APPLY = process.argv.includes('--apply');
// --urls=a,b  only (re)check these links
const ONLY_URLS = (process.argv.find(a => a.startsWith('--urls=')) || '').replace('--urls=', '').split(',').filter(Boolean);
const BROKEN_FLIPKART = /ad\.admitad\.com\/dummy/i;
const NOT_A_STORE = /vmone\.in|vmlist\.in|linkedin|youtube|youtu\.be|google\.|drive\.|docs\.|indiankanoon|t\.me|instagram|facebook|twitter|x\.com|wa\.me|amazon\.|amzn\.|bit\.ly|tinyurl/i;

type Source = { url: string; context: string; video: string };
type Kind = 'flipkart' | 'brand';

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

/** Follow redirects (HEAD, then GET for shorteners that ignore HEAD) and return the final URL. */
async function finalUrl(url: string): Promise<string | null> {
  let cur = url;
  for (let hop = 0; hop < 8; hop++) {
    try {
      const opts = { redirect: 'manual' as const, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' }, signal: AbortSignal.timeout(15000) };
      let res = await fetch(cur, { ...opts, method: 'HEAD' });
      if (!(res.status >= 300 && res.status < 400)) res = await fetch(cur, { ...opts, method: 'GET' });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
      return res.status < 400 || res.status === 403 || res.status === 405 ? cur : null;
    } catch {
      return null;
    }
  }
  return cur;
}

const decode = (u: string) => { try { return decodeURIComponent(decodeURIComponent(u)); } catch { return u; } };
/** Readable description of where a link lands, e.g. the Flipkart product slug inside an affiliate redirect. */
function destinationText(u: string): string {
  const d = decode(u);
  const flipkart = d.match(/flipkart\.com\/([^/?&]+)\/p\//i);
  if (flipkart) return `Flipkart product page: ${flipkart[1].replace(/-/g, ' ')}`;
  try { const x = new URL(d); return `${x.hostname}${x.pathname}`.replace(/[-_/]+/g, ' '); } catch { return d; }
}

// "272 l", "43 inch", "7 kg", "11 fins", "5 star" -> { l: [272], inch: [43], ... }
const UNITS: [string, RegExp][] = [
  ['l', /(\d{2,4})\s*(?:l|ltr|litres?|liters?)\b/gi],
  ['inch', /(\d{2,3})\s*(?:inch|inches|")/gi],
  ['kg', /(\d{1,2}(?:\.\d)?)\s*kg\b/gi],
  ['fin', /(\d{1,2})\s*fins?\b/gi],
  ['star', /\b([1-5])\s*star\b/gi]
];
function sizeNumbers(text: string): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const [unit, re] of UNITS) for (const m of text.matchAll(re)) (out[unit] ||= new Set()).add(Number(m[1]));
  return out;
}
/** True when page and product both state a size in the same unit and none of the numbers agree. */
function sizeClash(pageText: string, productText: string): boolean {
  const page = sizeNumbers(pageText), product = sizeNumbers(productText);
  return Object.entries(page).some(([unit, nums]) => product[unit] && ![...nums].some(n => product[unit].has(n)));
}
const productTextOf = (p: any) => `${p.name} ${(p.product_specs || []).map((s: any) => `${s.spec_key} ${s.spec_value}`).join(' ')}`;
const normModel = (m: string | null) => (m && !/^new$/i.test(m) ? m.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

async function askGemini(kind: Kind, src: Source, destination: string, candidates: any[]) {
  const prompt = `You match a shopping link from a VM One YouTube video to the exact product in our catalogue.

Link type: ${kind === 'flipkart' ? 'Flipkart product link' : 'brand website / brand store link'}
Text VM One wrote next to the link: "${src.context}"
Video title: "${src.video}"
Where the link actually opens: ${destination}

Our products from this brand (id | name | model | category | price | key specs):
${candidates.map(c => `${c.id} | ${c.name} | ${c.model || '-'} | ${c.category || '-'} | ${c.price ?? '-'} | ${c.specs}`).join('\n')}

Rules:
- Return the id(s) of the product this link sells. Usually one id. Return up to 3 ids only if they are the SAME model in different colours or duplicate entries.
- The product must be the same model: same size/capacity/tonnage/star rating/variant. A different size or model is NOT a match.
- If the link opens a range/collection/offers page instead of one product, or none of our products is that exact model, return an empty list.
- Where the text and the destination disagree (e.g. text says one fan, page opens another), trust where the link actually opens.
- confidence: "high" only if you are sure it is the same model.

Reply as JSON: {"product_ids": ["..."], "confidence": "high" | "medium" | "low", "reason": "short reason"}`;

  const res = await ai.models.generateContent({
    model: 'gemini-flash-lite-latest',
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0 }
  });
  return JSON.parse(res.text || '{}') as { product_ids?: string[]; confidence?: string; reason?: string };
}

async function run() {
  const videos = new Map((await fetchAll('youtube_videos', 'id, title')).map(v => [v.id, v.title]));
  const ytLinks = await fetchAll('youtube_video_links', 'id, youtube_video_id, original_url, link_type, context_text');
  const pdfLinks = await fetchAll('pdf_document_links', 'id, original_url, link_type, context_text');
  const products = (await fetchAll('products', 'id, name, brand, model, price, status, recommendable, categories(slug), product_specs(spec_key, spec_value)'))
    .filter(p => p.status === 'active' && p.brand && p.name);
  const productLinks = await fetchAll('product_links', 'id, product_id, flipkart_url, brand_url, asin');
  const linkByProduct = new Map(productLinks.map(l => [l.product_id, l]));
  const asinByProduct = new Map(productLinks.filter(l => l.asin).map(l => [l.product_id, l.asin]));

  // 1. Candidate links, one per URL (keep the first context text)
  const candidates = new Map<string, Source>();
  for (const l of [...ytLinks, ...pdfLinks]) {
    if (!['flipkart', 'brand_or_external', 'shortened'].includes(l.link_type)) continue;
    if (!candidates.has(l.original_url)) {
      candidates.set(l.original_url, { url: l.original_url, context: (l.context_text || '').replace(/[•:]+/g, ' ').trim(), video: videos.get(l.youtube_video_id) || 'PDF buying guide' });
    }
  }

  // 2. Where each link really goes; keep Flipkart pages and brand stores
  console.log(`Checking ${candidates.size} Flipkart / brand / short links...`);
  const work: { kind: Kind; src: Source; destination: string }[] = [];
  for (const src of candidates.values()) {
    if (ONLY_URLS.length && !ONLY_URLS.includes(src.url)) continue;
    const dest = await finalUrl(src.url);
    if (!dest) continue;
    const kind: Kind | null = /flipkart\.com|fkrt\.|admitad|qvmdz/i.test(dest + src.url) ? 'flipkart' : NOT_A_STORE.test(dest) ? null : 'brand';
    if (kind) work.push({ kind, src, destination: destinationText(dest) });
  }
  console.log(`  ${work.filter(w => w.kind === 'flipkart').length} Flipkart links, ${work.filter(w => w.kind === 'brand').length} brand-store links`);

  // 3. Match each one with Gemini against same-brand products
  // Brand comes from where the link really opens first (VM One's text can name the wrong brand,
  // e.g. "Orient Zeno" opening a Crompton fan); hyphens/dots are ignored ("v guard" = "V-Guard")
  const normBrand = (s: string) => s.toLowerCase().replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const brands = [...new Set(products.map(p => p.brand.toLowerCase()))].sort((a, b) => b.length - a.length);
  const findBrand = (text: string) => brands.find(b =>
    new RegExp(`(^|[^a-z])${normBrand(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(normBrand(text)));
  const matches: any[] = [];
  for (const w of work) {
    const brand = findBrand(w.destination) || findBrand(`${w.src.context} ${decode(w.src.url)}`);
    if (!brand) { matches.push({ ...w, result: 'skipped: brand not recognised' }); continue; }
    const shortlist = products.filter(p => p.brand.toLowerCase() === brand).slice(0, 60).map(p => ({
      id: p.id, name: p.name, model: p.model, price: p.price, category: p.categories?.slug,
      specs: (p.product_specs || []).filter((s: any) => s.spec_key !== 'model').slice(0, 5).map((s: any) => `${s.spec_key}: ${s.spec_value}`).join(', ')
    }));
    try {
      const g = await askGemini(w.kind, w.src, w.destination, shortlist);
      const ids = (g.product_ids || []).filter(id => shortlist.some(c => c.id === id));
      let accepted = g.confidence === 'high' && ids.length > 0 && ids.length <= 3;
      let result = accepted ? 'matched' : `skipped: ${g.confidence || 'no'} confidence / no exact product`;

      // Safety checks on top of Gemini: the page's size numbers must agree with the product, and one
      // link may only cover several products when they are the same model (colours / duplicates)
      let keep = ids;
      if (accepted) {
        const picked = ids.map(id => products.find(p => p.id === id)!);
        const clash = picked.find(p => sizeClash(w.destination, productTextOf(p)));
        if (clash) {
          accepted = false;
          result = `rejected: page size differs from "${clash.name}"`;
        } else if (picked.length > 1) {
          // Several products: keep only the largest group that is provably one model
          // (same Amazon listing, or one model number contains the other, e.g. CS/CU-SU18BKY3W ~ SU18BKY3W)
          const same = (a: any, b: any) => {
            const asinA = asinByProduct.get(a.id), asinB = asinByProduct.get(b.id);
            if (asinA && asinA === asinB) return true;
            const ma = normModel(a.model), mb = normModel(b.model);
            return !!ma && !!mb && (ma.includes(mb) || mb.includes(ma));
          };
          const groups = picked.map(p => picked.filter(q => same(p, q)));
          const best = Math.max(...groups.map(g => g.length));
          const winners = groups.filter(g => g.length === best);
          const distinct = new Set(winners.map(g => g.map(p => p.id).sort().join()));
          if (distinct.size > 1) { accepted = false; result = 'rejected: Gemini picked different models'; }
          else {
            keep = winners[0].map(p => p.id);
            if (keep.length < picked.length) result = `matched (left out ${picked.length - keep.length} different model)`;
          }
        }
      }
      matches.push({ ...w, brand, gemini: g, productIds: accepted ? keep : [], result });
    } catch (e: any) {
      matches.push({ ...w, brand, result: `skipped: Gemini error ${e.message?.slice(0, 80)}` });
    }
    await new Promise(r => setTimeout(r, 4500)); // Gemini rate limit
  }

  // 4. Report
  const nameOf = (id: string) => products.find(p => p.id === id)?.name;
  fs.writeFileSync(path.resolve('flipkart-brand-report.json'), JSON.stringify(matches, null, 2));
  for (const kind of ['flipkart', 'brand'] as Kind[]) {
    console.log(`\n=== ${kind === 'flipkart' ? 'Flipkart' : 'Brand store'} links`);
    for (const m of matches.filter(x => x.kind === kind)) {
      const target = m.productIds?.length ? m.productIds.map((id: string) => nameOf(id)?.slice(0, 50)).join(' | ') : m.result;
      console.log(`  ${m.productIds?.length ? '✅' : '—'} "${m.src.context.slice(0, 40)}" (${m.src.url})\n       opens: ${m.destination.slice(0, 80)}\n       -> ${target}${m.gemini?.reason ? `  [${m.gemini.reason.slice(0, 90)}]` : ''}`);
    }
  }
  const broken = ONLY_URLS.length ? [] : productLinks.filter(l => l.flipkart_url && BROKEN_FLIPKART.test(l.flipkart_url));
  console.log(`\nBroken placeholder Flipkart links to remove: ${broken.length}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
    return;
  }

  // 5. Write: remove broken placeholders, then attach matched links unchanged
  for (const l of broken) {
    await supabase.from('product_links').update({ flipkart_url: null }).eq('id', l.id);
  }
  let attached = 0;
  for (const m of matches.filter(x => x.productIds?.length)) {
    const column = m.kind === 'flipkart' ? 'flipkart_url' : 'brand_url';
    for (const productId of m.productIds) {
      const link = linkByProduct.get(productId);
      if (!link) continue;
      const { error } = await supabase.from('product_links').update({ [column]: m.src.url }).eq('id', link.id);
      if (error) console.error(`  ${productId}: ${error.message}`); else attached++;
    }
  }
  console.log(`\nApplied: removed ${broken.length} broken Flipkart links, attached ${attached} Flipkart/brand links.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
