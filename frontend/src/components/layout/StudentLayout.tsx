import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { authGet, authClearSession } from '@/lib/authStorage';
import { StudentTermsDialog } from '@/components/student/StudentTermsDialog';
import { LayoutDashboard, CalendarPlus, CalendarCheck, Video, LogOut, Loader2 } from 'lucide-react';

const NAV = [
  { to: '/student', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/student/book', label: 'Book a Meeting', icon: CalendarPlus },
  { to: '/student/meetings', label: 'My Meetings', icon: CalendarCheck },
  { to: '/student/recordings', label: 'Recordings', icon: Video },
];

/**
 * Shell + guard for the student dashboard. Requires a signed-in student; the backend enforces
 * the real gates (must-change-password, terms) on every API, this only presents them. A student
 * who has not accepted the current policy sees the terms dialog before anything else.
 */
export const StudentLayout: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<any>(null);
  const [needsTerms, setNeedsTerms] = useState(false);

  useEffect(() => {
    const token = authGet('bmm_auth_token');
    const role = authGet('bmm_current_user_role');
    if (!token || role !== 'student') {
      navigate('/admin/login', { replace: true });
      return;
    }
    (async () => {
      try {
        const data = await api.studentMe();
        setMe(data);
        setNeedsTerms(!data.policy_accepted);
      } catch (err: any) {
        if (err?.message === 'password_change_required' || err?.status === 403) {
          navigate('/student/change-password', { replace: true });
          return;
        }
        navigate('/admin/login', { replace: true });
        return;
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  const signOut = () => {
    authClearSession();
    navigate('/admin/login', { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-secondary">
        <Loader2 className="w-7 h-7 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-secondary">
      {needsTerms && me && (
        <StudentTermsDialog
          onAccepted={() => setNeedsTerms(false)}
          onDecline={signOut}
        />
      )}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        <aside className="md:w-56 shrink-0">
          <div className="flex items-center gap-2 px-2 pb-4">
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-bold text-text-primary">Student</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto md:flex-col">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors shrink-0 ${
                    isActive ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-surface'
                  }`
                }
              >
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
            <button onClick={signOut} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 md:mt-2">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet context={{ me }} />
        </main>
      </div>
    </div>
  );
};
