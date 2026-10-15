// Key product attributes per category (size/capacity and type), derived deterministically.
//
// Product specs are AI-extracted and inconsistent: the same fact appears as `Screen Size: "55 Inch"`,
// `screen_size: "55"`, or only in the product name. Matching answers against raw spec text therefore
// let a "32 inch" request return a 75 inch TV. This module reads one reliable value per product so the
// Finder can (a) offer only sizes/types that exist and (b) filter on them strictly.

export type NumericAttribute = {
  question: string;
  /** Spec keys that hold this value (also used to drop the overlapping AI-generated question) */
  specKey: RegExp;
  /** Captures the number from the product name, e.g. "... 55 Inch ..." */
  name: RegExp;
  /** Plausible range; anything outside is treated as a parsing mistake */
  min: number;
  max: number;
  format: (n: number) => string;
  /** Unit used in range labels, e.g. "Under 200 L" */
  unit: string;
};

export type ChoiceAttribute = {
  question: string;
  /** AI-generated question keys this replaces */
  replaces: RegExp;
  /** First matching choice wins, so list the most specific first */
  choices: { value: string; label: string; match: RegExp }[];
};

export type CategoryAttributes = { size?: NumericAttribute; type?: ChoiceAttribute };

const LITRES = String.raw`(?:l|ltr|ltrs|litre|litres|liter|liters)\b`;
const num = (n: number) => String(Number(n.toFixed(2)));

const litres = (question: string, min: number, max: number): NumericAttribute => ({
  question,
  specKey: /capacity/i,
  name: new RegExp(String.raw`(\d+(?:\.\d+)?)\s*-?\s*${LITRES}`, 'i'),
  min,
  max,
  format: n => `${num(n)} L`,
  unit: 'L'
});

