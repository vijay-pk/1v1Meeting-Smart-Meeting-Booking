import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Crown, Lock, Mail, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

export const SuperAdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('mahir6787');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTimeout(() => {
      localStorage.setItem('bmm_current_user_role', 'super_admin');
      localStorage.setItem('bmm_logged_admin_id', 'admin-mahir');
      setLoading(false);
      navigate('/super-admin');
    }, 400);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white font-bold mx-auto shadow-xl shadow-indigo-500/25">
            <Crown className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            <span>Main Super Admin</span>
            <ShieldCheck className="w-5 h-5 text-indigo-400" />
          </h1>
          <p className="text-xs text-slate-400">
            Adways Academy Master Control Center & Owner Portal
          </p>
        </div>

        {/* Highlight badge */}
        <div className="bg-indigo-950/60 border border-indigo-800/60 rounded-2xl p-3.5 text-center text-xs text-indigo-200 flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span>Logged in as <strong>Mahir (Owner)</strong> with global price & admin controls</span>
        </div>

        {/* Login Card */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-2xl rounded-3xl overflow-hidden">
          <CardContent className="p-6 sm:p-8 space-y-5">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="super-admin-user" className="text-xs font-bold text-slate-300">
                  Username or Owner Email
                </Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <Input
                    id="super-admin-user"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white pl-10 h-11 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="super-admin-pass" className="text-xs font-bold text-slate-300">
                  Master Password
                </Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <Input
                    id="super-admin-pass"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white pl-10 h-11 rounded-xl text-sm"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:to-pink-700 text-white font-bold h-11 rounded-xl shadow-lg shadow-indigo-500/25 mt-2 cursor-pointer"
              >
                {loading ? 'Entering Master Command...' : 'Enter Super Admin Dashboard'}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Links */}
        <div className="flex items-center justify-between text-xs text-slate-400 px-2">
          <Link to="/" className="hover:text-slate-200 transition-colors">
            ← Public Booking Page
          </Link>
          <Link to="/admin/login" className="text-slate-400 hover:text-slate-300 transition-colors">
            Staff Admin Login →
          </Link>
        </div>

      </div>
    </div>
  );
};
