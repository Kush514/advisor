import { SupabaseClient } from '@supabase/supabase-js';
import { FinderProduct } from '@vmone/shared';

// Live Amazon prices for the products a user is about to see.
//
// Stored prices only change when the sync job runs, so they can be hours old. Before results are
// returned, the current price and stock of the shown products are fetched from the Amazon Creators
// API (one request per 10 products, in parallel). Out-of-stock products, and products whose live
// price has moved outside the chosen budget, are dropped. Prices are cached ~15 minutes per ASIN so
// popular products are not re-fetched on every search, and fresh prices are written back to the
// database in the background. If Amazon does not answer, the stored price is shown and marked.

export type AmazonEnv = {
  AMAZON_CREATORS_CLIENT_ID?: string;
  AMAZON_CREATORS_CLIENT_SECRET?: string;
  AMAZON_CREATORS_PARTNER_TAG?: string;
};

type Live = { price: number | null; availability: string; checkedAt: string };

const API = 'https://creatorsapi.amazon/catalog/v1/getItems';
const TOKEN_URL = 'https://api.amazon.co.uk/auth/o2/token';
const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 2500;
const MAX_LIVE = 30;
const BUYABLE = ['IN_STOCK', 'IN_STOCK_SCARCE'];

// Module scope survives between requests within a Worker isolate
let token: { value: string; expires: number } | null = null;
const cache = new Map<string, { live: Live; at: number }>();

async function getToken(env: AmazonEnv): Promise<string | null> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.AMAZON_CREATORS_CLIENT_ID,
      client_secret: env.AMAZON_CREATORS_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  token = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

async function fetchBatch(env: AmazonEnv, accessToken: string, asins: string[]): Promise<Map<string, Live>> {
  const out = new Map<string, Live>();
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'x-marketplace': 'www.amazon.in' },
    body: JSON.stringify({
      itemIds: asins,
      itemIdType: 'ASIN',
      partnerTag: env.AMAZON_CREATORS_PARTNER_TAG || 'vmone-21',
      marketplace: 'www.amazon.in',
      resources: ['offersV2.listings.price', 'offersV2.listings.availability']
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) return out;
  const data = (await res.json()) as any;
  const checkedAt = new Date().toISOString();
  for (const it of data.itemsResult?.items || []) {
    const listing = it.offersV2?.listings?.[0];
    out.set(it.asin, {
      price: listing?.price?.money?.amount ?? null,
      availability: listing?.availability?.type || 'NO_OFFER',
      checkedAt
    });
  }
  // ASINs Amazon did not return: "ItemNotAccessible" means the API won't expose it (the listing may
  // still be live), "InvalidParameterValue" means the ASIN is wrong. Either way it can't be shown.
  const reasons = new Map<string, string>();
  for (const e of data.errors || []) {
    const asin = String(e.message || '').match(/ItemId\s+([A-Z0-9]{10})/i)?.[1]?.toUpperCase();
    if (asin) reasons.set(asin, e.code === 'ItemNotAccessible' ? 'API_BLOCKED' : e.code === 'InvalidParameterValue' ? 'INVALID_ASIN' : 'NOT_FOUND');
  }
  for (const a of asins) if (!out.has(a)) out.set(a, { price: null, availability: reasons.get(a) || 'NOT_FOUND', checkedAt });
  return out;
}

/** Live price + stock for these ASINs (cached ~15 min). Missing entries mean Amazon could not be reached. */
async function getLive(env: AmazonEnv, asins: string[]): Promise<Map<string, Live>> {
  const result = new Map<string, Live>();
  const now = Date.now();
  const todo: string[] = [];
  for (const a of asins) {
    const hit = cache.get(a);
    if (hit && now - hit.at < CACHE_MS) result.set(a, hit.live);
    else todo.push(a);
  }
  if (todo.length === 0 || !env.AMAZON_CREATORS_CLIENT_ID || !env.AMAZON_CREATORS_CLIENT_SECRET) return result;

  try {
    const accessToken = await getToken(env);
    if (!accessToken) return result;
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += 10) batches.push(todo.slice(i, i + 10));
    const settled = await Promise.allSettled(batches.map(b => fetchBatch(env, accessToken, b)));
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      for (const [asin, live] of s.value) {
        result.set(asin, live);
        cache.set(asin, { live, at: now });
      }
    }
  } catch (err) {
    console.error('Live price lookup failed:', err);
  }
  return result;
}

/**
 * Replaces stored prices with live ones for the first MAX_LIVE products and drops those that are no
 * longer buyable or no longer fit the budget. Returns the products to show and a background task
 * that saves the fresh prices.
 */
export async function applyLivePrices(
  env: AmazonEnv,
  supabase: SupabaseClient,
  products: FinderProduct[],
  budget?: { min?: number; max?: number }
): Promise<{ products: FinderProduct[]; persist: Promise<void> }> {
  const head = products.slice(0, MAX_LIVE);
  const asins = [...new Set(head.map(p => p.asin).filter((a): a is string => !!a))];
  const live = await getLive(env, asins);

  const shown: FinderProduct[] = [];
  const updates: { id: string; live: Live }[] = [];
  for (const p of products) {
    const l = p.asin ? live.get(p.asin) : undefined;
    if (!l) {
      // Not checked (beyond MAX_LIVE, no ASIN, or Amazon unreachable): keep the stored price
      shown.push({ ...p, price: { ...p.price, live: false, checkedAt: null } });
      continue;
    }
    updates.push({ id: p.id, live: l });
    if (!BUYABLE.includes(l.availability)) continue;
    const amount = l.price ?? p.price.amount;
    if (budget && amount != null && ((budget.min !== undefined && amount < budget.min) || (budget.max !== undefined && amount > budget.max))) continue;
    shown.push({ ...p, price: { ...p.price, amount, source: 'amazon', live: l.price != null, checkedAt: l.checkedAt } });
  }

  const persist = (async () => {
    for (const u of updates) {
      const fields: Record<string, unknown> = { amazon_availability: u.live.availability, availability_checked_at: u.live.checkedAt };
      if (u.live.price != null) fields.price = u.live.price;
      await supabase.from('products').update(fields).eq('id', u.id);
    }
  })().catch(err => console.error('Saving live prices failed:', err));

  return { products: shown, persist };
}
