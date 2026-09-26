import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { useAuthStore } from '@/stores/authStore';
import { formatPrice, formatBookingDate, formatBookingTime } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import type { AdminUser, MeetingType, WeeklyScheduleBlock } from '@/types';
import {
  Crown,
  Calendar,
  Clock,
  Video,
  Plus,
  Trash2,
  Edit2,
  Check,
  Save,
  Users,
  Layers,
  ExternalLink,
  LogOut,
  ShieldCheck,
  Tag,
  DollarSign,
  UserCheck,
  Mail,
  Key,
  Send,
  UserPlus,
  Lock,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Filter,
  Settings,
  Globe,
  Download,
  CreditCard,
  MessageSquare,
  Phone,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { useAdminTheme } from '@/hooks/useAdminTheme';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** One consultant's own bookings and own captured revenue, from `/super-admin/analytics`. */
interface AdminRevenueItem {
  admin_id: string | null;
  admin_name: string;
  /** 'super_admin' marks the owner's own sessions -- the one row that is theirs. */
  role: string | null;
  bookings: number;
  revenue: number;
}

interface PlatformAnalytics {
  total_admins: number;
  active_admins: number;
  disabled_admins: number;
  total_bookings: number;
  confirmed_bookings: number;
  /** Captured payments across every consultant, in paise. Never the Super Admin's own. */
  total_revenue: number;
  by_admin: AdminRevenueItem[];
}

/** A booking belonging to some consultant, from `/super-admin/bookings`. */
interface PlatformBooking {
  id: string;
  admin_id: string | null;
  admin_name: string;
  client_name: string;
  client_email: string;
  session_title: string;
  start_time: string;
  status: string;
  payment_status: string;
  /** Present only when the payment was really captured; null otherwise. */
  amount: number | null;
  currency: string;
  google_meet_link: string | null;
}

const DAYS_OF_WEEK = [
  { index: 1, name: 'Mon', fullName: 'Monday' },
  { index: 2, name: 'Tue', fullName: 'Tuesday' },
  { index: 3, name: 'Wed', fullName: 'Wednesday' },
  { index: 4, name: 'Thu', fullName: 'Thursday' },
  { index: 5, name: 'Fri', fullName: 'Friday' },
  { index: 6, name: 'Sat', fullName: 'Saturday' },
  { index: 0, name: 'Sun', fullName: 'Sunday' },
];

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '22:00'
];

