import { Bell, Search, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { useBookingStore } from '@/stores/bookingStore';
import { TEST_MODE, APP_NAME } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';
import type { Notification } from '@/types';
import { supabase } from '@/lib/supabase';
import { formatRelativeTime } from '@/lib/format';

export function TopBar() {
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

  useEffect(() => {
    if (!profile?.id) return;

    // Fetch initial notifications
    const fetchNotifications = async () => {
      try {
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .eq('admin_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (data) setNotifications(data as Notification[]);
      } catch (e) {}
    };

    fetchNotifications();

    let channel: any = null;
    try {
      channel = supabase
        .channel('admin-notifications')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `admin_id=eq.${profile.id}`,
          },
          (payload) => {
            setNotifications((prev) => [payload.new as Notification, ...prev]);
          }
        )
        .subscribe();
    } catch (e) {}

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const markAsRead = async (notificationId: string) => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
    );
  };

  const markAllAsRead = async () => {
    if (!profile?.id) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('admin_id', profile.id)
      .eq('is_read', false);

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <>
      {TEST_MODE && (
        <div className="test-mode-banner">
          ⚠️ TEST MODE — Payments are in sandbox. Do not use real payment methods.
        </div>
      )}
      <header className="h-16 border-b border-border bg-white flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <Input
              placeholder="Search bookings, customers..."
              className="pl-9 w-72 h-9 bg-surface-secondary border-transparent focus:border-border-strong"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {displayUsername && (
            <a
              href={`/${displayUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50/50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>View My Booking Page (/{displayUsername})</span>
            </a>
          )}

          {/* Notification Bell */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative"
              aria-label="Notifications"
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
                <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-border rounded-xl shadow-dropdown z-50 animate-fade-in">
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
