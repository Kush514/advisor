import { motion } from 'framer-motion';
import { Check, CirclePlay } from 'lucide-react';
import { FinderProduct } from '@vmone/shared';
import { categoryMeta } from '../../lib/categories';
import { friendlyReasons, AnswerLabels } from '../../lib/reasons';
import BuyButtons from './BuyButtons';

export default function ProductCard({ product, labels }: { product: FinderProduct; labels?: AnswerLabels }) {
  const displayName = product.name || `${product.brand || ''} ${product.model || ''}`.trim() || 'Recommended product';
  const { icon: Icon } = categoryMeta(product.category);
  const reasons = friendlyReasons(product, labels).slice(0, 2);
  const video = product.vmOneContent?.classification === 'EXACT_PRODUCT' ? product.vmOneContent.video : null;

  return (
    <motion.article
      variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }}
      className="card flex h-full flex-col p-5 transition-shadow hover:shadow-lift"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cream-100">
          <Icon className="h-7 w-7 text-ink-700" strokeWidth={1.4} />
        </span>
        <div className="min-w-0">
          {product.brand && <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{product.brand}</p>}
          <h3 className="mt-0.5 line-clamp-2 font-sans text-base font-semibold leading-snug text-ink">{displayName}</h3>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm text-ink-500">
          {reasons.map(r => (
            <li key={r} className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-leaf-600" strokeWidth={2.5} /> {r}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-ink-400">{product.price.live ? "In stock on Amazon" : ""}</span>
          {video?.youtubeUrl && (
            <a href={video.youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-primary">
              <CirclePlay className="h-4 w-4 text-primary" /> Review
            </a>
          )}
        </div>
        <BuyButtons product={product} compact />
      </div>
    </motion.article>
  );
}
