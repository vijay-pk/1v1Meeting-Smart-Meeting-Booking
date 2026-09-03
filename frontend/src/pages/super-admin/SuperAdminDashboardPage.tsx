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
} from 'lucide-react';
import { api } from '@/lib/api';
import { SuperProfileImportModal } from '@/components/admin/SuperProfileImportModal';
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
  const [isSuperAdminCredsOpen, setIsSuperAdminCredsOpen] = useState(false);
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

  // Super Admin Credentials Edit State
  const [masterUsername, setMasterUsername] = useState(currentSuperAdmin.username);
  const [masterEmail, setMasterEmail] = useState(currentSuperAdmin.email);
  // Never a default credential: an empty field means "leave the password unchanged".
  const [masterPassword, setMasterPassword] = useState('');
  const [credsSavedNotice, setCredsSavedNotice] = useState(false);

  // Super Admin's own settings & integrations state
  const [masterImportOpen, setMasterImportOpen] = useState(false);
  const [masterSuperChat, setMasterSuperChat] = useState(
    currentSuperAdmin.social_links?.super_chat || currentSuperAdmin.super_chat_url || ''
  );
  const [masterTelegram, setMasterTelegram] = useState(
    currentSuperAdmin.social_links?.telegram || ''
  );
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
      super_chat_url: masterSuperChat.trim(),
      social_links: {
        ...currentSuperAdmin.social_links,
        super_chat: masterSuperChat.trim(),
        telegram: masterTelegram.trim(),
      },
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

  // The super admin imports through the same authenticated preview/apply flow as any other
  // admin -- there is no separate scrape path, and nothing is written until they confirm.
  const handleMasterScrapeSuperProfile = () => {
    setMasterImportOpen(true);
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

  const handleSaveMasterCreds = (e: React.FormEvent) => {
    e.preventDefault();
    updateSuperAdminCredentials(masterUsername.trim(), masterEmail.trim(), masterPassword.trim());
    setCredsSavedNotice(true);
    setTimeout(() => {
      setCredsSavedNotice(false);
      setIsSuperAdminCredsOpen(false);
    }, 1200);
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
    <div className="min-h-screen bg-[#F0F4F8] text-slate-800 antialiased font-sans pb-24">
      
      {/* Super Admin Top Command Bar */}
      <header className="bg-[#0B1E3B] text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white font-bold flex items-center justify-center shadow-md">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-white">
                  Super Admin Master Console
                </span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                  {currentSuperAdmin.full_name} (CEO)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage Staff Admins, Send Gmail Credentials & Set Custom Pricing per Consultant
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Master Credentials Settings Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSuperAdminCredsOpen(true)}
              className="text-xs font-semibold px-3 h-8.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border-indigo-500/30 flex items-center gap-1.5 cursor-pointer"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Login Info</span>
            </Button>

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
              className="text-xs font-bold px-3 h-8.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-sm transition-all"
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
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </Link>

            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
              }}
              className="text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 gap-1.5 cursor-pointer transition-colors"
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
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Admins</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{admins.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Platform Staff</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Active Admins</p>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              {admins.filter(a => (a.status || 'ACTIVE') === 'ACTIVE').length}
            </p>
            <p className="text-[10px] text-emerald-600/80 mt-0.5">Accepting Bookings</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Disabled Admins</p>
            <p className="text-2xl font-black text-amber-700 mt-1">
              {admins.filter(a => a.status === 'TEMPORARILY_DISABLED').length}
            </p>
            <p className="text-[10px] text-amber-600/80 mt-0.5">Portals Paused</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">Total Bookings</p>
            <p className="text-2xl font-black text-blue-900 mt-1">{bookings.length}</p>
            <p className="text-[10px] text-blue-600/80 mt-0.5">Platform Wide</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
            <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">Confirmed Revenue</p>
            <p className="text-2xl font-black text-indigo-900 mt-1">
              ₹{(bookings.filter(b => b.payment_status === 'completed').length * 1497).toLocaleString()}
            </p>
            <p className="text-[10px] text-indigo-600/80 mt-0.5">Via Razorpay</p>
          </div>
        </div>

        {/* =========================================================================
            SECTION 1: ADMINS & WEEKLY HOURS CONFIGURATION
           ========================================================================= */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200">
            
            {/* Left Sidebar: Admins List + Add Admin */}
            <div className="md:col-span-4 lg:col-span-4 p-5 bg-slate-50/70 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900 text-sm tracking-tight">
                    Admins & Staff ({admins.length})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Search, toggle status & manage consultants
                  </p>
                </div>

                <Button
                  size="sm"
                  onClick={() => setIsAddAdminOpen(true)}
                  className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs h-8 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer font-semibold shadow-xs"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Add Admin</span>
                </Button>
              </div>

              {notice && (
                <div className="px-3 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-semibold">
                  {notice}
                </div>
              )}
              {adminsLoading && (
                <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-[11px] font-semibold">
                  Loading admins from the server…
                </div>
              )}

              {/* Search & Filter Bar */}
              <div className="space-y-2">
                <Input
                  placeholder="Search admin by name, email, or @user..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  className="h-8 text-xs bg-white rounded-lg border-slate-200"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition cursor-pointer ${
                      statusFilter === 'all' ? 'bg-[#0B1E3B] text-white' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    All ({admins.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ACTIVE')}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition cursor-pointer ${
                      statusFilter === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    Active ({admins.filter(a => (a.status || 'ACTIVE') === 'ACTIVE').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('TEMPORARILY_DISABLED')}
                    className={`px-2 py-1 text-[10px] font-bold rounded-md transition cursor-pointer ${
                      statusFilter === 'TEMPORARILY_DISABLED' ? 'bg-amber-600 text-white' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    Disabled ({admins.filter(a => a.status === 'TEMPORARILY_DISABLED').length})
                  </button>
                </div>
              </div>

              {/* Admin Cards List */}
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
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
                    const isSelected = selectedAdminId === adm.id;
                    const isSuper = adm.role === 'super_admin';
                    const isActive = (adm.status || 'ACTIVE') === 'ACTIVE';

                    return (
                      <div
                        key={adm.id}
                        onClick={() => setSelectedAdminId(adm.id)}
                        className={`p-3 rounded-xl transition-all duration-150 border cursor-pointer ${
                          isSelected
                            ? 'bg-[#EBF3FF] border-blue-400 text-blue-900 shadow-xs'
                            : 'bg-white hover:bg-slate-100/80 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={adm.photo_url || DEFAULT_AVATAR}
                              alt={adm.full_name}
                              className="w-8 h-8 rounded-full object-cover object-top border shrink-0"
                            />
                            <div className="truncate">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-bold text-slate-900 truncate">{adm.full_name}</p>
                                {isSuper && (
                                  <Crown className="w-3 h-3 text-amber-500 shrink-0" />
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono truncate">/{adm.username}</p>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <span
                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md shrink-0 ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {isActive ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </div>

                        {/* Integration Badges */}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100 text-[10px]">
                          <span className={`inline-flex items-center gap-1 font-medium ${adm.google_connected ? 'text-emerald-600' : 'text-slate-400'}`}>
                            <span>GCal</span>
                            <span>{adm.google_connected ? '✓' : '—'}</span>
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className={`inline-flex items-center gap-1 font-medium ${adm.razorpay_configured ? 'text-blue-600' : 'text-slate-400'}`}>
                            <span>Razorpay</span>
                            <span>{adm.razorpay_configured ? '✓' : '—'}</span>
                          </span>

                          {/* Public Profile Link */}
                          <Link
                            to={`/${adm.username}`}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-indigo-600 hover:underline flex items-center gap-0.5 text-[10px] font-bold"
                          >
                            <span>Profile</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </Link>
                        </div>

                        {/* Actions Row */}
                        {!isSuper && (
                          <div className="flex items-center justify-end gap-1.5 mt-2 pt-1.5 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                            {/* Toggle Status */}
                            <button
                              type="button"
                              onClick={async () => {
                                const newStatus = isActive ? 'TEMPORARILY_DISABLED' : 'ACTIVE';
                                try {
                                  // Server first: the local list follows what actually
                                  // changed, instead of showing a state the API refused.
                                  await api.superAdminUpdateStatus(adm.id, newStatus);
                                  setAdminStatus(adm.id, newStatus);
                                } catch (e: any) {
                                  setNotice(e?.message || 'Could not update that admin.');
                                  setTimeout(() => setNotice(''), 6000);
                                }
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                isActive
                                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              }`}
                            >
                              {isActive ? 'Pause' : 'Activate'}
                            </button>

                            {/* Gmail Credentials */}
                            <button
                              type="button"
                              title="Send Login Credentials via Gmail"
                              onClick={() => {
                                setTargetAdminForEmail(adm);
                                setIsEmailCredsOpen(true);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-100 cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </button>

                            {/* Permanent Delete with Modal Confirmation */}
                            <button
                              type="button"
                              title="Permanently Delete Admin"
                              onClick={() => {
                                setAdminToDelete(adm);
                                setIsDeleteModalOpen(true);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Right: Selected Admin Weekly Hours */}
            <div className="md:col-span-8 lg:col-span-8.5 p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {selectedAdmin.full_name} — weekly hours
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                      {selectedAdmin.role === 'super_admin' ? 'Super Admin' : 'Staff Consultant'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Set daily availability time blocks for {selectedAdmin.full_name.split(' ')[0]}.
                  </p>
                </div>

                {selectedAdmin.role !== 'super_admin' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTargetAdminForEmail(selectedAdmin);
                      setIsEmailCredsOpen(true);
                    }}
                    className="text-xs h-8 px-3 rounded-lg border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 flex items-center gap-1.5 cursor-pointer font-semibold"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Send Login Credentials</span>
                  </Button>
                )}
              </div>

              {/* Day By Day Blocks */}
              <div className="space-y-6">
                {DAYS_OF_WEEK.map((day) => {
                  const blocksForDay = scheduleBlocks.filter(
                    (b) => b.admin_id === selectedAdminId && b.day_of_week === day.index && b.is_active
                  );
                  const currentNew = dayNewBlocks[day.index] || { start: '07:00', end: '07:00' };

                  return (
                    <div key={day.index} className="space-y-2 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-800 w-16">
                          {day.name}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {blocksForDay.length === 0 ? (
                          <span className="text-xs text-slate-400 italic py-1 mr-2">
                            No hours set
                          </span>
                        ) : (
                          blocksForDay.map((block) => (
                            <div
                              key={block.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold border border-slate-200"
                            >
                              <span>{block.start_time}-{block.end_time}</span>
                              <button
                                type="button"
                                onClick={() => removeScheduleBlock(block.id)}
                                className="text-red-500 hover:text-red-700 ml-1 font-bold text-xs cursor-pointer"
                                title="Remove time block"
                              >
                                ✕
                              </button>
                            </div>
                          ))
                        )}

                        {/* Add Block Form */}
                        <div className="flex items-center gap-2 mt-1 sm:mt-0">
                          <Select
                            value={currentNew.start}
                            onValueChange={(val) => handleTimeChange(day.index, 'start', val)}
                          >
                            <SelectTrigger className="w-24 h-9 text-xs rounded-lg bg-white border-slate-200">
                              <SelectValue placeholder="Start" />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                              {TIME_OPTIONS.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <span className="text-xs text-slate-400 font-medium">to</span>

                          <Select
                            value={currentNew.end}
                            onValueChange={(val) => handleTimeChange(day.index, 'end', val)}
                          >
                            <SelectTrigger className="w-24 h-9 text-xs rounded-lg bg-white border-slate-200">
                              <SelectValue placeholder="End" />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                              {TIME_OPTIONS.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleAddBlock(day.index)}
                            className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs h-9 px-3.5 rounded-lg font-semibold cursor-pointer"
                          >
                            + Add block
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* =========================================================================
            SECTION 2: SUPER ADMIN PERSONAL 1v1 SESSIONS & PRICING
           ========================================================================= */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-indigo-600" />
                  <span>My 1v1 Sessions & Personal Pricing</span>
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {currentSuperAdmin.full_name || 'You'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
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
                <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
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
                    <td colSpan={5} className="py-8 text-center text-slate-400 italic">
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
                      <tr key={meeting.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Name input */}
                        <td className="py-3 px-3">
                          <Input
                            value={meeting.name}
                            onChange={(e) => handlePriceUpdate(meeting.id, 'name', e.target.value)}
                            className="h-9 text-xs rounded-lg font-semibold bg-white border-slate-200 min-w-44"
                          />
                        </td>

                        {/* Duration selector */}
                        <td className="py-3 px-3">
                          <Select
                            value={String(meeting.duration_minutes)}
                            onValueChange={(val) => handlePriceUpdate(meeting.id, 'duration_minutes', Number(val))}
                          >
                            <SelectTrigger className="w-28 h-9 text-xs rounded-lg bg-white border-slate-200">
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
                            <span className="absolute left-2.5 top-2 text-slate-400 text-xs font-semibold select-none">₹</span>
                            <Input
                              type="text"
                              value={origPriceInRupees}
                              onChange={(e) => handlePriceUpdate(meeting.id, 'original_price', e.target.value)}
                              placeholder="999"
                              className="h-9 text-xs rounded-lg bg-white border-slate-200 pl-6 w-28 line-through text-slate-400"
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
                              className="h-9 text-xs rounded-lg bg-white border-slate-200 pl-6 w-28 font-bold text-emerald-700"
                            />
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeMeetingType(meeting.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition hover:bg-red-50 cursor-pointer"
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
            SECTION 2B: SUPER ADMIN PROFILE, SUPER CHAT & INTEGRATIONS
            (Requirement: Master Admin parity with regular consultants)
           ========================================================================= */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-black text-xs">
                    2B
                  </span>
                  <span>My Profile, Super Chat & Personal Integrations</span>
                </h2>
                <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] font-bold">
                  Master Consultant Parity
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Configure your own SuperProfile import, Super Chat priority messaging link, Razorpay credentials, and Google Calendar sync for <strong>{currentSuperAdmin.full_name || 'your account'}</strong>.
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Card 1: SuperProfile Import & Super Chat */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50/70 to-orange-50/50 border border-amber-200/80 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <Sparkles className="w-4 h-4 text-orange-600" />
                  <span>SuperProfile Import & Super Chat</span>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-slate-700">Import from SuperProfile</Label>
                  <Button
                    type="button"
                    onClick={handleMasterScrapeSuperProfile}
                    className="w-full bg-orange-600 hover:bg-orange-500 text-white text-xs px-3 h-8.5 rounded-xl cursor-pointer"
                  >
                    Import from SuperProfile
                  </Button>
                  <p className="text-[10px] text-slate-500">
                    Preview what the public page exposes, then choose what to import.
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                    <span>⚡ Super Chat / Priority DM Link</span>
                  </Label>
                  <Input
                    value={masterSuperChat}
                    onChange={(e) => setMasterSuperChat(e.target.value)}
                    placeholder="https://superprofile.bio/chat/your-handle"
                    className="text-xs rounded-xl bg-white h-8.5"
                  />
                  <p className="text-[10px] text-slate-500">
                    Clients see an instant Super Chat card on /{currentSuperAdmin.username}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-slate-700">Telegram VIP Channel / DM</Label>
                  <Input
                    value={masterTelegram}
                    onChange={(e) => setMasterTelegram(e.target.value)}
                    placeholder="https://t.me/your-handle"
                    className="text-xs rounded-xl bg-white h-8.5"
                  />
                </div>
              </div>

              <p className="text-[10px] text-amber-800/80 italic pt-2 border-t border-amber-200/50">
                Syncs bio, avatar, headline & priority contact channels.
              </p>
            </div>

            {/* Card 2: Google Calendar Integration */}
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
                  <Label className="text-[11px] font-semibold text-slate-700">Google Account</Label>
                  {/* Read-only: the connected account is whichever one you sign in with on
                      Google's consent screen, not an address typed here. */}
                  <div className="text-xs rounded-xl bg-white border border-slate-200 h-8.5 px-3 flex items-center font-mono text-slate-700 truncate">
                    {masterGoogleEmail || 'Not connected'}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Creates calendar events & automated Google Meet video links for bookings.
                    Stays connected until you disconnect it here.
                  </p>
                  {masterGoogleConnected && !masterGoogleHealthy && (
                    <p className="text-[10px] text-amber-700 font-semibold">
                      Calendar cannot be read — access was likely revoked at Google. Bookings are paused until you reconnect.
                    </p>
                  )}
                </div>

                <div className="p-2.5 rounded-xl bg-white/80 border border-blue-200/70 text-[11px] text-blue-900 space-y-1">
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
                className={`w-full text-xs font-bold h-8.5 rounded-xl cursor-pointer ${
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
                    <Label className="text-[11px] font-semibold text-slate-700">Razorpay Key ID</Label>
                    <a
                      href="https://dashboard.razorpay.com/#/access/api_keys"
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
                    className="text-xs rounded-xl bg-white h-8.5 font-mono"
                  />
                  {masterRzpKey.startsWith('rzp_live_') && (
                    <p className="text-[10px] text-emerald-700 font-bold">● Live Mode (Real payments active)</p>
                  )}
                  {masterRzpKey.startsWith('rzp_test_') && (
                    <p className="text-[10px] text-amber-700 font-medium">⚠️ Test Mode key. Use rzp_live_ for real money.</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-slate-700">Razorpay Key Secret</Label>
                  <Input
                    type="password"
                    value={masterRzpSecret}
                    onChange={(e) => setMasterRzpSecret(e.target.value)}
                    placeholder="Enter Secret"
                    className="text-xs rounded-xl bg-white h-8.5 font-mono"
                  />
                  <p className="text-[10px] text-slate-500">
                    Encrypted with AES-256 before storage. Payments settle directly into your own account.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleSaveMasterProfileSettings}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold h-8.5 rounded-xl shadow-xs cursor-pointer"
              >
                {masterIntegrationsSaved ? '✓ Credentials Saved' : 'Connect Razorpay & Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* =========================================================================
            SECTION 3: MASTER BOOKINGS OVERVIEW
           ========================================================================= */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <span>Bookings Overview (Master List)</span>
            </h2>
            <p className="text-xs text-slate-500">
              Live records of all appointments across all platform consultants.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
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
                    <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                      No bookings yet — confirm one from the Book tab.
                    </td>
                  </tr>
                ) : (
                  bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/60 transition-colors">
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
                      <td className="py-3.5 px-3 font-medium text-slate-700">
                        {b.meeting_type_name || (b as any).meeting_type?.name || 'Session'}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px]">
                          {b.assigned_admin_name || 'Admin'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <p className="font-semibold text-slate-900">{b.customer_name || (b as any).customer?.name}</p>
                        <p className="text-[11px] text-slate-400">{b.customer_email || (b as any).customer?.email}</p>
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
                          <span className="text-slate-400">—</span>
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
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <UserPlus className="w-4 h-4" />
              <span>Add Staff Consultant</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Create New Admin Account
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              New admins can log in at the portal with their email & password to manage appointments.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateAdminSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Full Name</Label>
              <Input
                required
                placeholder="e.g. Kavita Reddy"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Professional Title</Label>
              <Input
                placeholder="e.g. Performance Ads Specialist"
                value={newAdminTitle}
                onChange={(e) => setNewAdminTitle(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Work Email (for Login)</Label>
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
                <Label className="text-xs font-bold text-slate-700">Username</Label>
                <Input
                  placeholder="e.g. kavita"
                  value={newAdminUsername}
                  onChange={(e) => setNewAdminUsername(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Initial Password</Label>
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
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Tag className="w-4 h-4" />
              <span>Custom Pricing & Session</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Add Personal 1v1 Session
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Create a new 1v1 session offering and configure your pricing.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateMeetingSubmit} className="space-y-4 pt-2">

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Session Name</Label>
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
                <Label className="text-xs font-bold text-slate-700">Duration</Label>
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
                <Label className="text-xs font-bold text-slate-700">Original (₹)</Label>
                <Input
                  placeholder="999"
                  value={newMtOrigPrice}
                  onChange={(e) => setNewMtOrigPrice(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 text-orange-600">Offer (₹)</Label>
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
              <Label className="text-xs font-bold text-slate-700">Description (Optional)</Label>
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
        <DialogContent className="sm:max-w-lg p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Mail className="w-4 h-4" />
              <span>Gmail & Email Dispatch</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Send Login Credentials to {targetAdminForEmail?.full_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              You can dispatch their login credentials via Gmail compose or copy the message.
            </DialogDescription>
          </DialogHeader>

          {targetAdminForEmail && (
            <div className="space-y-4 pt-2">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Consultant Email:</span>
                  <span className="font-bold text-slate-900">{targetAdminForEmail.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Username:</span>
                  <span className="font-bold font-mono text-slate-900">{targetAdminForEmail.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Password:</span>
                  <span className="font-bold font-mono text-indigo-600">{targetAdminForEmail.password || 'welcome@123'}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200/80 pt-2">
                  <span className="text-slate-500">Portal Login Link:</span>
                  <span className="font-mono text-slate-700 text-[11px]">http://localhost:5173/admin/login</span>
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
          MODAL 4: SUPER ADMIN CREDENTIALS EDITOR
         ========================================================================= */}
      <Dialog open={isSuperAdminCredsOpen} onOpenChange={setIsSuperAdminCredsOpen}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Key className="w-4 h-4" />
              <span>Owner Access Settings</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Customize Super Admin Login Credentials
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              You can set your own custom username, owner email, and master password.
            </DialogDescription>
          </DialogHeader>

          {credsSavedNotice ? (
            <div className="p-4 bg-emerald-50 text-emerald-800 rounded-2xl border border-emerald-200 text-center space-y-1 my-2">
              <Check className="w-6 h-6 mx-auto text-emerald-600" />
              <p className="font-bold text-xs">Credentials Updated Successfully!</p>
              <p className="text-[11px] text-emerald-600">You can now use these credentials on the Admin Login portal.</p>
            </div>
          ) : (
            <form onSubmit={handleSaveMasterCreds} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Master Username</Label>
                <Input
                  required
                  value={masterUsername}
                  onChange={(e) => setMasterUsername(e.target.value)}
                  className="h-10 text-xs rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Owner Email</Label>
                <Input
                  type="email"
                  required
                  value={masterEmail}
                  onChange={(e) => setMasterEmail(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Master Password</Label>
                <Input
                  required
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  className="h-10 text-xs rounded-xl font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsSuperAdminCredsOpen(false)}
                  className="rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs px-5 cursor-pointer"
                >
                  Save Master Credentials
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* =========================================================================
          MODAL 5: PERMANENT DELETE ADMIN CONFIRMATION (Requirement 19 Safety Dialog)
         ========================================================================= */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-md p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-wider mb-1">
              <AlertCircle className="w-4 h-4" />
              <span>Safety Deletion Safeguard</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Permanently Delete Admin?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
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
            <Label className="text-[11px] font-semibold text-slate-700">
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

      <SuperProfileImportModal
        open={masterImportOpen}
        onOpenChange={setMasterImportOpen}
        onImported={() => {
          setMasterIntegrationsNotice('✓ SuperProfile data imported into your profile.');
          setTimeout(() => setMasterIntegrationsNotice(''), 5000);
        }}
      />

    </div>
  );
};
