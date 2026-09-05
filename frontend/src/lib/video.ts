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
