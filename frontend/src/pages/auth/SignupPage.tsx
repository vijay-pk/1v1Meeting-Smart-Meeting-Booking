import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
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
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<{ available: boolean; reason?: string } | null>(null);

  const navigate = useNavigate();

  const handleUsernameChange = (value: string) => {
    // Only allow lowercase letters, numbers, and hyphens
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setUsername(sanitized);
  };

  // Live real-time check to ensure each admin has their own unique username
  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (clean.length < 3) {
      setUsernameAvailability(null);
      setCheckingUsername(false);
      return;
    }
    setCheckingUsername(true);
    const t = setTimeout(async () => {
      try {
        const result = await api.checkUsername(clean);
        setUsernameAvailability(result);
      } catch {
        setUsernameAvailability(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (usernameAvailability && !usernameAvailability.available) {
      setError(usernameAvailability.reason || 'This username is already taken. Please choose another.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

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
      setLoading(false);
    }
  };

  const host = typeof window !== 'undefined' ? window.location.host : '';

  // The username helper line: one message, one colour, in the field's reserved slot. Taken
  // names read red here and on the Google callback screen, which used to disagree (amber).
  const usernameHelper = (() => {
    if (username.length < 3) return { hint: 'At least 3 characters. Letters, numbers and dashes.' };
    if (checkingUsername) return { hint: 'Checking availability…' };
    if (usernameAvailability?.available) return { success: `${host}/${username} is available` };
    if (usernameAvailability && !usernameAvailability.available) {
      return { error: usernameAvailability.reason || 'That username is already taken' };
    }
    return { hint: `${host}/${username}` };
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

        <Button type="submit" size="touch" disabled={loading} className="mt-1 w-full">
          {loading ? (
            <>
              <Spinner />
              Creating your page…
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create my booking page
            </>
          )}
        </Button>
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
