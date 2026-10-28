import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { authGet, authClearSession } from '@/lib/authStorage';
import { StudentTermsDialog } from '@/components/student/StudentTermsDialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { LayoutDashboard, CalendarPlus, CalendarCheck, Video, LogOut, Loader2, Menu, X } from 'lucide-react';

const NAV = [
  { to: '/student', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/student/book', label: 'Book a Meeting', icon: CalendarPlus },
  { to: '/student/meetings', label: 'My Meetings', icon: CalendarCheck },
  { to: '/student/recordings', label: 'Recordings', icon: Video },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors shrink-0 ${
    isActive ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-surface'
  }`;

/** Mobile navigation: a hamburger in the header that opens a left drawer with the same NAV list. */
const MobileNav: React.FC<{ onSignOut: () => void }> = ({ onSignOut }) => {
  const [open, setOpen] = useState(false);

  // If the window grows to the desktop layout while the drawer is open, close it so the page is
  // never left scroll-locked behind an invisible backdrop.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-surface px-2 py-1.5 md:hidden safe-t">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger
          aria-label="Open navigation menu"
          className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-primary hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Menu className="h-6 w-6" />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay data-overlay="" className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm" />
          <DialogPrimitive.Content
            data-drawer=""
            aria-describedby={undefined}
            className="safe-t safe-b fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-border bg-surface-elevated shadow-dropdown focus:outline-none"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
                <DialogPrimitive.Title className="truncate font-bold text-text-primary">Student menu</DialogPrimitive.Title>
              </div>
              <DialogPrimitive.Close
                aria-label="Close navigation menu"
                className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
            <nav aria-label="Student navigation" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={(a) => `${linkClass(a)} min-h-11 text-base`} onClick={() => setOpen(false)}>
                  <Icon className="h-5 w-5" /> {label}
                </NavLink>
              ))}
              <div className="mt-auto border-t border-border pt-3">
                <button
                  onClick={() => { setOpen(false); onSignOut(); }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5" /> Sign out
                </button>
              </div>
            </nav>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <img src="/logo.png" alt="" className="h-7 w-7 rounded-lg object-contain" />
      <span className="font-bold text-text-primary">Student</span>
    </header>
  );
};

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
      <MobileNav onSignOut={signOut} />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        {/* Tablet and desktop keep the sidebar exactly as before; phones use the drawer above. */}
        <aside className="hidden shrink-0 md:block md:w-56">
          <div className="flex items-center gap-2 px-2 pb-4">
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-bold text-text-primary">Student</span>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={linkClass}>
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
            <button onClick={signOut} className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
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
