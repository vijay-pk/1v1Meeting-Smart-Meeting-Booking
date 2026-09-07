/**
 * The username rule, mirrored from the backend.
 *
 * The two ends disagreed. The signup field stripped input to `[a-z0-9-]` and told the user
 * "Letters, numbers and dashes", while `backend/app/api/auth.py` accepts
 * `^[a-z0-9][a-z0-9._-]{2,29}$` -- dots and underscores included. So a perfectly legal name
 * like `midhun.vijay` was silently mangled to `midhunvijay` as it was typed, and the user was
 * never told why.
 *
 * The backend rule is canonical: it is the one actually enforced, it is what
 * `check_username()` tests, and it already has tests behind it. This file exists so the form
 * enforces exactly that and nothing else. If the backend pattern changes, change it here in
 * the same commit.
 */

/** Mirrors USERNAME_PATTERN in backend/app/api/auth.py. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** The helper text shown under the field. Kept next to the rule it describes. */
export const USERNAME_RULE_TEXT =
  '3–30 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.';

/**
 * Cleans what the user typed without silently deleting legal characters.
 *
 * Lowercases (the backend stores and compares lowercase) and drops characters no username may
 * contain. It deliberately does NOT enforce the "first character must be alphanumeric" rule by
 * deleting a leading dot or dash -- doing that fights the user mid-word. `validateUsername`
 * reports that as a message instead.
 */
export function sanitizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, USERNAME_MAX_LENGTH);
}

/**
 * Returns null when the value is a legal username, or a human-readable reason when not.
 *
 * Only checks the format. Whether a legal name is actually free (taken, retired, or reserved)
 * is the server's answer, and the form asks for it separately.
 */
export function validateUsername(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Choose a username for your booking link.';
  if (name.length < USERNAME_MIN_LENGTH) {
    return `Use at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (name.length > USERNAME_MAX_LENGTH) {
    return `Use at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!/^[a-z0-9]/.test(name)) return 'Start with a letter or a number.';
  if (!USERNAME_PATTERN.test(name)) return USERNAME_RULE_TEXT;
  return null;
}

/** What the availability check currently knows. Each state renders differently. */
export type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; reason: string }
  /**
   * The check itself failed. Deliberately distinct from 'taken': an unreachable backend
   * reported as "that name is taken" is wrong advice the user cannot act on, and the backend
   * here can be cold for tens of seconds.
   */
  | { kind: 'error'; reason: string };
