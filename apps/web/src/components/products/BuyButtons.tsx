import { ExternalLink } from 'lucide-react';
import { FinderProduct } from '@vmone/shared';

export default function BuyButtons({ product, compact = false }: { product: FinderProduct; compact?: boolean }) {
  const { amazon, flipkart, brand } = product.links;
  if (!amazon && !flipkart && !brand) return null;
  const size = compact ? 'px-4 py-2.5 text-sm' : '';

  return (
    <div className={`flex flex-col gap-2.5 ${compact ? '' : 'sm:min-w-[240px]'}`}>
      {amazon && (
        <a href={amazon} target="_blank" rel="noopener noreferrer sponsored" className={`btn-amazon ${size}`}>
          {compact ? 'View on Amazon' : 'Check price on Amazon'} <ExternalLink className="h-4 w-4" />
        </a>
      )}
      {flipkart && (
        <a href={flipkart} target="_blank" rel="noopener noreferrer sponsored" className={`btn-secondary ${size}`}>
          View on Flipkart <ExternalLink className="h-4 w-4" />
        </a>
      )}
      {brand && (
        <a href={brand} target="_blank" rel="noopener noreferrer" className={`btn-secondary ${size}`}>
          Brand store <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}
