import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Check, KeyRound, UserCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Skeleton, Spinner } from '@/components/common/Skeleton';
import { useAdminTheme } from '@/hooks/useAdminTheme';
import { api, type ReminderSettings, type SuperAdminAccount } from '@/lib/api';
import { authGet } from '@/lib/authStorage';
import { USERNAME_PATTERN, USERNAME_RULE_TEXT } from '@/lib/username';

const LEAD_LABELS: Record<number, string> = {
  5: '5 minutes',
  10: '10 minutes',
  15: '15 minutes',
  30: '30 minutes',
  60: '1 hour',
  120: '2 hours',
  1440: '1 day',
};

function Saved({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
      <Check className="h-4 w-4" aria-hidden="true" />
      {text}
    </p>
  );
}

/**
 * The Super Admin's own account details and the platform settings only they control.
 *
 * Everything is loaded from and saved to the API; nothing here is kept in browser storage.
 * The server enforces the role on every call -- the redirect below only spares an admin a
 * screen of errors.
 */
export function SuperAdminSettingsPage() {
  useAdminTheme();
  const navigate = useNavigate();
  const [account, setAccount] = useState<SuperAdminAccount | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!authGet('bmm_auth_token')) {
      navigate('/admin/login', { replace: true });
      return;
    }
    api.superAdminGetAccount().then(setAccount).catch((err: any) => {
      if (err?.status === 401 || err?.status === 403) {
        navigate(err.status === 403 ? '/admin' : '/admin/login', { replace: true });
        return;
      }
      setLoadError(err?.message || 'Could not load your account.');
    });
  }, [navigate]);

  return (
    <div className="admin-shell min-h-dvh bg-surface-secondary font-sans text-text-secondary">
      <header className="sticky top-0 z-30 bg-[#0B1E3B] text-white shadow-md">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center gap-3 px-4 py-2 sm:px-6">
          <Link
            to="/super-admin"
            className="press inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Console
          </Link>
          <h1 className="min-w-0 truncate text-base font-bold">Account & Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {loadError && <ErrorNote message={loadError} onRetry={() => window.location.reload()} />}
        {!account && !loadError ? (
          <div className="space-y-4" role="status" aria-label="Loading">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        ) : account ? (
          <>
            <AccountCard account={account} onSaved={setAccount} />
            <PasswordCard />
          </>
        ) : null}
      </main>
    </div>
  );
}

