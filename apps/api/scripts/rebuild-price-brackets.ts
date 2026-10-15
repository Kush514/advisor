import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Rebuilds each category's "price" question options from the real prices of
// recommendable products, so every bracket returns at least one product.
// Usage: npx tsx scripts/rebuild-price-brackets.ts [--apply]

dotenv.config({ path: path.resolve('.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const APPLY = process.argv.includes('--apply');
const OPEN_ENDED_MAX = 9999999; // top bracket stays open so newly priced products still fit
const MIN_PER_BRACKET = 2;

// Round to a "nice" boundary: 23456 -> 25000, 3456 -> 3500, 740 -> 750
function niceRound(x: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const step = mag / 2;
  return Math.max(step, Math.round(x / step) * step);
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function buildBrackets(prices: number[], targetCount: number) {
  const sorted = [...prices].sort((a, b) => a - b);
  const count = (min: number, max: number) => sorted.filter(p => p >= min && p <= max).length;

  // Try the target number of brackets, falling back to fewer if any bracket would be too thin
  for (let n = Math.min(targetCount, Math.floor(sorted.length / MIN_PER_BRACKET)); n >= 2; n--) {
    const cuts: number[] = [];
    for (let i = 1; i < n; i++) {
      const cut = niceRound(sorted[Math.floor((sorted.length * i) / n)]);
      if (!cuts.includes(cut)) cuts.push(cut);
    }
    const bounds = [0, ...cuts, OPEN_ENDED_MAX];
    const ranges = bounds.slice(0, -1).map((min, i) => ({ min, max: bounds[i + 1] }));
    if (ranges.length === n && ranges.every(r => count(r.min, r.max) >= MIN_PER_BRACKET)) {
      return ranges.map((r, i) => ({
        label: i === 0 ? `Under ${inr(r.max)}` : i === ranges.length - 1 ? `Above ${inr(r.min)}` : `${inr(r.min)} to ${inr(r.max)}`,
        value: `${r.min}-${r.max}`,
        products: count(r.min, r.max)
      }));
    }
  }
  return [{ label: 'Any budget', value: `0-${OPEN_ENDED_MAX}`, products: sorted.length }];
}

async function run() {
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('price, category_id')
    .eq('status', 'active')
    .eq('recommendable', true)
    .not('price', 'is', null);
  if (pErr) throw pErr;

  const { data: questions, error: qErr } = await supabase
    .from('question_templates')
    .select('id, category_id, options, categories(slug)')
    .eq('question_key', 'price');
  if (qErr) throw qErr;

  const backupPath = path.resolve(`price-brackets-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(questions, null, 2));
  console.log(`Backup of current options: ${backupPath}\n`);

  for (const q of questions!) {
    const slug = (q.categories as any)?.slug;
    const prices = products!.filter(p => p.category_id === q.category_id && p.price > 0).map(p => p.price);
    if (prices.length === 0) {
      console.log(`${slug}: no priced products, leaving unchanged`);
      continue;
    }

    const brackets = buildBrackets(prices, Math.max(3, q.options.length));
    console.log(`${slug} (${prices.length} priced):`);
    brackets.forEach(b => console.log(`   ${b.label.padEnd(26)} ${b.value.padEnd(16)} ${b.products} products`));

    if (APPLY) {
      const options = brackets.map(({ label, value }) => ({ label, value }));
      const { error } = await supabase.from('question_templates').update({ options }).eq('id', q.id);
      if (error) console.error(`   update failed: ${error.message}`);
    }
  }

  console.log(APPLY ? '\nApplied.' : '\nDry run only. Re-run with --apply to write changes.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
