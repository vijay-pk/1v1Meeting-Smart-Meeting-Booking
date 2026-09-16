import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { useAuthStore } from '@/stores/authStore';
import { formatPrice } from '@/lib/format';
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
    bookings,
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
  const [masterRzpSecret, setMasterRzpSecret] = useState('••••••••••••••••');
  const [masterIntegrationsNotice, setMasterIntegrationsNotice] = useState('');
  const [masterIntegrationsSaved, setMasterIntegrationsSaved] = useState(false);

  const handleSaveMasterProfileSettings = async () => {
    updateAdminProfile(currentSuperAdmin.id, {
      razorpay_key_id: masterRzpKey.trim(),
      razorpay_configured: !!masterRzpKey.trim(),
      google_email: masterGoogleEmail.trim(),
      google_connected: masterGoogleConnected,
    });

    try {
      if (masterRzpKey.trim() && !masterRzpSecret.includes('•')) {
        await api.setupRazorpay(masterRzpKey.trim(), masterRzpSecret.trim());
      }
    } catch (e) {}

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
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="BookMyMeet Logo"
              className="w-10 h-10 object-contain rounded-xl shadow-md"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-white">
                  Super Admin Master Console
                </span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                  {currentSuperAdmin.full_name} (CEO)
                </span>
              </div>
              <p className="text-xs text-text-tertiary">
                Manage Staff Admins, Send Gmail Credentials & Set Custom Pricing per Consultant
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle
              value={themePreference}
              onChange={setThemePreference}
              className="bg-white/10"
            />

            {/* Master Credentials Settings Button */}
            {/* Account details and platform settings, saved on the server. This used to open a
                dialog that only wrote to this browser's local store and changed no real login. */}
            <Link
              to="/super-admin/settings"
              className="text-xs font-semibold px-3 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Account & Settings</span>
            </Link>

            {/* My Portal Settings (Requirement 7: Master Admin is like other admins) */}
            <Link
              to="/admin/settings"
              onClick={() => {
                localStorage.setItem('bmm_current_user_role', 'super_admin');
                localStorage.setItem('bmm_logged_role', 'super_admin');
                localStorage.setItem('bmm_logged_admin_id', currentSuperAdmin.id);
                localStorage.setItem('bmm_logged_username', currentSuperAdmin.username);
                localStorage.setItem('bmm_logged_admin_name', currentSuperAdmin.full_name);
              }}
              className="text-xs font-bold px-3 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>My Portal Settings</span>
            </Link>

            <Link
              to={`/${currentSuperAdmin.username}`}
              target="_blank"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <span>My Booking Link (/{currentSuperAdmin.username})</span>
              <ExternalLink className="w-3.5 h-3.5 text-text-tertiary" />
            </Link>

            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
              }}
              className="text-xs text-text-tertiary hover:text-red-400 hover:bg-slate-800 gap-1.5 cursor-pointer transition-colors"
              title="Sign out & go to Sign Up"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 space-y-8">
        
        {/* PLATFORM ANALYTICS BANNER */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">Total Admins</p>
            <p className="truncate text-xl font-black tabular-nums sm:text-2xl text-text-primary mt-1">{admins.length}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Platform Staff</p>
          </div>
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Active Admins</p>
            <p className="truncate text-xl font-black tabular-nums sm:text-2xl text-emerald-700 mt-1">
              {admins.filter(a => (a.status || 'ACTIVE') === 'ACTIVE').length}
            </p>
            <p className="text-[10px] text-emerald-600/80 mt-0.5">Accepting Bookings</p>
          </div>
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Disabled Admins</p>
            <p className="truncate text-xl font-black tabular-nums sm:text-2xl text-amber-700 mt-1">
              {admins.filter(a => a.status === 'TEMPORARILY_DISABLED').length}
            </p>
            <p className="text-[10px] text-amber-600/80 mt-0.5">Portals Paused</p>
          </div>
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Total Bookings</p>
            <p className="truncate text-xl font-black tabular-nums sm:text-2xl text-blue-900 mt-1">{bookings.length}</p>
            <p className="text-[10px] text-blue-600/80 mt-0.5">Platform Wide</p>
          </div>
          <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs col-span-2 sm:col-span-1">
            <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">Confirmed Revenue</p>
            <p className="truncate text-xl font-black tabular-nums sm:text-2xl text-indigo-900 mt-1">
              ₹{(bookings.filter(b => b.payment_status === 'completed').length * 1497).toLocaleString()}
            </p>
            <p className="text-[10px] text-indigo-600/80 mt-0.5">Via Razorpay</p>
          </div>
        </div>

        {/* =========================================================================
            SECTION 1: ADMINS & CONSULTANTS MANAGEMENT
           ========================================================================= */}
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="font-bold text-text-primary text-lg tracking-tight flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <span>Admins & Consultants ({admins.length})</span>
              </h2>
              <p className="text-xs text-text-tertiary mt-0.5">
                View consultants, monitor active status, and manage platform staff accounts.
              </p>
            </div>

            <Button
              size="sm"
              onClick={() => setIsAddAdminOpen(true)}
              className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs h-9 px-4 rounded-lg flex items-center gap-1.5 cursor-pointer font-semibold shadow-xs"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Add Consultant</span>
            </Button>
          </div>

          {notice && (
            <div className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold">
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
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono truncate block"
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
            SECTION 2: SUPER ADMIN PERSONAL 1v1 SESSIONS & PRICING
           ========================================================================= */}
        <div className="bg-surface rounded-2xl p-6 sm:p-8 border border-border shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                  <Tag className="w-5 h-5 text-indigo-600" />
                  <span>My 1v1 Sessions & Personal Pricing</span>
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {currentSuperAdmin.full_name || 'You'}
                </span>
              </div>
              <p className="text-xs text-text-tertiary mt-0.5">
                Set your personal 1v1 session rates, offer pricing, and durations. Staff admins customize their own session pricing and payment gateway independently in their portal settings.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => handleOpenAddMeetingModal(currentSuperAdmin.id)}
              className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs font-semibold px-4 h-9 rounded-xl gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add My 1v1 Session</span>
            </Button>
          </div>

          {/* Meeting Types & Price Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  <th className="py-3 px-3">SESSION TITLE</th>
                  <th className="py-3 px-3">DURATION</th>
                  <th className="py-3 px-3">ORIGINAL PRICE (₹)</th>
                  <th className="py-3 px-3">OFFER PRICE (₹)</th>
                  <th className="py-3 px-3 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedMeetingTypes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-text-tertiary italic">
                      No 1v1 sessions configured for your profile yet.{' '}
                      <button
                        type="button"
                        onClick={() => handleOpenAddMeetingModal(currentSuperAdmin.id)}
                        className="text-blue-600 font-bold underline ml-1 cursor-pointer"
                      >
                        + Add one now
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedMeetingTypes.map((meeting) => {
                    const origPriceInRupees =
                      meeting.original_price && meeting.original_price > 0
                        ? String(Math.floor(meeting.original_price / 100))
                        : '';

                    const offerPriceInRupees =
                      meeting.price && meeting.price > 0
                        ? String(Math.floor(meeting.price / 100))
                        : '';

                    return (
                      <tr key={meeting.id} className="hover:bg-surface-secondary/60 transition-colors">
                        {/* Name input */}
                        <td className="py-3 px-3">
                          <Input
                            value={meeting.name}
                            onChange={(e) => handlePriceUpdate(meeting.id, 'name', e.target.value)}
                            className="h-9 text-xs rounded-lg font-semibold bg-surface border-border min-w-0 flex-1 sm:min-w-44"
                          />
                        </td>

                        {/* Duration selector */}
                        <td className="py-3 px-3">
                          <Select
                            value={String(meeting.duration_minutes)}
                            onValueChange={(val) => handlePriceUpdate(meeting.id, 'duration_minutes', Number(val))}
                          >
                            <SelectTrigger className="w-full sm:w-28 h-9 text-xs rounded-lg bg-surface border-border">
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
                        </td>

                        {/* Original Price */}
                        <td className="py-3 px-3">
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-text-tertiary text-xs font-semibold select-none">₹</span>
                            <Input
                              type="text"
                              value={origPriceInRupees}
                              onChange={(e) => handlePriceUpdate(meeting.id, 'original_price', e.target.value)}
                              placeholder="999"
                              className="h-9 text-xs rounded-lg bg-surface border-border pl-6 w-28 line-through text-text-tertiary"
                            />
                          </div>
                        </td>

                        {/* Offer Price */}
                        <td className="py-3 px-3">
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-emerald-600 text-xs font-bold select-none">₹</span>
                            <Input
                              type="text"
                              value={offerPriceInRupees}
                              onChange={(e) => handlePriceUpdate(meeting.id, 'price', e.target.value)}
                              placeholder="499"
                              className="h-9 text-xs rounded-lg bg-surface border-border pl-6 w-28 font-bold text-emerald-700"
                            />
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeMeetingType(meeting.id)}
                            className="p-1.5 text-text-tertiary hover:text-red-500 rounded-lg transition hover:bg-red-50 cursor-pointer"
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* =========================================================================
            SECTION 2B: SUPER ADMIN PROFILE & INTEGRATIONS
            (Requirement: Master Admin parity with regular consultants)
           ========================================================================= */}
        <div className="bg-surface rounded-2xl p-6 sm:p-8 border border-border shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-black text-xs">
                    2B
                  </span>
                  <span>My Profile & Personal Integrations</span>
                </h2>
                <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] font-bold">
                  Master Consultant Parity
                </Badge>
              </div>
              <p className="text-xs text-text-tertiary mt-1">
                Configure your own Razorpay credentials and Google Calendar sync for <strong>{currentSuperAdmin.full_name || 'your account'}</strong>.
              </p>
            </div>

            <Link
              to="/admin/settings"
              onClick={() => {
                localStorage.setItem('bmm_current_user_role', 'super_admin');
                localStorage.setItem('bmm_logged_role', 'super_admin');
                localStorage.setItem('bmm_logged_admin_id', currentSuperAdmin.id);
                localStorage.setItem('bmm_logged_username', currentSuperAdmin.username);
                localStorage.setItem('bmm_logged_admin_name', currentSuperAdmin.full_name);
              }}
              className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Full Customizer & Sections →</span>
            </Link>
          </div>

          {masterIntegrationsNotice && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center justify-between animate-fade-in">
              <span>{masterIntegrationsNotice}</span>
              <button
                type="button"
                onClick={() => setMasterIntegrationsNotice('')}
                className="text-emerald-600 hover:text-emerald-900 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Card 1: Google Calendar Integration */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50/70 to-indigo-50/50 border border-blue-200/80 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-blue-900 font-bold text-xs">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    <span>Google Calendar & Meet</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-bold ${
                      masterGoogleConnected
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-amber-50 text-amber-700 border-amber-300'
                    }`}
                  >
                    {masterGoogleConnected ? (masterGoogleHealthy ? 'Synced' : 'Reconnect needed') : 'Disconnected'}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-text-secondary">Google Account</Label>
                  {/* Read-only: the connected account is whichever one you sign in with on
                      Google's consent screen, not an address typed here. */}
                  <div className="text-xs rounded-xl bg-surface border border-border h-9 px-3 flex items-center font-mono text-text-secondary truncate">
                    {masterGoogleEmail || 'Not connected'}
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    Creates calendar events & automated Google Meet video links for bookings.
                    Stays connected until you disconnect it here.
                  </p>
                  {masterGoogleConnected && !masterGoogleHealthy && (
                    <p className="text-[10px] text-amber-700 font-semibold">
                      Calendar cannot be read — access was likely revoked at Google. Bookings are paused until you reconnect.
                    </p>
                  )}
                </div>

                <div className="p-2.5 rounded-xl bg-surface/80 border border-blue-200/70 text-[11px] text-blue-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Video className="w-3.5 h-3.5 text-blue-600" />
                    <span>Google Meet Auto-Generator</span>
                  </div>
                  <p className="text-[10px] text-blue-700">
                    Each client receives a 1-click meeting link instantly upon confirmed payment.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleToggleMasterGoogle}
                variant={masterGoogleConnected ? 'outline' : 'default'}
                className={`w-full text-xs font-bold h-9 rounded-xl cursor-pointer ${
                  masterGoogleConnected
                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {masterGoogleConnected ? 'Disconnect Calendar' : 'Authorize & Connect Google Calendar'}
              </Button>
            </div>

            {/* Card 3: Razorpay Payment Setup */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50/70 to-teal-50/50 border border-emerald-200/80 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                    <CreditCard className="w-4 h-4 text-emerald-600" />
                    <span>Personal Razorpay Gateway</span>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                    100% Payout
                  </Badge>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-text-secondary">Razorpay Key ID</Label>
                    <a
                      href="https://easy.razorpay.com/onboarding?recommended_product=payment_gateway"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-emerald-700 font-bold hover:underline flex items-center gap-0.5"
                    >
                      <span>Open Razorpay</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <Input
                    value={masterRzpKey}
                    onChange={(e) => setMasterRzpKey(e.target.value)}
                    placeholder="rzp_live_... (Live Key ID)"
                    className="text-xs rounded-xl bg-surface h-9 font-mono"
                  />
                  {masterRzpKey.startsWith('rzp_live_') && (
                    <p className="text-[10px] text-emerald-700 font-bold">● Live Mode (Real payments active)</p>
                  )}
                  {masterRzpKey.startsWith('rzp_test_') && (
                    <p className="text-[10px] text-amber-700 font-medium">⚠️ Test Mode key. Use rzp_live_ for real money.</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-text-secondary">Razorpay Key Secret</Label>
                  <Input
                    type="password"
                    value={masterRzpSecret}
                    onChange={(e) => setMasterRzpSecret(e.target.value)}
                    placeholder="Enter Secret"
                    className="text-xs rounded-xl bg-surface h-9 font-mono"
                  />
                  <p className="text-[10px] text-text-tertiary">
                    Encrypted with AES-256 before storage. Payments settle directly into your own account.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleSaveMasterProfileSettings}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold h-9 rounded-xl shadow-xs cursor-pointer"
              >
                {masterIntegrationsSaved ? '✓ Credentials Saved' : 'Connect Razorpay & Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* =========================================================================
            SECTION 3: MASTER BOOKINGS OVERVIEW
           ========================================================================= */}
        <div className="bg-surface rounded-2xl p-6 sm:p-8 border border-border shadow-sm space-y-6">
          <div className="border-b border-border pb-3">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <span>Bookings Overview (Master List)</span>
            </h2>
            <p className="text-xs text-text-tertiary">
              Live records of all appointments across all platform consultants.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  <th className="py-3 px-3">WHEN</th>
                  <th className="py-3 px-3">TYPE</th>
                  <th className="py-3 px-3">ASSIGNED TO</th>
                  <th className="py-3 px-3">CUSTOMER</th>
                  <th className="py-3 px-3">MEET CODE / LINK</th>
                  <th className="py-3 px-3 text-right">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-text-tertiary italic">
                      No bookings yet — confirm one from the Book tab.
                    </td>
                  </tr>
                ) : (
                  bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-surface-secondary/60 transition-colors">
                      <td className="py-3.5 px-3 font-semibold text-slate-800">
                        {new Date(b.start_time).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        •{' '}
                        {new Date(b.start_time).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3.5 px-3 font-medium text-text-secondary">
                        {b.meeting_type_name || (b as any).meeting_type?.name || 'Session'}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px]">
                          {b.assigned_admin_name || 'Admin'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <p className="font-semibold text-text-primary">{b.customer_name || (b as any).customer?.name}</p>
                        <p className="text-[11px] text-text-tertiary">{b.customer_email || (b as any).customer?.email}</p>
                      </td>
                      <td className="py-3.5 px-3">
                        {b.google_meet_url ? (
                          <a
                            href={b.google_meet_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 font-mono text-[11px]"
                          >
                            <Video className="w-3.5 h-3.5" />
                            {b.google_meet_url.replace('https://', '')}
                          </a>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">
                          {b.status.toUpperCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
              Create a new 1v1 session offering and configure your pricing.
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
