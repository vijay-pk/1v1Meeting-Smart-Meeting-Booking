import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { validateUsername, type UsernameStatus } from '@/lib/username';

/**
 * The username availability state machine, owned in one place.
 *
 * Two screens ask this question -- the sign-up form and the Google "choose your page address"
 * step -- and they drifted. One had a race guard and explicit states; the other swallowed
 * failures and kept a stale answer on screen. That drift is what produced a page showing
 * "midhunvijay is available" in green beside "Could not reach the server" in red, with the
 * submit button enabled.
 *
 * Three rules this exists to enforce, in every caller, by construction:
 *
 * 1. **A failure is never an answer.** If the check did not complete, the status is `error`,
 *    never `available` and never `taken`. An unreachable server reported as "that name is
 *    taken" is wrong advice; reported as "available" is worse, because it lets the form submit.
 *
 * 2. **A stale reply never wins.** Typing "midhunvijay" fires a request per keystroke past the
 *    debounce. Each new keystroke aborts the previous request, and any reply that arrives for
 *    a username that is no longer the current one is discarded.
 *
 * 3. **Knowledge expires when the connection does.** `invalidate()` exists for the case where
 *    a *later* request to the same server fails: we checked this name seconds ago against a
 *    server we can no longer reach, so we no longer know it is free. The caller invalidates,
 *    the green message clears, the button disables, and the check runs again.
 */

const DEBOUNCE_MS = 350;

export interface UsernameAvailability {
  /** The current state. Never contradicts itself, and never lags the input. */
  status: UsernameStatus;
  /** True only for a confirmed `available` on the username currently in the box. */
  isAvailable: boolean;
  /**
   * Discards the current result and re-checks. Call this when a *different* request to the
   * same backend fails, because that failure means the earlier answer can no longer be trusted.
   */
  invalidate: () => void;
}

export function useUsernameAvailability(username: string, enabled = true): UsernameAvailability {
  const [status, setStatus] = useState<UsernameStatus>({ kind: 'idle' });
  const [nonce, setNonce] = useState(0);

  // The username this hook last acted on. Guards against a reply landing after the input has
  // moved on, which AbortController alone does not fully cover: a response can already be
  // in flight through the parsing step when the abort fires.
  const latest = useRef(username);
  latest.current = username;

  useEffect(() => {
    const clean = username.trim();

    if (!enabled) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (!clean) {
      setStatus({ kind: 'idle' });
      return;
    }

    // Format is decided locally against the rule shared with the backend, so an obviously
    // invalid name never costs a round trip.
    const formatProblem = validateUsername(clean);
    if (formatProblem) {
      setStatus({ kind: 'invalid', reason: formatProblem });
      return;
    }

    const controller = new AbortController();
    setStatus({ kind: 'checking' });

    const timer = setTimeout(async () => {
      try {
        const result = await api.checkUsername(clean, controller.signal);
        // Two guards, not one: the request may have been aborted, or it may have completed
        // for a username the user has since typed past.
        if (controller.signal.aborted || latest.current.trim() !== clean) return;
        setStatus(
          result.available
            ? { kind: 'available' }
            : { kind: 'taken', reason: result.reason || 'That name is already taken.' }
        );
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        if (latest.current.trim() !== clean) return;
        setStatus({
          kind: 'error',
          reason: err?.message || 'Could not check that name right now.',
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, enabled, nonce]);

  const invalidate = useCallback(() => {
    // Drop straight to `checking` rather than leaving the old answer visible for a frame --
    // the whole point is that the previous result stops being displayed immediately.
    setStatus({ kind: 'checking' });
    setNonce((n) => n + 1);
  }, []);

  return { status, isAvailable: status.kind === 'available', invalidate };
}
