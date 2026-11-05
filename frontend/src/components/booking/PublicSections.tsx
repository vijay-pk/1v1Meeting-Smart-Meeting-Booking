import React from 'react';
import { ArrowUpRight, Download, ExternalLink, FileText, Quote } from 'lucide-react';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import type { ProfileSection, ProfileSectionItem } from '@/types';

/**
 * A host's custom sections on the public booking page, in the order the host saved them. The layout is
 * chosen from what a section actually contains, so a newly added section looks designed with no CSS
 * of its own:
 *
 *   - runs of image-only sections           -> one gallery (1 = single wide image, 2 = pair, 3+ = mosaic/grid)
 *   - runs of video-only sections           -> one video row (1 = featured, 2 = pair, 3+ = grid)
 *   - runs of resource sections (a button, no media) -> a grid of resource cards
 *   - text with an image or video           -> split layout, media side alternating down the page
 *   - text only                             -> an editorial card
 *   - testimonials                          -> a tinted band; columns follow the number of cards
 *
 * Everything is optional and an empty field renders nothing (no blank headings, no broken image boxes).
 * Text is rendered as text, links open in a new tab with noopener, images load lazily, and video is the
 * click-to-load player (nothing downloads or plays by itself). Colours come only from the --bm-* theme
 * variables, so every theme and light/dark mode works unchanged.
 */

const initials = (name?: string | null) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';

// ---- shared pieces ---------------------------------------------------------------------------------

const AccentBar: React.FC = () => (
  <span aria-hidden="true" className="mb-3 block h-1 w-10 rounded-full" style={{ background: 'var(--bm-accent)' }} />
);

/** Badge + title + description. `onBg` = the block sits directly on the page background, not in a card. */
const SectionHead: React.FC<{ s: ProfileSection; onBg?: boolean }> = ({ s, onBg }) => {
  if (!(s.badge || s.title || s.description)) return null;
  return (
    <div className="max-w-3xl space-y-2">
      {s.badge && <span className="bm-badge inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold">{s.badge}</span>}
      {s.title && (
        <>
          <AccentBar />
          <h2 className={`break-words text-xl font-bold leading-snug tracking-tight sm:text-2xl ${onBg ? 'bm-onbg' : 'bm-text'}`}>{s.title}</h2>
        </>
      )}
      {s.description && (
        <p className={`whitespace-pre-line break-words text-sm leading-7 sm:text-[15px] ${onBg ? 'bm-onbg-muted' : 'bm-muted'}`}>{s.description}</p>
      )}
    </div>
  );
};

const ResourceButton: React.FC<{ s: ProfileSection }> = ({ s }) =>
  s.button_url ? (
    <a href={s.button_url} target="_blank" rel="noopener noreferrer"
      className="bm-btn inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold">
      {s.button_text || 'Open resource'}
      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
    </a>
  ) : null;

const isDownload = (url?: string | null) => /\.(pdf|docx?|xlsx?|pptx?|zip|rar|csv|epub)(\?|#|$)/i.test(url || '');

/** An image that disappears (instead of showing a broken box) if its file cannot be loaded. */
const Pic: React.FC<{ src?: string | null; alt?: string | null; className?: string }> = ({ src, alt, className }) => {
  const [broken, setBroken] = React.useState(false);
  if (!src || broken) return null;
  return <img src={src} alt={alt || ''} loading="lazy" decoding="async" onError={() => setBroken(true)} className={className} />;
};

const Media: React.FC<{ imageUrl?: string | null; imageAlt?: string | null; videoUrl?: string | null }> = ({ imageUrl, imageAlt, videoUrl }) => {
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
          <img src={imageUrl} alt={imageAlt || ''} loading="lazy" decoding="async" onError={() => setBroken(true)}
            className="max-h-[440px] w-full rounded-2xl object-cover" />
          {imageAlt && <figcaption className="mt-1.5 text-xs bm-muted">{imageAlt}</figcaption>}
        </figure>
      )}
    </div>
  );
};

// ---- a single section with text (and maybe media / a button) -----------------------------------------

