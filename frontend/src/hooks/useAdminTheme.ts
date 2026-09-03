import { useCallback, useEffect, useState } from 'react';

/**
 * Theme control for the admin application.
 *
 * The dark palette lives on `<html data-theme="dark">`, and this hook is the only thing that
 * puts it there. It is mounted by the admin shell, the super-admin console and the auth
 * pages — never by a public route — and it **removes the attribute on unmount**.
 *
 * That unmount is the whole design. The design tokens in index.css are global, four public
 * booking pages read them directly, and the shared ui/ components are used by seven of the
 * eight public pages. A wrapper `<div class="dark">` would also miss Radix portals, which
 * render into document.body outside the React tree. Tying the attribute to the lifetime of an
 * admin route means a client viewing an admin's public page always gets that admin's
 * configured public theme, even in the same browser where the admin picked dark mode.
 *
 * The preference is per-device and lives in localStorage; nothing about it is sent to the
 * backend or stored against the account.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bmm_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode or blocked storage: fall through to the system default.
  }
  return 'system';
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

function resolve(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light';
  return preference;
}

function apply(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function useAdminTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readThemePreference()));

  // Apply while mounted, and clean up on the way out so no public page inherits it.
  useEffect(() => {
    const next = resolve(preference);
    setResolved(next);
    apply(next);
    return () => apply('light');
  }, [preference]);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (preference !== 'system') return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = () => {
      const next = prefersDark() ? 'dark' : 'light';
      setResolved(next);
      apply(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply does not persist if storage is unavailable; the UI still switches.
    }
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