export const SuperAdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { signOut } = useAuthStore();
  const {
    admins,
    meetingTypes,
    scheduleBlocks,
    currentSuperAdmin,
    updateSuperAdminCredentials,
    addAdmin,
    removeAdmin,
    updateAdmin,
    setAdminStatus,
    updateMeetingType,
    addMeetingType,
    removeMeetingType,
    addScheduleBlock,
    removeScheduleBlock,
    updateAdminProfile,
    connectGoogleCalendar,
    disconnectGoogleCalendar,
  } = useBookingStore();

  // Auth guard: redirect to login if not authenticated as super_admin
  const loggedRole = localStorage.getItem('bmm_current_user_role');
  const authToken = localStorage.getItem('bmm_auth_token');
  useEffect(() => {
    if (!authToken || loggedRole !== 'super_admin') {
      navigate('/admin/login', { replace: true });
    }
  }, [authToken, loggedRole, navigate]);

  // Prevent crash while redirecting or if store is not yet hydrated
  if (!authToken || loggedRole !== 'super_admin' || !currentSuperAdmin) {
    return null;
  }

  // Search and status filter for admins
  const [adminSearch, setAdminSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'TEMPORARILY_DISABLED'>('all');

  // Deletion modal confirmation
  const [adminToDelete, setAdminToDelete] = useState<AdminUser | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [adminsLoading, setAdminsLoading] = useState(true);

  /**
   * The admin list is the backend's, not the browser's.
   *
   * This dashboard used to render a hardcoded array of seeded admins from localStorage,
   * which meant deleted admins kept appearing and the list never matched the database.
   */
  const loadAdmins = React.useCallback(async () => {
    setAdminsLoading(true);
    try {
      const rows = await api.superAdminListAdmins();
      useBookingStore.setState((state) => ({
        admins: rows.map((row: any) => {
          const previous = state.admins.find((a) => a.id === row.id);
          return {
            ...previous,
            id: row.id,
            username: row.username,
            full_name: row.name,
            email: row.email,
            phone: row.phone || '',
            role: row.role,
            status: row.status,
            title: previous?.title || '',
            avatar_color: previous?.avatar_color || 'bg-indigo-600',
            avatar_letter: (row.name || '?').charAt(0).toUpperCase(),
            google_connected: row.google_connected,
            google_email: row.google_email || '',
            razorpay_configured: row.razorpay_configured,
            razorpay_key_id: row.razorpay_key_id || '',
          } as AdminUser;
        }),
      }));
    } catch (e: any) {
      setNotice(e?.message || 'Could not load the admin list from the server.');
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  /**
   * Platform figures and the booking list come from the server, for every consultant.
   *
   * Both were previously read out of the local zustand store, which this page never
   * fills: the booking table was therefore always empty, and the revenue tile multiplied
   * the booking count by a hardcoded 1497 paise-per-booking figure. Neither number
   * described anything real, and the money shown is not the Super Admin's -- each
   * payment settles into the consultant's own Razorpay account. These endpoints
   * (`/super-admin/analytics`, `/super-admin/bookings`) already existed and aggregate
   * over `bookings.admin_id` / `payments.admin_id`.
   */
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [platformBookings, setPlatformBookings] = useState<PlatformBooking[] | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');

  useEffect(() => {
    let ignore = false;
    setOverviewLoading(true);
    setOverviewError('');
    Promise.all([api.superAdminGetAnalytics(), api.superAdminGetBookings()])
      .then(([stats, rows]: any[]) => {
        if (ignore) return;
        setAnalytics(stats);
        setPlatformBookings(rows || []);
      })
      .catch((e: any) => {
        // A failed request is not "no bookings" and not "zero revenue". Say so rather
        // than rendering zeros the owner might act on.
        if (ignore) return;
        setAnalytics(null);
        setPlatformBookings(null);
        setOverviewError(e?.message || 'Could not load platform figures from the server.');
      })
      .finally(() => {
        if (!ignore) setOverviewLoading(false);
      });
    return () => { ignore = true; };
  }, []);

  // Selected Admin tab in Section 1 (Weekly Hours)
  const [selectedAdminId, setSelectedAdminId] = useState<string>(admins[1]?.id || admins[0]?.id);

  // Pricing filter in Section 2 (Meeting Types)
  const [pricingFilterAdminId, setPricingFilterAdminId] = useState<string>('all');

  // Modals state
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [isAddMeetingModalOpen, setIsAddMeetingModalOpen] = useState(false);
  const [isEmailCredsOpen, setIsEmailCredsOpen] = useState(false);
  const [targetAdminForEmail, setTargetAdminForEmail] = useState<AdminUser | null>(null);

  // New Admin Form State
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminTitle, setNewAdminTitle] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  // New Meeting Type Form State
  const [newMtAdminId, setNewMtAdminId] = useState<string>(admins[0]?.id || '');
  const [newMtName, setNewMtName] = useState('');
  const [newMtDesc, setNewMtDesc] = useState('');
  const [newMtDuration, setNewMtDuration] = useState<number>(30);
  const [newMtOrigPrice, setNewMtOrigPrice] = useState<string>('999');
  const [newMtOfferPrice, setNewMtOfferPrice] = useState<string>('499');

  // Super Admin's own settings & integrations state

  // Hosts the admin dark theme for this route (see hooks/useAdminTheme.ts).
  const { preference: themePreference, setPreference: setThemePreference } = useAdminTheme();
  const [masterGoogleEmail, setMasterGoogleEmail] = useState(currentSuperAdmin.google_email || '');
  // Never default to "connected": the server row decides, and it is loaded below.
  const [masterGoogleConnected, setMasterGoogleConnected] = useState(false);
  const [masterGoogleHealthy, setMasterGoogleHealthy] = useState(true);
  const [masterRzpKey, setMasterRzpKey] = useState(
    currentSuperAdmin.razorpay_key_id || ''
  );
  // The secret input is always empty. The stored secret is encrypted server-side and is never
  // sent to the browser. A blank field on save keeps the stored secret; it never deletes it.
  const [masterRzpSecret, setMasterRzpSecret] = useState('');
  // Connectedness comes from the backend row, not from a typed field or the store.
  const [masterRzpConfigured, setMasterRzpConfigured] = useState(false);
  const [masterIntegrationsNotice, setMasterIntegrationsNotice] = useState('');
  const [masterIntegrationsSaved, setMasterIntegrationsSaved] = useState(false);

  const handleSaveMasterProfileSettings = async () => {
    const cleanKey = masterRzpKey.trim();
    const cleanSecret = masterRzpSecret.trim();

    if (cleanKey) {
      // A first-time connection needs a secret; once connected, a blank field keeps the
      // stored one so the Key ID can be updated on its own.
      if (!cleanSecret && !masterRzpConfigured) {
        setMasterIntegrationsNotice('Razorpay Key Secret is required.');
        return;
      }
      try {
        await api.setupRazorpay(cleanKey, cleanSecret);
      } catch (e: any) {
        setMasterIntegrationsNotice(e?.message || 'Could not save Razorpay credentials.');
        return;
      }
      setMasterRzpConfigured(true);
      // Never keep the entered secret in memory once it has been sent.
      setMasterRzpSecret('');
    }

    updateAdminProfile(currentSuperAdmin.id, {
      razorpay_key_id: cleanKey,
      razorpay_configured: !!cleanKey,
      google_email: masterGoogleEmail.trim(),
      google_connected: masterGoogleConnected,
    });

    setMasterIntegrationsSaved(true);
    setMasterIntegrationsNotice('✓ Master Admin profile & integrations updated successfully!');
    setTimeout(() => {
      setMasterIntegrationsSaved(false);
      setMasterIntegrationsNotice('');
    }, 3000);
  };

  // Load the real connection state for the super admin's own calendar.
  useEffect(() => {
    let ignore = false;
    api
      .getGoogleStatus()
      .then((status: any) => {
        if (ignore) return;
        setMasterGoogleConnected(!!status.connected);
        setMasterGoogleHealthy(status.connected ? !!status.healthy : true);
        if (status.google_email) setMasterGoogleEmail(status.google_email);
        if (status.connected) {
          connectGoogleCalendar(currentSuperAdmin.id, status.google_email || '');
        } else {
          disconnectGoogleCalendar(currentSuperAdmin.id);
        }
      })
      .catch(() => {
        // A failed status call is not a disconnect; leave the last known state alone.
      });

    // Razorpay connectedness for the super admin's own account, from the backend row.
    api
      .getRazorpayStatus()
      .then((status: any) => {
        if (ignore) return;
        setMasterRzpConfigured(!!status.configured);
        if (status.key_id) setMasterRzpKey(status.key_id);
      })
      .catch(() => {
        // A failed status call is not a disconnect; keep the last known state.
      });
    return () => { ignore = true; };
  }, [currentSuperAdmin.id]);

  const handleToggleMasterGoogle = async () => {
    if (masterGoogleConnected) {
      if (!confirm('Disconnect your Google Calendar? Clients will not be able to book until you reconnect.')) return;
      try { await api.disconnectGoogle(); } catch (e) {}
      disconnectGoogleCalendar(currentSuperAdmin.id);
      setMasterGoogleConnected(false);
      return;
    }
    // Real OAuth: Google decides which account gets connected, not a typed-in address.
    try {
      const res = await api.getGoogleAuthUrl();
      if (!res.auth_url) {
        setMasterIntegrationsNotice(res.message || 'Google OAuth is not configured on this server.');
        return;
      }
      window.location.href = res.auth_url;
    } catch (e: any) {
      setMasterIntegrationsNotice(e?.message || 'Could not start Google authorization');
    }
  };

  // New Block temporary state per day
  const [dayNewBlocks, setDayNewBlocks] = useState<Record<number, { start: string; end: string }>>({
    1: { start: '07:00', end: '07:00' },
    2: { start: '07:00', end: '07:00' },
    3: { start: '07:00', end: '07:00' },
    4: { start: '07:00', end: '07:00' },
    5: { start: '07:00', end: '07:00' },
    6: { start: '07:00', end: '07:00' },
    0: { start: '07:00', end: '07:00' },
  });

  const selectedAdmin = admins.find((a) => a.id === selectedAdminId) || admins[0];

  const handleTimeChange = (dayIndex: number, field: 'start' | 'end', val: string) => {
    setDayNewBlocks((prev) => ({
      ...prev,
      [dayIndex]: {
        ...prev[dayIndex],
        [field]: val,
      },
    }));
  };

  const handleAddBlock = (dayIndex: number) => {
    const config = dayNewBlocks[dayIndex] || { start: '09:00', end: '17:00' };
    addScheduleBlock(selectedAdminId, dayIndex, config.start, config.end);
  };

  const handlePriceUpdate = (
    meetingId: string,
    field: 'price' | 'original_price' | 'name' | 'duration_minutes' | 'admin_id',
    value: any
  ) => {
    if (field === 'price' || field === 'original_price') {
      const cleanStr = String(value ?? '').replace(/[^0-9]/g, '');
      if (cleanStr === '') {
        updateMeetingType(meetingId, {
          [field]: field === 'original_price' ? null : 0,
        });
      } else {
        const parsed = parseInt(cleanStr, 10) * 100;
        updateMeetingType(meetingId, { [field]: parsed });
      }
    } else {
      updateMeetingType(meetingId, { [field]: value });
    }
  };

  const handleOpenAddMeetingModal = (preselectedAdminId?: string) => {
    setNewMtAdminId(preselectedAdminId || currentSuperAdmin.id);
    setNewMtName('');
    setNewMtDesc('');
    setNewMtDuration(30);
    setNewMtOrigPrice('999');
    setNewMtOfferPrice('499');
    setIsAddMeetingModalOpen(true);
  };

  const handleCreateMeetingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMtName.trim()) return;

    const offerInPaise = Math.round(Number(newMtOfferPrice.replace(/[^0-9]/g, '') || '0') * 100);
    const origInPaise = newMtOrigPrice
      ? Math.round(Number(newMtOrigPrice.replace(/[^0-9]/g, '') || '0') * 100)
      : null;

    addMeetingType({
      admin_id: newMtAdminId,
      name: newMtName.trim(),
      description: newMtDesc.trim() || 'Personalized 1-on-1 consultation session.',
      duration_minutes: newMtDuration,
      price: offerInPaise,
      original_price: origInPaise,
      offer_price: offerInPaise,
      currency: 'INR',
      is_active: true,
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
      min_advance_hours: 2,
      max_advance_days: 30,
      cancellation_window_hours: 24,
      reschedule_allowed: true,
      max_bookings_per_day: 6,
      color_id: Math.floor(Math.random() * 5) + 1,
      sort_order: meetingTypes.length + 1,
    });

    setIsAddMeetingModalOpen(false);
  };

  const handleCreateAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminName || !newAdminEmail) return;

    const username = (newAdminUsername.trim() || newAdminName.toLowerCase().replace(/\s+/g, '-')).toLowerCase();
    const password = newAdminPassword.trim();

    if (password.length < 6) {
      setNotice('Set a password of at least 6 characters for the new admin.');
      return;
    }

    // api.signup writes the new account's token into localStorage. Keep the super admin's
    // own session and put it back afterwards, or creating an admin would sign the super
    // admin out of their own dashboard.
    const ownToken = localStorage.getItem('bmm_auth_token');
    const ownRole = localStorage.getItem('bmm_current_user_role');

    try {
      // A real account through the real endpoint. Creating one only in this browser's
      // store produced "admins" who could never sign in and did not exist in the database.
      // The backend also enforces the rules that matter here: unique email and username,
      // and a refusal for any address belonging to a permanently deleted admin.
      await api.signup({
        name: newAdminName.trim(),
        email: newAdminEmail.trim(),
        password,
        username,
      });
    } catch (err: any) {
      setNotice(err?.message || 'Could not create the admin account.');
      return;
    } finally {
      if (ownToken) localStorage.setItem('bmm_auth_token', ownToken);
      if (ownRole) localStorage.setItem('bmm_current_user_role', ownRole);
    }

    await loadAdmins();
    const created = useBookingStore.getState().admins.find((a) => a.username === username);

    setIsAddAdminOpen(false);
    if (created) setSelectedAdminId(created.id);
    setNewAdminName('');
    setNewAdminTitle('');
    setNewAdminEmail('');
    setNewAdminUsername('');
    setNewAdminPassword('');
    setNotice(`Admin @${username} created.`);
    setTimeout(() => setNotice(''), 6000);
  };

  const generateGmailComposeLink = (admin: AdminUser) => {
    const to = encodeURIComponent(admin.email);
    const subject = encodeURIComponent(`Your admin portal access`);
    const body = encodeURIComponent(
      `Hello ${admin.full_name},

` +
      `You have been granted admin access to the booking platform.

` +
      `• Portal URL: ${window.location.origin}/admin/login
` +
      `• Username / Email: ${admin.email} (or ${admin.username})
` +
      // A password is never held by this dashboard, and must not be mailed in plain text.
      `• Password: the one set when the account was created

` +
      `Please sign in to set your weekly available hours and view your scheduled appointments.

` +
      `Best regards,
${currentSuperAdmin.full_name || 'The platform team'}`
    );
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
  };

  // Super Admin only manages his own personal 1v1 meeting types and pricing
  const displayedMeetingTypes = meetingTypes.filter(
    (mt) => mt.admin_id === currentSuperAdmin.id || !mt.admin_id
  );

  return (
    <div className="admin-shell min-h-dvh bg-surface-secondary font-sans text-text-secondary antialiased pb-24">
      
      {/* Super Admin Top Command Bar */}
      <header className="bg-[#0B1E3B] text-white sticky top-0 z-30 shadow-md">
        <div className="mx-auto max-w-7xl px-3 py-2 sm:px-6 sm:py-2.5">
          {/* Identity and controls share a row from `sm` up; below that the controls wrap
              onto their own line rather than squeezing the name. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/logo.png"
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg object-contain sm:h-9 sm:w-9"
              />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-white sm:text-base">
                  Super Admin
                </p>
                <p className="truncate text-xs leading-tight text-slate-300">
                  {currentSuperAdmin.full_name}
                  {currentSuperAdmin.title ? ` · ${currentSuperAdmin.title}` : ''}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeToggle
                value={themePreference}
                onChange={setThemePreference}
                className="bg-white/10"
              />

              {/* Account details and platform settings, saved on the server. This used to open
                  a dialog that only wrote to this browser's local store and changed no real
                  login. Icon-only on phones; the label appears from `md` up. */}
              <Link
                to="/super-admin/settings"
                aria-label="Account and settings"
                title="Account & settings"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-slate-800 px-2.5 text-xs font-semibold text-indigo-300 hover:bg-slate-700"
              >
                <Key className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Account</span>
              </Link>

              {/* Portal settings (the Master Admin is a consultant like any other) */}
              <Link
                to="/admin/settings"
                aria-label="Portal settings"
                title="Portal settings"
                onClick={() => {
                  localStorage.setItem('bmm_current_user_role', 'super_admin');
                  localStorage.setItem('bmm_logged_role', 'super_admin');
                  localStorage.setItem('bmm_logged_admin_id', currentSuperAdmin.id);
                  localStorage.setItem('bmm_logged_username', currentSuperAdmin.username);
                  localStorage.setItem('bmm_logged_admin_name', currentSuperAdmin.full_name);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Portal settings</span>
              </Link>

              {/* The slug stays reachable through the label and the link itself, but it no
                  longer sets the width of the header on a phone. */}
              <Link
                to={`/${currentSuperAdmin.username}`}
                target="_blank"
                aria-label={`Booking link, /${currentSuperAdmin.username}`}
                title={`/${currentSuperAdmin.username}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Booking link</span>
              </Link>

              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                }}
                aria-label="Sign out"
                className="h-9 gap-1.5 px-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-red-400 cursor-pointer"
                title="Sign out"
              >
                <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">

        {/* PLATFORM OVERVIEW — every figure here belongs to the consultants, not to the
            Super Admin. Values come from /super-admin/analytics; "—" means the request
            failed or has not answered, never zero. */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="bg-surface p-3 rounded-xl border border-border">
            <p className="text-xs font-medium text-text-tertiary">Consultants</p>
            <p className="truncate text-xl font-bold tabular-nums text-text-primary mt-0.5">{admins.length}</p>
          </div>
          <div className="bg-surface p-3 rounded-xl border border-border">
            <p className="text-xs font-medium text-emerald-600">Active</p>
            <p className="truncate text-xl font-bold tabular-nums text-text-primary mt-0.5">
              {admins.filter(a => (a.status || 'ACTIVE') === 'ACTIVE').length}
            </p>
          </div>
          <div className="bg-surface p-3 rounded-xl border border-border">
            <p className="text-xs font-medium text-amber-600">Paused</p>
            <p className="truncate text-xl font-bold tabular-nums text-text-primary mt-0.5">
              {admins.filter(a => a.status === 'TEMPORARILY_DISABLED').length}
            </p>
          </div>
          <div className="bg-surface p-3 rounded-xl border border-border">
            <p className="text-xs font-medium text-blue-600">Platform bookings</p>
            <p className="truncate text-xl font-bold tabular-nums text-text-primary mt-0.5">
              {analytics ? analytics.total_bookings : '—'}
            </p>
          </div>
          <div className="bg-surface p-3 rounded-xl border border-border col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-indigo-600">Consultant revenue</p>
            <p className="truncate text-xl font-bold tabular-nums text-text-primary mt-0.5">
              {analytics ? formatPrice(analytics.total_revenue, 'INR') : '—'}
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">Across all admins</p>
          </div>
        </div>

        {overviewError && (
          <div className="px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs font-semibold">
            {overviewError}
          </div>
        )}

        {/* =========================================================================
            SECTION 1: ADMINS & CONSULTANTS MANAGEMENT
           ========================================================================= */}
        <div className="bg-surface rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <h2 className="font-semibold text-text-primary text-lg tracking-tight flex items-center gap-2 min-w-0">
              <Users className="w-5 h-5 text-indigo-600 shrink-0" />
              <span className="truncate">Admins ({admins.length})</span>
            </h2>

            <Button
              size="sm"
              onClick={() => setIsAddAdminOpen(true)}
              aria-label="Add consultant"
              className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs h-9 px-3 rounded-lg flex shrink-0 items-center gap-1.5 cursor-pointer font-semibold"
            >
              <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Add consultant</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>

          {notice && (
            <div className="px-3 py-2 rounded-lg border border-border bg-slate-900 text-white text-xs font-semibold">
              {notice}
            </div>
          )}
          {adminsLoading && (
            <div className="px-3 py-2 rounded-lg bg-surface-tertiary text-text-tertiary text-xs font-semibold">
              Loading admins from the server…
            </div>
          )}

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <Input
              placeholder="Search by name, email, or @username..."
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              className="h-10 text-xs bg-surface rounded-lg border-border max-w-md w-full"
            />
            <div className="flex gap-1.5 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                  statusFilter === 'all' ? 'bg-[#0B1E3B] text-white' : 'bg-surface-tertiary text-text-secondary hover:bg-surface-secondary'
                }`}
              >
                All ({admins.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                  statusFilter === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'bg-surface-tertiary text-text-secondary hover:bg-surface-secondary'
                }`}
              >
                Active ({admins.filter(a => (a.status || 'ACTIVE') === 'ACTIVE').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('TEMPORARILY_DISABLED')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                  statusFilter === 'TEMPORARILY_DISABLED' ? 'bg-amber-600 text-white' : 'bg-surface-tertiary text-text-secondary hover:bg-surface-secondary'
                }`}
              >
                Paused ({admins.filter(a => a.status === 'TEMPORARILY_DISABLED').length})
              </button>
            </div>
          </div>

          {/* Admin Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {admins
              .filter((adm) => {
                const matchSearch =
                  adminSearch === '' ||
                  adm.full_name.toLowerCase().includes(adminSearch.toLowerCase()) ||
                  adm.email.toLowerCase().includes(adminSearch.toLowerCase()) ||
                  adm.username.toLowerCase().includes(adminSearch.toLowerCase());
                const matchStatus =
                  statusFilter === 'all' || (adm.status || 'ACTIVE') === statusFilter;
                return matchSearch && matchStatus;
              })
              .map((adm) => {
                const isSuper = adm.role === 'super_admin';
                const isActive = (adm.status || 'ACTIVE') === 'ACTIVE';

                return (
                  <div
                    key={adm.id}
                    className="p-4 rounded-xl border border-border bg-surface hover:shadow-md transition space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={adm.photo_url || DEFAULT_AVATAR}
                            alt={adm.full_name}
                            className="w-10 h-10 rounded-full object-cover object-top border shrink-0"
                          />
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-text-primary truncate">{adm.full_name}</p>
                              {isSuper && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            </div>
                            <a
                              href={`/${adm.username}`}
                              target="_blank"
                              rel="noreferrer"
                              className="press -my-1 inline-flex min-h-11 w-full items-center truncate rounded px-1 font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400 sm:min-h-6"
                            >
                              /{adm.username}
                            </a>
                          </div>
                        </div>

                        <span
                          className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md shrink-0 ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {isActive ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-text-secondary">
                        <p className="truncate flex items-center gap-1.5">
                          <Mail className="w-3 h-3 text-text-tertiary shrink-0" />
                          <span>{adm.email}</span>
                        </p>
                        {adm.phone && (
                          <p className="truncate flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-text-tertiary shrink-0" />
                            <span>{adm.phone}</span>
                          </p>
                        )}
                      </div>

                      {/* Integration Badges */}
                      <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-border text-[11px]">
                        <span className={`inline-flex items-center gap-1 font-medium ${adm.google_connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-tertiary'}`}>
                          <span>GCal:</span>
                          <span>{adm.google_connected ? 'Connected ✓' : 'Not linked'}</span>
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className={`inline-flex items-center gap-1 font-medium ${adm.razorpay_configured ? 'text-blue-600 dark:text-blue-400' : 'text-text-tertiary'}`}>
                          <span>Razorpay:</span>
                          <span>{adm.razorpay_configured ? 'Live ✓' : 'Not set'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    {!isSuper && (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const newStatus = isActive ? 'TEMPORARILY_DISABLED' : 'ACTIVE';
                            try {
                              await api.superAdminUpdateStatus(adm.id, newStatus);
                              setAdminStatus(adm.id, newStatus);
                            } catch (e: any) {
                              setNotice(e?.message || 'Could not update that admin.');
                              setTimeout(() => setNotice(''), 6000);
                            }
                          }}
                          className="text-xs h-8 px-2 text-text-secondary hover:text-text-primary"
                        >
                          {isActive ? 'Pause Account' : 'Activate Account'}
                        </Button>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Send Login Credentials"
                            onClick={() => {
                              setTargetAdminForEmail(adm);
                              setIsEmailCredsOpen(true);
                            }}
                            className="h-8 px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                          >
                            <Mail className="w-3.5 h-3.5 mr-1" />
                            <span className="text-xs">Email</span>
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            title="Permanently Delete Admin"
                            onClick={() => {
                              setAdminToDelete(adm);
                              setIsDeleteModalOpen(true);
                            }}
                            className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* =========================================================================
            SECTION 3: REVENUE BY CONSULTANT + ALL PLATFORM BOOKINGS
            Everything below describes the consultants' business. Each payment settled
            into that consultant's own Razorpay account; this console only reports it.
           ========================================================================= */}
        <div className="bg-surface rounded-xl p-4 sm:p-6 border border-border space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-indigo-600 shrink-0" />
              <span>Revenue by consultant</span>
            </h2>
            <p className="text-xs text-text-tertiary mt-0.5">
              Bookings and captured payments per consultant, settled in their own account
            </p>
          </div>

          {overviewLoading ? (
            <p className="py-6 text-center text-sm text-text-tertiary">Loading…</p>
          ) : !analytics ? (
            <p className="py-6 text-center text-sm text-text-tertiary">
              Figures unavailable right now.
            </p>
          ) : analytics.by_admin.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-tertiary">
              No consultant has taken a booking yet.
            </p>
          ) : (
            <>
              {/* Phone: a row per consultant, no horizontal scroll. */}
              <ul className="space-y-2 md:hidden">
                {analytics.by_admin.map((row) => (
                  <li
                    key={row.admin_id || 'unattributed'}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {row.admin_name}
                        {row.role === 'super_admin' && (
                          <span className="ml-1.5 text-xs font-normal text-text-tertiary">(your own sessions)</span>
                        )}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {row.bookings} booking{row.bookings === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                      {formatPrice(row.revenue, 'INR')}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-medium text-text-tertiary">
                      <th className="py-2 px-3 font-medium">Consultant</th>
                      <th className="py-2 px-3 font-medium text-right">Bookings</th>
                      <th className="py-2 px-3 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analytics.by_admin.map((row) => (
                      <tr key={row.admin_id || 'unattributed'}>
                        <td className="py-2.5 px-3 text-text-primary">
                          {row.admin_name}
                          {row.role === 'super_admin' && (
                            <span className="ml-1.5 text-xs text-text-tertiary">(your own sessions)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-text-secondary">{row.bookings}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-text-primary">
                          {formatPrice(row.revenue, 'INR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="bg-surface rounded-xl p-4 sm:p-6 border border-border space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600 shrink-0" />
              <span>All bookings</span>
            </h2>
            <p className="text-xs text-text-tertiary mt-0.5">Bookings across all consultants</p>
          </div>

          {overviewLoading ? (
            <p className="py-8 text-center text-sm text-text-tertiary">Loading bookings…</p>
          ) : !platformBookings ? (
            <p className="py-8 text-center text-sm text-text-tertiary">
              Bookings unavailable right now.
            </p>
          ) : platformBookings.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-tertiary">No bookings yet.</p>
          ) : (
            <>
              {/* Phone: one card per booking. A six-column table cannot be squeezed into
                  360px without clipping a column, and clipping the Meet link or the
                  customer's address is the same as losing it. */}
              <ul className="space-y-2.5 lg:hidden">
                {platformBookings.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          {formatBookingDate(b.start_time, 'MMM d')} · {formatBookingTime(b.start_time)}
                        </p>
                        <p className="text-xs text-text-tertiary truncate">{b.session_title}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium"
                      >
                        {b.status}
                      </Badge>
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm text-text-primary break-words">{b.client_name}</p>
                      {/* Long addresses wrap rather than overflow the card. */}
                      <p className="text-xs text-text-tertiary break-all">{b.client_email}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>
                        <span className="text-text-tertiary">Consultant </span>
                        <span className="font-medium text-text-secondary">{b.admin_name}</span>
                      </span>
                      {/* Only a captured payment shows an amount, and it is that
                          consultant's money, not the platform's. */}
                      {b.amount !== null && b.amount !== undefined && (
                        <span className="font-medium text-text-secondary tabular-nums">
                          {formatPrice(b.amount, (b.currency as any) || 'INR')}
                        </span>
                      )}
                    </div>

                    {b.google_meet_link && (
                      <a
                        href={b.google_meet_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 break-all font-mono text-xs text-blue-600 hover:underline"
                      >
                        <Video className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{b.google_meet_link.replace('https://', '')}</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>

              {/* Desktop: the table, which has the room it needs. Below 1024px the Meet
                  URL column is too narrow and the address breaks mid-word. */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-xs font-medium text-text-tertiary">
                      <th className="py-2 px-3 font-medium">When</th>
                      <th className="py-2 px-3 font-medium">Session</th>
                      <th className="py-2 px-3 font-medium">Consultant</th>
                      <th className="py-2 px-3 font-medium">Customer</th>
                      <th className="py-2 px-3 font-medium text-right">Amount</th>
                      <th className="py-2 px-3 font-medium">Meet</th>
                      <th className="py-2 px-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {platformBookings.map((b) => (
                      <tr key={b.id} className="hover:bg-surface-secondary/60 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-text-primary whitespace-nowrap">
                          {formatBookingDate(b.start_time, 'MMM d')} · {formatBookingTime(b.start_time)}
                        </td>
                        <td className="py-2.5 px-3 text-text-secondary">{b.session_title}</td>
                        <td className="py-2.5 px-3 text-text-secondary">{b.admin_name}</td>
                        <td className="py-2.5 px-3">
                          <p className="font-medium text-text-primary">{b.client_name}</p>
                          <p className="text-xs text-text-tertiary break-all">{b.client_email}</p>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-text-secondary whitespace-nowrap">
                          {b.amount !== null && b.amount !== undefined
                            ? formatPrice(b.amount, (b.currency as any) || 'INR')
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {b.google_meet_link ? (
                            <a
                              href={b.google_meet_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1 font-mono text-xs break-words"
                            >
                              <Video className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{b.google_meet_link.replace('https://', '')}</span>
                            </a>
                          ) : (
                            <span className="text-text-tertiary">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium">
                            {b.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

      </main>

      {/* =========================================================================
          MODAL 1: ADD NEW ADMIN / CONSULTANT
         ========================================================================= */}
      <Dialog open={isAddAdminOpen} onOpenChange={setIsAddAdminOpen}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-surface">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <UserPlus className="w-4 h-4" />
              <span>Add Staff Consultant</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-text-primary">
              Create New Admin Account
            </DialogTitle>
            <DialogDescription className="text-xs text-text-tertiary">
              New admins can log in at the portal with their email & password to manage appointments.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateAdminSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-text-secondary">Full Name</Label>
              <Input
                required
                placeholder="e.g. Kavita Reddy"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-text-secondary">Professional Title</Label>
              <Input
                placeholder="e.g. Performance Ads Specialist"
                value={newAdminTitle}
                onChange={(e) => setNewAdminTitle(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-text-secondary">Work Email (for Login)</Label>
              <Input
                type="email"
                required
                placeholder="name@example.com"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-text-secondary">Username</Label>
                <Input
                  placeholder="e.g. kavita"
                  value={newAdminUsername}
                  onChange={(e) => setNewAdminUsername(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-text-secondary">Initial Password</Label>
                <Input
                  type="password"
                  placeholder="e.g. kavita@123"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddAdminOpen(false)}
                className="rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#0B1E3B] hover:bg-slate-800 text-white font-bold rounded-xl text-xs px-5 cursor-pointer"
              >
                Create Admin
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* =========================================================================
          MODAL 2: ADD MEETING TYPE / CUSTOM PRICE RANGE FOR ADMIN
         ========================================================================= */}
      <Dialog open={isAddMeetingModalOpen} onOpenChange={setIsAddMeetingModalOpen}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-surface">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Tag className="w-4 h-4" />
              <span>Custom Pricing & Session</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-text-primary">
              Add Personal 1v1 Session
            </DialogTitle>
            <DialogDescription className="text-xs text-text-tertiary">
              Add a session and set its price.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateMeetingSubmit} className="space-y-4 pt-2">

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-text-secondary">Session Name</Label>
              <Input
                required
                placeholder="e.g. Growth Blueprint Consultation"
                value={newMtName}
                onChange={(e) => setNewMtName(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-text-secondary">Duration</Label>
                <Select
                  value={String(newMtDuration)}
                  onValueChange={(val) => setNewMtDuration(Number(val))}
                >
                  <SelectTrigger className="h-10 text-xs rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15" className="text-xs">15 min</SelectItem>
                    <SelectItem value="30" className="text-xs">30 min</SelectItem>
                    <SelectItem value="45" className="text-xs">45 min</SelectItem>
                    <SelectItem value="60" className="text-xs">60 min</SelectItem>
                    <SelectItem value="90" className="text-xs">90 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-text-secondary">Original (₹)</Label>
                <Input
                  placeholder="999"
                  value={newMtOrigPrice}
                  onChange={(e) => setNewMtOrigPrice(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-text-secondary text-orange-600">Offer (₹)</Label>
                <Input
                  required
                  placeholder="499"
                  value={newMtOfferPrice}
                  onChange={(e) => setNewMtOfferPrice(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-10 text-xs rounded-xl font-bold text-orange-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-text-secondary">Description (Optional)</Label>
              <Textarea
                placeholder="What will be covered in this session?"
                value={newMtDesc}
                onChange={(e) => setNewMtDesc(e.target.value)}
                rows={2}
                className="text-xs rounded-xl"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddMeetingModalOpen(false)}
                className="rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#0B1E3B] hover:bg-slate-800 text-white font-bold rounded-xl text-xs px-5 cursor-pointer"
              >
                Add Price & Session
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* =========================================================================
          MODAL 3: SEND CREDENTIALS VIA GMAIL / EMAIL
         ========================================================================= */}
      <Dialog open={isEmailCredsOpen} onOpenChange={setIsEmailCredsOpen}>
        <DialogContent className="sm:max-w-lg p-6 sm:p-8 rounded-3xl bg-surface">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Mail className="w-4 h-4" />
              <span>Gmail & Email Dispatch</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-text-primary">
              Send Login Credentials to {targetAdminForEmail?.full_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-text-tertiary">
              You can dispatch their login credentials via Gmail compose or copy the message.
            </DialogDescription>
          </DialogHeader>

          {targetAdminForEmail && (
            <div className="space-y-4 pt-2">
              <div className="bg-surface-secondary p-4 rounded-2xl border border-border space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Consultant Email:</span>
                  <span className="font-bold text-text-primary">{targetAdminForEmail.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Username:</span>
                  <span className="font-bold font-mono text-text-primary">{targetAdminForEmail.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Password:</span>
                  <span className="font-bold font-mono text-indigo-600">{targetAdminForEmail.password || 'welcome@123'}</span>
                </div>
                <div className="flex justify-between border-t border-border/80 pt-2">
                  <span className="text-text-tertiary">Portal Login Link:</span>
                  <span className="font-mono text-text-secondary text-[11px]">http://localhost:5173/admin/login</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEmailCredsOpen(false)}
                  className="rounded-xl text-xs cursor-pointer"
                >
                  Close
                </Button>

                {/* Direct Gmail Compose Link */}
                <a
                  href={generateGmailComposeLink(targetAdminForEmail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-[#EA4335] hover:bg-[#D93025] text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send via Gmail Compose</span>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* =========================================================================
          MODAL 5: PERMANENT DELETE ADMIN CONFIRMATION (Requirement 19 Safety Dialog)
         ========================================================================= */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-surface">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-wider mb-1">
              <AlertCircle className="w-4 h-4" />
              <span>Safety Deletion Safeguard</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-text-primary">
              Permanently Delete Admin?
            </DialogTitle>
            <DialogDescription className="text-xs text-text-tertiary">
              Are you sure you want to permanently delete <strong className="text-slate-800">{adminToDelete?.full_name}</strong> (@{adminToDelete?.username})?
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-2 my-2">
            <p className="font-bold">⚠️ This action cannot be undone.</p>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-red-700">
              <li>The admin account, profile, session types, availability, Google Calendar connection and Razorpay configuration are permanently deleted.</li>
              <li>Their booking link (<strong>/{adminToDelete?.username}</strong>) stops working immediately, and that username can never be claimed again.</li>
              <li>They can no longer sign in, with a password or with Google.</li>
              <li>They will not be able to register again using the same email address.</li>
              <li>Past bookings and payments are kept as financial records, with all personal details erased.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-text-secondary">
              Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm
            </Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="text-xs rounded-xl"
              autoComplete="off"
            />
          </div>

          {deleteError && (
            <p className="text-[11px] font-semibold text-red-600">{deleteError}</p>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setDeleteConfirmText('');
                setDeleteError('');
              }}
              className="rounded-xl text-xs cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
              onClick={async () => {
                if (!adminToDelete) return;
                setDeleting(true);
                setDeleteError('');
                try {
                  // The server deletes; the local list is then rebuilt from the server, so
                  // the UI can never disagree with the database about who exists.
                  await api.superAdminDeleteAdmin(adminToDelete.id);
                  removeAdmin(adminToDelete.id);
                  await loadAdmins();
                  const remaining = useBookingStore.getState().admins;
                  if (selectedAdminId === adminToDelete.id) {
                    setSelectedAdminId(remaining[0]?.id || '');
                  }
                  setNotice(`${adminToDelete.full_name} was permanently deleted.`);
                  setTimeout(() => setNotice(''), 6000);
                  setIsDeleteModalOpen(false);
                  setDeleteConfirmText('');
                } catch (e: any) {
                  setDeleteError(e?.message || 'Deletion failed. Nothing was removed.');
                } finally {
                  setDeleting(false);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs px-5 cursor-pointer shadow-md shadow-red-600/20 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, Permanently Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};