const InfoSection: React.FC<{ s: ProfileSection; flip?: boolean }> = ({ s, flip }) => {
  const hasMedia = Boolean(s.image_url || s.video_url);
  const hasText = Boolean(s.title || s.badge || s.description || s.button_url);
  const split = hasMedia && hasText;
  return (
    <section aria-label={s.title || undefined} className="bm-card w-full p-5 sm:p-7 lg:p-8">
      <div className={split ? `grid gap-6 md:grid-cols-2 md:items-center lg:gap-10 ${flip ? 'md:[&>*:first-child]:order-2' : ''}` : ''}>
        {hasText && (
          // Text-only: the readable column sits centred in the card instead of hugging its left edge.
          <div className={`min-w-0 max-w-3xl space-y-4 ${split ? '' : 'mx-auto'}`}>
            <SectionHead s={s} />
            <ResourceButton s={s} />
          </div>
        )}
        {hasMedia && <Media imageUrl={s.image_url} imageAlt={s.image_alt} videoUrl={s.video_url} />}
      </div>
    </section>
  );
};

// ---- groups of sections that are really "one thing" --------------------------------------------------

const Gallery: React.FC<{ items: ProfileSection[] }> = ({ items }) => {
  const n = items.length;
  if (n === 1) {
    const s = items[0];
    return (
      <figure className="m-0 mx-auto w-full max-w-4xl">
        <Pic src={s.image_url} alt={s.image_alt} className="max-h-[560px] w-full rounded-3xl object-cover" />
        {s.image_alt && <figcaption className="mt-2 text-center text-xs bm-onbg-muted">{s.image_alt}</figcaption>}
      </figure>
    );
  }
  // 3 images: one large + two stacked on desktop. 2 and 4: even grid. 5+: three across.
  const cols = n === 2 || n === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  const mosaic = n === 3;       // desktop: a fixed-height block, the lead image spanning both rows
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${cols} ${mosaic ? 'lg:h-[460px] lg:grid-rows-2' : ''}`}>
      {items.map((s, i) => {
        const lead = mosaic && i === 0;
        return (
          <figure key={s.id || i} className={`m-0 overflow-hidden rounded-2xl ${lead ? 'sm:col-span-2 lg:row-span-2' : ''}`}>
            <Pic src={s.image_url} alt={s.image_alt}
              className={`aspect-[4/3] w-full object-cover ${mosaic ? 'lg:aspect-auto lg:h-full' : ''}`} />
          </figure>
        );
      })}
    </div>
  );
};

const VideoRow: React.FC<{ items: ProfileSection[] }> = ({ items }) => {
  const n = items.length;
  const wrap = n === 1 ? 'mx-auto max-w-4xl' : n === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${wrap}`}>
      {items.map((s, i) => (
        <div key={s.id || i} className="overflow-hidden rounded-2xl shadow-sm">
          <IntroVideoPlayer url={s.video_url} />
        </div>
      ))}
    </div>
  );
};

const ResourceCard: React.FC<{ s: ProfileSection }> = ({ s }) => {
  const Icon = isDownload(s.button_url) ? Download : s.description ? FileText : ExternalLink;
  return (
    <li className="bm-card flex h-full flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="bm-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {s.badge && <span className="bm-badge inline-block rounded-full px-2 py-0.5 text-[10px] font-bold">{s.badge}</span>}
          {s.title && <h3 className="break-words text-base font-semibold leading-snug bm-text">{s.title}</h3>}
          {s.description && <p className="whitespace-pre-line break-words text-sm leading-relaxed bm-muted">{s.description}</p>}
        </div>
      </div>
      <div className="mt-auto"><ResourceButton s={s} /></div>
    </li>
  );
};

const ResourceGrid: React.FC<{ items: ProfileSection[] }> = ({ items }) => (
  <ul className={`grid grid-cols-1 gap-3.5 ${items.length === 1 ? 'mx-auto max-w-2xl' : 'sm:grid-cols-2'} ${items.length >= 3 ? 'lg:grid-cols-3' : ''}`}>
    {items.map((s, i) => <ResourceCard key={s.id || i} s={s} />)}
  </ul>
);

// ---- testimonials ------------------------------------------------------------------------------------

