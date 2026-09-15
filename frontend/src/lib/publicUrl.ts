/**
 * The canonical public origin for links an admin shares.
 *
 * VITE_APP_URL is the configured production domain. window.location.origin is only the
 * fallback for a build without it: shared from a Vercel preview deployment or localhost, it
 * would hand clients a link to that preview or to the admin's own machine.
 */
export function getPublicAppOrigin(): string {
  const configured = (import.meta.env.VITE_APP_URL || '').trim().replace(/\/+$/, '');
  return configured || window.location.origin;
}

/**
 * The permanent public booking URL for a username, or null when there is no usable one.
 *
 * Null rather than a string for anything that is not a real username, so no caller can
 * produce /undefined, /null or /[object Object]. Deliberately looser than the signup rule in
 * lib/username.ts: a username stored before that rule existed still answers its own URL, and
 * refusing to build a link to it would take a live page off the dashboard.
 */
export function buildPublicProfileUrl(username: unknown): string | null {
  if (typeof username !== 'string') return null;
  const clean = username.trim().toLowerCase();
  if (!clean || clean === 'undefined' || clean === 'null' || /[\s/?#]/.test(clean)) return null;
  return `${getPublicAppOrigin()}/${encodeURIComponent(clean)}`;
}
