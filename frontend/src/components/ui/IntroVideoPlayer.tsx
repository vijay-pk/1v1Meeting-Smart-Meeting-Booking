import React, { useState } from 'react';
import { Play } from 'lucide-react';
import {
  getVideoEmbedUrl,
  withAutoplay,
  INTRO_VIDEO_LABEL,
  INTRO_VIDEO_ARIA_LABEL,
} from '@/lib/video';

/**
 * The intro video card, shared by the public booking page, the scheduling page and the
 * admin preview so a host sees exactly what a client sees.
 *
 * Why it is click-to-load rather than a plain iframe: a YouTube or Vimeo player mounted on
 * page load paints the provider's own pre-roll chrome before anyone presses anything -- the
 * provider logo, the uploader's channel name and avatar, the video title, a "watch on ..."
 * button. Asking for the least-branded player (see lib/video.ts) reduces that but cannot
 * remove it, and removing it inside the provider's own iframe is not something to attempt.
 *
 * So the card a visitor lands on is entirely ours: our surface, our play control, the
 * generic "Intro Video" label, and nothing naming a provider. The official player is mounted
 * only when the visitor deliberately presses play, which is also the moment the provider's
 * branding legitimately belongs on screen. Nothing is downloaded, re-hosted or scraped: no
 * provider thumbnail is fetched for the facade (that is what makes it neutral), and the
 * video stays a reference to the URL the admin saved.
 */
interface IntroVideoPlayerProps {
  /** The URL exactly as the admin saved it. */
  url?: string | null;
  /** Optional caption shown under the facade; never carries a provider name. */
  label?: string;
  /** Extra classes for the aspect-ratio frame. */
  className?: string;
}

export const IntroVideoPlayer: React.FC<IntroVideoPlayerProps> = ({
  url,
  label = INTRO_VIDEO_LABEL,
  className = '',
}) => {
  const [playing, setPlaying] = useState(false);
  const embedUrl = getVideoEmbedUrl(url);

  if (!url) return null;

  const frameClass = `relative aspect-video w-full overflow-hidden bg-slate-950 ${className}`;

  // A direct file plays in our own <video>, so it carries no third-party chrome at all. It
  // still goes behind the same facade: one card, one interaction, whatever the source is.
  if (!embedUrl) {
    return (
      <div className={frameClass}>
        {playing ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            aria-label={INTRO_VIDEO_ARIA_LABEL}
            className="w-full h-full object-cover"
          />
        ) : (
          <VideoFacade label={label} onPlay={() => setPlaying(true)} />
        )}
      </div>
    );
  }

  return (
    <div className={frameClass}>
      {playing ? (
        <iframe
          src={withAutoplay(embedUrl)}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          title={INTRO_VIDEO_ARIA_LABEL}
          allowFullScreen
        />
      ) : (
        <VideoFacade label={label} onPlay={() => setPlaying(true)} />
      )}
    </div>
  );
};

/**
 * The neutral cover. Deliberately built from our own gradient and icon rather than the
 * provider's poster image: a provider thumbnail would put their framing (and often their
 * watermark) back on the card, and is exactly the asset that must never end up standing in
 * for a profile photo.
 */
const VideoFacade: React.FC<{ label: string; onPlay: () => void }> = ({ label, onPlay }) => (
  <button
    type="button"
    onClick={onPlay}
    aria-label={INTRO_VIDEO_ARIA_LABEL}
    className="group absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900 via-slate-950 to-black cursor-pointer transition"
  >
    <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(249,115,22,0.18),transparent_60%)]" aria-hidden="true" />
    <span className="relative w-16 h-16 rounded-full bg-white/10 border border-white/25 backdrop-blur-sm flex items-center justify-center transition group-hover:bg-white/20 group-hover:scale-105">
      <Play className="w-7 h-7 text-white fill-white translate-x-0.5" aria-hidden="true" />
    </span>
    <span className="relative text-xs font-semibold tracking-wide text-white/80">{label}</span>
  </button>
);
