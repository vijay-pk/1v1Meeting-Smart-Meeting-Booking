import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { api } from '@/lib/api';
import { GoogleAuthButton, AuthDivider } from '@/components/auth/GoogleAuthButton';
import {
  UserPlus,
  Mail,
  Lock,
  User,
  AtSign,
  Phone,
  AlertCircle,
  Check,
  ShieldCheck,
  Calendar,
  CreditCard,
  Sparkles,
  ArrowRight,
  Video,
  Globe,
  Eye,
  EyeOff
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 font-sans relative overflow-x-hidden flex flex-col justify-between">
      {/* Subtle background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-gradient-to-b from-orange-500/15 via-amber-500/10 to-transparent blur-3xl pointer-events-none rounded-full" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-600/10 blur-3xl pointer-events-none rounded-full" />

      {/* TOP NAVIGATION BAR */}
      <header className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 flex items-center justify-between relative z-20 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-600 via-amber-500 to-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-orange-500/25">
            A
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight text-white">BookMyMeet</span>
            <span className="ml-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
              Platform
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/admin/login"
            className="text-xs font-bold px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 border border-white/10"
          >
            <span>Sign In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* MAIN HERO & SIGNUP SECTION */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 relative z-10 my-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* Left Column: Product Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>SuperProfile-Style Personal Booking Platform</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
              Launch Your 1:1 Personal Booking Page in <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-rose-400 bg-clip-text text-transparent">60 Seconds</span>.
            </h1>

            <p className="text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
              Accept paid 1-to-1 appointments, eliminate scheduling emails, connect your Google Calendar, and collect payments directly via Razorpay.
            </p>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5 backdrop-blur-xs">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 text-orange-400 flex items-center justify-center font-bold">
                  <Globe className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-white">Personal URL</h2>
                <p className="text-xs text-slate-400">
                  Claim your link at <code className="text-orange-400 font-mono text-[11px]">{typeof window !== 'undefined' ? window.location.host : 'bookmymeet'}/:username</code> with custom themes, videos & bio.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5 backdrop-blur-xs">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                  <Calendar className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-white">Google Calendar & Meet</h2>
                <p className="text-xs text-slate-400">
                  Automatic busy-slot subtraction and direct Google Meet video links generated on confirmation.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5 backdrop-blur-xs">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                  <CreditCard className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-white">Direct Razorpay Setup</h2>
                <p className="text-xs text-slate-400">
                  Connect your own Razorpay keys with AES-256 encryption. Keep 100% of your earnings.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5 backdrop-blur-xs">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-white">Zero Double Booking</h2>
                <p className="text-xs text-slate-400">
                  Atomic 10-minute temporary slot reservation prevents concurrent booking collisions.
                </p>
              </div>
            </div>

          </div>

          {/* Right Column: Registration Form */}
          <div className="lg:col-span-5">
            <Card className="bg-slate-900/90 border-slate-800 shadow-2xl backdrop-blur-md">
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-bold text-white">Create Admin Account</CardTitle>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Free Instant Setup
                  </span>
                </div>
                <CardDescription className="text-slate-400 text-xs">
                  Enter your details to generate your personal booking portal
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="space-y-3 mb-5">
                  <GoogleAuthButton label="Sign up with Google" onError={setError} />
                  <AuthDivider text="or sign up with email" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-3.5">
                  {error && (
                    <div className="flex items-center gap-2 p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="signup-name" className="text-xs text-slate-300 font-medium">
                      Full Name
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="Enter your full name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-white pl-10 h-10 rounded-xl text-xs"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="signup-username" className="text-xs text-slate-300 font-medium">
                      Username & Personal URL
                    </Label>
                    <div className="relative">
                      <AtSign className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <Input
                        id="signup-username"
                        type="text"
                        placeholder="Enter unique username"
                        value={username}
                        onChange={(e) => handleUsernameChange(e.target.value)}
                        className={`bg-slate-950 text-white pl-10 h-10 rounded-xl text-xs transition-colors ${
                          usernameAvailability && !usernameAvailability.available
                            ? 'border-red-500 focus:border-red-500'
                            : usernameAvailability?.available
                            ? 'border-emerald-500 focus:border-emerald-500'
                            : 'border-slate-700'
                        }`}
                        required
                        minLength={3}
                        maxLength={30}
                      />
                    </div>
                    {username.length >= 3 && (
                      <div className="mt-1 text-[11px] font-mono">
                        {checkingUsername ? (
                          <p className="text-slate-400 flex items-center gap-1">
                            <span className="w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                            <span>Checking username availability...</span>
                          </p>
                        ) : usernameAvailability?.available ? (
                          <p className="text-emerald-400 flex items-center gap-1 font-semibold">
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{window.location.host}/{username} (Available)</span>
                          </p>
                        ) : usernameAvailability && !usernameAvailability.available ? (
                          <p className="text-red-400 flex items-center gap-1 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                            <span>{usernameAvailability.reason || 'Username is already taken'}</span>
                          </p>
                        ) : (
                          <p className="text-slate-400">
                            {window.location.host}/{username}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="signup-email" className="text-xs text-slate-300 font-medium">
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="Enter Gmail or email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-white pl-10 h-10 rounded-xl text-xs"
                        required
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="signup-phone" className="text-xs text-slate-300 font-medium">
                      Phone Number (Optional)
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <Input
                        id="signup-phone"
                        type="tel"
                        placeholder="Enter phone number (optional)"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-white pl-10 h-10 rounded-xl text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="signup-password" className="text-xs text-slate-300 font-medium">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-white pl-10 pr-10 h-10 rounded-xl text-xs"
                        required
                        minLength={6}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition cursor-pointer p-0.5 rounded"
                        title={showPassword ? "Hide password" : "View password"}
                        aria-label={showPassword ? "Hide password" : "View password"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-slate-400" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">Minimum 6 characters</p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-orange-600 via-amber-600 to-indigo-600 hover:from-orange-700 hover:to-indigo-700 text-white font-bold h-11 rounded-xl shadow-lg shadow-orange-500/20 mt-2 cursor-pointer transition-all"
                    disabled={loading}
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 mr-1.5" />
                        <span>Launch My Booking Platform</span>
                      </>
                    )}
                  </Button>
                </form>

                <div className="mt-4 pt-3 border-t border-slate-800 text-center">
                  <p className="text-xs text-slate-400">
                    Already registered?{' '}
                    <Link
                      to="/admin/login"
                      className="text-orange-400 hover:underline font-bold"
                    >
                      Sign In
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 border-t border-white/10 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 relative z-20">
        <p>© 2026 BookMyMeet. Multi-Admin 1:1 Mentorship Platform.</p>
        <div className="flex items-center gap-4">
          <Link to="/admin/login" className="hover:text-slate-300 transition">
            Admin Portal
          </Link>
        </div>
      </footer>
    </div>
  );
}
