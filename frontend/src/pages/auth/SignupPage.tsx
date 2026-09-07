import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, SLOW_REQUEST_MS } from '@/lib/api';
import {
  sanitizeUsername,
  validateUsername,
  USERNAME_RULE_TEXT,
  type UsernameStatus,
} from '@/lib/username';
import { GoogleAuthButton, AuthDivider } from '@/components/auth/GoogleAuthButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField, PasswordToggle } from '@/components/auth/AuthField';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Spinner } from '@/components/common/Skeleton';
import {
  UserPlus,
  Mail,
  Lock,
  User,
  AtSign,
  Phone,
  ShieldCheck,
  Calendar,
  CreditCard,
  Sparkles,
  ArrowRight,
  Globe
} from 'lucide-react';

export function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({ kind: 'idle' });
  // True once a request has been in flight long enough to be worth explaining. The backend
  // can take tens of seconds to wake from idle, and silence for that long reads as broken.
  const [serverWaking, setServerWaking] = useState(false);

  const navigate = useNavigate();

  const handleUsernameChange = (value: string) => {
    // Keeps every character the backend accepts. This used to strip dots and underscores,
    // which the backend allows, so a legal name was mangled as the user typed it.
    setUsername(sanitizeUsername(value));
  };

  // Live availability check.
  //
  // Three things this has to get right, all of which it previously got wrong:
  //   1. A failed check is not an answer. It used to be swallowed into `null`, which the
  //      submit guard then read as "no objection" and let the form through.
  //   2. A superseded check must not win. Typing "midhun" fires a request per keystroke
  //      after the debounce; without cancellation a slow reply for "midh" can land after the
  //      reply for "midhun" and overwrite a correct answer with a stale one.
  //   3. Format is decided locally against the shared rule, so an obviously invalid name
  //      never costs a round trip.
  useEffect(() => {
    const clean = username.trim();
    if (!clean) {
      setUsernameStatus({ kind: 'idle' });
      return;
    }
    const formatProblem = validateUsername(clean);
    if (formatProblem) {
      setUsernameStatus({ kind: 'invalid', reason: formatProblem });
      return;
    }

    const controller = new AbortController();
    setUsernameStatus({ kind: 'checking' });

    const timer = setTimeout(async () => {
      try {
        const result = await api.checkUsername(clean, controller.signal);
        if (controller.signal.aborted) return;
        setUsernameStatus(
          result.available
            ? { kind: 'available' }
            : { kind: 'taken', reason: result.reason || 'That name is already taken.' }
        );
      } catch (err: any) {
        // An abort is this effect superseding itself, not a failure.
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setUsernameStatus({
          kind: 'error',
          reason: err?.message || 'Could not check that name right now.',
        });
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const formatProblem = validateUsername(username.trim());
    if (formatProblem) {
      setError(formatProblem);
      return;
    }

    // Only a confirmed "available" may proceed. The old guard read
    // `usernameAvailability && !available`, so a check that had failed -- stored as null --
    // satisfied it and the form submitted anyway. Against a cold backend that produced the
    // reported symptom exactly: "midhunvijay is available" from a check that eventually
    // returned, next to "Failed to fetch" from the submit that did not.
    if (usernameStatus.kind === 'checking') {
      setError('Still checking that name — one moment.');
      return;
    }
    if (usernameStatus.kind === 'taken' || usernameStatus.kind === 'invalid') {
      setError(usernameStatus.reason);
      return;
    }
    if (usernameStatus.kind === 'error') {
      setError('We could not confirm that name is free. Please try again in a moment.');
      return;
    }
    if (usernameStatus.kind !== 'available') {
      setError('Choose a username for your booking link.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    // Explain a slow backend rather than showing a button that looks stuck.
    const wakeTimer = setTimeout(() => setServerWaking(true), SLOW_REQUEST_MS);

    try {
      // The backend is the only place an account is created. It rejects duplicate and
      // permanently deleted email addresses, and it returns the reason -- which is shown
      // to the user verbatim below. There is deliberately no local fallback: creating a
      // browser-only "account" when the API is unreachable produced admins that existed
      // in localStorage and nowhere else.
      const data = await api.signup({
        name: fullName,
        email,
        password,
        phone,
        username,
      });

      localStorage.setItem('bmm_logged_admin_id', data.user_id);
      localStorage.setItem('bmm_logged_username', data.username || username);
      localStorage.setItem('bmm_logged_admin_name', data.name || fullName);

      navigate('/admin');
    } catch (err: any) {
      const message = err?.message || 'Failed to create admin account';
      setError(
        message.includes('Failed to fetch')
          ? 'Could not reach the sign-up service. Please try again in a moment.'
          : message
      );
    } finally {
      clearTimeout(wakeTimer);
      setServerWaking(false);
      setLoading(false);
    }
  };

  const host = typeof window !== 'undefined' ? window.location.host : '';

  // The username helper line: one message, one colour, in the field's reserved slot. Taken
  // names read red here and on the Google callback screen, which used to disagree (amber).
  const usernameHelper = (() => {
    switch (usernameStatus.kind) {
      case 'idle':
        return { hint: USERNAME_RULE_TEXT };
      case 'invalid':
        return { error: usernameStatus.reason };
      case 'checking':
        return { hint: 'Checking availability…' };
      case 'available':
        return { success: `${host}/${username} is available` };
      case 'taken':
        return { error: usernameStatus.reason };
      case 'error':
        // Distinct from "taken" on purpose. The name may well be free; we could not ask.
        return { error: 'Unable to check availability. Please try again in a moment.' };
    }
  })();

  return (
    <AuthShell
      wide
      title="Create your account"
      subtitle="Your booking page is live the moment you finish."
      footer={
        <Link
          to="/admin/login"
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-tertiary"
        >
          <span>Sign in</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
      aside={
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Personal booking pages for 1:1 sessions</span>
          </div>

          <h2 className="text-2xl font-black leading-tight tracking-tight text-text-primary sm:text-4xl">
            Launch your 1:1 booking page in{' '}
            <span className="text-primary-600">60 seconds</span>.
          </h2>

          <p className="max-w-xl text-sm leading-relaxed text-text-secondary sm:text-base">
            Accept paid 1-to-1 appointments, drop the scheduling emails, connect your Google
            Calendar, and collect payments straight through your own Razorpay account.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                Icon: Globe,
                tone: 'bg-primary-50 text-primary-600',
                title: 'Your own URL',
                body: <>Claim <code className="font-mono text-[11px] text-primary-700">{host}/username</code> with your own theme, video and bio.</>,
              },
              {
                Icon: Calendar,
                tone: 'bg-blue-50 text-blue-600',
                title: 'Google Calendar & Meet',
                body: 'Busy slots are subtracted automatically, and every confirmed booking gets a Meet link.',
              },
              {
                Icon: CreditCard,
                tone: 'bg-emerald-50 text-emerald-600',
                title: 'Your own Razorpay',
                body: 'Connect your own keys, encrypted at rest. Payments settle directly to you.',
              },
              {
                Icon: ShieldCheck,
                tone: 'bg-purple-50 text-purple-600',
                title: 'No double bookings',
                body: 'Slots are held while a client pays, so two people can never take the same time.',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="space-y-1.5 rounded-2xl border border-border bg-surface p-4"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${feature.tone}`}>
                  <feature.Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">{feature.title}</h3>
                <p className="text-xs leading-relaxed text-text-tertiary">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <GoogleAuthButton
          label="Sign up with Google"
          onError={setError}
          onStart={() => {
            if (username.trim()) {
              localStorage.setItem('bmm_pending_username', username.trim().toLowerCase());
              sessionStorage.setItem('bmm_pending_username', username.trim().toLowerCase());
            }
          }}
        />
        <AuthDivider text="or sign up with email" />
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
        {error && <ErrorNote message={error} />}

        <AuthField
          id="signup-name"
          label="Full name"
          type="text"
          required
          autoComplete="name"
          icon={User}
          placeholder="Your full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <AuthField
          id="signup-username"
          label="Username & personal URL"
          type="text"
          required
          minLength={3}
          maxLength={30}
          autoComplete="off"
          icon={AtSign}
          placeholder="yourname"
          value={username}
          onChange={(e) => handleUsernameChange(e.target.value)}
          reserveHelper
          {...usernameHelper}
        />

        <AuthField
          id="signup-email"
          label="Email address"
          type="email"
          required
          autoComplete="email"
          icon={Mail}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthField
          id="signup-phone"
          label="Phone number"
          type="tel"
          autoComplete="tel"
          icon={Phone}
          placeholder="Optional"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Optional — used only for booking notifications."
        />

        <AuthField
          id="signup-password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          required
          minLength={6}
          autoComplete="new-password"
          icon={Lock}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Minimum 6 characters."
          trailing={
            <PasswordToggle
              visible={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
            />
          }
        />

        {/* Also disabled while the name is still being checked: submitting into an
            unresolved check is how the form ended up posting to a backend that had not
            answered yet. */}
        <Button
          type="submit"
          size="touch"
          disabled={loading || usernameStatus.kind === 'checking'}
          className="mt-1 w-full"
        >
          {loading ? (
            <>
              <Spinner />
              {serverWaking ? 'Waking the server…' : 'Creating your page…'}
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create my booking page
            </>
          )}
        </Button>
        {serverWaking && (
          <p className="text-center text-xs text-text-secondary" aria-live="polite">
            The server has been idle and is starting up. This can take up to a minute the
            first time — your details are safe, please don&rsquo;t refresh.
          </p>
        )}
      </form>

      <div className="mt-4 border-t border-border pt-3 text-center">
        <p className="text-xs text-text-secondary">
          Already registered?{' '}
          <Link to="/admin/login" className="font-semibold text-primary-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
