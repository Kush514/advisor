import {
  AirVent, BatteryCharging, Brush, Waves, Blend, CookingPot, Fan, Flame, Heater, LockKeyhole, Microwave, Package,
  Refrigerator, Shirt, ShowerHead, Snowflake, Soup, Speaker, Tv, Utensils, Droplets, Wind, Sparkles,
  WashingMachine, type LucideIcon
} from 'lucide-react';

type CategoryMeta = { icon: LucideIcon; blurb: string };

const META: Record<string, CategoryMeta> = {
  'tv': { icon: Tv, blurb: 'Smart TVs for every room' },
  'air-conditioner': { icon: AirVent, blurb: 'Split & window ACs' },
  'refrigerators': { icon: Refrigerator, blurb: 'Single, double & side-by-side' },
  'washing-machine': { icon: WashingMachine, blurb: 'Front & top load' },
  'soundbars': { icon: Speaker, blurb: 'Better sound for your TV' },
  'air-purifier': { icon: Wind, blurb: 'Cleaner air at home' },
  'water-purifier': { icon: Droplets, blurb: 'RO, UV & UF purifiers' },
  'geyser': { icon: ShowerHead, blurb: 'Instant & storage heaters' },
  'microwave-otg-oven': { icon: Microwave, blurb: 'Microwaves, OTGs & ovens' },
  'air-fryer': { icon: Utensils, blurb: 'Crispy food, less oil' },
  'chimney': { icon: Waves, blurb: 'Kitchen chimneys' },
  'gas-stove': { icon: Flame, blurb: 'Glass-top & steel stoves' },
  'cooktop-induction': { icon: CookingPot, blurb: 'Induction cooktops' },
  'mixer-grinder': { icon: Blend, blurb: 'Mixers, grinders & juicers' },
  'electric-cooker': { icon: Soup, blurb: 'Rice & multi cookers' },
  'electric-iron': { icon: Shirt, blurb: 'Dry & steam irons' },
  'ceiling-fans': { icon: Fan, blurb: 'Energy-saving BLDC fans' },
  'air-cooler': { icon: Snowflake, blurb: 'Desert & personal coolers' },
  'room-heaters': { icon: Heater, blurb: 'Oil-filled & fan heaters' },
  'inverter-battery': { icon: BatteryCharging, blurb: 'Power backup for your home' },
  'smart-door-lock': { icon: LockKeyhole, blurb: 'Keyless, secure entry' },
  'dishwasher': { icon: Sparkles, blurb: 'Spotless dishes, less effort' },
  'vacuum-cleaners-robot-vacuum': { icon: Brush, blurb: 'Robot & handheld vacuums' },
};

export function categoryMeta(slug: string | null | undefined): CategoryMeta {
  return (slug && META[slug]) || { icon: Package, blurb: 'VM One picks' };
}

// Popular categories shown first on the home page
export const FEATURED = ['tv', 'air-conditioner', 'refrigerators', 'washing-machine', 'soundbars', 'water-purifier', 'air-purifier', 'geyser'];

export function formatPrice(amount: number | null | undefined): string | null {
  return amount == null ? null : `₹${amount.toLocaleString('en-IN')}`;
}

/** "checked 4:12 pm" for a live Amazon price, otherwise a note that the saved price may be out of date. */
export function priceFreshness(price: { live?: boolean; checkedAt?: string | null }): string {
  if (price.live && price.checkedAt) {
    const time = new Date(price.checkedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return `checked ${time}`;
  }
  return 'may have changed';
}