export const CATEGORY_ATTRIBUTES: Record<string, CategoryAttributes> = {
  'tv': {
    size: {
      question: 'What screen size do you want?',
      specKey: /screen.?size|display.?size|^size$/i,
      name: /(\d{2,3})\s*-?\s*(?:inch|inches|")/i,
      min: 20, max: 110, format: n => `${num(n)} inch`, unit: 'inch'
    }
  },
  'air-conditioner': {
    size: {
      question: 'What capacity (ton) do you need?',
      specKey: /^ton|tonnage|capacity/i,
      name: /(\d(?:\.\d+)?)\s*-?\s*ton/i,
      min: 0.5, max: 3, format: n => `${num(n)} Ton`, unit: 'Ton'
    },
    type: {
      question: 'Which type of AC?',
      replaces: /^type$|ac.?type/i,
      choices: [
        { value: 'window', label: 'Window AC', match: /window/i },
        { value: 'portable', label: 'Portable / Tower AC', match: /portable|tower/i },
        { value: 'split', label: 'Split AC', match: /split/i }
      ]
    }
  },
  'refrigerators': {
    size: litres('What capacity do you need?', 40, 900),
    type: {
      question: 'Which type of refrigerator?',
      replaces: /^type$|door|refrigeration.?type/i,
      choices: [
        { value: 'side-by-side', label: 'Side by Side', match: /side.?by.?side/i },
        { value: 'multi-door', label: 'French / Multi Door', match: /french|multi.?door|triple.?door|4.?door/i },
        { value: 'double-door', label: 'Double Door', match: /double.?door|bottom.?mount|top.?mount|frost.?free/i },
        { value: 'single-door', label: 'Single Door', match: /single.?door|direct.?cool/i }
      ]
    }
  },
  'washing-machine': {
    size: {
      question: 'What capacity do you need?',
      specKey: /capacity/i,
      name: /(\d+(?:\.\d+)?)\s*-?\s*kg/i,
      min: 4, max: 20, format: n => `${num(n)} kg`, unit: 'kg'
    },
    type: {
      question: 'Which type of washing machine?',
      replaces: /load|^type$/i,
      choices: [
        { value: 'semi-automatic', label: 'Semi Automatic', match: /semi/i },
        { value: 'front-load', label: 'Front Load', match: /front.?load/i },
        { value: 'top-load', label: 'Top Load', match: /top.?load/i }
      ]
    }
  },
  'geyser': {
    size: litres('What capacity do you need?', 1, 100),
    type: {
      question: 'Which type of geyser?',
      replaces: /^type$/i,
      choices: [
        { value: 'instant', label: 'Instant', match: /instant/i },
        { value: 'storage', label: 'Storage', match: /storage/i }
      ]
    }
  },
  'water-purifier': {
    type: {
      question: 'Which purification do you need?',
      replaces: /purification|technology|^type$/i,
      choices: [
        { value: 'ro', label: 'RO (borewell / hard water)', match: /\bRO\b/ },
        { value: 'uv-uf', label: 'UV / UF (municipal water)', match: /\bUV\b|\bUF\b/ }
      ]
    }
  },
  'microwave-otg-oven': {
    size: litres('What capacity do you need?', 8, 70),
    type: {
      question: 'Which type do you want?',
      replaces: /^type$/i,
      choices: [
        { value: 'otg', label: 'OTG', match: /\botg\b|oven toaster/i },
        { value: 'convection', label: 'Convection Microwave', match: /convection/i },
        { value: 'grill', label: 'Grill Microwave', match: /grill/i },
        { value: 'solo', label: 'Solo Microwave', match: /solo/i }
      ]
    }
  },
  'air-fryer': { size: litres('What capacity do you need?', 1, 20) },
  'electric-cooker': { size: litres('What capacity do you need?', 0.5, 12) },
  'air-cooler': {
    size: litres('What tank capacity do you need?', 8, 200),
    type: {
      question: 'Which type of cooler?',
      replaces: /^type$/i,
      choices: [
        { value: 'desert', label: 'Desert Cooler', match: /desert/i },
        { value: 'tower', label: 'Tower Cooler', match: /tower/i },
        { value: 'personal', label: 'Personal Cooler', match: /personal|room cooler/i }
      ]
    }
  },
  'chimney': {
    size: {
      question: 'What chimney width do you need?',
      specKey: /^size$|width/i,
      name: /(\d{2,3})\s*-?\s*cm/i,
      min: 45, max: 120, format: n => `${num(n)} cm`, unit: 'cm'
    }
  },
  'gas-stove': {
    size: {
      question: 'How many burners do you need?',
      specKey: /burner/i,
      name: /(\d)\s*-?\s*burner/i,
      min: 1, max: 6, format: n => `${num(n)} Burner`, unit: 'burners'
    }
  },
  'mixer-grinder': {
    size: {
      question: 'How powerful should it be?',
      specKey: /^power$|watt/i,
      name: /(\d{3,4})\s*-?\s*(?:w\b|watt)/i,
      min: 300, max: 2500, format: n => `${num(n)} W`, unit: 'W'
    }
  },
  'ceiling-fans': {
    size: {
      question: 'What fan size (sweep) do you need?',
      specKey: /sweep|^size$/i,
      name: /(\d{3,4})\s*-?\s*mm/i,
      min: 600, max: 1600, format: n => `${num(n)} mm`, unit: 'mm'
    }
  },
  'dishwasher': {
    size: {
      question: 'How many place settings do you need?',
      specKey: /place.?setting|^capacity$/i,
      name: /(\d{1,2})\s*-?\s*place/i,
      min: 4, max: 18, format: n => `${num(n)} place settings`, unit: 'place settings'
    }
  },
  'inverter-battery': {
    type: {
      question: 'What are you looking for?',
      replaces: /^type$/i,
      choices: [
        { value: 'combo', label: 'Inverter + Battery combo', match: /combo|with battery|\+\s*battery/i },
        { value: 'battery', label: 'Battery only', match: /battery/i },
        { value: 'inverter', label: 'Inverter only', match: /inverter|\bups\b/i }
      ]
    }
  },
  'electric-iron': {
    type: {
      question: 'Which type of iron?',
      replaces: /^type$/i,
      choices: [
        { value: 'steamer', label: 'Garment Steamer', match: /garment|steamer/i },
        { value: 'steam', label: 'Steam Iron', match: /steam/i },
        { value: 'dry', label: 'Dry Iron', match: /dry/i }
      ]
    }
  },
  'room-heaters': {
    type: {
      question: 'Which type of heater?',
      replaces: /^type$/i,
      choices: [
        { value: 'oil-filled', label: 'Oil Filled (OFR)', match: /oil|\bofr\b/i },
        { value: 'fan', label: 'Fan / Blower Heater', match: /fan|blower|convector|convection|ptc/i },
        { value: 'radiant', label: 'Halogen / Quartz / Carbon', match: /halogen|quartz|carbon|radiant/i }
      ]
    }
  },
  'vacuum-cleaners-robot-vacuum': {
    type: {
      question: 'Which type of vacuum cleaner?',
      replaces: /^type$|cleaning.?type/i,
      choices: [
        { value: 'robot', label: 'Robot Vacuum', match: /robot/i },
        { value: 'wet-dry', label: 'Wet & Dry', match: /wet/i },
        { value: 'handheld', label: 'Handheld / Cordless Stick', match: /handheld|stick|cordless/i }
      ]
    }
  }
};

type ProductLike = { name?: string | null; product_specs?: { spec_key: string; spec_value: string }[] | null };

const inRange = (n: number, attr: NumericAttribute) => Number.isFinite(n) && n >= attr.min && n <= attr.max;

/** The product's size/capacity, read from a matching spec first and the product name second. */
export function getSize(product: ProductLike, attr: NumericAttribute): number | null {
  for (const spec of product.product_specs || []) {
    if (!attr.specKey.test(spec.spec_key)) continue;
    const m = String(spec.spec_value).match(/\d+(?:\.\d+)?/);
    if (m && inRange(Number(m[0]), attr)) return Number(m[0]);
  }
  const fromName = (product.name || '').match(attr.name);
  if (fromName && inRange(Number(fromName[1]), attr)) return Number(fromName[1]);
  return null;
}

/** The product's type, from its name and its type-like specs. */
export function getType(product: ProductLike, attr: ChoiceAttribute): string | null {
  const typeSpecs = (product.product_specs || [])
    .filter(s => attr.replaces.test(s.spec_key) || /type|technology/i.test(s.spec_key))
    .map(s => s.spec_value)
    .join(' ');
  const text = `${product.name || ''} ${typeSpecs}`;
  return attr.choices.find(c => c.match.test(text))?.value ?? null;
}

export type AttributeFilter = { size?: { min: number; max: number }; type?: string };

/** Strict check used by both the question builder and the recommendation engine. */
export function passesAttributes(product: ProductLike, categorySlug: string | undefined, filter: AttributeFilter | undefined): boolean {
  if (!filter || !categorySlug) return true;
  const attrs = CATEGORY_ATTRIBUTES[categorySlug];
  if (!attrs) return true;
  if (filter.size && attrs.size) {
    const size = getSize(product, attrs.size);
    if (size === null || size < filter.size.min || size > filter.size.max) return false;
  }
  if (filter.type && attrs.type) {
    if (getType(product, attrs.type) !== filter.type) return false;
  }
  return true;
}

/** Parses a size answer: "55" (exact) or "200-300" (range). */
export function parseSizeAnswer(value: unknown): { min: number; max: number } | null {
  const s = String(value ?? '').trim();
  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  if (/^\d+(?:\.\d+)?$/.test(s)) return { min: Number(s), max: Number(s) };
  return null;
}
