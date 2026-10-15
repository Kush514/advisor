import { SupabaseClient } from '@supabase/supabase-js';
import { QuestionOption, QuestionTemplateResponse } from '@vmone/shared';
import { CATEGORY_ATTRIBUTES, NumericAttribute, getSize, getType, parseSizeAnswer } from './attributes';
import { matchesFeature } from './recommendation-engine';
import { CATEGORY_PREFERENCES, isStrictPreference, optionMatches, preferenceState, productText } from './preferences';

// Builds the Finder questions for a category from the products that can actually be recommended.
// Every question only offers options that still have products after the answers given before it,
// so a user can no longer pick a combination (e.g. "above ₹75,000" + "32 inch") that does not exist.

export const SIZE_KEY = 'size';
export const TYPE_KEY = 'type';
export const ANY_VALUE = 'any';
const MAX_QUESTIONS = 5;
const MIN_QUESTIONS = 4;
const MAX_DISCRETE_OPTIONS = 6;

type Answers = Record<string, unknown>;

const parsePriceRange = (value: unknown) => {
  const m = String(value ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
};

function niceRound(x: number): number {
  if (x <= 0) return x;
  const step = Math.pow(10, Math.floor(Math.log10(x))) / 2;
  return Math.max(step, Math.round(x / step) * step);
}

/** Exact values when there are only a few (55 inch, 65 inch), otherwise ranges (Under 200 L, 200 to 300 L). */
function sizeOptions(sizes: number[], attr: NumericAttribute): QuestionOption[] {
  const distinct = [...new Set(sizes)].sort((a, b) => a - b);
  if (distinct.length <= MAX_DISCRETE_OPTIONS) {
    return distinct.map(n => ({ value: String(n), label: attr.format(n) }));
  }

  const sorted = [...sizes].sort((a, b) => a - b);
  for (let n = 4; n >= 2; n--) {
    const cuts: number[] = [];
    for (let i = 1; i < n; i++) {
      const cut = niceRound(sorted[Math.floor((sorted.length * i) / n)]);
      if (!cuts.includes(cut)) cuts.push(cut);
    }
    const bounds = [0, ...cuts, 999999];
    // Upper bound is exclusive (cut - 0.001) so ranges never overlap
    const ranges = bounds.slice(0, -1).map((min, i) => ({ min, max: i === bounds.length - 2 ? bounds[i + 1] : bounds[i + 1] - 0.001, cut: bounds[i + 1] }));
    if (ranges.length === n && ranges.every(r => sorted.some(s => s >= r.min && s <= r.max))) {
      return ranges.map((r, i) => ({
        value: `${r.min}-${r.max}`,
        label: i === 0 ? `Under ${r.cut} ${attr.unit}` : i === ranges.length - 1 ? `${r.min} ${attr.unit} and above` : `${r.min} to ${r.cut} ${attr.unit}`
      }));
    }
  }
  return [];
}

const withAny = (options: QuestionOption[], label: string): QuestionOption[] => [...options, { value: ANY_VALUE, label }];

// Topics already covered by a preference question, so an old database question on the same topic
// is not asked twice (pref-stars vs "Star Rating", pref-controls vs "Control Type"...)
const TOPIC_ALIASES: Record<string, RegExp> = {
  'pref-stars': /star/i,
  'pref-power': /power|watt/i,
  'pref-controls': /control/i,
  'pref-autoignition': /ignition/i,
  'pref-soleplate': /soleplate/i,
  'pref-jars': /jar/i,
  'pref-channels': /channel|audio/i,
  'pref-atmos': /audio|atmos/i,
  'pref-room': /cadr|coverage|room/i,
  'pref-hepa': /filter/i,
  'pref-install': /install/i,
  'pref-capacity': /capacity/i,
  'pref-unlock': /unlock/i,
  'pref-autoclean': /clean/i,
  'pref-filterless': /filter/i,
  'pref-honeycomb': /cooling\s*medium|pad/i,
  'pref-resolution': /resolution/i,
  'pref-os': /operating|os\b/i,
  'pref-bldc': /speed|motor/i
};
const askedTopics = (qs: QuestionTemplateResponse[]) =>
  qs.map(q => TOPIC_ALIASES[q.questionKey]).filter((r): r is RegExp => !!r);
const chosen = (options: QuestionOption[], answer: unknown) =>
  answer !== undefined && answer !== ANY_VALUE && options.some(o => o.value === String(answer)) ? String(answer) : null;

export async function buildFinderQuestions(
  supabase: SupabaseClient,
  slug: string,
  answers: Answers,
  hiddenKeys: string[]
): Promise<{ category: { slug: string; name: string }; questions: QuestionTemplateResponse[] } | null> {
  const { data: category } = await supabase.from('categories').select('id, slug, name').eq('slug', slug).single();
  if (!category) return null;

  const [{ data: templates, error: qError }, { data: products, error: pError }] = await Promise.all([
    supabase
      .from('question_templates')
      .select('question_key, question_text, question_type, options, display_order')
      .eq('category_id', category.id)
      .not('question_key', 'in', `(${hiddenKeys.join(',')})`)
      .order('display_order', { ascending: true }),
    supabase
      .from('products')
      .select('id, name, description, price, product_specs ( spec_key, spec_value, spec_unit )')
      .eq('category_id', category.id)
      .eq('status', 'active')
      .eq('recommendable', true)
  ]);
  if (qError) throw qError;
  if (pError) throw pError;

  const attrs = CATEGORY_ATTRIBUTES[slug] || {};
  const questions: QuestionTemplateResponse[] = [];
  const add = (questionKey: string, questionText: string, options: QuestionOption[]) =>
    questions.push({ questionKey, questionText, questionType: 'single_select', options, required: true, displayOrder: questions.length + 1 });

  // `pool` narrows as each strict answer is applied, in question order
  let pool = products || [];

  // 1. Budget
  const priceTemplate = (templates || []).find(t => t.question_key === 'price');
  if (priceTemplate) {
    const inRange = (p: any, r: { min: number; max: number }) => typeof p.price === 'number' && p.price >= r.min && p.price <= r.max;
    const options = (priceTemplate.options as QuestionOption[]).filter(o => {
      const r = parsePriceRange(o.value);
      return r && pool.some(p => inRange(p, r));
    });
    if (options.length > 0) {
      add('price', priceTemplate.question_text, options);
      const range = parsePriceRange(chosen(options, answers.price));
      if (range) pool = pool.filter(p => inRange(p, range));
    }
  }

  // 2. Size / capacity (strict: the product must positively match)
  if (attrs.size) {
    const sizeAttr = attrs.size;
    const options = sizeOptions(pool.map(p => getSize(p, sizeAttr)).filter((n): n is number => n !== null), sizeAttr);
    if (options.length >= 2) {
      add(SIZE_KEY, sizeAttr.question, withAny(options, 'Not sure / any size'));
      const range = parseSizeAnswer(chosen(options, answers[SIZE_KEY]));
      if (range) pool = pool.filter(p => { const s = getSize(p, sizeAttr); return s !== null && s >= range.min && s <= range.max; });
    }
  }

  // 3. Type (known mismatches are removed; products whose type is unknown stay available)
  if (attrs.type) {
    const typeAttr = attrs.type;
    const types = pool.map(p => getType(p, typeAttr));
    const options = typeAttr.choices.filter(c => types.includes(c.value)).map(c => ({ value: c.value, label: c.label }));
    if (options.length >= 2) {
      add(TYPE_KEY, typeAttr.question, withAny(options, 'Not sure / any type'));
      const type = chosen(options, answers[TYPE_KEY]);
      if (type) pool = pool.filter(p => { const t = getType(p, typeAttr); return t === null || t === type; });
    }
  }

  // 4. Preference questions (preferences.ts).
  //    Ranking-only preferences take their options from the whole category, so a cheap budget with
  //    only a few products still gets a full set of questions. Strict ones (star rating, power, room
  //    size) only offer values that exist among the products still in play, and narrow that pool for
  //    the questions after them, like size and type. A question needs two real choices, or one choice
  //    that only some products have (asked as yes / no, e.g. "5 Star" vs "Doesn't matter").
  const categoryTexts = (products || []).map(productText);
  for (const pref of CATEGORY_PREFERENCES[slug] || []) {
    if (questions.length >= MAX_QUESTIONS) break;
    const strict = isStrictPreference(slug, pref.key);
    const texts = strict ? pool.map(productText) : categoryTexts;
    const available = pref.options.filter(o => texts.some(t => optionMatches(o, t)));
    const worthAsking = available.length >= 2 ||
      (available.length === 1 && texts.some(t => !optionMatches(available[0], t)));
    if (!worthAsking) continue;
    const options = available.map(o => ({ value: o.value, label: o.label }));
    add(pref.key, pref.question, withAny(options, pref.noPreference));

    const picked = strict ? pref.options.find(o => o.value === chosen(options, answers[pref.key])) : undefined;
    if (picked) pool = pool.filter(p => preferenceState(pref, picked, productText(p)) !== 'mismatch');
  }

  // 5. Older AI-generated questions from the database only fill in if fewer than MIN_QUESTIONS remain,
  //    minus any that the size/type questions replace. Options nothing satisfies are dropped.
  for (const t of templates || []) {
    if (questions.length >= MIN_QUESTIONS) break;
    if (t.question_key === 'price') continue;
    if (attrs.size?.specKey.test(t.question_key) || attrs.type?.replaces.test(t.question_key)) continue;
    if (askedTopics(questions).some(topic => topic.test(t.question_key))) continue; // e.g. "Power" when pref-power is asked
    const options = ((t.options as QuestionOption[]) || []).filter(o =>
      pool.some(p => matchesFeature(p, String(o.value).replace(/_/g, ' ')))
    );
    if (options.length >= 2) add(t.question_key, t.question_text, withAny(options, 'No preference'));
  }

  return { category: { slug: category.slug, name: category.name }, questions };
}
