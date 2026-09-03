import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Calendar,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Settings,
  Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { useAuthStore } from '@/stores/authStore';
import { NAV_ITEMS } from './Sidebar';
import type { ThemePreference } from '@/hooks/useAdminTheme';

/**
 * Bottom navigation for phones and small tablets.
 *
 * The admin app has eight destinations, which is too many for a tab bar — so the four most
 * frequently used sit in the bar, within thumb reach, and the rest live one tap away in a
 * "More" sheet. The bar is hidden from `lg` up, where the sidebar returns.
 *
 * Destinations come from the sidebar's own NAV_ITEMS so the two navigations can never drift
 * apart.
 */

const PRIMARY_TABS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/admin/bookings', icon: CalendarDays, label: 'Bookings' },
  { to: '/admin/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
];

const PRIMARY_PATHS = new Set(PRIMARY_TABS.map((tab) => tab.to));

export function MobileTabBar({
  themePreference,
  onThemeChange,
  isSuperAdmin,
}: {
  themePreference: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
  isSuperAdmin?: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuthStore();

  // Everything not already in the bar goes in the sheet, so no destination is unreachable.
  const overflowItems = NAV_ITEMS.filter((item) => !PRIMARY_PATHS.has(item.to));
  const moreIsActive = overflowItems.some((item) => location.pathname === item.to);

  const go = (to: string) => {
    setMoreOpen(false);
    navigate(to);
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="safe-b-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
          {PRIMARY_TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'press flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] transition-colors',
                    isActive
                      ? 'font-semibold text-primary-600'
                      : 'font-medium text-text-tertiary hover:text-text-secondary'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <tab.icon
                      className={cn('h-5 w-5 shrink-0', isActive && 'stroke-[2.4]')}
                      aria-hidden="true"
                    />
                    <span className="leading-none">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                'press flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] transition-colors',
                moreIsActive
                  ? 'font-semibold text-primary-600'
                  : 'font-medium text-text-tertiary hover:text-text-secondary'
              )}
            >
              <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent title="Menu">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => go('/super-admin')}
              className="press mb-2 flex w-full items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-left text-sm font-semibold text-text-primary"
            >
              <Crown className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              Master Console
            </button>
          )}

          <ul className="space-y-1">
            {overflowItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => go(item.to)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'press flex min-h-[52px] w-full items-center gap-3 rounded-xl px-4 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-primary-50 font-semibold text-primary-700'
                        : 'font-medium text-text-secondary hover:bg-surface-tertiary'
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Appearance
              </p>
              <ThemeToggle
                value={themePreference}
                onChange={onThemeChange}
                showLabels
                className="w-full"
              />
            </div>

            <button
              type="button"
              onClick={async () => {
                setMoreOpen(false);
                await signOut();
              }}
              className="press flex min-h-[48px] w-full items-center gap-3 rounded-xl px-4 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-error-bg"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