const TestimonialCard: React.FC<{ item: ProfileSectionItem }> = ({ item }) => {
  const [broken, setBroken] = React.useState(false);
  const hasWords = Boolean(item.customer_name || item.text);
  const showAvatar = Boolean(item.image_url) && !broken && hasWords;
  const showBigImage = Boolean(item.image_url) && !broken && !hasWords;
  return (
    <li className="bm-card flex h-full flex-col gap-3 overflow-hidden p-4 sm:p-5">
      {item.video_url && (
        <div className="overflow-hidden rounded-xl">
          <IntroVideoPlayer url={item.video_url} />
        </div>
      )}
      {showBigImage && (
        <img src={item.image_url as string} alt={item.image_alt || ''} loading="lazy" decoding="async"
          onError={() => setBroken(true)} className="aspect-[4/3] w-full rounded-xl object-cover" />
      )}
      {item.text && (
        <div className="flex gap-2.5">
          <Quote className="mt-0.5 h-5 w-5 shrink-0 bm-ink opacity-60" aria-hidden="true" />
          <p className="min-w-0 break-words text-sm leading-relaxed bm-text sm:text-[15px]">{item.text}</p>
        </div>
      )}
      {(item.customer_name || item.designation || showAvatar || item.badge) && (
        <div className="mt-auto flex items-center gap-3 border-t pt-3 bm-divider">
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
  if (!(s.badge || s.title || s.description) && items.length === 0) return null;
  return (
    // A tinted band (from the theme's own text colour) so reviews read as their own chapter of the page.
    <section aria-label={s.title || undefined} className="space-y-6 rounded-3xl p-5 sm:p-8"
      style={{ background: 'color-mix(in srgb, var(--bm-on-bg) 7%, transparent)' }}>
      <SectionHead s={s} onBg />
      {items.length > 0 && (
        // Columns follow the number of cards: 1 = one centred card, 2 = halves, 3+ = three across.
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

// ---- choosing a layout -------------------------------------------------------------------------------

type Block =
  | { type: 'gallery' | 'videos' | 'resources'; sections: ProfileSection[] }
  | { type: 'section'; section: ProfileSection };

const hasHeader = (s: ProfileSection) => Boolean(s.title || s.badge || s.description);
const isImageOnly = (s: ProfileSection) => s.kind !== 'testimonials' && !hasHeader(s) && !s.button_url && !!s.image_url && !s.video_url;
const isVideoOnly = (s: ProfileSection) => s.kind !== 'testimonials' && !hasHeader(s) && !s.button_url && !!s.video_url && !s.image_url;
const isResource = (s: ProfileSection) => s.kind !== 'testimonials' && !!s.button_url && !s.image_url && !s.video_url;

/** Saved order is kept; only neighbours of the same kind are merged into one block. */
export function groupSections(list: ProfileSection[]): Block[] {
  const out: Block[] = [];
  for (const s of list) {
    const type = isImageOnly(s) ? 'gallery' : isVideoOnly(s) ? 'videos' : isResource(s) ? 'resources' : null;
    const last = out[out.length - 1];
    if (type && last && last.type === type) (last as { sections: ProfileSection[] }).sections.push(s);
    else if (type) out.push({ type, sections: [s] });
    else out.push({ type: 'section', section: s });
  }
  return out;
}

/** One section, by kind. Exported so the Settings preview shows what visitors will see. */
export const PublicSectionBlock: React.FC<{ section: ProfileSection; flip?: boolean }> = ({ section, flip }) => {
  if (section.kind === 'testimonials') return <TestimonialsSection s={section} />;
  if (isImageOnly(section)) return <Gallery items={[section]} />;
  if (isVideoOnly(section)) return <VideoRow items={[section]} />;
  if (isResource(section)) return <ResourceGrid items={[section]} />;
  return <InfoSection s={section} flip={flip} />;
};

export const PublicSections: React.FC<{ sections?: ProfileSection[] | null }> = ({ sections }) => {
  const blocks = groupSections((sections || []).filter(Boolean));
  if (blocks.length === 0) return null;
  let textIndex = 0;       // alternates the media side of split sections down the page
  return (
    <div className="mt-12 space-y-8 sm:mt-14 sm:space-y-10">
      {blocks.map((b, i) => {
        if (b.type === 'gallery') return <Gallery key={i} items={b.sections} />;
        if (b.type === 'videos') return <VideoRow key={i} items={b.sections} />;
        if (b.type === 'resources') return <ResourceGrid key={i} items={b.sections} />;
        const flip = b.section.kind !== 'testimonials' && textIndex++ % 2 === 1;
        return <PublicSectionBlock key={b.section.id || i} section={b.section} flip={flip} />;
      })}
    </div>
  );
};
