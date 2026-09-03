import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Spinner } from '@/components/common/Skeleton';
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

        // New Google user: auto-create account with chosen username (from signup) or suggested username
        const chosenUsername = (
          sessionStorage.getItem('bmm_pending_username') ||
          localStorage.getItem('bmm_pending_username') ||
          result.suggested_username ||
          ''
        ).trim().toLowerCase();

        if (chosenUsername) {
          try {
            setPhase('creating');
            const created = await api.googleAuthComplete(token, chosenUsername);
            sessionStorage.removeItem('bmm_pending_username');
            localStorage.removeItem('bmm_pending_username');
            await finishSignIn(created.role);
            return;
          } catch (autoErr: any) {
            // If the preferred handle had a validation collision, fallback to manual selection
            console.warn('Auto-create failed, prompting user:', autoErr);
          }
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

        if (bp.profile_photo) {
          localStorage.setItem('bmm_logged_admin_photo', bp.profile_photo);
        }
        if (bp.intro_video) {
          localStorage.setItem('bmm_logged_admin_video', bp.intro_video);
        }

        // Merge onto the existing record instead of replacing it: this payload carries no
        // google_connected / google_email, and a wholesale replace is what used to make a
        // connected Google Calendar look disconnected after a sign-in.
        useBookingStore.setState((state) => {
          const previous = state.admins.find(
            (a: any) =>
              a.id === synced.id || a.username.toLowerCase() === synced.username.toLowerCase()
          );
          return {
            admins: [
              { ...previous, ...synced } as any,
              ...state.admins.filter(
                (a: any) =>
                  a.id !== synced.id && a.username.toLowerCase() !== synced.username.toLowerCase()
              ),
            ],
          };
        });
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
    <AuthShell
      title={phase === 'error' ? 'Sign-in failed' : 'Choose your page address'}
      subtitle={
        phase === 'error'
          ? undefined
          : phase === 'verifying'
          ? undefined
          : `Signed in as ${email}. This is the link you will share with people booking time with you.`
      }
    >
      {phase === 'verifying' && (
        <div className="py-6 text-center" role="status" aria-live="polite">
          <Spinner className="mx-auto mb-4 h-8 w-8 border-[3px] text-primary-600" />
          <p className="text-sm text-text-secondary">Signing you in with Google…</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-4 text-center">
          <ErrorNote message={error || 'Google sign-in could not be completed.'} />
          <Button
            size="touch"
            variant="outline"
            className="w-full"
            onClick={() => navigate('/admin/login', { replace: true })}
          >
            Back to sign in
          </Button>
        </div>
      )}

      {(phase === 'choose-username' || phase === 'creating') && (
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="google-username" className="text-xs font-semibold text-text-secondary">
              Username
            </Label>

            {/* The host prefix stays inside the field, so it is clear the username is the
                tail of a URL rather than a display name. */}
            <div className="flex h-11 items-center rounded-xl border border-border-strong bg-surface focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 focus-within:ring-offset-surface">
              <span className="shrink-0 pl-3 text-sm text-text-tertiary">{previewHost}/</span>
              <input
                id="google-username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoFocus
                disabled={phase === 'creating'}
                aria-describedby="google-username-helper"
                className="min-w-0 flex-1 bg-transparent px-1 text-base text-text-primary outline-none disabled:opacity-60 sm:text-sm"
                placeholder="yourname"
              />
            </div>

            {/* Reserved height so the message appearing never shifts the button under the
                user's thumb. Taken names read red here, matching the sign-up form. */}
            <p
              id="google-username-helper"
              className="min-h-[16px] text-[11px] leading-tight"
              aria-live="polite"
            >
              {checking && <span className="text-text-tertiary">Checking availability…</span>}
              {!checking && availability?.available && (
                <span className="font-medium text-emerald-600">
                  {previewHost}/{username} is available
                </span>
              )}
              {!checking && availability && !availability.available && (
                <span className="font-medium text-red-600">{availability.reason}</span>
              )}
            </p>
          </div>

          {error && <ErrorNote message={error} />}

          <Button type="submit" size="touch" disabled={!canSubmit} className="w-full">
            {phase === 'creating' ? (
              <>
                <Spinner />
                Creating your account…
              </>
            ) : (
              'Create my page'
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
