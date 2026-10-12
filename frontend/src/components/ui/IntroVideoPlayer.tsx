import React, { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import {
  getVideoEmbedUrl,
  withAutoplay,
  fetchVideoThumbnail,
  INTRO_VIDEO_LABEL,
  INTRO_VIDEO_ARIA_LABEL,
} from '@/lib/video';

interface IntroVideoPlayerProps {
  /** The URL exactly as the admin saved it. */
  url?: string | null;
  /** Optional custom poster/cover image override. */
  posterUrl?: string | null;
  /** Optional caption shown under the facade; never carries a provider name. */
  label?: string;
  /** Extra classes for the aspect-ratio frame. */
  className?: string;
}

export const IntroVideoPlayer: React.FC<IntroVideoPlayerProps> = ({
  url,
  posterUrl,
  label = INTRO_VIDEO_LABEL,
  className = '',
}) => {
  const [playing, setPlaying] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(posterUrl || null);
  const embedUrl = getVideoEmbedUrl(url);

  useEffect(() => {
    let isMounted = true;
    if (posterUrl) {
      setThumbnailUrl(posterUrl);
      return;
    }
    if (!url) {
      setThumbnailUrl(null);
      return;
    }

    fetchVideoThumbnail(url).then((thumb) => {
      if (isMounted && thumb) {
        setThumbnailUrl(thumb);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [url, posterUrl]);

  if (!url) return null;

  const frameClass = `relative aspect-video w-full overflow-hidden bg-slate-950 ${className}`;

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
          <VideoFacade label={label} thumbnailUrl={thumbnailUrl} onPlay={() => setPlaying(true)} />
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
        <VideoFacade label={label} thumbnailUrl={thumbnailUrl} onPlay={() => setPlaying(true)} />
      )}
    </div>
  );
};

/**
 * The video cover facade.
 * Displays the resolved provider thumbnail (or neutral gradient fallback),
 * centered play button, and caption.
 */
const VideoFacade: React.FC<{
  label: string;
  thumbnailUrl: string | null;
  onPlay: () => void;
}> = ({ label, thumbnailUrl, onPlay }) => {
  const [imgSrc, setImgSrc] = useState<string | null>(thumbnailUrl);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setImgSrc(thumbnailUrl);
    setHasError(false);
  }, [thumbnailUrl]);

  const handleImageError = () => {
    // If high-res maxresdefault failed for YouTube, try hqdefault fallback before giving up
    if (imgSrc && imgSrc.includes('maxresdefault.jpg')) {
      setImgSrc(imgSrc.replace('maxresdefault.jpg', 'hqdefault.jpg'));
    } else {
      setHasError(true);
    }
  };

  const showCover = Boolean(imgSrc && !hasError);

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={INTRO_VIDEO_ARIA_LABEL}
      className="group absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3 bg-slate-950 cursor-pointer transition overflow-hidden"
    >
      {showCover ? (
        <>
          <img
            src={imgSrc!}
            alt=""
            onError={handleImageError}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/35 group-hover:bg-black/25 transition-colors" />
        </>
      ) : (
        <>
          <span className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
          <span
            className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(249,115,22,0.18),transparent_60%)]"
            aria-hidden="true"
          />
        </>
      )}

      {/* Center play control */}
      <span className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/20 border border-white/40 backdrop-blur-md shadow-lg flex items-center justify-center transition group-hover:bg-white/30 group-hover:scale-110">
        <Play className="w-6 h-6 sm:w-7 sm:h-7 text-white fill-white translate-x-0.5" aria-hidden="true" />
      </span>
      <span className="relative text-xs font-semibold tracking-wide text-white drop-shadow-sm">
        {label}
      </span>
    </button>
  );
};

