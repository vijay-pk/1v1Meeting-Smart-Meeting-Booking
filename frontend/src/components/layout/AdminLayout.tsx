import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileTabBar } from './MobileTabBar';
import { useAuthStore } from '@/stores/authStore';
import { useBookingStore } from '@/stores/bookingStore';
import { useAdminTheme } from '@/hooks/useAdminTheme';
import { Skeleton } from '@/components/common/Skeleton';

export function AdminLayout() {
  const { user, loading, initialized, profile } = useAuthStore();
  const { admins } = useBookingStore();
  // Mounted here and nowhere on a public route: the dark theme attribute lives exactly as
  // long as an admin screen is on the page (see hooks/useAdminTheme.ts).
  const { preference, setPreference } = useAdminTheme();

  const loggedAdminId = localStorage.getItem('bmm_logged_admin_id');
  const loggedRole = localStorage.getItem('bmm_current_user_role');

  const isAuthenticated = !!user || !!loggedAdminId || !!loggedRole;

  const isSuperAdmin =
    profile?.role === 'super_admin' ||
    localStorage.getItem('bmm_logged_role') === 'super_admin' ||
    admins.find((a) => a.id === loggedAdminId)?.role === 'super_admin';

  // Only block with a loading state if there are NO local auth credentials AND auth is pending
  if (!isAuthenticated && (!initialized || loading)) {
    return (
      <div className="admin-shell flex min-h-dvh items-center justify-center bg-surface-secondary p-6">
        <div className="w-full max-w-sm space-y-3" role="status" aria-label="Loading">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="admin-shell flex min-h-dvh bg-surface-secondary">
      <Sidebar />

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <TopBar themePreference={preference} onThemeChange={setPreference} />

        {/* pb-24 on mobile keeps the last row of content clear of the fixed tab bar. */}
        <main className="flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileTabBar
        themePreference={preference}
        onThemeChange={setPreference}
        isSuperAdmin={isSuperAdmin}
      />
    </div>
  );
}
