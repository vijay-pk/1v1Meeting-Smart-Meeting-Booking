/**
 * Per-tab auth/session storage.
 *
 * The bug this fixes: the JWT and the cached identity (role, admin id, username, name, …)
 * lived in localStorage, which every tab of the same origin shares. Logging in as a second
 * user in a second tab overwrote the single `bmm_auth_token`, so BOTH tabs then sent the last
 * token and `/me` resolved to the same user everywhere -- a Super Admin's data leaking into a
 * regular Admin's tab, and vice versa.
 *
 * The credential now lives in `sessionStorage`, which is isolated per tab. A tab that logs in
 * writes its own sessionStorage AND localStorage; localStorage is kept only as the *default*
 * a brand-new tab inherits once, at load, so opening a new tab keeps you signed in. After that
 * one-time adoption the tab reads exclusively from its own sessionStorage, so another tab
 * signing in as a different user can never change who this tab is.
 *
 * The backend is still the sole authority for ownership: it resolves the user from the token,
 * never from any of these values. These keys are a client-side cache for rendering and for the
 * Authorization header; scoping them per tab is what makes simultaneous sessions correct.
 */

// Every key that identifies "who is signed in" in this tab. Anything here is per-tab.
export const SESSION_KEYS = [
  'bmm_auth_token',
  'bmm_current_user_role',
  'bmm_logged_role',
  'bmm_logged_admin_id',
  'bmm_logged_username',
  'bmm_logged_admin_name',
  'bmm_logged_admin_photo',
  'bmm_logged_admin_video',
  'bmm_auth_user',
] as const;

const TOKEN_KEY = 'bmm_auth_token';

// One-time, per-tab adoption. A fresh tab with no session of its own inherits the last
// localStorage session as a whole, so a new tab is not logged out. Copying the entire set
// together (rather than per-key fallback) guarantees a consistent identity: never this user's
// token with that user's role.
try {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    if (!sessionStorage.getItem(TOKEN_KEY) && localStorage.getItem(TOKEN_KEY)) {
      for (const k of SESSION_KEYS) {
        const v = localStorage.getItem(k);
        if (v !== null) sessionStorage.setItem(k, v);
      }
    }
  }
} catch {
  // Private mode / blocked storage: fall through to the localStorage-only path below.
}

/**
 * Read a session value. Once this tab has its own token, sessionStorage is the ONLY source --
 * never fall back to localStorage, which another tab may have overwritten with a different
 * user. Before a per-tab session exists (pre-adoption edge, or storage blocked), fall back to
 * localStorage.
 */
export function authGet(key: string): string | null {
  try {
    if (sessionStorage.getItem(TOKEN_KEY)) {
      return sessionStorage.getItem(key);
    }
    return localStorage.getItem(key);
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

/**
 * Write a session value to this tab (sessionStorage) and to the shared default (localStorage)
 * so the next new tab inherits it. Only this tab's sessionStorage decides this tab's identity.
 */
export function authSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch {}
  try { localStorage.setItem(key, value); } catch {}
}

export function authRemove(key: string): void {
  try { sessionStorage.removeItem(key); } catch {}
  try { localStorage.removeItem(key); } catch {}
}

/** Clear this tab's session identity from both stores (used on logout / revocation). */
export function authClearSession(): void {
  for (const k of SESSION_KEYS) authRemove(k);
}
