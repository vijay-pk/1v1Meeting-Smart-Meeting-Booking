import React from 'react';
import { ArrowUpRight, Quote } from 'lucide-react';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import type { ProfileSection, ProfileSectionItem } from '@/types';

/**
 * A host's custom sections on the public booking page, in the order the host saved them. Everything
 * is optional and an empty field renders nothing (no blank gaps, no broken image boxes). Text is
 * rendered as text, links open in a new tab with noopener, images load lazily, and video is the
 * existing click-to-load player (a thumbnail until someone presses play, so nothing downloads or
 * plays on its own). Themed through the same --bm-* variables as the rest of the page.
 */

const initials = (name?: string | null) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';

const Media: React.FC<{ imageUrl?: string | null; imageAlt?: string | null; videoUrl?: string | null; eager?: boolean }> = ({
  imageUrl, imageAlt, videoUrl,
}) => {
  const [broken, setBroken] = React.useState(false);
  if (!videoUrl && (!imageUrl || broken)) return null;
  return (
    <div className="space-y-3">
      {videoUrl && (
        <div className="overflow-hidden rounded-2xl">
          <IntroVideoPlayer url={videoUrl} />
        </div>
      )}
      {imageUrl && !broken && (
        <figure className="m-0">
          <img
            src={imageUrl}
            alt={imageAlt || ''}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="max-h-[420px] w-full rounded-2xl object-cover"
          />
          {imageAlt && <figcaption className="mt-1.5 text-xs bm-muted">{imageAlt}</figcaption>}
        </figure>
      )}
    </div>
  );
};

const InfoSection: React.FC<{ s: ProfileSection }> = ({ s }) => {
  const hasMedia = Boolean(s.image_url || s.video_url);
  const showButton = Boolean(s.button_url);
  // A media-only section (no title/badge/description/button) renders just the media, full width.
  const hasText = Boolean(s.title || s.badge || s.description || showButton);
  return (
    // Same left/right edges as every other block on the page; only the text measure is capped inside the card.
    <section aria-label={s.title || undefined} className="bm-card w-full p-5 sm:p-7">
      <div className={hasMedia && hasText ? 'grid gap-5 md:grid-cols-2 md:items-start lg:gap-8' : ''}>
        {hasText && <div className="min-w-0 max-w-3xl space-y-3">
          {s.badge && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="bm-badge rounded-full px-2.5 py-0.5 text-[11px] font-bold">{s.badge}</span>
            </div>
          )}
          {s.title && <h2 className="break-words text-xl font-bold leading-snug bm-text sm:text-2xl">{s.title}</h2>}
          {s.description && <p className="whitespace-pre-line break-words text-sm leading-7 bm-muted sm:text-[15px]">{s.description}</p>}
          {showButton && (
            <a
              href={s.button_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="bm-btn inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold"
            >
              {s.button_text || 'Open resource'}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </div>}
        {hasMedia && <Media imageUrl={s.image_url} imageAlt={s.image_alt} videoUrl={s.video_url} />}
      </div>
    </section>
  );
};

const TestimonialCard: React.FC<{ item: ProfileSectionItem }> = ({ item }) => {
  const [broken, setBroken] = React.useState(false);
  const hasWords = Boolean(item.customer_name || item.text);
  const showAvatar = Boolean(item.image_url) && !broken && hasWords;
  const showBigImage = Boolean(item.image_url) && !broken && !hasWords;
  return (
    <li className="bm-card flex h-full flex-col gap-3 p-4 sm:p-5">
      {item.video_url && (
        <div className="overflow-hidden rounded-xl">
          <IntroVideoPlayer url={item.video_url} />
        </div>
      )}
      {showBigImage && (
        <img src={item.image_url as string} alt={item.image_alt || ''} loading="lazy" decoding="async"
          onError={() => setBroken(true)} className="max-h-72 w-full rounded-xl object-cover" />
      )}
      {item.text && (
        <p className="relative break-words pl-0 text-sm leading-relaxed bm-text">
          <Quote className="mb-1 h-4 w-4 bm-ink opacity-70" aria-hidden="true" />
          {item.text}
        </p>
      )}
      {(item.customer_name || item.designation || showAvatar || item.badge) && (
        <div className="mt-auto flex items-center gap-3 pt-1">
          {showAvatar ? (
            <img src={item.image_url as string} alt={item.image_alt || item.customer_name || ''} loading="lazy" decoding="async"
              onError={() => setBroken(true)} className="h-11 w-11 shrink-0 rounded-full object-cover" />
          ) : item.customer_name ? (
            <span aria-hidden="true" className="bm-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold">
              {initials(item.customer_name)}
            </span>
          ) : null}
          <div className="min-w-0">
            {item.customer_name && <p className="break-words text-sm font-semibold bm-text">{item.customer_name}</p>}
            {item.designation && <p className="break-words text-xs bm-muted">{item.designation}</p>}
            {item.badge && <span className="bm-badge mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold">{item.badge}</span>}
          </div>
        </div>
      )}
    </li>
  );
};

const TestimonialsSection: React.FC<{ s: ProfileSection }> = ({ s }) => {
  const items = s.items || [];
  return (
    <section aria-label={s.title || undefined} className="space-y-4">
      {(s.badge || s.title || s.description) && (
        <div className="space-y-2">
          {s.badge && <span className="bm-badge inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold">{s.badge}</span>}
          {s.title && <h2 className="break-words text-xl font-bold leading-snug bm-onbg sm:text-2xl">{s.title}</h2>}
          {s.description && <p className="whitespace-pre-line break-words text-sm bm-onbg-muted sm:text-[15px]">{s.description}</p>}
        </div>
      )}
      {items.length > 0 && (
        // Columns follow the number of cards, so one or two reviews are never stranded in a corner of a
        // three-column grid: 1 = a centred card of readable width, 2 = two halves, 3+ = three across.
        <ul className={`grid grid-cols-1 gap-3.5 ${
          items.length === 1 ? 'mx-auto max-w-2xl'
            : items.length === 2 ? 'sm:grid-cols-2'
            : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
          {items.map((it, i) => <TestimonialCard key={it.id || i} item={it} />)}
        </ul>
      )}
    </section>
  );
};

/** One section, by kind. Exported so the Settings preview shows exactly what visitors will see. */
export const PublicSectionBlock: React.FC<{ section: ProfileSection }> = ({ section }) =>
  section.kind === 'testimonials' ? <TestimonialsSection s={section} /> : <InfoSection s={section} />;

export const PublicSections: React.FC<{ sections?: ProfileSection[] | null }> = ({ sections }) => {
  const list = (sections || []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className="mt-10 space-y-6 sm:space-y-8">
      {list.map((s, i) => <PublicSectionBlock key={s.id || i} section={s} />)}
    </div>
  );
};
