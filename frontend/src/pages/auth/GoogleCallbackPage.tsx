import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api, warmUpBackend } from '@/lib/api';
import { sanitizeUsername } from '@/lib/username';
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability';
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
  // One shared state machine with the sign-up form. These two screens drifted apart once,
  // and that drift is exactly what produced a green "available" beside a red server error.
  const {
    status: usernameStatus,
    invalidate: recheckUsername,
  } = useUsernameAvailability(username, phase === 'choose-username');

  // React 18 mounts effects twice in dev; the exchange must not run twice.
  const started = useRef(false);

  useEffect(() => {
    warmUpBackend();
  }, []);

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



  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhase('creating');
    try {
      const result = await api.googleAuthComplete(accessToken, username.trim().toLowerCase());
      await finishSignIn(result.role);
    } catch (err: any) {
      setPhase('choose-username');

      if (err?.isNetwork || err?.isTimeout) {
        // We could not reach the server -- which also means we no longer know this name is
        // free. It was checked seconds ago against a server we can no longer talk to, so
        // leaving the green "available" on screen asserts knowledge we have lost. Dropping it
        // is what stops the two messages contradicting each other, and it re-disables the
        // button until the name is confirmed again.
        recheckUsername();
        setError(
          'We could not reach the server — it may have been asleep. Nothing was created. ' +
          'Your name is being checked again; try once more in a moment.'
        );
        return;
      }

      // A real answer from the server: the name was taken between the check and the create,
      // the account is blocked, or something else it can explain. Show what it said.
      setError(err?.message || 'Could not create your account.');
    }
  };

  const previewHost = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/^https?:\/\//, '');
  // Only a confirmed 'available' may submit: not 'checking', and never 'error'.
  // Enabled only on a confirmed 'available' for the username currently in the box.
  // Every other state -- idle, invalid, checking, taken, error -- and any in-flight
  // submission leaves it disabled. 'error' matters most: a check that did not complete is
  // not permission to submit.
  const canSubmit = usernameStatus.kind === 'available' && phase === 'choose-username';

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

            {/* The host prefix sits inside the field so it reads as the tail of a URL rather
                than a display name -- but it is a <span>, never part of the value.

                It is hidden below sm: on purpose. The deployed host is 44 characters
                (1v1-meeting-smart-meeting-booking.vercel.app/), which on a phone consumes
                almost the whole field and leaves the username a sliver, making the domain
                look like the editable value. On small screens the full URL is shown under the
                field instead, where it has room. */}
            <div className="flex h-11 items-center rounded-xl border border-border-strong bg-surface focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 focus-within:ring-offset-surface">
              <span className="hidden shrink-0 max-w-[45%] truncate pl-3 text-sm text-text-tertiary sm:inline">{previewHost}/</span>
              <span className="shrink-0 pl-3 text-sm text-text-tertiary sm:hidden">/</span>
              <input
                id="google-username"
                value={username}
                onChange={(e) => { if (error) setError(null); setUsername(sanitizeUsername(e.target.value)); }}
                autoFocus
                disabled={phase === 'creating'}
                aria-describedby="google-username-helper"
                className="min-w-0 flex-1 bg-transparent px-1 text-base text-text-primary outline-none disabled:opacity-60 sm:text-sm"
                placeholder="yourname"
              />
            </div>

            {/* Reserved height so the message appearing never shifts the button under the
                user's thumb. Taken names read red here, matching the sign-up form. */}
            {/* The address in full, for the screens the inline prefix is hidden on. */}
            <p className="truncate text-[11px] leading-tight text-text-tertiary sm:hidden">
              {previewHost}/{username || 'yourname'}
            </p>

            <p
              id="google-username-helper"
              className="min-h-[16px] text-[11px] leading-tight"
              aria-live="polite"
            >
              {usernameStatus.kind === 'checking' && (
                <span className="text-text-tertiary">Checking availability…</span>
              )}
              {/* Suppressed while a submit error stands: the green claim and a red server
                  error are each true about a different request, and shown together they read
                  as the page contradicting itself. */}
              {usernameStatus.kind === 'available' && !error && (
                <span className="font-medium text-emerald-600">
                  {previewHost}/{username} is available
                </span>
              )}
              {(usernameStatus.kind === 'taken' || usernameStatus.kind === 'invalid') && (
                <span className="font-medium text-red-600">{usernameStatus.reason}</span>
              )}
              {usernameStatus.kind === 'error' && (
                <span className="font-medium text-amber-600">
                  Unable to check availability. Please try again in a moment.
                </span>
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
