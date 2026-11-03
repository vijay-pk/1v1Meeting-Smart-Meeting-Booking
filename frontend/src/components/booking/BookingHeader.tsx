import React from 'react';
import { APP_NAME } from '@/lib/constants';
import type { ThemeMode } from '@/lib/themes';
import { ShareButton } from './ShareButton';
import { ModeToggle } from './ModeToggle';

/**
 * Top bar of the public booking page: app logo and host name on the left; About, Sessions, Share and
 * the light/dark switch on the right. There is no Reviews link because the platform has no reviews to
 * show. On phones the section links fold away and Share + the switch stay within thumb reach.
 */
export const BookingHeader: React.FC<{
  hostName: string;
  username: string;
  mode: ThemeMode;
  onToggleMode: () => void;
  hasAbout: boolean;
  hasSessions: boolean;
}> = ({ hostName, username, mode, onToggleMode, hasAbout, hasSessions }) => {
  const link = 'bm-navlink rounded-full px-3 py-2 text-sm font-medium transition-colors';
  return (
    <header className="relative z-30">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/logo.png" alt={APP_NAME} className="h-8 w-8 shrink-0 rounded-lg bg-white/90 object-contain p-0.5" />
          <span className="truncate text-sm font-semibold bm-onbg">{hostName}</span>
        </div>
        <nav aria-label="Page sections" className="flex items-center gap-1 sm:gap-2">
          <div className="hidden items-center md:flex">
            {hasAbout && <a href="#about" className={link}>About</a>}
            {hasSessions && <a href="#sessions" className={link}>Sessions</a>}
          </div>
          <ShareButton username={username} hostName={hostName} />
          <ModeToggle mode={mode} onToggle={onToggleMode} />
        </nav>
      </div>
    </header>
  );
};
