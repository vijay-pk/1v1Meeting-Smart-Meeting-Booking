import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OnboardingStatus } from '@/lib/api';

/**
 * The signed-in admin's setup status, read fresh from the server on every mount.
 *
 * No cache and no store on purpose: the page that shows it remounts after the admin saves
 * a step elsewhere, so a fresh read is what makes the checklist current after a save, a
 * refresh, a re-login or a different device. It is also re-read when the tab regains focus,
 * for an admin who connected Razorpay in another tab.
 */
export function useOnboardingStatus() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const call = ++latest.current;
    setLoading(true);
    try {
      const next = await api.getOnboardingStatus();
      if (call !== latest.current) return;
      setStatus(next);
      setError('');
    } catch (err: any) {
      if (call !== latest.current) return;
      // Keep the last known status; a failed read is reported, never shown as "0 of 4".
      setError(err?.message || 'Could not load your setup status.');
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      latest.current++;
    };
  }, [refresh]);

  return { status, error, loading, refresh };
}
