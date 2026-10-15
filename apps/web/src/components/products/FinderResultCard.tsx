import { FinderProduct } from '@vmone/shared';
import { Check, CirclePlay } from 'lucide-react';
import { motion } from 'framer-motion';
import { categoryMeta } from '../../lib/categories';
import { friendlyReasons, AnswerLabels } from '../../lib/reasons';
import BuyButtons from './BuyButtons';

interface FinderResultCardProps {
  product: FinderProduct;
  isTopMatch?: boolean;
  labels?: AnswerLabels;
}

export default function FinderResultCard({ product, labels }: FinderResultCardProps) {
  const displayName = product.name || `${product.brand || ''} ${product.model || ''}`.trim() || 'Recommended product';
  const { icon: Icon } = categoryMeta(product.category);
  const reasons = friendlyReasons(product, labels);
  const video = product.vmOneContent?.classification !== 'NO_RELEVANT_CONTENT' ? product.vmOneContent?.video : null;
  const isExactReview = product.vmOneContent?.classification === 'EXACT_PRODUCT';

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="card overflow-hidden"
    >
      <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[200px_1fr]">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-cream-100 md:aspect-square md:h-auto md:w-full">
          <Icon className="h-12 w-12 text-ink-700 md:h-20 md:w-20" strokeWidth={1.2} />
        </div>

        <div className="flex flex-col">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
            ★ Best match for you
          </span>
          {product.brand && <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-ink-400">{product.brand}</p>}
          <h2 className="mt-1 text-3xl font-medium leading-tight text-ink sm:text-[2.1rem]">{displayName}</h2>
          {product.model && product.model !== product.name && !/\bNEW\b/.test(product.model) && (
            <p className="mt-2 text-sm text-ink-400">Model {product.model}</p>
          )}

          {reasons.length > 0 && (
            <div className="mt-6">
              <h3 className="font-sans text-sm font-semibold text-ink">Why it's a good fit</h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {reasons.map(r => (
                  <li key={r} className="flex items-start gap-2.5 text-ink-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-leaf-50">
                      <Check className="h-3.5 w-3.5 text-leaf-600" strokeWidth={3} />
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Prices are checked live in the background (budget + stock) but not shown */}
          <div className="mt-8 flex flex-col gap-5 border-t border-cream-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-400">{product.price.live ? "In stock on Amazon right now" : ""}</p>
            <BuyButtons product={product} />
          </div>
        </div>
      </div>

      {video && (
        <a
          href={video.youtubeUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col items-center gap-6 border-t border-cream-200 bg-cream-100/70 p-6 transition-colors hover:bg-cream-100 sm:flex-row sm:p-8"
        >
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl bg-cream-200 sm:w-64">
            {video.thumbnailUrl && (
              <img src={video.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lift">
                <CirclePlay className="h-7 w-7 text-primary" />
              </span>
            </span>
          </div>
          <div>
            <p className="eyebrow">{isExactReview ? "Watch VM One's review" : 'From VM One on YouTube'}</p>
            <p className="mt-2 font-serif text-xl leading-snug text-ink">{video.title || 'Watch the VM One video'}</p>
            <p className="mt-3 text-sm font-semibold text-ink-500 group-hover:text-ink">Watch on YouTube →</p>
          </div>
        </a>
      )}
    </motion.article>
  );
}
