import { useEffect } from 'react';
import { Outlet, Navigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileTabBar } from './MobileTabBar';
import { useAuthStore } from '@/stores/authStore';
import { useBookingStore } from '@/stores/bookingStore';
import { useAdminTheme } from '@/hooks/useAdminTheme';
import { Skeleton } from '@/components/common/Skeleton';
import { api } from '@/lib/api';
import { authGet } from '@/lib/authStorage';

export function AdminLayout() {
  const { user, loading, initialized, profile } = useAuthStore();
  const { admins } = useBookingStore();
  // Mounted here and nowhere on a public route: the dark theme attribute lives exactly as
  // long as an admin screen is on the page (see hooks/useAdminTheme.ts).
  const { preference, setPreference } = useAdminTheme();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const loggedToken = authGet('bmm_auth_token');
  const loggedAdminId = authGet('bmm_logged_admin_id');
  const loggedRole = authGet('bmm_current_user_role');

  const isAuthenticated = !!loggedToken && (!!user || !!loggedAdminId || !!loggedRole);

  // Ask the server whether this account still exists, once per mount.
  //
  // Everything above is browser state, and browser state cannot know that a Super Admin
  // deleted this account thirty seconds ago. Without this, a revoked admin who simply left a
  // tab open kept the whole shell -- sidebar, navigation, the lot -- and only discovered the
  // truth through whichever panel happened to fetch first.
  //
  // getMe() carries the token, so a deleted or disabled account comes back with the
  // revocation header and lib/api.ts ends the session centrally. Nothing to handle here: this
  // exists to make the request happen at all, on a screen that might otherwise make none.
  useEffect(() => {
    if (!isAuthenticated) return;
    void api.getMe();
  }, [isAuthenticated]);

  const isSuperAdmin =
    profile?.role === 'super_admin' ||
    authGet('bmm_logged_role') === 'super_admin' ||
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
            {/* Setup steps are done on their own pages; this is the way back. */}
            {searchParams.get('from') === 'setup' && location.pathname !== '/admin/setup' && (
              <Link
                to="/admin/setup"
                className="press mb-4 flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-700 hover:bg-primary-100"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to setup — save your changes here first
              </Link>
            )}
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
