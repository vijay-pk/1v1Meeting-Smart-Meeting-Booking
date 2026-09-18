import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  CalendarDays,
  Users,
  CreditCard,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useState } from 'react';

export const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/bookings', icon: CalendarDays, label: 'Bookings' },
  { to: '/admin/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/admin/customers', icon: Users, label: 'Customers' },
  { to: '/admin/payments', icon: CreditCard, label: 'Payments' },
];

export const SETTINGS_ITEMS = [
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
];

import { useBookingStore } from '@/stores/bookingStore';

export function Sidebar() {
  const { profile, signOut } = useAuthStore();
  const { admins } = useBookingStore();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const loggedAdminId = localStorage.getItem('bmm_logged_admin_id');
  const loggedUsername = localStorage.getItem('bmm_logged_username');
  const matchedAdmin = admins.find(
    (a) =>
      (loggedAdminId && a.id === loggedAdminId) ||
      (loggedUsername && a.username.toLowerCase() === loggedUsername.toLowerCase()) ||
      (profile?.username && a.username.toLowerCase() === profile.username.toLowerCase())
  );

  const isSuperAdmin =
    profile?.role === 'super_admin' ||
    localStorage.getItem('bmm_logged_role') === 'super_admin' ||
    matchedAdmin?.role === 'super_admin';

  const navItems = isSuperAdmin
    ? [
        { to: '/super-admin', icon: Crown, label: 'Master Console', end: true },
        ...NAV_ITEMS,
      ]
    : NAV_ITEMS;

  const displayName = profile?.full_name || matchedAdmin?.full_name || 'Admin';
  const displayUsername = profile?.username || loggedUsername || matchedAdmin?.username || 'admin';
  const displayPhoto = profile?.photo_url || matchedAdmin?.photo_url;

  const initials = displayName
    ? displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'AD';

  return (
    <aside
      className={cn(
        // Hidden below lg: on a phone this 260px column left ~100px for the page. The same
        // destinations are reachable from MobileTabBar + its More sheet.
        //
        // The document is the scroll container (one scrollbar; TopBar is sticky inside it).
        // A plain flex item scrolled away with the page and left the light shell background
        // where the sidebar had been, so it is sticky to the viewport at full viewport height.
        // Sticky rather than fixed: it keeps its place in the flex row, so the content column
        // follows the 260/72px collapse without a margin kept in sync by hand. self-start
        // stops the row from stretching it to the page height, which would defeat sticky.
        'sticky top-0 self-start hidden lg:flex flex-col h-dvh shrink-0 bg-sidebar-bg border-r border-sidebar-border transition-[width] duration-300',
        collapsed ? 'w-[72px]' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 shrink-0">
        <img
          src="/logo.png"
          alt="BookMyMeet Logo"
          className="w-9 h-9 object-contain rounded-xl shrink-0 shadow-xs"
        />
        {!collapsed && (
          <span className="text-sidebar-text-active font-bold text-lg tracking-tight">
            {APP_NAME}
          </span>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="tap-hit press absolute -right-3.5 top-20 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-border shadow-sm hover:bg-surface-tertiary transition-colors cursor-pointer"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-text-secondary" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5 text-text-secondary" />
        )}
      </button>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-sidebar-active text-sidebar-text-active'
                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active'
              )
            }
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        <div className="pt-4">
          <Separator className="bg-sidebar-border mb-4" />
          {SETTINGS_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (isSuperAdmin) {
                  localStorage.setItem('bmm_current_user_role', 'super_admin');
                  localStorage.setItem('bmm_logged_role', 'super_admin');
                  // Identity comes from the signed-in account, never from a literal
                  // written here: this used to overwrite whoever was logged in.
                }
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-sidebar-active text-sidebar-text-active'
                    : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active'
                )
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Profile / Logout */}
      <div className="shrink-0 p-3 border-t border-sidebar-border">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={displayPhoto || undefined} alt={displayName} />
            <AvatarFallback className="bg-primary-700 text-white text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-text-active truncate">
                {displayName}
              </p>
              <p className="text-xs text-sidebar-text truncate">
                @{displayUsername}
              </p>
            </div>
          )}
          <button
            onClick={async () => {
              await signOut();
            }}
            className="press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sidebar-text hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            aria-label="Sign out"
            title="Sign out & go to Sign Up"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
