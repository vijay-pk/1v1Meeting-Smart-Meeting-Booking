import React from 'react';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import { DEFAULT_AVATAR } from '@/lib/utils';

/**
 * Left column of the public booking page: the host's intro video (reference-only, click to play),
 * photo, name, title and about text. Everything comes from the host's saved profile. Nothing the
 * profile does not have is invented: no skills/expertise badges, no verified tick, no ratings or
 * booking counts, because the platform stores none of those.
 */
export const HostProfilePanel: React.FC<{
  name: string;
  title?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  about?: string | null;
  introVideo?: string | null;
  showVideo: boolean;
}> = ({ name, title, photoUrl, bio, about, introVideo, showVideo }) => {
  const hasVideo = Boolean(introVideo) && showVideo;
  const intro = (bio || '').trim();
  const more = (about || '').trim();
  return (
    <section id="about" aria-label="About the host" className="space-y-4 scroll-mt-4">
      {hasVideo && (
        <div className="bm-card overflow-hidden p-0">
          <IntroVideoPlayer url={introVideo} className="rounded-[inherit]" />
        </div>
      )}
      <div className="bm-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <img
            src={photoUrl || DEFAULT_AVATAR}
            alt={`${name}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR; }}
            className="h-16 w-16 shrink-0 rounded-full object-cover object-top ring-2 sm:h-20 sm:w-20"
            style={{ ['--tw-ring-color' as any]: 'var(--bm-border)' }}
          />
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold leading-tight bm-text sm:text-2xl">{name}</h1>
            {title && <p className="mt-0.5 break-words text-sm bm-muted sm:text-base">{title}</p>}
          </div>
        </div>
        {(intro || more) && (
          <div className="mt-4 space-y-3 text-sm leading-relaxed bm-muted sm:text-[15px]">
            {intro && <p className="whitespace-pre-line break-words">{intro}</p>}
            {more && more !== intro && <p className="whitespace-pre-line break-words">{more}</p>}
          </div>
        )}
      </div>
    </section>
  );
};
