import React from 'react';
import { ArrowRight, Briefcase, Clock, MessageCircle, Rocket, Zap } from 'lucide-react';
import { PriceTag } from '@/components/ui/PriceTag';

/** A small icon for the session, chosen from its length (no data is invented). */
function iconFor(minutes: number) {
  if (minutes <= 15) return Zap;
  if (minutes <= 30) return MessageCircle;
  if (minutes <= 60) return Briefcase;
  return Rocket;
}

/**
 * One bookable session. The whole card is the button; "Choose time" is the visible call to action
 * and runs the existing booking flow (the parent passes `onChoose`, unchanged). Prices come from the
 * saved meeting type; the discount badge is computed by PriceTag/resolvePricing, never typed in.
 */
export const SessionCard: React.FC<{
  title: string;
  description?: string;
  durationMinutes: number;
  price: number;
  originalPrice?: number | null;
  currency?: string;
  onChoose: () => void;
}> = ({ title, description, durationMinutes, price, originalPrice, currency, onChoose }) => {
  const Icon = iconFor(durationMinutes);
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-label={`Choose a time for ${title}`}
      className="bm-card bm-session group flex w-full flex-col gap-3 p-4 text-left sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="bm-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold leading-snug bm-text sm:text-lg">{title}</h3>
          {description && <p className="mt-1 line-clamp-2 break-words text-sm bm-muted">{description}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm bm-muted">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {durationMinutes} min
        </span>
        <PriceTag tone="themed" size="md" price={price} originalPrice={originalPrice} currency={currency} />
      </div>

      <span className="bm-btn inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold sm:w-auto sm:self-start">
        Choose time
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  );
};
