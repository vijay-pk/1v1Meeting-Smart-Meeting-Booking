import { Bell, Search, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import type { ThemePreference } from '@/hooks/useAdminTheme';
import { useAuthStore } from '@/stores/authStore';
import { useBookingStore } from '@/stores/bookingStore';
import { TEST_MODE, APP_NAME } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';
import type { Notification } from '@/types';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

export function TopBar({
  themePreference,
  onThemeChange,
}: {
  themePreference: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}) {
  const { profile } = useAuthStore();
  const { admins } = useBookingStore();
  const loggedAdminId = localStorage.getItem('bmm_logged_admin_id');
  const loggedUsername = localStorage.getItem('bmm_logged_username');
  const matchedAdmin = admins.find(
    (a) =>
      (loggedAdminId && a.id === loggedAdminId) ||
      (loggedUsername && a.username.toLowerCase() === loggedUsername.toLowerCase()) ||
      (profile?.username && a.username.toLowerCase() === profile.username.toLowerCase())
  );
  const displayUsername = profile?.username || loggedUsername || matchedAdmin?.username;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Notifications come from the FastAPI notifications table -- where new-booking, calendar
  // and meeting-reminder notices are written. This used to read a Supabase table the backend
  // never writes to, keyed on an auth-store id nothing populates, so the bell was always empty.
  // Polled rather than pushed: the backend has no socket, and a minute is fine for a reminder
  // that is scheduled minutes ahead.
  useEffect(() => {
    if (!localStorage.getItem('bmm_auth_token')) return;
    let cancelled = false;
    const load = () =>
      api
        .getNotifications()
        .then((rows) => {
          if (!cancelled) setNotifications(rows as unknown as Notification[]);
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
    );
    await api.markNotificationRead(notificationId).catch(() => {});
  };

  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await api.markAllNotificationsRead().catch(() => {});
  };

  return (
    <>
      {TEST_MODE && (
        <div className="test-mode-banner">
          ⚠️ TEST MODE — Payments are in sandbox. Do not use real payment methods.
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* The sidebar carries the brand from lg up; below that it is hidden, so the
              top bar shows it instead and the app never looks unbranded on a phone. */}
          <div className="flex items-center gap-2 lg:hidden">
            <img
              src="/logo.png"
              alt="BookMyMeet Logo"
              className="h-8 w-8 object-contain rounded-lg shrink-0 shadow-xs"
            />
            <span className="truncate text-base font-bold tracking-tight text-text-primary">
              {APP_NAME}
            </span>
          </div>

          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <Input
              placeholder="Search bookings, customers..."
              className="pl-9 w-64 xl:w-72 h-9 bg-surface-secondary border-transparent focus:border-border-strong"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle
            value={themePreference}
            onChange={onThemeChange}
            className="hidden sm:inline-flex"
          />

          {displayUsername && (
            <a
              href={`/${displayUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`View my booking page (/${displayUsername})`}
              className="press hidden h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-text-secondary transition-colors hover:border-primary-200 hover:bg-primary-50/60 hover:text-primary-700 sm:inline-flex"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">View booking page</span>
              <span className="lg:hidden">Booking page</span>
            </a>
          )}

          {/* Notification Bell */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-expanded={showNotifications}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse-soft">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            {showNotifications && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowNotifications(false)}
                />
                <div className="animate-fade-in fixed inset-x-3 top-[4.5rem] z-50 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface-elevated shadow-dropdown sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-96 sm:w-80 sm:rounded-xl">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="font-semibold text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-sm text-text-tertiary">
                      No notifications yet
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {notifications.slice(0, 10).map((notification) => (
                        <button
                          key={notification.id}
                          onClick={() => markAsRead(notification.id)}
                          className={`w-full text-left p-4 hover:bg-surface-secondary transition-colors cursor-pointer ${
                            !notification.is_read ? 'bg-primary-50/50' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {!notification.is_read && (
                              <div className="w-2 h-2 rounded-full bg-primary-500 mt-1.5 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-text-primary truncate">
                                {notification.title}
                              </p>
                              <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                                {notification.message}
                              </p>
                              <p className="text-xs text-text-tertiary mt-1">
                                {formatRelativeTime(notification.created_at)}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
