// Preference questions per category ("Do you want Wi-Fi control?", "Which resolution?").
//
// These replace the AI-generated preference questions, whose option values no longer matched the
// cleaned product specs, so most of them disappeared. Each option is recognised from the product's
// name, description and specs with a pattern, the same way attributes.ts reads size and type.
//
// Preferences are soft: a matching product ranks higher, nothing is filtered out. That keeps the
// question count stable (budget + size + type + preferences) without ever emptying the results.

type TextMatch = RegExp | ((text: string) => boolean);

export type PreferenceOption = {
  value: string;
  label: string;
  /** Shown under "Why it's a good fit"; defaults to the label */
  reason?: string;
  match: TextMatch;
};

export type Preference = {
  key: string;
  question: string;
  options: PreferenceOption[];
  /** Label of the "doesn't matter" choice */
  noPreference: string;
};

type ProductLike = {
  name?: string | null;
  description?: string | null;
  product_specs?: { spec_key: string; spec_value: string; spec_unit?: string | null }[] | null;
};

export function productText(p: ProductLike): string {
  const specs = (p.product_specs || []).map(s => `${s.spec_key}: ${s.spec_value} ${s.spec_unit || ''}`).join(' | ');
  return `${p.name || ''} | ${p.description || ''} | ${specs}`;
}

export function optionMatches(option: PreferenceOption, text: string): boolean {
  return typeof option.match === 'function' ? option.match(text) : option.match.test(text);
}

/** True when some number captured by `pattern` in the text lies in [min, max). */
const numberIn = (pattern: RegExp, min: number, max: number) => (text: string) => {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  for (const m of text.matchAll(re)) {
    const n = Number(String(m[1]).replace(/,/g, ''));
    if (Number.isFinite(n) && n >= min && n < max) return true;
  }
  return false;
};

/** A yes/no preference: one option plus "doesn't matter". */
const want = (key: string, question: string, label: string, reason: string, match: TextMatch, noPreference = "Doesn't matter"): Preference => ({
  key, question, noPreference, options: [{ value: 'yes', label, reason, match }]
});

const STAR = (key = 'pref-stars'): Preference => ({
  key,
  question: 'How important is saving electricity?',
  noPreference: "Doesn't matter",
  options: [
    { value: '5', label: '5 Star (lowest bills)', reason: '5 Star energy rating', match: /\b5\s*-?\s*star/i },
    { value: '4', label: '4 Star', reason: '4 Star energy rating', match: /\b4\s*-?\s*star/i },
    { value: '3', label: '3 Star (lower price)', reason: '3 Star energy rating', match: /\b3\s*-?\s*star/i }
  ]
});

const WIFI = (what = 'Wi-Fi / app control'): Preference =>
  want('pref-wifi', `Do you want ${what}?`, 'Yes, control it from my phone', 'Wi-Fi / app control', /wi-?fi|\bapp\b|smart\s*(control|connect)|alexa|google assistant|thinq|smartthings/i);

const WATTS = (key: string, question: string, buckets: [number, number, string][]): Preference => ({
  key, question, noPreference: "Doesn't matter",
  options: buckets.map(([min, max, label]) => ({ value: `${min}-${max}`, label, reason: label, match: numberIn(/(\d{3,4})\s*(?:w\b|watts?)/i, min, max) }))
});

