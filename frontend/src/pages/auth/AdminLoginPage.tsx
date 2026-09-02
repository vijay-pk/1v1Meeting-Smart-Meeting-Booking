import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Lock, Mail, ArrowRight, AlertCircle, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';

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

          useBookingStore.setState((state) => ({
            admins: [
              synced,
              ...state.admins.filter(
                (a) => a.id !== synced.id && a.username.toLowerCase() !== synced.username.toLowerCase()
              ),
            ],
          }));
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
      // If unauthorized or network error, fallback to local store validation
    }

    // 2. Client-side Store Validation (Fallback)
    setTimeout(() => {
      // Check Super Admin
      const isSuperAdminMatch =
        (cleanId === currentSuperAdmin.username.toLowerCase() ||
          cleanId === currentSuperAdmin.email.toLowerCase()) &&
        (cleanPass === (currentSuperAdmin.password || 'admin123'));

      if (isSuperAdminMatch) {
        localStorage.setItem('bmm_current_user_role', 'super_admin');
        localStorage.setItem('bmm_logged_admin_id', currentSuperAdmin.id);
        setLoading(false);
        navigate('/super-admin');
        return;
      }

      // Check Staff Admins
      const matchedAdmin = admins.find(
        (a) =>
          (a.email.toLowerCase() === cleanId || a.username.toLowerCase() === cleanId) &&
          (a.password || `${a.username}@123` || 'password123') === cleanPass
      );

      if (matchedAdmin) {
        if (matchedAdmin.status === 'TEMPORARILY_DISABLED') {
          setError('Your admin account has been temporarily disabled by the Super Admin.');
          setLoading(false);
          return;
        }

        if (matchedAdmin.status === 'PERMANENTLY_DELETED') {
          setError('This admin account has been permanently removed.');
          setLoading(false);
          return;
        }

        localStorage.setItem('bmm_current_user_role', matchedAdmin.role);
        localStorage.setItem('bmm_logged_admin_id', matchedAdmin.id);
        setLoading(false);
        if (matchedAdmin.role === 'super_admin') {
          navigate('/super-admin');
        } else {
          navigate('/admin');
        }
        return;
      }

      setError('Invalid username/email or password. Please try again.');
      setLoading(false);
    }, 200);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100 font-sans">
      <div className="w-full max-w-md space-y-6">
        
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-600 via-amber-500 to-indigo-600 flex items-center justify-center text-white font-bold mx-auto shadow-xl shadow-orange-500/25 text-2xl">
            A
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>Admin Portal</span>
            <ShieldCheck className="w-6 h-6 text-blue-400" />
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Single Unified Login • Auto-detects Super Admin vs Admin
          </p>
        </div>

        {/* Login Card */}
        <Card className="bg-slate-900/90 border-slate-800 shadow-2xl backdrop-blur-md">
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="login-id" className="text-xs text-slate-300 font-semibold">
                  Gmail or Username
                </Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <Input
                    id="login-id"
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Enter Gmail or username"
                    className="bg-slate-950 border-slate-700 text-white pl-10 h-11 rounded-xl text-sm placeholder:text-slate-500 focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-pass" className="text-xs text-slate-300 font-semibold">
                    Password
                  </Label>
                  <span className="text-[11px] text-slate-500 hover:text-slate-400 cursor-pointer">
                    Forgot Password?
                  </span>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <Input
                    id="login-pass"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white pl-10 pr-10 h-11 rounded-xl text-sm focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                    title={showPassword ? "Hide password" : "View password"}
                    aria-label={showPassword ? "Hide password" : "View password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-orange-600 via-amber-600 to-indigo-600 hover:from-orange-700 hover:to-indigo-700 text-white font-bold h-11 rounded-xl shadow-lg shadow-orange-500/20 mt-2 cursor-pointer transition-all"
              >
                {loading ? 'Authenticating...' : 'Sign In to Portal'}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </form>

            <div className="mt-5 pt-4 border-t border-slate-800 text-center">
              <p className="text-xs text-slate-400">
                Want to become a mentor?{' '}
                <Link to="/signup" className="text-orange-400 font-bold hover:underline inline-flex items-center gap-1">
                  <span>Register as Admin</span>
                  <UserPlus className="w-3.5 h-3.5" />
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Back Link */}
        <div className="text-center text-xs text-slate-400">
          <Link to="/" className="hover:text-slate-200 transition-colors inline-flex items-center gap-1">
            ← Back to Public Booking Page
          </Link>
        </div>

      </div>
    </div>
  );
};
