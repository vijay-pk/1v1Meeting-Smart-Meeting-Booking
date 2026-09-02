import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { useBookingStore } from '@/stores/bookingStore';

type Phase = 'verifying' | 'choose-username' | 'creating' | 'error';

/**
 * Where Google returns after OAuth.
 *
 * Supabase has a session by this point; the backend still owns the account. This page
 * trades the Supabase access token for a backend JWT:
 *
 *   - Google address already registered -> signed in, straight to the dashboard.
 *   - New Google address -> the username step below, then the account is created.
 *
 * Which of the two happens depends only on whether the account exists, so starting
 * from the sign-in page or the sign-up page reaches the same right outcome.
 */
export function GoogleCallbackPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  // React 18 mounts effects twice in dev; the exchange must not run twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        // detectSessionInUrl is on in lib/supabase.ts, so the session may still be
        // settling when this mounts. Retry briefly before giving up.
        let token = '';
        for (let attempt = 0; attempt < 10 && !token; attempt++) {
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token || '';
          if (!token) await new Promise((r) => setTimeout(r, 300));
        }

        if (!token) {
          setError('Google sign-in did not complete. Please try again.');
          setPhase('error');
          return;
        }
        setAccessToken(token);

        const result = await api.googleAuth(token);

        if (result.status === 'authenticated') {
          await finishSignIn(result.role);
          return;
        }

        setEmail(result.email || '');
        setUsername(result.suggested_username || '');
        setPhase('choose-username');
      } catch (err: any) {
        setError(err?.message || 'Google sign-in failed. Please try again.');
        setPhase('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mirrors the password login path: hydrate the store, then route by role. */
  const finishSignIn = async (role?: string) => {
    try {
      const bp = await api.getMyProfile();
      if (bp) {
        localStorage.setItem('bmm_logged_username', bp.username);
        localStorage.setItem('bmm_logged_admin_id', bp.user_id);
        localStorage.setItem('bmm_logged_admin_name', bp.name);

        const synced = {
          id: bp.user_id,
          username: bp.username,
          full_name: bp.name,
          title: bp.title || '',
          bio: bp.bio || '',
          about_me_text: bp.about_me_text || '',
          heading_text: bp.heading_text || '',
          welcome_message: bp.welcome_message || '',
          photo_url: bp.profile_photo || '',
          intro_video: bp.intro_video || '',
          email: bp.email,
          phone: bp.phone,
          role: bp.role || 'admin',
          status: bp.status || 'ACTIVE',
          avatar_color: 'bg-indigo-600',
          avatar_letter: bp.name ? bp.name.charAt(0).toUpperCase() : 'A',
          theme_settings: bp.theme_settings || {},
          social_links: bp.social_links || {},
        };

        useBookingStore.setState((state) => ({
          admins: [
            synced,
            ...state.admins.filter(
              (a: any) =>
                a.id !== synced.id && a.username.toLowerCase() !== synced.username.toLowerCase()
            ),
          ],
        }));
      }
    } catch {
      // Profile hydration is best-effort; the token is already stored.
    }

    const effectiveRole = role || localStorage.getItem('bmm_current_user_role');
    navigate(effectiveRole === 'super_admin' ? '/super-admin' : '/admin', { replace: true });
  };

  // Availability check, debounced so typing does not hit the API on every keystroke.
  useEffect(() => {
    if (phase !== 'choose-username' || !username.trim()) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      const result = await api.checkUsername(username.trim().toLowerCase());
      setAvailability(result);
      setChecking(false);
    }, 400);
    return () => clearTimeout(t);
  }, [username, phase]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhase('creating');
    try {
      const result = await api.googleAuthComplete(accessToken, username.trim().toLowerCase());
      await finishSignIn(result.role);
    } catch (err: any) {
      setError(err?.message || 'Could not create your account.');
      setPhase('choose-username');
    }
  };

  const previewHost = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/^https?:\/\//, '');
  const canSubmit = !!availability?.available && !checking && phase === 'choose-username';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800/60 p-7 shadow-xl">
        {phase === 'verifying' && (
          <div className="text-center py-6">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-white" />
            <p className="text-sm text-slate-300">Signing you in with Google...</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-white">Sign-in failed</h1>
            <p className="mt-2 text-sm text-red-400">{error}</p>
            <button
              onClick={() => navigate('/admin/login', { replace: true })}
              className="mt-5 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Back to sign in
            </button>
          </div>
        )}

        {(phase === 'choose-username' || phase === 'creating') && (
          <form onSubmit={handleCreate}>
            <h1 className="text-lg font-semibold text-white">Choose your page address</h1>
            <p className="mt-1 text-sm text-slate-400">
              Signed in as <span className="text-slate-200">{email}</span>. This is the link you
              will share with people booking time with you.
            </p>

            <label htmlFor="google-username" className="mt-5 block text-xs font-medium text-slate-300">
              Username
            </label>
            <div className="mt-1.5 flex items-center rounded-lg border border-slate-600 bg-slate-900 focus-within:border-slate-400">
              <span className="pl-3 text-sm text-slate-500">{previewHost}/</span>
              <input
                id="google-username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoFocus
                disabled={phase === 'creating'}
                className="flex-1 bg-transparent px-1 py-2.5 text-sm text-white outline-none disabled:opacity-60"
                placeholder="yourname"
              />
            </div>

            <div className="mt-2 min-h-[20px] text-xs">
              {checking && <span className="text-slate-500">Checking availability...</span>}
              {!checking && availability?.available && (
                <span className="text-emerald-400">
                  {previewHost}/{username} is available
                </span>
              )}
              {!checking && availability && !availability.available && (
                <span className="text-amber-400">{availability.reason}</span>
              )}
            </div>

            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'creating' ? 'Creating your account...' : 'Create my page'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
