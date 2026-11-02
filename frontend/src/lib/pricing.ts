/**
 * Real Price / Offer Price for regular client meeting types.
 *
 * Stored in the existing columns (all amounts in paise):
 *   price           what the customer pays: the Offer Price when there is one, else the Real Price
 *   original_price  the Real Price, only when an offer applies (NULL otherwise)
 *
 * Display only. The amount actually charged is decided on the server from the saved row; nothing
 * here is ever sent as a payable amount.
 */
export interface ResolvedPricing {
  /** What the customer pays, in paise. */
  payable: number;
  /** The Real Price, in paise (equals payable when there is no offer). */
  real: number;
  hasOffer: boolean;
  /** Whole-number percentage off, 0 when there is no offer. */
  discountPercent: number;
}

export function resolvePricing(price: number, originalPrice?: number | null): ResolvedPricing {
  const payable = Math.max(0, Number(price) || 0);
  const original = Number(originalPrice) || 0;
  const hasOffer = original > payable && payable > 0;
  const real = hasOffer ? original : payable;
  const discountPercent = hasOffer ? Math.max(1, Math.round(((real - payable) / real) * 100)) : 0;
  return { payable, real, hasOffer, discountPercent };
}

/** Admin form helper: split a stored row into the two input values (whole rupees as strings). */
export function pricingToDraft(price: number, originalPrice?: number | null): { real: string; offer: string } {
  const p = resolvePricing(price, originalPrice);
  const toRupees = (paise: number) => (paise > 0 ? String(Math.floor(paise / 100)) : '');
  return { real: toRupees(p.real), offer: p.hasOffer ? toRupees(p.payable) : '' };
}

export type DraftResult =
  | { ok: true; price: number; original_price: number | null }
  | { ok: false; error: string };

/** Admin form helper: validate the two inputs and map them back onto price / original_price. */
export function draftToPricing(real: string, offer: string): DraftResult {
  const realRupees = real.trim() === '' ? 0 : parseInt(real, 10);
  const hasOfferInput = offer.trim() !== '';
  const offerRupees = hasOfferInput ? parseInt(offer, 10) : 0;
  if (Number.isNaN(realRupees) || Number.isNaN(offerRupees) || realRupees < 0 || offerRupees < 0) {
    return { ok: false, error: 'Prices cannot be negative.' };
  }
  if (realRupees <= 0) return { ok: false, error: 'Real price must be greater than 0.' };
  if (!hasOfferInput) return { ok: true, price: realRupees * 100, original_price: null };
  if (offerRupees <= 0) return { ok: false, error: 'Offer price must be greater than 0 (or leave it empty).' };
  if (offerRupees > realRupees) return { ok: false, error: 'Offer price cannot be higher than the real price.' };
  if (offerRupees === realRupees) return { ok: true, price: realRupees * 100, original_price: null };
  return { ok: true, price: offerRupees * 100, original_price: realRupees * 100 };
}