export const CATEGORY_PREFERENCES: Record<string, Preference[]> = {
  'tv': [
    {
      key: 'pref-resolution', question: 'Which picture quality do you want?', noPreference: 'Not sure',
      options: [
        { value: '4k', label: '4K Ultra HD (best for 43" and above)', reason: '4K Ultra HD picture', match: /\b4k\b|ultra\s*hd|\buhd\b|2160/i },
        { value: 'fhd', label: 'Full HD', reason: 'Full HD picture', match: /full\s*hd|\bfhd\b|1080/i },
        { value: 'hd', label: 'HD Ready (budget, small screens)', reason: 'HD Ready picture', match: /hd\s*ready|\b720/i }
      ]
    },
    {
      key: 'pref-display', question: 'Which screen technology do you prefer?', noPreference: 'Not sure',
      options: [
        { value: 'oled', label: 'OLED (deepest blacks)', reason: 'OLED screen', match: /\boled\b/i },
        { value: 'mini-led', label: 'Mini LED (very bright)', reason: 'Mini LED screen', match: /mini\s*-?led/i },
        { value: 'qled', label: 'QLED (rich colours)', reason: 'QLED screen', match: /\bqled\b|\bqd\b|quantum/i }
      ]
    },
    {
      key: 'pref-os', question: 'Which smart TV system do you like?', noPreference: 'No preference',
      options: [
        { value: 'google', label: 'Google TV / Android TV', reason: 'Google TV', match: /google\s*tv|android\s*tv/i },
        { value: 'webos', label: 'LG webOS', reason: 'webOS', match: /webos/i },
        { value: 'tizen', label: 'Samsung Tizen', reason: 'Tizen OS', match: /tizen/i },
        { value: 'fire', label: 'Fire TV', reason: 'Fire TV built in', match: /fire\s*tv/i }
      ]
    },
    want('pref-gaming', 'Do you play games on your TV?', 'Yes, I want a smooth 120Hz+ screen', '120Hz+ smooth motion for gaming', /\b(1[2-9]\d|2\d\d)\s*hz/i, 'No, mostly shows & movies')
  ],
  'air-conditioner': [
    STAR(),
    WIFI(),
    want('pref-convertible', 'Do you want a convertible AC (adjustable cooling to save power)?', 'Yes, convertible', 'Convertible cooling modes', /convertible/i),
    want('pref-hotcold', 'Do you also need heating in winter?', 'Yes, hot & cold', 'Hot & cold (works as a heater)', /hot\s*(?:and|&|\+)\s*cold|heat\s*pump/i, 'No, cooling only')
  ],
  'refrigerators': [
    STAR(),
    want('pref-convertible', 'Do you want a convertible freezer (use it as a fridge when needed)?', 'Yes, convertible', 'Convertible freezer', /convertible/i),
    want('pref-inverter', 'Do you want an inverter compressor (quieter, saves power)?', 'Yes, inverter compressor', 'Inverter compressor', /inverter/i)
  ],
  'washing-machine': [
    STAR(),
    want('pref-heater', 'Do you want a built-in heater (better for stains & hygiene)?', 'Yes, with heater', 'Built-in heater', /heater|hot\s*wash|steam/i),
    want('pref-inverter', 'Do you want an inverter motor (quieter, lasts longer)?', 'Yes, inverter motor', 'Inverter / BLDC motor', /inverter|bldc|direct\s*drive|\bdd\b/i),
    WIFI()
  ],
  'soundbars': [
    {
      key: 'pref-channels', question: 'How immersive should the sound be?', noPreference: 'Not sure',
      options: [
        { value: '5.1+', label: 'Surround (5.1 channels or more)', reason: 'Surround sound (5.1+)', match: /\b(?:5|7|9)\.\d/ },
        { value: '3.1', label: '3.1 (clearer dialogue)', reason: '3.1 channels for clear dialogue', match: /\b3\.1\b/ },
        { value: '2.1', label: '2.1 (TV upgrade with bass)', reason: '2.1 channels with subwoofer', match: /\b2\.1\b/ }
      ]
    },
    want('pref-atmos', 'Do you want Dolby Atmos (sound from above)?', 'Yes, Dolby Atmos', 'Dolby Atmos', /atmos/i),
    want('pref-subwoofer', 'Do you want a separate subwoofer for deep bass?', 'Yes, with subwoofer', 'Separate subwoofer for deep bass', /sub\s*-?woofer|\b\d\.1\b/i)
  ],
  'air-purifier': [
    {
      key: 'pref-room', question: 'How big is the room?', noPreference: 'Not sure',
      options: [
        { value: 'small', label: 'Small (up to 300 sq ft)', reason: 'Right size for a small room', match: numberIn(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i, 0, 300) },
        { value: 'medium', label: 'Medium (300 – 600 sq ft)', reason: 'Right size for a medium room', match: numberIn(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i, 300, 600) },
        { value: 'large', label: 'Large (600 sq ft or more)', reason: 'Covers a large room', match: numberIn(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i, 600, 99999) }
      ]
    },
    want('pref-hepa', 'Do you want a True HEPA filter (best for allergies & PM2.5)?', 'Yes, True HEPA', 'True HEPA filter', /hepa/i),
    WIFI()
  ],
  'water-purifier': [
    want('pref-minerals', 'Do you want minerals / copper added back to the water?', 'Yes, mineral / copper boost', 'Adds minerals / copper', /mineral|copper|alkaline|zinc/i),
    want('pref-tds', 'Do you want a TDS controller (keeps water tasting natural)?', 'Yes, TDS control', 'TDS controller', /\btds\b|mtds/i),
    want('pref-storage', 'Do you want a large storage tank (7 litres or more)?', 'Yes, 7 L or more', 'Large storage tank', numberIn(/(\d{1,2}(?:\.\d)?)\s*-?\s*(?:l\b|ltr|litre|liter)/i, 7, 40))
  ],
  'geyser': [
    STAR(),
    want('pref-smart', 'Do you want smart features (Wi-Fi, digital display)?', 'Yes, smart / digital', 'Smart / digital controls', /wi-?fi|smart|digital|display/i),
    want('pref-coastal', 'Do you live in a hard-water or coastal area?', 'Yes, I need a rust-proof tank', 'Rust-proof / hard-water tank', /glass\s*(?:lined|coat)|vitreous|enamel|anti\s*-?rust|hard\s*water|coastal|titanium/i)
  ],
  'microwave-otg-oven': [
    want('pref-autocook', 'Do you want auto-cook menus (one-touch Indian recipes)?', 'Yes, auto-cook menus', 'Auto-cook menus', /auto\s*-?cook|menus?|recipes?/i),
    want('pref-convection-uses', 'Will you bake cakes or pizza?', 'Yes, I want to bake', 'Can bake (convection / OTG)', /convection|\botg\b|bak/i, 'No, mostly reheating'),
    want('pref-childlock', 'Do you need a child lock?', 'Yes, child lock', 'Child lock', /child\s*lock/i)
  ],
  'air-fryer': [
    {
      key: 'pref-controls', question: 'Which controls do you prefer?', noPreference: 'No preference',
      options: [
        { value: 'digital', label: 'Digital touch panel', reason: 'Digital touch controls', match: /digital|touch/i },
        { value: 'manual', label: 'Simple knobs', reason: 'Easy knob controls', match: /manual|knob|dial|analog/i }
      ]
    },
    want('pref-window', 'Do you want a see-through window?', 'Yes, viewing window', 'See-through viewing window', /window|see\s*-?through|visible/i),
    WATTS('pref-power', 'How powerful should it be?', [[0, 1400, 'Up to 1400 W'], [1400, 1700, '1400 – 1700 W'], [1700, 9999, '1700 W or more']]),
    want('pref-presets', 'Do you want one-touch preset menus?', 'Yes, preset menus', 'One-touch preset menus', /preset|menu|programs?/i),
    want('pref-dual', 'Do you want two baskets (cook two dishes at once)?', 'Yes, dual basket', 'Dual basket', /dual\s*(?:basket|zone)|two\s*baskets?|2\s*baskets?/i)
  ],
  'electric-cooker': [
    {
      key: 'pref-cooker-kind', question: 'What will you cook most?', noPreference: 'A bit of everything',
      options: [
        { value: 'rice', label: 'Mostly rice', reason: 'Made for rice', match: /rice/i },
        { value: 'multi', label: 'Many dishes (multi cooker)', reason: 'Multi-purpose cooker', match: /multi|kettle|pressure|all\s*in\s*one/i }
      ]
    },
    want('pref-keepwarm', 'Do you want a keep-warm mode?', 'Yes, keep warm', 'Keeps food warm', /keep\s*warm|warm/i),
    want('pref-steel', 'Do you prefer a stainless steel pot?', 'Yes, stainless steel', 'Stainless steel pot', /stainless|steel/i, 'No preference')
  ],
  'chimney': [
    want('pref-autoclean', 'Do you want auto-clean (no messy filter washing)?', 'Yes, auto-clean', 'Auto-clean', /auto\s*-?clean|thermal\s*clean/i),
    want('pref-filterless', 'Do you want a filterless chimney (less maintenance)?', 'Yes, filterless', 'Filterless design', /filter\s*-?less/i),
    want('pref-gesture', 'Do you want touch or motion-sensor controls?', 'Yes, touch / motion', 'Touch / motion-sensor controls', /touch|motion|gesture|sensor/i),
    {
      key: 'pref-suction', question: 'How much cooking do you do?', noPreference: 'Not sure',
      options: [
        { value: 'heavy', label: 'Heavy Indian cooking (1200+ m³/hr suction)', reason: 'Strong suction for heavy cooking', match: numberIn(/(\d{3,4})\s*(?:m3|m³|cmh|m\^3)/i, 1200, 99999) },
        { value: 'light', label: 'Light cooking', reason: 'Enough suction for light cooking', match: numberIn(/(\d{3,4})\s*(?:m3|m³|cmh|m\^3)/i, 0, 1200) }
      ]
    }
  ],
  'gas-stove': [
    want('pref-autoignition', 'Do you want auto ignition (no lighter needed)?', 'Yes, auto ignition', 'Auto ignition', /auto\s*-?\s*ignition/i, 'No, manual is fine'),
    {
      key: 'pref-top', question: 'Which top do you prefer?', noPreference: 'No preference',
      options: [
        { value: 'glass', label: 'Toughened glass (easy to clean, looks premium)', reason: 'Toughened glass top', match: /glass/i },
        { value: 'steel', label: 'Stainless steel (very durable)', reason: 'Stainless steel body', match: /stainless|steel/i }
      ]
    },
    want('pref-brass', 'Do you want brass burners (last longer)?', 'Yes, brass burners', 'Brass burners', /brass/i)
  ],
  'cooktop-induction': [
    WATTS('pref-power', 'How powerful should it be?', [[0, 1800, 'Up to 1800 W'], [1800, 2100, '1800 – 2000 W'], [2100, 9999, '2100 W or more']]),
    {
      key: 'pref-controls', question: 'Which controls do you prefer?', noPreference: 'No preference',
      options: [
        { value: 'touch', label: 'Touch / feather-touch', reason: 'Touch controls', match: /touch|feather/i },
        { value: 'button', label: 'Push buttons', reason: 'Push-button controls', match: /push|button/i }
      ]
    },
    want('pref-presets', 'Do you want Indian cooking presets (one-touch modes)?', 'Yes, cooking presets', 'Indian cooking presets', /preset|indian\s*menu|menu/i),
    want('pref-autooff', 'Do you want auto shut-off for safety?', 'Yes, auto shut-off', 'Auto shut-off', /auto\s*-?\s*(?:off|shut)|timer/i),
    want('pref-surge', 'Do you get voltage fluctuations at home?', 'Yes, I need surge protection', 'Surge / voltage protection', /surge|voltage|fluctuation/i, 'No')
  ],
  'mixer-grinder': [
    {
      key: 'pref-jars', question: 'How many jars do you need?', noPreference: 'Not sure',
      options: [
        { value: '4+', label: '4 or more jars', reason: '4+ jars', match: /\b[4-6]\s*jars?/i },
        { value: '3', label: '3 jars', reason: '3 jars', match: /\b3\s*jars?/i },
        { value: '2', label: '2 jars', reason: '2 jars', match: /\b2\s*jars?/i }
      ]
    },
    want('pref-juicer', 'Do you also want a juicer?', 'Yes, with juicer', 'Includes a juicer', /juicer/i, 'No, just mixing & grinding'),
    want('pref-overload', 'Do you want overload protection (safer motor)?', 'Yes, overload protection', 'Overload protection', /overload/i)
  ],
  'electric-iron': [
    WATTS('pref-power', 'How powerful should it be?', [[0, 1200, 'Up to 1200 W'], [1200, 1800, '1200 – 1800 W'], [1800, 9999, '1800 W or more']]),
    {
      key: 'pref-soleplate', question: 'Which soleplate do you prefer?', noPreference: 'No preference',
      options: [
        { value: 'ceramic', label: 'Ceramic (glides smoothly)', reason: 'Ceramic soleplate', match: /ceramic/i },
        { value: 'non-stick', label: 'Non-stick coated', reason: 'Non-stick soleplate', match: /non\s*-?stick|teflon|coat/i }
      ]
    },
    want('pref-autooff', 'Do you want auto shut-off for safety?', 'Yes, auto shut-off', 'Auto shut-off', /auto\s*-?\s*(?:off|shut)/i),
    want('pref-steam', 'Do you want strong continuous steam (for heavy fabrics)?', 'Yes, strong steam', 'Strong continuous steam', /continuous\s*steam|steam\s*(?:rate|burst|shot)|vertical\s*steam/i),
    want('pref-light', 'Do you want a lightweight iron (easy on the wrist)?', 'Yes, lightweight', 'Lightweight', numberIn(/(\d(?:\.\d+)?)\s*kg/i, 0, 1.2), "Doesn't matter")
  ],
  'ceiling-fans': [
    want('pref-bldc', 'Do you want an energy-saving BLDC motor (up to 65% less power)?', 'Yes, BLDC motor', 'Energy-saving BLDC motor', /bldc/i),
    want('pref-remote', 'Do you want a remote control?', 'Yes, with remote', 'Remote control', /remote/i),
    STAR(),
    want('pref-light', 'Do you want a built-in light?', 'Yes, with light', 'Built-in light', /\blight\b|\bled\b/i, 'No light needed'),
    {
      key: 'pref-airdelivery', question: 'How strong a breeze do you want?', noPreference: 'Not sure',
      options: [
        { value: 'strong', label: 'Strong breeze (220+ CMM)', reason: 'Strong air delivery', match: numberIn(/(\d{3})\s*(?:cmm|m3\/min|m³\/min|cubic\s*metres?\s*per\s*min)/i, 220, 999) },
        { value: 'normal', label: 'Normal breeze (up to 220 CMM)', reason: 'Comfortable air delivery', match: numberIn(/(\d{3})\s*(?:cmm|m3\/min|m³\/min|cubic\s*metres?\s*per\s*min)/i, 100, 220) }
      ]
    },
    want('pref-decorative', 'Do you want a decorative / designer fan?', 'Yes, decorative design', 'Decorative design', /decorative|designer|d[eé]co|premium\s*finish/i, 'No, a regular fan is fine')
  ],
  'air-cooler': [
    want('pref-honeycomb', 'Do you want honeycomb pads (better cooling)?', 'Yes, honeycomb pads', 'Honeycomb cooling pads', /honeycomb/i),
    want('pref-remote', 'Do you want a remote control?', 'Yes, with remote', 'Remote control', /remote/i),
    want('pref-inverter', 'Should it run on a home inverter during power cuts?', 'Yes, inverter compatible', 'Runs on an inverter', /inverter/i),
    {
      key: 'pref-airflow', question: 'How big is the area to cool?', noPreference: 'Not sure',
      options: [
        { value: 'large', label: 'Large room / hall (strong airflow)', reason: 'Strong airflow for large rooms', match: (t: string) => numberIn(/(\d{3,5})\s*(?:m3|m³|cmh|cubic)/i, 3500, 99999)(t) || numberIn(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft)/i, 400, 9999)(t) || numberIn(/(\d{2,3})\s*-?\s*(?:l\b|ltr|litres?|liters?)/i, 70, 300)(t) },
        { value: 'medium', label: 'Bedroom / medium room', reason: 'Right for a medium room', match: (t: string) => numberIn(/(\d{3,5})\s*(?:m3|m³|cmh|cubic)/i, 1500, 3500)(t) || numberIn(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft)/i, 150, 400)(t) || numberIn(/(\d{2,3})\s*-?\s*(?:l\b|ltr|litres?|liters?)/i, 30, 70)(t) }
      ]
    }
  ],
  'room-heaters': [
    WATTS('pref-power', 'How big is the room?', [[0, 1500, 'Small room (up to 1500 W)'], [1500, 2100, 'Medium room (1500 – 2000 W)'], [2100, 9999, 'Large room (2100 W+)']]),
    want('pref-thermostat', 'Do you want a thermostat (keeps the room at a set temperature)?', 'Yes, thermostat', 'Adjustable thermostat', /thermostat/i),
    want('pref-settings', 'Do you want adjustable heat settings?', 'Yes, multiple heat settings', 'Adjustable heat settings', /heat\s*settings?|heat\s*modes?|heating\s*modes?|\b[2-5]\s*(?:heat|power)\s*(?:settings|levels|modes)|\b[2-5]\s*rods?/i),
    {
      key: 'pref-fins', question: 'For an oil heater, how many fins?', noPreference: 'Not an oil heater / not sure',
      options: [
        { value: '11+', label: '11 or more fins (bigger rooms)', reason: '11+ fins for bigger rooms', match: numberIn(/(\d{1,2})\s*-?\s*fins?\b/i, 11, 30) },
        { value: 'up-to-10', label: 'Up to 10 fins (smaller rooms)', reason: 'Compact, up to 10 fins', match: numberIn(/(\d{1,2})\s*-?\s*fins?\b/i, 5, 11) }
      ]
    },
    want('pref-safety', 'Do you need tip-over / overheat protection?', 'Yes, safety cut-off', 'Overheat / tip-over protection', /tip\s*-?over|overheat|safety|cut\s*-?off/i)
  ],
  'inverter-battery': [
    {
      key: 'pref-capacity', question: 'How much backup do you need?', noPreference: 'Not sure',
      options: [
        { value: 'small', label: 'Lights & fans (up to 900 VA / 100 Ah)', reason: 'Right for lights & fans', match: (t: string) => numberIn(/(\d{3,4})\s*va\b/i, 0, 900)(t) || numberIn(/(\d{2,3})\s*ah\b/i, 0, 101)(t) },
        { value: 'medium', label: 'Plus TV & fridge (900 – 1500 VA / 150 Ah)', reason: 'Runs TV & fridge too', match: (t: string) => numberIn(/(\d{3,4})\s*va\b/i, 900, 1500)(t) || numberIn(/(\d{2,3})\s*ah\b/i, 101, 160)(t) },
        { value: 'large', label: 'Whole home (1500 VA+ / 200 Ah)', reason: 'Backs up the whole home', match: (t: string) => numberIn(/(\d{3,4})\s*va\b/i, 1500, 99999)(t) || numberIn(/(\d{2,3})\s*ah\b/i, 160, 999)(t) }
      ]
    },
    want('pref-sine', 'Do you want a pure sine wave (safe for computers & fridges)?', 'Yes, pure sine wave', 'Pure sine wave output', /sine/i),
    want('pref-tubular', 'Do you want a tall tubular battery (lasts longest)?', 'Yes, tubular battery', 'Tubular battery', /tubular|tall/i)
  ],
  'smart-door-lock': [
    {
      key: 'pref-unlock', question: 'How do you want to unlock the door?', noPreference: 'Any way is fine',
      options: [
        { value: 'face', label: 'Face recognition', reason: 'Face recognition unlock', match: /face/i },
        { value: 'fingerprint', label: 'Fingerprint', reason: 'Fingerprint unlock', match: /finger/i },
        { value: 'pin-card', label: 'PIN code / card', reason: 'PIN / card unlock', match: /\bpin\b|password|card|rfid/i }
      ]
    },
    WIFI('to unlock from your phone'),
    want('pref-camera', 'Do you want a built-in camera / video doorbell?', 'Yes, with camera', 'Built-in camera', /camera|video|doorbell/i)
  ],
  'dishwasher': [
    {
      key: 'pref-install', question: 'Where will it go?', noPreference: 'Not sure',
      options: [
        { value: 'freestanding', label: 'Freestanding (anywhere in the kitchen)', reason: 'Freestanding', match: /free\s*-?\s*standing/i },
        { value: 'built-in', label: 'Built into the kitchen cabinets', reason: 'Built-in', match: /built\s*-?\s*in/i },
        { value: 'countertop', label: 'On the counter (small kitchens)', reason: 'Countertop', match: /counter\s*-?\s*top|table\s*-?\s*top/i }
      ]
    },
    want('pref-heater', 'Do you want an in-built heater (cleans oily Indian utensils better)?', 'Yes, with heater', 'In-built heater', /heater|hot\s*water|intensive|steam/i),
    want('pref-quiet', 'Does a quiet machine matter to you?', 'Yes, quiet operation', 'Quiet operation', /\b4[0-9]\s*db|quiet|silent/i),
    {
      key: 'pref-programs', question: 'How many wash programs do you want?', noPreference: 'Not sure',
      options: [
        { value: '7+', label: '7 or more (more flexibility)', reason: '7+ wash programs', match: numberIn(/(\d{1,2})\s*(?:wash\s*)?(?:programs?|programmes?|modes?)/i, 7, 30) },
        { value: 'up-to-6', label: 'Up to 6 (simple to use)', reason: 'Simple, up to 6 programs', match: numberIn(/(\d{1,2})\s*(?:wash\s*)?(?:programs?|programmes?|modes?)/i, 1, 7) }
      ]
    },
    want('pref-energy', 'Do you want an energy-efficient model?', 'Yes, energy efficient', 'Energy-efficient rating', /energy\s*(?:rating|efficient)|\b[3-5]\s*star|a\+\+/i)
  ],
  'vacuum-cleaners-robot-vacuum': [
    want('pref-cordless', 'Do you want it cordless?', 'Yes, cordless', 'Cordless / battery powered', /cordless|battery|rechargeable|robot/i),
    want('pref-mop', 'Do you also want mopping?', 'Yes, vacuum + mop', 'Mops as well', /\bmop/i),
    want('pref-selfempty', 'Do you want a self-emptying dock (robot vacuums)?', 'Yes, self-emptying', 'Self-emptying dock', /self\s*-?\s*empty|auto\s*-?\s*empty/i),
    want('pref-hepa', 'Do you want a HEPA filter (good for allergies)?', 'Yes, HEPA filter', 'HEPA filter', /hepa/i)
  ]
};

