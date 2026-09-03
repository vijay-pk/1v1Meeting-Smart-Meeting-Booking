import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Crown, Lock, Mail, ArrowRight } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField, PasswordToggle } from '@/components/auth/AuthField';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Spinner } from '@/components/common/Skeleton';
import { api } from '@/lib/api';
import { useBookingStore } from '@/stores/bookingStore';

export const SuperAdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  /**
   * Real authentication against the backend.
   *
   * This form previously accepted anything: it waited 400 ms, wrote
   * bmm_current_user_role = 'super_admin' into localStorage and navigated to the
   * dashboard, with the owner's credentials pre-filled in the inputs. Anyone who opened
   * the page had super-admin access. Now the password is verified server-side and the
   * role comes from the issued token's account, not from the browser.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(username.trim(), password);

      if (data.role !== 'super_admin') {
        // api.login has already stored a token; drop it rather than leaving a
        // half-authenticated session behind on the super-admin route.
        localStorage.removeItem('bmm_auth_token');
        localStorage.removeItem('bmm_current_user_role');
        setError('This account is not a Super Admin.');
        setLoading(false);
        return;
      }

      localStorage.setItem('bmm_logged_admin_id', data.user_id);
      localStorage.setItem('bmm_logged_username', data.username || '');
      localStorage.setItem('bmm_logged_admin_name', data.name || '');
      localStorage.setItem('bmm_logged_role', 'super_admin');

      useBookingStore.setState((state) => ({
        currentSuperAdmin: {
          ...state.currentSuperAdmin,
          id: data.user_id,
          username: data.username || '',
          full_name: data.name || '',
          email: username.includes('@') ? username.trim().toLowerCase() : state.currentSuperAdmin.email,
          role: 'super_admin',
          status: 'ACTIVE',
          avatar_letter: (data.name || '?').charAt(0).toUpperCase(),
        },
      }));

      navigate('/super-admin');
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Platform owner"
      subtitle="Sign in to the master console."
      icon={
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <Crown className="h-6 w-6" aria-hidden="true" />
        </span>
      }
    >
      <form onSubmit={handleLogin} className="space-y-4">
        {error && <ErrorNote message={error} />}

        <AuthField
          id="super-admin-user"
          label="Username or owner email"
          type="text"
          required
          autoComplete="username"
          icon={Mail}
          placeholder="you@example.com"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <AuthField
          id="super-admin-pass"
          label="Master password"
          type={showPassword ? 'text' : 'password'}
          required
          autoComplete="current-password"
          icon={Lock}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
              Enter master console
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs">
        <Link to="/" className="text-text-tertiary transition hover:text-text-secondary">
          ← Back to sign up
        </Link>
        <Link to="/admin/login" className="font-semibold text-primary-600 hover:underline">
          Admin sign in →
        </Link>
      </div>
    </AuthShell>
  );
};
