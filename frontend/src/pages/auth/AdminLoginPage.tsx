import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Lock, Mail, ArrowRight, UserPlus } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField, PasswordToggle } from '@/components/auth/AuthField';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Spinner } from '@/components/common/Skeleton';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';
import { GoogleAuthButton, AuthDivider } from '@/components/auth/GoogleAuthButton';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { admins, currentSuperAdmin } = useBookingStore();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const cleanId = identifier.trim().toLowerCase();
    const cleanPass = password.trim();

    // 1. Try Live FastAPI Backend
    try {
      const data = await api.login(cleanId, cleanPass);

      // Immediately fetch full profile and register into store
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
            theme_settings: bp.theme_settings || {
              theme: 'amber',
              bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]',
              button_color: '#D32F2F',
            },
            social_links: bp.social_links || {},
          };

          // Merge onto the existing record instead of replacing it: this payload carries no
          // google_connected / google_email, and a wholesale replace is what used to make a
          // connected Google Calendar look disconnected after a profile sync or re-login.
          useBookingStore.setState((state) => {
            const previous = state.admins.find(
              (a) => a.id === synced.id || a.username.toLowerCase() === synced.username.toLowerCase()
            );
            const merged = { ...previous, ...synced } as any;
            return {
              admins: [
                merged,
                ...state.admins.filter(
                  (a) => a.id !== synced.id && a.username.toLowerCase() !== synced.username.toLowerCase()
                ),
              ],
              // Populate currentSuperAdmin so the /super-admin dashboard renders correctly
              ...(synced.role === 'super_admin' ? { currentSuperAdmin: merged } : {}),
            };
          });
        }
      } catch (e) {}

      setLoading(false);
      if (data.role === 'super_admin') {
        navigate('/super-admin');
      } else {
        navigate('/admin');
      }
      return;
    } catch (apiErr: any) {
      if (apiErr.message && apiErr.message.includes('disabled')) {
        setError(apiErr.message);
        setLoading(false);
        return;
      }
      // Any other failure (network, server down) is reported as-is below: signing
      // somebody in against browser-held data is not an acceptable fallback.
      setError(apiErr?.message || 'Could not reach the sign-in service. Please try again.');
      setLoading(false);
      return;
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="One login for admins and the platform owner."
      icon={
        <img
          src="/logo.png"
          alt="BookMyMeet Logo"
          className="h-12 w-12 object-contain rounded-2xl shadow-sm"
        />
      }
      footer={
        <Link
          to="/signup"
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-tertiary"
        >
          <span>Create account</span>
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="space-y-3">
        <GoogleAuthButton label="Continue with Google" onError={setError} />
        <AuthDivider text="or sign in with password" />
      </div>

      <form onSubmit={handleLogin} className="mt-4 space-y-4">
        {error && <ErrorNote message={error} />}

        <AuthField
          id="login-id"
          label="Email or username"
          type="text"
          required
          autoComplete="username"
          icon={Mail}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@example.com"
        />

        <AuthField
          id="login-pass"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          required
          autoComplete="current-password"
          icon={Lock}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          labelAction={
            <span className="text-[11px] text-text-tertiary">Contact your admin to reset</span>
          }
          trailing={
            <PasswordToggle
              visible={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
            />
          }
        />

        <Button type="submit" size="touch" disabled={loading} className="w-full">
          {loading ? (
            <>
              <Spinner />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-5 border-t border-border pt-4 text-center">
        <p className="text-xs text-text-secondary">
          Want to take bookings of your own?{' '}
          <Link to="/signup" className="font-semibold text-primary-600 hover:underline">
            Create an admin account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};
