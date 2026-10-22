import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

/**
 * First-login student meeting policy. Acceptance is recorded server-side (version + timestamp),
 * so this is a presentation of a backend-enforced gate, not the gate itself. Shown again when
 * the Super Admin publishes a new policy version.
 */
export const StudentTermsDialog: React.FC<{ onAccepted: () => void; onDecline: () => void }> = ({ onAccepted, onDecline }) => {
  const [policy, setPolicy] = useState<{ version: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.studentPolicy().then(setPolicy).catch(() => setError('Could not load the policy.'));
  }, []);

  const accept = async () => {
    if (!policy) return;
    setBusy(true);
    setError(null);
    try {
      await api.studentAcceptPolicy(policy.version);
      onAccepted();
    } catch (err: any) {
      setError(err?.message || 'Could not record acceptance.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-bold text-text-primary">Student Meeting Policy</h2>
        <p className="mt-1 text-xs text-text-tertiary">Please read these rules before booking your sessions.</p>
        <div className="mt-4 max-h-72 overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-surface-secondary p-4 text-sm text-text-secondary">
          {policy ? policy.text : <Loader2 className="w-5 h-5 animate-spin text-primary-600" />}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onDecline} disabled={busy}>Sign Out</Button>
          <Button onClick={accept} disabled={busy || !policy} className="bg-primary-600 hover:bg-primary-700 text-white">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : 'I Agree and Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};
