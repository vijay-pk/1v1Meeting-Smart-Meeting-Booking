import React from 'react';
import type { Currency } from '@/types';
import { formatPrice } from '@/lib/format';
import { resolvePricing } from '@/lib/pricing';

/**
 * A meeting's price for customers. With an offer: the Real Price struck through, the Offer Price
 * prominent, and a "NN% OFF" badge (plus an optional "You pay" line). Without one (or when both are
 * equal): just the price. Display only; the charge is computed on the server.
 */
export const PriceTag: React.FC<{
  price: number;
  originalPrice?: number | null;
  currency?: Currency | string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** 'slate' matches the public booking pages, which use fixed slate colours. */
  tone?: 'app' | 'slate';
  /** Adds an explicit "You pay" line under the prices when an offer applies. */
  showPayable?: boolean;
}> = ({ price, originalPrice, currency = 'INR', className = '', size = 'md', tone = 'app', showPayable = false }) => {
  const cur = currency as Currency;
  const p = resolvePricing(price, originalPrice);
  const main = size === 'lg' ? 'text-xl sm:text-2xl font-extrabold' : size === 'sm' ? 'text-sm font-bold' : 'text-base font-bold';
  const strong = tone === 'slate' ? 'text-slate-900' : 'text-text-primary';
  const faint = tone === 'slate' ? 'text-slate-400' : 'text-text-tertiary';
  const muted = tone === 'slate' ? 'text-slate-600' : 'text-text-secondary';
  if (!p.hasOffer) {
    return <span className={`${main} ${strong} ${className}`}>{formatPrice(p.payable, cur)}</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <span className={`${size === 'lg' ? 'text-sm sm:text-base' : 'text-xs'} ${faint} line-through`} aria-label={`Original price ${formatPrice(p.real, cur)}`}>
        {formatPrice(p.real, cur)}
      </span>
      <span className={`${main} ${strong}`} aria-label={`Offer price ${formatPrice(p.payable, cur)}`}>
        {formatPrice(p.payable, cur)}
      </span>
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
        {p.discountPercent}% OFF
      </span>
      {showPayable && (
        <span className={`w-full text-xs ${muted}`}>
          You pay <span className={`font-semibold ${strong}`}>{formatPrice(p.payable, cur)}</span>
        </span>
      )}
    </span>
  );
};
