import { FinderProduct } from '@vmone/shared';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type AnswerLabels = Map<string, string>;
export const labelKey = (value: string) => value.toLowerCase().replace(/_/g, ' ').trim();

// Turns engine output like "Budget: ₹19,990" / "Feature: front load" into plain-language reasons,
// using the option labels the user saw ("7" -> "7 kg") when available
export function friendlyReasons(product: FinderProduct, labels?: AnswerLabels): string[] {
  const reasons: string[] = [];
  for (const raw of product.whyItMatches.matched || []) {
    const [label, ...rest] = raw.split(': ');
    const value = rest.join(': ').trim();
    if (!value || label === 'Category') continue;
    if (label === 'Budget') reasons.push('Fits your budget');
    else if (label === 'Brand') reasons.push(`Brand you asked for: ${value}`);
    else if (label === 'Model') reasons.push(`The model you asked for`);
    else if (!/^\d+\s*-\s*\d+$/.test(value)) reasons.push(labels?.get(labelKey(value)) || capitalize(value));
  }
  return [...new Set(reasons)];
}
