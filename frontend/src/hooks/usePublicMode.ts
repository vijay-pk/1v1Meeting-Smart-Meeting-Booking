import { useCallback, useEffect, useState } from 'react';
import type { ThemeMode } from '@/lib/themes';

const KEY = 'bmm_public_mode';

function read(): ThemeMode | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The visitor's light/dark choice for the public booking page. It lives in this page's own wrapper
 * (see lib/themes.ts) and in its own storage key: it never touches <html data-theme>, which belongs to
 * the admin dashboard, and it is a per-visitor convenience that works without storage (private mode).
 * Until the visitor chooses, the page uses the host's theme in its native mode.
 */
export function usePublicMode(native: ThemeMode): { mode: ThemeMode; toggle: () => void } {
  const [stored, setStored] = useState<ThemeMode | null>(() => (typeof window === 'undefined' ? null : read()));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setStored(read()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const mode = stored ?? native;
  const toggle = useCallback(() => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setStored(next);
    try { window.localStorage.setItem(KEY, next); } catch { /* storage unavailable: the choice lasts for this view only */ }
  }, [mode]);

  return { mode, toggle };
}
