import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuthStore } from '@/stores/authStore';

export function AdminLayout() {
  const { user, loading, initialized } = useAuthStore();
  const loggedAdminId = localStorage.getItem('bmm_logged_admin_id');
  const loggedRole = localStorage.getItem('bmm_current_user_role');

  const isAuthenticated = !!user || !!loggedAdminId || !!loggedRole;

  // Only block with loading spinner if there are NO local auth credentials AND auth is pending
  if (!isAuthenticated && (!initialized || loading)) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-secondary">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary-600 animate-pulse-soft" />
          <p className="text-sm text-text-tertiary">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6 bg-surface-secondary">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