function AccountCard({ account, onSaved }: { account: SuperAdminAccount; onSaved: (a: SuperAdminAccount) => void }) {
  const [name, setName] = useState(account.name);
  const [username, setUsername] = useState(account.username || '');
  const [email, setEmail] = useState(account.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();
  const identityChanges = cleanUsername !== (account.username || '') || cleanEmail !== account.email.toLowerCase();
  const dirty = identityChanges || name.trim() !== account.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (!name.trim()) return setError('Full name is required.');
    if (cleanUsername !== (account.username || '') && !USERNAME_PATTERN.test(cleanUsername)) return setError(USERNAME_RULE_TEXT);
    if (identityChanges && !currentPassword) return setError('Enter your current password to change your username or email.');

    setSaving(true);
    try {
      const next = await api.superAdminUpdateAccount({
        name: name.trim(),
        ...(cleanUsername !== (account.username || '') ? { username: cleanUsername } : {}),
        ...(cleanEmail !== account.email.toLowerCase() ? { email: cleanEmail } : {}),
        ...(identityChanges ? { current_password: currentPassword } : {}),
      });
      onSaved(next);
      setName(next.name);
      setUsername(next.username || '');
      setEmail(next.email);
      setCurrentPassword('');
      setSaved('Account details saved.');
    } catch (err: any) {
      setError(err?.message || 'Could not save your account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="h-5 w-5 text-text-secondary" aria-hidden="true" />
          Account details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <ErrorNote message={error} />}
          <div className="space-y-1.5">
            <Label htmlFor="sa-name">Full name</Label>
            <Input id="sa-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-username">Username</Label>
            <Input
              id="sa-username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="h-11"
              aria-describedby="sa-username-hint"
            />
            <p id="sa-username-hint" className="text-xs text-text-tertiary">
              Also your sign-in name and your booking link (/{cleanUsername || 'username'}). Changing it changes that link.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-email">Email address</Label>
            <Input id="sa-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          {identityChanges && (
            <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <Label htmlFor="sa-confirm-password">Current password</Label>
              <Input
                id="sa-confirm-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-11"
              />
              <p className="text-xs text-text-tertiary">Required to change your username or email.</p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Saved text={saved} />
            <Button type="submit" size="touch" disabled={saving || !dirty} className="w-full sm:ml-auto sm:w-auto">
              {saving ? <Spinner /> : 'Save account details'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (!current) return setError('Enter your current password.');
    if (next.length < 8) return setError('Use at least 8 characters for the new password.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setSaving(true);
    try {
      const res = await api.superAdminChangePassword({ current_password: current, new_password: next, confirm_password: confirm });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSaved(res.message || 'Password changed.');
    } catch (err: any) {
      setError(err?.message || 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-5 w-5 text-text-secondary" aria-hidden="true" />
          Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <ErrorNote message={error} />}
          <div className="space-y-1.5">
            <Label htmlFor="sa-current">Current password</Label>
            <Input id="sa-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sa-new">New password</Label>
              <Input id="sa-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-11" />
              <p className="text-xs text-text-tertiary">At least 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-confirm">Confirm new password</Label>
              <Input id="sa-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
            </div>
          </div>
          <p className="text-xs text-text-tertiary">Changing your password signs out every other device.</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Saved text={saved} />
            <Button type="submit" size="touch" disabled={saving} className="w-full sm:ml-auto sm:w-auto">
              {saving ? <Spinner /> : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// Exported so the Super Admin's Email & Notifications tab (in the shared SettingsPage) can
// render the same control. It stays here with its helpers; Account & Settings no longer
// renders it, so there is exactly one copy.
export function ReminderCard() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [lead, setLead] = useState(5);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .superAdminGetReminderSettings()
      .then((s) => {
        setSettings(s);
        setEnabled(s.enabled);
        setLead(s.lead_minutes);
      })
      .catch((err: any) => setError(err?.message || 'Could not load reminder settings.'));
  }, []);

  const save = async () => {
    setError('');
    setSaved('');
    setSaving(true);
    try {
      const s = await api.superAdminUpdateReminderSettings({ enabled, lead_minutes: lead });
      setSettings(s);
      setSaved('Reminder settings saved. They apply to bookings confirmed from now on.');
    } catch (err: any) {
      setError(err?.message || 'Could not save reminder settings.');
    } finally {
      setSaving(false);
    }
  };

  const choices = settings?.choices?.length ? settings.choices : Object.keys(LEAD_LABELS).map(Number);
  const dirty = !!settings && (settings.enabled !== enabled || settings.lead_minutes !== lead);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-5 w-5 text-text-secondary" aria-hidden="true" />
          Meeting reminder
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}
        {!settings && !error ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : settings ? (
          <>
            <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border p-3">
              <Label htmlFor="sa-reminders-enabled" className="text-sm font-medium text-text-primary">
                Enable meeting reminders
              </Label>
              <Switch id="sa-reminders-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-reminder-lead">Remind the host</Label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="sa-reminder-lead"
                  value={lead}
                  disabled={!enabled}
                  onChange={(e) => setLead(Number(e.target.value))}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base text-text-primary sm:max-w-xs sm:text-sm"
                >
                  {choices.map((m) => (
                    <option key={m} value={m}>
                      {LEAD_LABELS[m] || `${m} minutes`}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-text-secondary">before the meeting</span>
              </div>
              <p className="text-xs text-text-tertiary">
                Sent to the admin who owns the booking, in the app and by email, with the client, meeting type,
                time and Google Meet link. Reminders already scheduled keep their time.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Saved text={saved} />
              <Button type="button" size="touch" onClick={save} disabled={saving || !dirty} className="w-full sm:ml-auto sm:w-auto">
                {saving ? <Spinner /> : 'Save reminder settings'}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
