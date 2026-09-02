import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface GoogleAuthButtonProps {
  /** Shown on the button. Wording differs between the sign-in and sign-up pages. */
  label?: string;
  /** Surfaced to the parent page so the error sits with the form's other errors. */
  onError?: (message: string) => void;
}

/**
 * Starts Google sign-in.
 *
 * Supabase runs the OAuth redirect; the account itself lives in the FastAPI backend.
 * Google returns to /auth/callback, which exchanges the Supabase session for a backend
 * JWT and either signs the user in or asks a new user to choose their username.
 *
 * The same button serves both pages: whether this ends as a sign-in or a registration
 * is decided by whether the Google address already has an account, not by where the
 * user clicked.
 */
export function GoogleAuthButton({ label = 'Continue with Google', onError }: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const origin = import.meta.env.VITE_APP_URL || window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${origin}/auth/callback` },
      });
      if (error) throw error;
      // On success the browser navigates away to Google; nothing after this runs.
    } catch (err: any) {
      setLoading(false);
      onError?.(err?.message || 'Could not start Google sign-in. Please try again.');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 rounded-lg border border-slate-600 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleMark />
      {loading ? 'Redirecting to Google...' : label}
    </button>
  );
}

/** Google's mark, inlined so the button never depends on a remote asset. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** A labelled divider, so both auth pages separate the OAuth and password paths alike. */
export function AuthDivider({ text = 'or' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-slate-700" />
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{text}</span>
      <span className="h-px flex-1 bg-slate-700" />
    </div>
  );
}
