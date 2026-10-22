import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { authSet } from '@/lib/authStorage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { Loader2, ShieldCheck } from 'lucide-react';

/**
 * Forced first-login password change for students created with the shared temporary password.
 * The backend enforces must_change_password regardless; this is the screen that resolves it.
 */
export const StudentChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setSaving(true);
    try {
      const data = await api.changePassword(current, next);
      // Store the rotated token so the student stays signed in.
      authSet('bmm_auth_token', data.access_token);
      authSet('bmm_current_user_role', data.role);
      authSet('bmm_logged_role', data.role);
      authSet('bmm_logged_admin_id', data.user_id);
      navigate('/student');
    } catch (err: any) {
      setError(err?.message || 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell title="Set your password" subtitle="Choose a new password to finish signing in.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="cur">Temporary password</Label>
          <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new">New password</Label>
          <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="conf">Confirm new password</Label>
          <Input id="conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={saving} className="w-full bg-primary-600 hover:bg-primary-700 text-white">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : 'Set password and continue'}
        </Button>
        <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Your password is stored securely and never shared.
        </p>
      </form>
    </AuthShell>
  );
};