export function getPreference(categorySlug: string | undefined, key: string): Preference | undefined {
  return categorySlug ? CATEGORY_PREFERENCES[categorySlug]?.find(p => p.key === key) : undefined;
}

// Preferences that filter instead of only ranking. A product that clearly states a DIFFERENT value
// (a 3 Star AC when 5 Star was chosen) is removed; one that does not state the value at all stays,
// ranked below confirmed matches, so an incomplete listing does not empty the results.
// (Mixer power is the mixer's size question and is already strict there.)
const STRICT_PREFERENCES: Record<string, string[]> = {
  'air-conditioner': ['pref-stars'],
  'refrigerators': ['pref-stars'],
  'washing-machine': ['pref-stars'],
  'geyser': ['pref-stars'],
  'electric-iron': ['pref-power'],
  'room-heaters': ['pref-power'],
  'cooktop-induction': ['pref-power'],
  'air-fryer': ['pref-power'],
  'air-purifier': ['pref-room'],
  'inverter-battery': ['pref-capacity']
};

export function isStrictPreference(categorySlug: string | undefined, key: string): boolean {
  return !!categorySlug && (STRICT_PREFERENCES[categorySlug] || []).includes(key);
}

/** match: the product has the chosen value; mismatch: it states another value; unknown: it states none. */
export function preferenceState(pref: Preference, chosen: PreferenceOption, text: string): 'match' | 'mismatch' | 'unknown' {
  if (optionMatches(chosen, text)) return 'match';
  return pref.options.some(o => o !== chosen && optionMatches(o, text)) ? 'mismatch' : 'unknown';
}
