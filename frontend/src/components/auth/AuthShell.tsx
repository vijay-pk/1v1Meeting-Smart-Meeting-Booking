import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';

/**
 * The frame every auth screen sits in.
 *
 * Sign-up, sign-in and the Google callback each used to build their own page chrome, which is
 * how they ended up with three different card surfaces and four error treatments. They now
 * share this one.
 *
 * Light by design, and deliberately not wired to the admin dark-mode toggle: `/` and `/signup`
 * are the public front door, and a visitor who has never signed in should not get a dark
 * landing page because someone set that preference on this device.
 */
export function AuthShell({
  children,
  aside,
  title,
  subtitle,
  icon,
  footer,
  wide = false,
}: {
  children: ReactNode;
  /** Marketing column. Rendered after the form on mobile, beside it from lg up. */
  aside?: ReactNode;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  footer?: ReactNode;
  /** Set when an aside is present, to widen the container for the two-column layout. */
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-secondary font-sans text-text-primary">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className="press flex items-center gap-2.5 rounded-xl">
          <img
            src="/logo.png"
            alt="BookMyMeet Logo"
            className="h-9 w-9 object-contain rounded-xl shrink-0 shadow-xs"
          />
          <span className="text-base font-bold tracking-tight text-text-primary">
            {APP_NAME}
          </span>
        </Link>
        {footer}
      </header>

      <main
        className={cn(
          'mx-auto flex w-full min-w-0 flex-1 flex-col justify-center px-4 py-4 sm:px-6 sm:py-10',
          wide ? 'max-w-6xl' : 'max-w-md'
        )}
      >
        <div
          className={cn(
            aside && 'grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12'
          )}
        >
          {/* The form comes first in DOM order so it is the first thing on a phone. From lg
              up the aside is pulled to the left column, restoring the marketing-first
              reading order on a desktop. */}
          <div className={cn(aside && 'lg:col-span-5 lg:order-2')}>
            <div className="mb-5 text-center">
              {icon && <div className="mb-3 flex justify-center">{icon}</div>}
              <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">{title}</h1>
              {subtitle && (
                <p className="mt-1.5 text-sm text-text-secondary">{subtitle}</p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
              {children}
            </div>
          </div>

          {aside && <div className="lg:col-span-7 lg:order-1">{aside}</div>}
        </div>
      </main>

      <footer className="safe-b mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-text-tertiary sm:px-6">
        <p>
          © {new Date().getFullYear()} {APP_NAME}
        </p>
      </footer>
    </div>
  );
}
