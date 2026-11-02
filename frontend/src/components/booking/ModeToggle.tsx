import React from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '@/lib/themes';

/** Light/dark switch for the public booking page only. */
export const ModeToggle: React.FC<{ mode: ThemeMode; onToggle: () => void }> = ({ mode, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    aria-pressed={mode === 'dark'}
    className="bm-ghost inline-flex h-11 w-11 items-center justify-center rounded-full transition"
  >
    {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
  </button>
);
