/**
 * Intro-video URL handling, shared by the public booking page, the scheduling page and the
 * admin preview so all three render the same thing from the same stored URL.
 *
 * Two rules this file exists to keep:
 *
 * 1. **Provider-neutral.** Our UI never adds a YouTube or Vimeo logo, icon, badge or name to
 *    the video card, and the embed URLs below ask each provider for its least-branded player
 *    (no related-video grid, no title bar, no uploader byline/portrait). What the provider
 *    still draws inside its own iframe is theirs and is left alone -- removing that would be
 *    stripping branding they require. Nothing here exposes which provider was used.
 * 2. **Reference only.** The video is embedded from the URL the admin saved. It is never
 *    downloaded, re-hosted, or turned into a thumbnail that could overwrite a profile photo.
 */

/** Extracts the 11-character YouTube id from any of the public URL shapes. */
const YOUTUBE_ID = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=))([\w-]{11})/;
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d+)/;

/**
 * Normalizes a saved intro-video URL into a safe, provider-neutral embed URL.
 *
 * Returns null for anything that is not a recognised YouTube or Vimeo link -- including a
 * direct file URL, which the caller renders in a plain <video> element instead. Never throws:
 * an unparseable string is simply not embeddable.
 */
export function getVideoEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.trim();
  if (!clean) return null;

  const vimeo = clean.match(VIMEO_ID);
  if (vimeo) {
    // title/byline/portrait off: the card carries our own label, not Vimeo's overlay.
    return `https://player.vimeo.com/video/${vimeo[1]}?title=0&byline=0&portrait=0&badge=0&autopause=0&dnt=1`;
  }

  const youtube = clean.match(YOUTUBE_ID);
  if (youtube) {
    // -nocookie host, no related-video grid, no title bar overlay.
    return `https://www.youtube-nocookie.com/embed/${youtube[1]}?rel=0&modestbranding=1&playsinline=1`;
  }

  return null;
}

/** True when the URL is a file we can play ourselves rather than an embed. */
export function isDirectVideoUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim()) && getVideoEmbedUrl(url) === null;
}

/**
 * The only label our video UI ever shows. Deliberately says nothing about where the video is
 * hosted -- see rule 1 above.
 */
export const INTRO_VIDEO_LABEL = 'Intro Video';
export const INTRO_VIDEO_ARIA_LABEL = 'Play intro video';

/**
 * The same embed URL, asking the provider to start playing immediately.
 *
 * Only ever used after the visitor has clicked our own play control: the card renders a
 * provider-neutral facade first and mounts the iframe on that click, so the provider's
 * pre-roll chrome (its logo, the uploader's name and avatar, the video title, its own
 * "watch on ..." control) is never what a visitor sees when the page loads. Autoplay is what
 * makes the click still feel like one click.
 */
export function withAutoplay(embedUrl: string): string {
  return `${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1`;
}

/** Extracts the 11-character YouTube id from any of the public URL shapes. */
export function getYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.trim().match(YOUTUBE_ID);
  return match ? match[1] : null;
}

/** Extracts the Vimeo numeric id from any Vimeo URL shape. */
export function getVimeoVideoId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.trim().match(VIMEO_ID);
  return match ? match[1] : null;
}

/**
 * Returns a YouTube thumbnail URL. Prefers maxresdefault with fallback to hqdefault.
 */
export function getYouTubeThumbnailUrl(videoId: string, quality: 'hq' | 'maxres' = 'maxres'): string {
  if (quality === 'hq') {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

/** In-memory cache of resolved thumbnails so we never refetch for the same video URL. */
const thumbnailCache = new Map<string, string | null>();

/**
 * Asynchronously retrieves a reliable cover image URL for a YouTube or Vimeo video.
 * Handles private videos, unsupported formats, and network issues gracefully without throwing.
 */
export async function fetchVideoThumbnail(url?: string | null): Promise<string | null> {
  if (!url) return null;
  const clean = url.trim();
  if (!clean) return null;

  if (thumbnailCache.has(clean)) {
    return thumbnailCache.get(clean) || null;
  }

  // 1. YouTube: instant direct URL
  const ytId = getYouTubeVideoId(clean);
  if (ytId) {
    const thumb = getYouTubeThumbnailUrl(ytId, 'maxres');
    thumbnailCache.set(clean, thumb);
    return thumb;
  }

  // 2. Vimeo: fetch via oEmbed
  const vimeoId = getVimeoVideoId(clean);
  if (vimeoId) {
    try {
      const cached = sessionStorage.getItem(`vimeo_thumb_${vimeoId}`);
      if (cached) {
        thumbnailCache.set(clean, cached);
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}&width=960`);
      if (res.ok) {
        const data = await res.json();
        if (data?.thumbnail_url) {
          thumbnailCache.set(clean, data.thumbnail_url);
          try {
            sessionStorage.setItem(`vimeo_thumb_${vimeoId}`, data.thumbnail_url);
          } catch {}
          return data.thumbnail_url;
        }
      }
    } catch {
      // Graceful fallback on network/CORS error or private video
    }
  }

  thumbnailCache.set(clean, null);
  return null;
}

