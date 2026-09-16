import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, warmUpBackend, SLOW_REQUEST_MS } from '@/lib/api';
import { sanitizeUsername, validateUsername } from '@/lib/username';
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability';
import { GoogleAuthButton, AuthDivider } from '@/components/auth/GoogleAuthButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField, PasswordToggle } from '@/components/auth/AuthField';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Spinner } from '@/components/common/Skeleton';
import { Mail, Lock, User, AtSign } from 'lucide-react';

// A shorter form of USERNAME_RULE_TEXT for the idle helper line. The full sentence is still
// what validation reports when a name breaks the rule.
const USERNAME_HINT = '3–30 characters · lowercase letters, numbers, dots, dashes or underscores';

export function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Shared with the Google "choose your page address" step, so the two screens cannot drift.
  const { status: usernameStatus, invalidate: recheckUsername } = useUsernameAvailability(username);
  // True once a request has been in flight long enough to be worth explaining. The backend
  // can take tens of seconds to wake from idle, and silence for that long reads as broken.
  const [serverWaking, setServerWaking] = useState(false);

  const navigate = useNavigate();

  // Move the cold start off the submit button. See warmUpBackend() in lib/api.ts.
  useEffect(() => {
    warmUpBackend();
  }, []);

  const handleUsernameChange = (value: string) => {
    // The outstanding error described the previous attempt with the previous name. Once the
    // name changes it no longer applies, and holding it would keep suppressing the helper.
    if (error) setError('');
    // Keeps every character the backend accepts. This used to strip dots and underscores,
    // which the backend allows, so a legal name was mangled as the user typed it.
    setUsername(sanitizeUsername(value));
  };



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
        username,
      });

      localStorage.setItem('bmm_logged_admin_id', data.user_id);
      localStorage.setItem('bmm_logged_username', data.username || username);
      localStorage.setItem('bmm_logged_admin_name', data.name || fullName);

      // A brand-new account goes through first-time setup before the dashboard.
      navigate('/admin/setup');
    } catch (err: any) {
      // This used to test `message.includes('Failed to fetch')` to substitute friendlier
      // copy. That string no longer reaches here -- lib/api.ts converts the browser's raw
      // TypeError into NetworkError first -- so the branch was dead and the generic message
      // leaked through, beside a username helper that had already succeeded and said the name
      // was available. Two accurate statements about two different requests, reading as one
      // contradiction.
      if (err?.isNetwork || err?.isTimeout) {
        // The server is unreachable, so the availability answer beside this message is no
        // longer something we know -- it was checked against a server we can no longer talk
        // to. Drop it, which clears the green line and re-disables the button until the name
        // is confirmed again. Otherwise the screen claims a name is available and the server
        // is unreachable in the same breath.
        recheckUsername();
        setError(
          'We could not reach the sign-up service — it may have been asleep. Nothing was ' +
          'created. Your name is being checked again; if it then says the email is already ' +
          'registered, your account did go through: sign in instead.'
        );
      } else {
        setError(err?.message || 'Failed to create admin account');
      }
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
    // A standing submit error outranks the availability line.
    //
    // "midhunvijay is available" in green and "could not reach the server" in red are each
    // true about a different request, and together they read as the page contradicting
    // itself -- which is exactly what was reported. Re-checking the name is not enough on its
    // own: against a reachable server the check succeeds again in a few hundred milliseconds
    // and the green returns while the red is still on screen.
    //
    // So while an error from the submit is outstanding, the availability line falls back to
    // the neutral URL preview. The green claim returns the moment the user edits the name,
    // which is what clears the error.
    if (error) return { hint: `${host}/${username}` };

    switch (usernameStatus.kind) {
      case 'idle':
        return { hint: USERNAME_HINT };
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
    <AuthShell title="Create your account">
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
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <AuthField
          id="signup-username"
          label="Username"
          type="text"
          required
          minLength={3}
          maxLength={30}
          autoComplete="off"
          icon={AtSign}
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthField
          id="signup-password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          required
          minLength={6}
          autoComplete="new-password"
          icon={Lock}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 6 characters."
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
        {/* Enabled only on a confirmed 'available' for the name currently in the box.
            idle, invalid, checking, taken and error all leave it disabled -- 'error' most
            importantly, because a check that did not complete is not permission to submit.
            The handler still re-validates; this is the visible half of the same rule. */}
        <Button
          type="submit"
          size="touch"
          disabled={loading || usernameStatus.kind !== 'available'}
          className="mt-1 w-full"
        >
          {loading ? (
            <>
              <Spinner />
              {serverWaking ? 'Waking the server…' : 'Creating your page…'}
            </>
          ) : (
            'Create account'
          )}
        </Button>
        {serverWaking && (
          <p className="text-center text-xs text-text-secondary" aria-live="polite">
            The server has been idle and is starting up. This can take up to a minute the
            first time — your details are safe, please don&rsquo;t refresh.
          </p>
        )}
      </form>

      <div className="mt-5 text-center">
        <p className="text-sm text-text-secondary">
          Already have an account?{' '}
          <Link to="/admin/login" className="press -my-2 inline-flex min-h-11 items-center rounded-lg px-1.5 font-semibold text-primary-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
