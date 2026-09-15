import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Link2 } from 'lucide-react';
import { buildPublicProfileUrl } from '@/lib/publicUrl';

type ShareState = 'idle' | 'shared' | 'copied' | 'manual';

/**
 * Share / copy behaviour for an admin's permanent public booking URL.
 *
 * `username` must be the server's value (GET /profiles/me/onboarding), never localStorage:
 * the dashboard's old links read an auth store nothing populated and opened /undefined.
 */
export function usePublicLinkShare(username: string | null | undefined) {
  const url = buildPublicProfileUrl(username);
  const [state, setState] = useState<ShareState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectForManualCopy = useCallback(() => {
    setState('manual');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const share = useCallback(async () => {
    if (!url) return;

    // The native share sheet on touch devices; on a desktop it is an odd detour for what is
    // almost always "copy the link", so desktops copy.
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Book a 1:1 session with me', url });
        setState('shared');
        return;
      } catch (err: any) {
        // The admin closed the sheet: nothing failed, and nothing needs saying.
        if (err?.name === 'AbortError') return;
        // Otherwise fall through to copying.
      }
    }

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setState('copied');
      window.setTimeout(() => setState((s) => (s === 'copied' ? 'idle' : s)), 3000);
    } catch {
      selectForManualCopy();
    }
  }, [url, selectForManualCopy]);

  return { url, state, share, inputRef, selectForManualCopy };
}

/**
 * The URL itself, visible so the admin can check it, plus the outcome of the last share.
 */
export function PublicLinkRow({
  url,
  state,
  inputRef,
  loading,
  error,
  onRetry,
}: {
  url: string | null;
  state: ShareState;
  inputRef: React.RefObject<HTMLInputElement | null>;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  if (!url) {
    if (loading) {
      return <p className="text-xs text-text-tertiary">Loading your booking link…</p>;
    }
    if (error) {
      return (
        <p className="text-xs text-red-700" role="alert">
          Couldn't load your booking link. {onRetry && (
            <button type="button" onClick={onRetry} className="font-semibold underline">
              Try again
            </button>
          )}
        </p>
      );
    }
    return (
      <p className="text-xs text-amber-800" role="status">
        Complete your username to create your booking link.{' '}
        <Link to="/admin/settings" className="font-semibold underline">
          Go to profile settings
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <Link2 className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="Your public booking link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text-primary outline-none"
        />
      </div>
      <p className="min-h-4 text-xs" role="status" aria-live="polite">
        {state === 'copied' && (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Booking link copied
          </span>
        )}
        {state === 'shared' && <span className="font-semibold text-emerald-700">Booking link shared</span>}
        {state === 'manual' && (
          <span className="text-amber-800">
            Copying isn't available in this browser. The link above is selected — press Ctrl+C (⌘C on Mac) to copy it.
          </span>
        )}
      </p>
    </div>
  );
}
