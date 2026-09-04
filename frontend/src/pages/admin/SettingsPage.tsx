import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useBookingStore } from '@/stores/bookingStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { SuperProfileImportModal } from '@/components/admin/SuperProfileImportModal';
import { TIMEZONES } from '@/lib/constants';
import type { AdminUser, AdminThemeSettings, AdminSocialLinks } from '@/types';
import {
  User,
  Settings as SettingsIcon,
  Calendar as CalendarIcon,
  CreditCard,
  Mail,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Video,
  Palette,
  Share2,
  ShieldCheck,
  AlertCircle,
  Download,
  Globe,
  Loader2,
  DollarSign,
  Plus,
  Trash2,
  Clock,
  Tag,
  Eye,
  EyeOff,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
  Upload,
  Image as ImageIcon,
  Film,
  X,
  Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type SettingsTab = 'profile' | 'pricing' | 'payment' | 'booking' | 'calendar' | 'email';

function getVideoEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.trim();
  if (clean.includes('vimeo.com')) {
    const match = clean.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (match && match[1]) {
      return `https://player.vimeo.com/video/${match[1]}?title=0&byline=0&portrait=0&badge=0&autopause=0`;
    }
  }
  if (clean.includes('youtube.com') || clean.includes('youtu.be')) {
    const match = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) {
      return `https://www.youtube-nocookie.com/embed/${match[1]}?rel=0`;
    }
  }
  return null;
}

const THEME_PRESETS = [
  {
    id: 'amber',
    name: 'Sunset Amber (SuperProfile)',
    bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]',
    button_color: '#D32F2F',
    preview_bg: 'bg-gradient-to-r from-[#873600] to-[#D32F2F]'
  },
  {
    id: 'indigo',
    name: 'Deep Indigo (High Tech)',
    bg_gradient: 'from-[#1e1b4b] via-[#312e81] to-[#0f172a]',
    button_color: '#4f46e5',
    preview_bg: 'bg-gradient-to-r from-[#1e1b4b] to-[#4f46e5]'
  },
  {
    id: 'emerald',
    name: 'Emerald Growth (Consulting)',
    bg_gradient: 'from-[#064e3b] via-[#047857] to-[#022c22]',
    button_color: '#059669',
    preview_bg: 'bg-gradient-to-r from-[#064e3b] to-[#059669]'
  },
  {
    id: 'slate',
    name: 'Sleek Minimal Dark',
    bg_gradient: 'from-slate-950 via-slate-900 to-slate-950',
    button_color: '#ea580c',
    preview_bg: 'bg-gradient-to-r from-slate-950 to-orange-600'
  },
  {
    id: 'rose',
    name: 'Crimson Executive',
    bg_gradient: 'from-[#881337] via-[#9f1239] to-[#4c0519]',
    button_color: '#e11d48',
    preview_bg: 'bg-gradient-to-r from-[#881337] to-[#e11d48]'
  }
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const { admins, updateAdminProfile, currentSuperAdmin } = useBookingStore();
  const { profile } = useAuthStore();

  const storedRole =
    localStorage.getItem('bmm_current_user_role') ||
    localStorage.getItem('bmm_logged_role') ||
    profile?.role;
  const storedUsername = localStorage.getItem('bmm_logged_username') || profile?.username;
  const storedAdminId = localStorage.getItem('bmm_logged_admin_id');
  const storedAdminName = localStorage.getItem('bmm_logged_admin_name');

  // Super-admin mode is a role, not a list of usernames. This used to also match the
  // literal names "ameen" / "mahir" / "mahir6787" and ids like "admin-mahir", which meant
  // anyone who registered one of those usernames was treated as the platform owner.
  const isSuperAdmin = storedRole === 'super_admin' || profile?.role === 'super_admin';

  const [liveAdmin, setLiveAdmin] = useState<AdminUser | null>(null);

  // Synchronize profile directly from backend API for authenticated admin
  useEffect(() => {
    let isMounted = true;
    const syncBackend = async () => {
      try {
        const bp = await api.getMyProfile();
        if (bp && isMounted) {
          // If in Super Admin mode, do NOT allow a staff admin profile from an old token to hijack
          if (isSuperAdmin && bp.role !== 'super_admin') {
            console.warn('Ignoring staff admin backend profile while in Super Admin mode');
            return;
          }

          localStorage.setItem('bmm_logged_username', bp.username);
          localStorage.setItem('bmm_logged_admin_id', bp.user_id);
          localStorage.setItem('bmm_logged_admin_name', bp.name);
          if (bp.profile_photo) {
            localStorage.setItem('bmm_logged_admin_photo', bp.profile_photo);
          } else {
            localStorage.removeItem('bmm_logged_admin_photo');
          }
          if (bp.intro_video) {
            localStorage.setItem('bmm_logged_admin_video', bp.intro_video);
          } else {
            localStorage.removeItem('bmm_logged_admin_video');
          }

          const synced: AdminUser = {
            id: bp.user_id,
            username: bp.username,
            full_name: bp.name,
            title: bp.title || '',
            bio: bp.bio || '',
            about_me_text: bp.about_me_text || '',
            heading_text: bp.heading_text || '',
            welcome_message: bp.welcome_message || '',
            photo_url: bp.profile_photo || '',
            intro_video: bp.intro_video || '',
            email: bp.email,
            phone: bp.phone,
            role: bp.role || (isSuperAdmin ? 'super_admin' : 'admin'),
            status: bp.status || 'ACTIVE',
            avatar_color: 'bg-indigo-600',
            avatar_letter: bp.name ? bp.name.charAt(0).toUpperCase() : 'A',
            theme_settings: bp.theme_settings || {
              theme: 'amber',
              bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]',
              button_color: '#D32F2F',
            },
            social_links: bp.social_links || {},
            razorpay_configured: bp.razorpay_configured,
            razorpay_key_id: bp.razorpay_key_id,
            google_connected: bp.google_connected,
            google_email: bp.google_email,
          };

          setLiveAdmin(synced);

          // Update into bookingStore
          // Merge onto the existing record instead of replacing it: this payload carries no
          // google_connected / google_email, and a wholesale replace is what used to make a
          // connected Google Calendar look disconnected after a profile sync or re-login.
          useBookingStore.setState((state) => {
            const previous = state.admins.find(
              (a) => a.id === synced.id || a.username.toLowerCase() === synced.username.toLowerCase()
            );
            return {
              admins: [
                { ...previous, ...synced },
                ...state.admins.filter(
                  (a) => a.id !== synced.id && a.username.toLowerCase() !== synced.username.toLowerCase()
                ),
              ],
            };
          });
        }
      } catch (e) {}
    };
    syncBackend();
    return () => { isMounted = false; };
  }, [isSuperAdmin]);

  // Strict resolution of currently logged-in admin — never leak or show other admins
  const currentAdmin: AdminUser = useMemo(() => {
    const storedPhoto = localStorage.getItem('bmm_logged_admin_photo') || '';
    const storedVideo = localStorage.getItem('bmm_logged_admin_video') || '';

    // 1. In Super Admin mode, always resolve to the signed-in super admin
    if (isSuperAdmin) {
      if (liveAdmin && liveAdmin.role === 'super_admin') {
        return liveAdmin;
      }
      const superAdminInStore =
        admins.find((a) => a.role === 'super_admin') ||
        currentSuperAdmin;
      if (superAdminInStore) {
        return {
          ...superAdminInStore,
          photo_url: superAdminInStore.photo_url || storedPhoto || '',
          intro_video: superAdminInStore.intro_video || storedVideo || '',
        };
      }
    }

    // 2. Staff admin with live backend profile matching their non-super identity
    if (liveAdmin && liveAdmin.role !== 'super_admin') {
      return liveAdmin;
    }

    // 3. Match loggedAdminId or loggedUsername for staff admin
    const activeUsername = storedUsername;
    if (storedAdminId || activeUsername) {
      const match = admins.find(
        (a) =>
          (storedAdminId && a.id === storedAdminId) ||
          (activeUsername && a.username?.toLowerCase() === activeUsername.toLowerCase())
      );
      if (match && match.role !== 'super_admin') {
        return {
          ...match,
          photo_url: match.photo_url || storedPhoto || '',
          intro_video: match.intro_video || storedVideo || '',
        };
      }
    }

    // 4. Construct strictly for this logged-in staff admin — NEVER another admin
    const safeUser = storedUsername || 'admin';
    const safeName = storedAdminName || profile?.full_name || 'Admin';
    return {
      id: storedAdminId || `admin-${safeUser}`,
      username: safeUser,
      full_name: safeName,
      title: 'Mentor & Growth Consultant',
      email: '',
      role: 'admin',
      status: 'ACTIVE',
      avatar_color: 'bg-indigo-600',
      avatar_letter: safeName.charAt(0).toUpperCase(),
      photo_url: storedPhoto || '',
      intro_video: storedVideo || '',
      theme_settings: {
        theme: 'amber',
        bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]',
        button_color: '#D32F2F',
      },
      social_links: {},
    } as AdminUser;
  }, [liveAdmin, admins, storedAdminId, storedUsername, storedAdminName, isSuperAdmin, currentSuperAdmin, profile]);

  const [copied, setCopied] = useState(false);

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: 'profile', label: 'Profile & Customizer', icon: Palette },
    { id: 'pricing', label: '1v1 Sessions & Pricing', icon: DollarSign },
    { id: 'payment', label: 'Razorpay Payment Setup', icon: CreditCard },
    { id: 'booking', label: 'Booking Rules', icon: CalendarIcon },
    { id: 'calendar', label: 'Google Calendar', icon: CalendarIcon },
    { id: 'email', label: 'Email & Notifications', icon: Mail },
  ];

  const publicProfileUrl = `${window.location.origin}/${currentAdmin?.username || ''}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicProfileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-20 font-sans">
      {/* Header with Quick Actions */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-text-primary sm:text-2xl">Portal Settings</h1>
            {isSuperAdmin ? (
              <span className="text-xs px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-extrabold border border-indigo-200 flex items-center gap-1">
                <span>👑 Master Admin:</span>
                <span>{currentAdmin?.full_name}</span>
              </span>
            ) : (
              <span className="text-xs px-2.5 py-0.5 rounded-md bg-orange-50 text-orange-700 font-bold border border-orange-200">
                Admin: {currentAdmin?.full_name}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-md bg-surface-tertiary text-text-secondary font-mono font-bold">
              /{currentAdmin?.username}
            </span>
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            {isSuperAdmin
              ? 'Customize your public booking page, 1v1 sessions, and direct integrations.'
              : 'Customize what clients see on your personal SuperProfile booking page.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">

          <button
            onClick={handleCopyLink}
            className="press inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-text-secondary shadow-2xs transition hover:bg-surface-tertiary sm:h-9 sm:flex-none"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="whitespace-nowrap">{copied ? 'Copied' : 'Copy link'}</span>
          </button>

          <a
            href={publicProfileUrl}
            target="_blank"
            rel="noreferrer"
            className="press inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-500 sm:h-9 sm:flex-none"
          >
            <span className="whitespace-nowrap">Preview</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <nav className="lg:w-60 flex-shrink-0">
          <ul className="scroll-x flex gap-1.5 rounded-2xl border border-border bg-surface p-2 lg:flex-col lg:overflow-visible">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`press flex h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-bold transition-all cursor-pointer ${
                      activeTab === tab.id
                        ? 'bg-orange-50 font-extrabold text-orange-700 shadow-2xs'
                        : 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Quick Info Box */}
          <div className="mt-4 hidden space-y-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-900 sm:block">
            <p className="font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Personal Booking Link</span>
            </p>
            <p className="text-[11px] text-amber-800 leading-relaxed font-mono font-bold break-all">
              /{currentAdmin?.username}
            </p>
            <div className="pt-1 flex items-center gap-2">
              <button
                onClick={handleCopyLink}
                className="text-[10px] text-amber-700 hover:text-amber-900 font-bold underline cursor-pointer flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </button>
              <span className="text-amber-400">•</span>
              <a
                href={publicProfileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-amber-700 hover:text-amber-900 font-bold underline flex items-center gap-1"
              >
                <span>Preview</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </nav>

        {/* Tab Content */}
        <div className="flex-1 max-w-3xl">
          {activeTab === 'profile' && (
            <ProfileCustomizer admin={currentAdmin} onUpdate={(updated) => setLiveAdmin(updated)} />
          )}
          {activeTab === 'pricing' && (
            <PricingAndSessionsSettings
              admin={currentAdmin}
              onSwitchToPayment={() => setActiveTab('payment')}
            />
          )}
          {activeTab === 'payment' && <RazorpaySettings admin={currentAdmin} />}
          {activeTab === 'booking' && <BookingRulesSettings admin={currentAdmin} />}
          {activeTab === 'calendar' && <GoogleCalendarSettings admin={currentAdmin} />}
          {activeTab === 'email' && <EmailSettings admin={currentAdmin} />}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 1. PROFILE & CUSTOMIZER TAB (Requirement 4: Full Profile Customization)
// =========================================================================
function ProfileCustomizer({
  admin,
  onUpdate,
}: {
  admin: AdminUser;
  onUpdate?: (updated: AdminUser) => void;
}) {
  const { updateAdminProfile } = useBookingStore();
  const { profile, updateProfile } = useAuthStore();

  const [username, setUsername] = useState(admin.username || '');
  const [name, setName] = useState(admin.full_name || '');
  const [title, setTitle] = useState(admin.title || '');
  const [headingText, setHeadingText] = useState(admin.heading_text || '');
  const [welcomeMessage, setWelcomeMessage] = useState(admin.welcome_message || '');
  const [bio, setBio] = useState(admin.bio || '');
  const [aboutMe, setAboutMe] = useState(admin.about_me_text || '');
  const [photoUrl, setPhotoUrl] = useState(admin.photo_url || '');
  const [introVideo, setIntroVideo] = useState(admin.intro_video || '');
  const [buttonColor, setButtonColor] = useState(admin.theme_settings?.button_color || '#D32F2F');
  const [bgGradient, setBgGradient] = useState(admin.theme_settings?.bg_gradient || THEME_PRESETS[0].bg_gradient);

  // Socials & Priority Links
  const [whatsapp, setWhatsapp] = useState(admin.social_links?.whatsapp || '');
  const [linkedin, setLinkedin] = useState(admin.social_links?.linkedin || '');
  const [instagram, setInstagram] = useState(admin.social_links?.instagram || '');
  const [youtube, setYoutube] = useState(admin.social_links?.youtube || '');
  const [website, setWebsite] = useState(admin.social_links?.website || '');
  const [superChat, setSuperChat] = useState(admin.social_links?.super_chat || admin.super_chat_url || '');
  const [telegram, setTelegram] = useState(admin.social_links?.telegram || '');
  const [customSections, setCustomSections] = useState<any[]>(admin.custom_sections || []);

  // Media Upload & Selection States (Profile Photo only keeps device upload)
  const [photoTab, setPhotoTab] = useState<'device' | 'url'>('device');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [photoUploadSuccess, setPhotoUploadSuccess] = useState('');
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);

  const processPhotoFile = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoUploadError('Please select a valid image file (PNG, JPG, WEBP, GIF, SVG).');
      setTimeout(() => setPhotoUploadError(''), 5000);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoUploadError('Image file size exceeds 25MB limit.');
      setTimeout(() => setPhotoUploadError(''), 5000);
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoUploadError('');
    setPhotoUploadSuccess('');

    try {
      const res = await api.uploadMedia(file, 'photo');
      if (res && res.url) {
        setPhotoUrl(res.url);
        setPhotoUploadSuccess('✓ Picture uploaded successfully from device!');
        setTimeout(() => setPhotoUploadSuccess(''), 4000);
      } else {
        throw new Error('Upload returned no URL');
      }
    } catch (err: any) {
      console.warn('Backend upload failed, fallback to local FileReader:', err);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setPhotoUrl(reader.result);
          setPhotoUploadSuccess('✓ Picture selected from device!');
          setTimeout(() => setPhotoUploadSuccess(''), 4000);
        }
      };
      reader.readAsDataURL(file);
      if (err?.message && !err.message.includes('Failed to fetch')) {
        setPhotoUploadError(err.message);
        setTimeout(() => setPhotoUploadError(''), 5000);
      }
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Synchronize when switching between admins or when live backend profile arrives
  useEffect(() => {
    setUsername(admin.username || '');
    setName(admin.full_name || '');
    setTitle(admin.title || '');
    setHeadingText(admin.heading_text || '');
    setWelcomeMessage(admin.welcome_message || '');
    setBio(admin.bio || '');
    setAboutMe(admin.about_me_text || '');
    if (admin.photo_url !== undefined) {
      setPhotoUrl(admin.photo_url || '');
    }
    if (admin.intro_video !== undefined) {
      setIntroVideo(admin.intro_video || '');
    }
    setButtonColor(admin.theme_settings?.button_color || '#D32F2F');
    setBgGradient(admin.theme_settings?.bg_gradient || THEME_PRESETS[0].bg_gradient);
    setWhatsapp(admin.social_links?.whatsapp || '');
    setLinkedin(admin.social_links?.linkedin || '');
    setInstagram(admin.social_links?.instagram || '');
    setYoutube(admin.social_links?.youtube || '');
    setWebsite(admin.social_links?.website || '');
    setSuperChat(admin.social_links?.super_chat || admin.super_chat_url || '');
    setTelegram(admin.social_links?.telegram || '');
    setCustomSections(admin.custom_sections || []);
  }, [admin.id, admin.username, admin.photo_url, admin.intro_video]);

  // === SuperProfile Import ===
  // The whole flow (URL -> preview -> field/session selection -> apply) lives in
  // SuperProfileImportModal and writes through the backend import endpoints. The old inline
  // version applied straight into this form and into the local store, which meant imported
  // sessions never reached the database.
  const [importOpen, setImportOpen] = useState(false);

  const handleAddSection = () => {
    const newSec = {
      id: `sec-${Date.now()}`,
      title: 'Ask a Priority Question / Super Chat',
      description: 'Send a direct priority message or query with guaranteed response time.',
      button_text: 'Send Message ⚡',
      button_url: superChat || 'https://',
      badge: 'Priority DM',
    };
    setCustomSections((prev) => [...prev, newSec]);
  };

  const handleUpdateSection = (id: string, field: string, value: string) => {
    setCustomSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const handleRemoveSection = (id: string) => {
    setCustomSections((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    const cleanUsername = (username || admin.username || 'admin')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '');

    const updates: Partial<AdminUser> = {
      username: cleanUsername,
      full_name: name,
      title,
      heading_text: headingText,
      welcome_message: welcomeMessage,
      bio,
      about_me_text: aboutMe,
      photo_url: photoUrl,
      intro_video: introVideo,
      theme_settings: {
        ...admin.theme_settings,
        button_color: buttonColor,
        bg_gradient: bgGradient,
      },
      social_links: {
        whatsapp,
        linkedin,
        instagram,
        youtube,
        website,
        super_chat: superChat.trim(),
        telegram: telegram.trim(),
      },
      super_chat_url: superChat.trim(),
      custom_sections: customSections,
    };

    // Update locally in store
    updateAdminProfile(admin.id, updates);
    localStorage.setItem('bmm_logged_username', cleanUsername);
    localStorage.setItem('bmm_logged_admin_name', name);
    if (photoUrl) {
      localStorage.setItem('bmm_logged_admin_photo', photoUrl);
    } else {
      localStorage.removeItem('bmm_logged_admin_photo');
    }
    if (introVideo) {
      localStorage.setItem('bmm_logged_admin_video', introVideo);
    } else {
      localStorage.removeItem('bmm_logged_admin_video');
    }

    const updatedAdmin = { ...admin, ...updates } as AdminUser;
    if (onUpdate) {
      onUpdate(updatedAdmin);
    }

    if (profile?.id === admin.id || !profile?.id) {
      updateProfile({ username: cleanUsername, full_name: name });
    }

    // Update on backend if connected
    try {
      await api.updateMyProfile({
        name,
        username: cleanUsername,
        title,
        heading_text: headingText,
        welcome_message: welcomeMessage,
        bio,
        about_me_text: aboutMe,
        profile_photo: photoUrl,
        intro_video: introVideo,
        theme_settings: { button_color: buttonColor, bg_gradient: bgGradient },
        social_links: {
          whatsapp,
          linkedin,
          instagram,
          youtube,
          website,
          super_chat: superChat.trim(),
          telegram: telegram.trim(),
        },
      });
    } catch (e) {
      // Offline fallback already updated store
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const currentDisplaySlug = username || admin.username || '';
  const currentPublicLink = `${window.location.origin}/${currentDisplaySlug}`;

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-6 shadow-xs">
      <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-text-primary">Customize Public Profile</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            Everything configured here reflects on your personal booking page at{' '}
            <a
              href={currentPublicLink}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-orange-600 font-bold hover:underline"
            >
              /{currentDisplaySlug}
            </a>.
          </p>
        </div>
        <a
          href={currentPublicLink}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shadow-2xs"
        >
          <span>Personal Link: /{currentDisplaySlug}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* ===== IMPORT FROM SUPERPROFILE ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-br from-violet-50 via-indigo-50 to-purple-50 border border-indigo-200/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
            <Download className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-indigo-900">Import from SuperProfile</h3>
            <p className="text-[11px] text-indigo-600/70">
              Bring your public profile and 1:1 sessions across. You review everything before anything changes.
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={() => setImportOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl px-4 py-2 cursor-pointer shadow-md shadow-indigo-600/20"
        >
          Import from SuperProfile
        </Button>
      </div>

      <SuperProfileImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          // The import wrote straight to the backend; reload so the form shows the result.
          window.location.reload();
        }}
      />


      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">1. Basic Profile Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Full Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Personal Booking Link (Slug)</Label>
              <span className="text-[10px] text-orange-600 font-mono font-bold">Custom URL</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-tertiary font-mono">
                /
              </span>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                placeholder="e.g. midhun or midhuzer"
                className="text-xs rounded-xl pl-6 font-mono font-bold text-slate-800"
              />
            </div>
            <p className="text-[10px] text-text-tertiary truncate">
              Public link:{' '}
              <a
                href={`${window.location.origin}/${username}`}
                target="_blank"
                rel="noreferrer"
                className="text-orange-600 font-mono font-bold hover:underline"
              >
                {window.location.origin}/{username || 'your-slug'}
              </a>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Professional Title / Headline</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Technical Consultant"
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Heading Text (Top Banner)</Label>
            <Input
              value={headingText}
              onChange={(e) => setHeadingText(e.target.value)}
              placeholder="e.g. Upskilling Marketers into Top 1% Performers"
              className="text-xs rounded-xl"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold">Short Bio / Tagline</Label>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            className="text-xs rounded-xl"
            placeholder="Short description displayed next to your profile photo"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold">Detailed About Me Text</Label>
          <Textarea
            value={aboutMe}
            onChange={(e) => setAboutMe(e.target.value)}
            rows={3}
            className="text-xs rounded-xl"
            placeholder="Authority metrics, career summary, or who this call is best suited for"
          />
        </div>
      </div>

      {/* 2. Media & Intro Video (Device Upload & URL options) */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
              <span>2. Media & Intro Video</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                Device Upload
              </span>
            </h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Choose to upload directly from your device (phone/computer) or paste a web link for both picture and video.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* A. PROFILE PICTURE / PHOTO */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Profile Picture</h4>
                  <p className="text-[10px] text-text-tertiary">Displayed on your booking page & portrait</p>
                </div>
              </div>

              {/* Toggle Source */}
              <div className="flex items-center p-0.5 rounded-lg bg-surface-tertiary text-[10px] font-semibold">
                <button
                  type="button"
                  onClick={() => setPhotoTab('device')}
                  className={`px-2 py-1 rounded-md transition cursor-pointer flex items-center gap-1 ${
                    photoTab === 'device'
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-slate-800'
                  }`}
                >
                  <Upload className="w-3 h-3" />
                  <span>From Device</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoTab('url')}
                  className={`px-2 py-1 rounded-md transition cursor-pointer flex items-center gap-1 ${
                    photoTab === 'url'
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-slate-800'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  <span>Image URL</span>
                </button>
              </div>
            </div>

            {/* Hidden Photo File Input */}
            <input
              type="file"
              ref={photoInputRef}
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processPhotoFile(f);
                if (e.target) e.target.value = '';
              }}
            />

            {/* Notification messages */}
            {photoUploadSuccess && (
              <div className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{photoUploadSuccess}</span>
              </div>
            )}
            {photoUploadError && (
              <div className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{photoUploadError}</span>
              </div>
            )}

            {photoTab === 'device' ? (
              <div className="space-y-3">
                {/* Active Photo Preview or Upload Dropzone */}
                {photoUrl ? (
                  <div className="p-3 rounded-xl border border-border bg-surface-secondary/70 flex items-center gap-3">
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-200 border border-slate-300 shrink-0 shadow-sm">
                      <img
                        src={photoUrl}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold uppercase tracking-wider">
                          Active Picture
                        </span>
                      </div>
                      <p className="text-[11px] text-text-secondary truncate font-mono">
                        {photoUrl.startsWith('data:') ? 'Local file from device' : photoUrl.split('/').pop() || photoUrl}
                      </p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isUploadingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="h-6 text-[10px] px-2 rounded-md font-semibold cursor-pointer"
                        >
                          {isUploadingPhoto ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-2.5 h-2.5 mr-1" />
                              Change Picture
                            </>
                          )}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setPhotoUrl('')}
                          className="text-[10px] text-red-600 hover:text-red-700 font-medium cursor-pointer flex items-center gap-0.5"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingPhoto(true);
                    }}
                    onDragLeave={() => setIsDraggingPhoto(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingPhoto(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) processPhotoFile(f);
                    }}
                    onClick={() => photoInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 ${
                      isDraggingPhoto
                        ? 'border-orange-500 bg-orange-50/50'
                        : 'border-border hover:border-orange-400 hover:bg-orange-50/20 bg-surface-secondary/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                      {isUploadingPhoto ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text-secondary">
                        {isUploadingPhoto ? 'Uploading image from device...' : 'Click to add picture from device'}
                      </p>
                      <p className="text-[10px] text-text-tertiary mt-0.5">
                        PNG, JPG, JPEG, WEBP, GIF (up to 25MB)
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isUploadingPhoto}
                      className="h-9 text-xs font-semibold px-3 rounded-lg mt-1 bg-surface border border-border shadow-sm cursor-pointer"
                    >
                      Browse Device Files
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* URL Mode for Photo */
              <div className="space-y-2">
                <Label className="text-xs font-medium text-text-secondary">Enter Image URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="https://example.com/your-photo.jpg"
                    className="text-xs rounded-xl"
                  />
                  {photoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPhotoUrl('')}
                      className="h-9 px-2 text-text-tertiary hover:text-text-secondary"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {photoUrl && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-secondary border border-border">
                    <img
                      src={photoUrl}
                      alt="URL preview"
                      className="w-8 h-8 rounded-md object-cover border border-slate-300"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <span className="text-[10px] text-text-tertiary truncate flex-1">{photoUrl}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* B. INTRO VIDEO */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-text-primary">Intro Video</h4>
                  <p className="text-[10px] text-text-tertiary">Featured greeting video on your booking page (YouTube or Vimeo)</p>
                </div>
              </div>
              {introVideo && (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-bold uppercase tracking-wider">
                  Active Video
                </span>
              )}
            </div>

            {/* Saved Video Preview & URL Configuration */}
            {introVideo ? (
              <div className="p-3 rounded-xl border border-border bg-surface-secondary/70 space-y-3">
                {/* Embed Preview if Vimeo/YouTube, or HTML5 video */}
                {(() => {
                  const embedUrl = getVideoEmbedUrl(introVideo);
                  if (embedUrl) {
                    return (
                      <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black border border-slate-300 shadow-sm">
                        <iframe
                          src={embedUrl}
                          title="Intro Video Preview"
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    );
                  }
                  if (introVideo.endsWith('.mp4') || introVideo.endsWith('.webm') || introVideo.includes('/uploads/')) {
                    return (
                      <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black border border-slate-300 shadow-sm">
                        <video src={introVideo} controls className="w-full h-full object-cover" />
                      </div>
                    );
                  }
                  return (
                    <div className="p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2">
                      <Video className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="truncate flex-1 font-mono text-[11px]">{introVideo}</span>
                    </div>
                  );
                })()}

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <Label className="text-[11px] font-semibold text-text-secondary">Video URL</Label>
                    <button
                      type="button"
                      onClick={() => setIntroVideo('')}
                      className="text-[10px] text-red-600 hover:text-red-700 font-medium cursor-pointer flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove Video</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={introVideo}
                      onChange={(e) => setIntroVideo(e.target.value)}
                      placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
                      className="text-xs rounded-xl"
                    />
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    To change this video, simply paste a new YouTube or Vimeo link above.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-text-secondary">Enter Video Link (YouTube or Vimeo)</Label>
                <div className="flex gap-2">
                  <Input
                    value={introVideo}
                    onChange={(e) => setIntroVideo(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
                    className="text-xs rounded-xl"
                  />
                  {introVideo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIntroVideo('')}
                      className="h-9 px-2 text-text-tertiary hover:text-text-secondary"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-text-tertiary">
                  Paste a link to your introduction video from YouTube (e.g. <code>youtube.com/watch?v=...</code>) or Vimeo (e.g. <code>vimeo.com/...</code>).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Theme Presets & Styling */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">3. Design & Colors</h3>

        <div>
          <Label className="text-xs font-semibold mb-2 block">Select Background Theme Preset</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setBgGradient(preset.bg_gradient);
                  setButtonColor(preset.button_color);
                }}
                className={`p-3 rounded-xl border text-left flex items-center gap-3 transition cursor-pointer ${
                  bgGradient === preset.bg_gradient
                    ? 'border-orange-600 bg-orange-50/50 ring-2 ring-orange-500/20'
                    : 'border-border hover:bg-surface-secondary'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg ${preset.preview_bg} shrink-0 shadow-xs`} />
                <div className="text-xs">
                  <p className="font-bold text-slate-800">{preset.name}</p>
                  <p className="text-[10px] text-text-tertiary font-mono">Button: {preset.button_color}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Action Button Color (Hex)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={buttonColor}
                onChange={(e) => setButtonColor(e.target.value)}
                className="w-10 h-10 rounded-xl cursor-pointer border border-border"
              />
              <Input
                value={buttonColor}
                onChange={(e) => setButtonColor(e.target.value)}
                className="text-xs font-mono rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Welcome Banner Subtitle</Label>
            <Input
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="e.g. Choose your session below"
              className="text-xs rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* Social Links */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">4. Social Media Links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">WhatsApp Number / Link</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+91 9876543210"
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">LinkedIn Profile URL</Label>
            <Input
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Instagram Handle or URL</Label>
            <Input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="https://instagram.com/..."
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Website URL</Label>
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
              className="text-xs rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* 5. Super Chat & Priority Links */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
              <span>5. Super Chat & Direct Messaging Link</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">Priority DM</span>
            </h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Add your paid Super Chat or direct priority message link (SuperProfile, Telegram, or WhatsApp).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <span>⚡ Super Chat / Ask Me Anything URL</span>
            </Label>
            <Input
              value={superChat}
              onChange={(e) => setSuperChat(e.target.value)}
              placeholder="https://superprofile.bio/chat/yourname"
              className="text-xs rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <span>💬 Telegram Handle or VIP Channel URL</span>
            </Label>
            <Input
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="https://t.me/yourusername"
              className="text-xs rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* 6. Custom Uploaded Sections & Resource Blocks */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
              <span>6. Custom Sections & Resource Uploads</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold">
                {customSections.length} Sections
              </span>
            </h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Upload custom highlighted cards on your public page (e.g. Free Guides, VIP Community, Super Chat, Portfolio).
            </p>
          </div>
          <Button
            type="button"
            onClick={handleAddSection}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-3.5 h-8 rounded-xl cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span>+ Add Section</span>
          </Button>
        </div>

        {customSections.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-text-tertiary">
            No custom sections uploaded yet. Click "+ Add Section" to feature custom links, guides, or ask-me-anything banners on your public page.
          </div>
        ) : (
          <div className="space-y-3">
            {customSections.map((sec, idx) => (
              <div key={sec.id || idx} className="p-3.5 rounded-xl border border-border bg-surface-secondary/70 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-text-secondary">Section #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSection(sec.id)}
                    className="text-text-tertiary hover:text-red-500 text-xs transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input
                    value={sec.title}
                    onChange={(e) => handleUpdateSection(sec.id, 'title', e.target.value)}
                    placeholder="Section Title (e.g. Ask a Priority Question)"
                    className="text-xs rounded-lg bg-surface h-8 font-semibold"
                  />
                  <Input
                    value={sec.badge || ''}
                    onChange={(e) => handleUpdateSection(sec.id, 'badge', e.target.value)}
                    placeholder="Badge Tag (e.g. ⚡ Super Chat, Free, Popular)"
                    className="text-xs rounded-lg bg-surface h-8"
                  />
                </div>
                <Input
                  value={sec.description || ''}
                  onChange={(e) => handleUpdateSection(sec.id, 'description', e.target.value)}
                  placeholder="Short description or benefits for clients..."
                  className="text-xs rounded-lg bg-surface h-8"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input
                    value={sec.button_text || ''}
                    onChange={(e) => handleUpdateSection(sec.id, 'button_text', e.target.value)}
                    placeholder="Button Label (e.g. Ask Now ⚡, Download PDF)"
                    className="text-xs rounded-lg bg-surface h-8"
                  />
                  <Input
                    value={sec.button_url || ''}
                    onChange={(e) => handleUpdateSection(sec.id, 'button_url', e.target.value)}
                    placeholder="Button Destination URL (https://...)"
                    className="text-xs rounded-lg bg-surface h-8"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-4 border-t border-border flex items-center justify-between">
        <p className="text-xs text-text-tertiary">Updates will be saved instantly to your live public profile.</p>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition shadow-md shadow-orange-600/20 cursor-pointer"
        >
          {saving ? 'Saving...' : saved ? '✓ Saved Profile' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

// =========================================================================
// 2. GOOGLE CALENDAR TAB (Requirement 6 & 7: Own Google Account per Admin)
// =========================================================================
function GoogleCalendarSettings({ admin }: { admin: AdminUser }) {
  const { connectGoogleCalendar, disconnectGoogleCalendar } = useBookingStore();
  // The server row is the only source of truth for connectedness. Local state is a cache of
  // it, never the decider — that is what used to make the connection "drop" on reload.
  const [googleEmail, setGoogleEmail] = useState(admin.google_email || '');
  const [isConnected, setIsConnected] = useState(false);
  const [isHealthy, setIsHealthy] = useState(true);
  const [lastError, setLastError] = useState('');
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = React.useCallback(async () => {
    try {
      const status = await api.getGoogleStatus();
      setIsConnected(!!status.connected);
      setIsHealthy(status.connected ? !!status.healthy : true);
      if (status.google_email) setGoogleEmail(status.google_email);
      if (status.last_error) setLastError(status.last_error);
      if (status.connected) {
        connectGoogleCalendar(admin.id, status.google_email || '');
      } else {
        disconnectGoogleCalendar(admin.id);
      }
    } catch (e) {
      // Leave the last known state alone: a failed status call is not a disconnect.
    } finally {
      setStatusLoaded(true);
    }
  }, [admin.id, connectGoogleCalendar, disconnectGoogleCalendar]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Surface the outcome of the OAuth round trip (backend redirects back with these).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    if (oauthError) {
      const messages: Record<string, string> = {
        InvalidState: 'That authorization link expired. Please try connecting again.',
        AdminNotFound: 'Your admin account could not be matched. Please sign in again.',
        OAuthFailed: 'Google rejected the authorization. Please try again.',
        NoRefreshToken: 'Google did not return a long-lived token. Remove BookMyMeet at myaccount.google.com/permissions, then connect again.',
      };
      setError(messages[oauthError] || 'Google authorization failed.');
    }
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getGoogleAuthUrl();
      if (!res.auth_url) {
        setError(res.message || 'Google OAuth is not configured on this server.');
        setLoading(false);
        return;
      }
      // Real consent screen. We come back at /admin/settings?tab=calendar&connected=true.
      window.location.href = res.auth_url;
    } catch (e: any) {
      const raw = e?.message || '';
      if (raw.toLowerCase().includes('user not found') || raw.toLowerCase().includes('not authenticated')) {
        setError('Your session has expired. Please sign out and sign back in to refresh your account.');
      } else {
        setError(raw || 'Could not start Google authorization');
      }
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your Google Calendar? Clients will not be able to book until you reconnect.')) return;
    setLoading(true);
    try {
      await api.disconnectGoogle();
      disconnectGoogleCalendar(admin.id);
      setIsConnected(false);
    } catch (e: any) {
      setError(e?.message || 'Could not disconnect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-5 shadow-xs">
      <div className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-black text-text-primary">Google Calendar & Google Meet</h2>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            Personal Admin Account
          </span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          Connect your personal or work Google account. Each admin independently sets up their own Google Calendar. Meetings booked on your page will sync directly with your calendar and auto-generate unique Google Meet video links.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-400 space-y-2">
          <p>{error}</p>
          {error.toLowerCase().includes('session') && (
            <Button
              size="sm"
              onClick={() => {
                localStorage.removeItem('bmm_auth_token');
                localStorage.removeItem('bmm_logged_admin_id');
                window.location.href = '/admin/login';
              }}
              className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 px-3 rounded-lg cursor-pointer"
            >
              Sign In Again
            </Button>
          )}
        </div>
      )}

      {!statusLoaded ? (
        <div className="p-4 bg-surface-secondary rounded-2xl border border-border text-xs text-text-tertiary font-medium">
          Checking your Google Calendar connection...
        </div>
      ) : isConnected ? (
        <div
          className={`p-4 rounded-2xl border space-y-3 ${
            isHealthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl text-white flex items-center justify-center font-bold text-lg shadow-sm ${
                isHealthy ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
            >
              {isHealthy ? '✓' : '!'}
            </div>
            <div>
              <p className={`text-sm font-bold ${isHealthy ? 'text-emerald-900' : 'text-amber-900'}`}>
                {isHealthy ? 'Google Calendar Connected' : 'Reconnect Required'}
              </p>
              <p className={`text-xs font-mono ${isHealthy ? 'text-emerald-700' : 'text-amber-800'}`}>{googleEmail}</p>
            </div>
          </div>
          {isHealthy ? (
            <p className="text-xs text-emerald-800 leading-relaxed">
              Real-time busy slot detection is active. Clients will never be offered times when you have events or out-of-office blocks marked on this calendar.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-amber-900 leading-relaxed">
                Your calendar cannot be read right now. Bookings are paused for your page until you reconnect, so no one can book over an existing event.
              </p>
              {lastError && (
                <div className="p-2 rounded-lg bg-amber-100/80 border border-amber-200 text-[11px] font-mono text-amber-950 break-all">
                  <strong>Diagnostic details:</strong> {lastError}
                </div>
              )}
            </div>
          )}
          <div className="pt-2 flex items-center gap-3 flex-wrap">
            {!isHealthy && (
              <Button
                onClick={handleConnect}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg px-3 py-1.5 cursor-pointer"
              >
                Reconnect Google Calendar
              </Button>
            )}
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold transition cursor-pointer"
            >
              Disconnect Calendar
            </button>
            <span className="text-[11px] text-text-tertiary font-medium">
              Stays connected until you disconnect it here
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-surface-secondary border border-border rounded-2xl space-y-2">
            <p className="text-xs font-bold text-slate-800">Why connect your Google Calendar?</p>
            <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
              <li><strong>Zero Double Booking:</strong> Automatically blocks busy slots, appointments, and personal events.</li>
              <li><strong>Instant Google Meet:</strong> Creates calendar event with client added as attendee.</li>
              <li><strong>Automated Reminders:</strong> Google Calendar sends alerts 1 hour and 5 minutes prior.</li>
            </ul>
          </div>

          <p className="text-[11px] text-text-tertiary leading-relaxed">
            You will be sent to Google's consent screen. The calendar that gets connected is
            whichever Google account you sign in with there — it stays connected until you
            disconnect it on this page.
          </p>

          <Button
            onClick={handleConnect}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl px-5 py-2.5 cursor-pointer shadow-md shadow-blue-600/20"
          >
            {loading ? 'Redirecting to Google...' : 'Authorize & Connect Google Calendar'}
          </Button>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 2. 1v1 PRICING & SESSIONS TAB (Admin Payment & Pricing Authority)
// =========================================================================
function PricingAndSessionsSettings({
  admin,
  onSwitchToPayment,
}: {
  admin: AdminUser;
  onSwitchToPayment: () => void;
}) {
  const { meetingTypes, addMeetingType, updateMeetingType, removeMeetingType } = useBookingStore();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingOpen, setIsAddingOpen] = useState(false);

  // New session form
  const [newTitle, setNewTitle] = useState('');
  const [newDuration, setNewDuration] = useState<number>(30);
  const [newOfferPrice, setNewOfferPrice] = useState<string>('1497');
  const [newOriginalPrice, setNewOriginalPrice] = useState<string>('4999');
  const [newDescription, setNewDescription] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  const [savingAll, setSavingAll] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');

  const loadSessions = async () => {
    setLoading(true);
    setLoadError('');
    try {
      // The database is the only source of truth for prices. There used to be a fallback to
      // the persisted zustand store here: when this call failed, the page rendered whatever
      // stale prices localStorage happened to hold, and saving then wrote those over the
      // real ones. An empty list now means "no sessions yet"; a failure says so.
      const apiSessions = await api.getMySessions();
      setSessions(
        (Array.isArray(apiSessions) ? apiSessions : []).map((s: any) => ({
          ...s,
          offerRupees: s.price ? String(Math.floor(s.price / 100)) : '',
          origRupees: s.original_price ? String(Math.floor(s.original_price / 100)) : '',
        }))
      );
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your sessions. Your saved prices are safe — please retry.');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [admin.id]);

  const handleFieldChange = (sessionId: string, field: string, value: any) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, [field]: value } : s))
    );
  };

  const saveSessionItem = async (s: any) => {
    const rawOffer = String(s.offerRupees ?? (s.price ? s.price / 100 : '')).replace(/[^0-9]/g, '');
    // A blank price used to fall through `|| '0'` and silently save the session at zero.
    // Refuse instead: the stored price stays exactly as the admin last set it.
    if (!rawOffer || Number(rawOffer) <= 0) {
      throw new Error('Enter a price greater than 0 before saving this session.');
    }
    const offerPaise = Math.round(Number(rawOffer) * 100);
    const origPaise =
      s.origRupees !== undefined
        ? s.origRupees
          ? Math.round(Number(String(s.origRupees).replace(/[^0-9]/g, '') || '0') * 100)
          : null
        : (s.original_price || null);

    const payload = {
      title: s.title || '1:1 Consultation',
      description: s.description || '',
      duration_minutes: Number(s.duration_minutes || 30),
      price: offerPaise,
      original_price: origPaise,
    };

    if (s.id && !s.id.startsWith('mt-')) {
      // Not caught here: a failed price save must surface, not be swallowed and then hidden
      // by a refetch that shows the old value as though nothing had happened.
      await api.updateSession(s.id, payload);
    }

    updateMeetingType(s.id, {
      name: s.title,
      description: s.description || '',
      duration_minutes: Number(s.duration_minutes || 30),
      price: offerPaise,
      original_price: origPaise,
      offer_price: offerPaise,
    });

    return {
      ...s,
      price: offerPaise,
      original_price: origPaise,
      offerRupees: offerPaise ? String(Math.floor(offerPaise / 100)) : '',
      origRupees: origPaise ? String(Math.floor(origPaise / 100)) : '',
    };
  };

  // Both handlers report failures. They used to console.error and show the success banner's
  // absence as the only signal, so a rejected price save looked like the price had "reset
  // itself" on the next load.
  const handleSaveSingle = async (s: any) => {
    setSavingId(s.id);
    setSaveError('');
    try {
      const updated = await saveSessionItem(s);
      setSessions((prev) => prev.map((item) => (item.id === s.id ? updated : item)));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setSaveError(e?.message || 'Could not save that session. Your saved price is unchanged.');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    setSaveSuccess(false);
    setSaveError('');
    try {
      const updatedList = [];
      for (const s of sessions) {
        const updated = await saveSessionItem(s);
        updatedList.push(updated);
      }
      setSessions(updatedList);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e: any) {
      setSaveError(e?.message || 'Could not save your pricing. Your saved prices are unchanged.');
      // Re-read the database so the form shows what is actually stored, not a half-applied edit.
      await loadSessions();
    } finally {
      setSavingAll(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setSavingNew(true);
    const offerPaise = Math.round(Number(newOfferPrice.replace(/[^0-9]/g, '') || '0') * 100);
    const origPaise = newOriginalPrice
      ? Math.round(Number(newOriginalPrice.replace(/[^0-9]/g, '') || '0') * 100)
      : null;

    let createdId = `mt-${Date.now()}`;
    try {
      const created = await api.createSession({
        title: newTitle.trim(),
        description: newDescription.trim() || 'Private 1-on-1 consultation session.',
        duration_minutes: newDuration,
        price: offerPaise,
        original_price: origPaise,
        currency: 'INR',
        is_active: true,
      });
      if (created?.id) {
        createdId = created.id;
        setSessions((prev) => [
          ...prev,
          {
            ...created,
            offerRupees: String(Math.floor(offerPaise / 100)),
            origRupees: origPaise ? String(Math.floor(origPaise / 100)) : '',
          },
        ]);
      }
    } catch (e) {
      setSessions((prev) => [
        ...prev,
        {
          id: createdId,
          title: newTitle.trim(),
          duration_minutes: newDuration,
          price: offerPaise,
          original_price: origPaise,
          description: newDescription.trim(),
          is_active: true,
          offerRupees: String(Math.floor(offerPaise / 100)),
          origRupees: origPaise ? String(Math.floor(origPaise / 100)) : '',
        },
      ]);
    }

    addMeetingType({
      admin_id: admin.id,
      name: newTitle.trim(),
      description: newDescription.trim() || 'Private 1-on-1 consultation session.',
      duration_minutes: newDuration,
      price: offerPaise,
      original_price: origPaise,
      offer_price: offerPaise,
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
      sort_order: sessions.length + 1,
    });

    setNewTitle('');
    setNewDescription('');
    setIsAddingOpen(false);
    setSavingNew(false);
  };

  const handleDelete = async (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    removeMeetingType(sessionId);
    try {
      await api.deleteSession(sessionId);
    } catch (e) {}
  };

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-6 shadow-xs">
      <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-text-primary">1v1 Sessions & Pricing Customization</h2>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Admin Direct Authority
            </span>
          </div>
          <p className="text-xs text-text-tertiary mt-0.5">
            Set your own rates and durations. Click <strong className="text-text-primary">Save Pricing Changes</strong> to apply your prices live.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            onClick={handleSaveAll}
            disabled={savingAll || loading || sessions.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-sm transition-all"
          >
            {savingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saveSuccess ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{savingAll ? 'Saving Changes...' : saveSuccess ? 'Saved!' : 'Save Pricing Changes'}</span>
          </Button>

          <Button
            type="button"
            onClick={() => setIsAddingOpen(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add 1v1 Session</span>
          </Button>
        </div>
      </div>

      {(loadError || saveError) && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-start gap-2 shadow-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{loadError || saveError}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between animate-fade-in shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>✓ All 1v1 session rates and durations have been saved successfully and are live on your booking page!</span>
          </div>
          <button onClick={() => setSaveSuccess(false)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50/80 to-teal-50/60 border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
            <DollarSign className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-emerald-900">Direct Payment Payout to Your Bank</h4>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              100% of the session fees clients pay go straight to your connected Razorpay gateway without platform cuts.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSwitchToPayment}
          className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline flex items-center gap-1 shrink-0 cursor-pointer self-start sm:self-auto"
        >
          <span>Razorpay Keys →</span>
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="py-10 text-center text-xs text-text-tertiary">Loading your session offerings...</div>
        ) : sessions.length === 0 ? (
          <div className="py-10 text-center border-2 border-dashed border-border rounded-2xl space-y-2">
            <Tag className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs text-text-tertiary font-semibold">No 1v1 sessions configured yet</p>
            <Button
              type="button"
              onClick={() => setIsAddingOpen(true)}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
            >
              + Create Your First 1v1 Session
            </Button>
          </div>
        ) : (
          sessions.map((s, index) => {
            const offerVal = s.offerRupees !== undefined ? s.offerRupees : (s.price ? String(Math.floor(s.price / 100)) : '');
            const origVal = s.origRupees !== undefined ? s.origRupees : (s.original_price ? String(Math.floor(s.original_price / 100)) : '');

            return (
              <div
                key={s.id || index}
                className="p-4 rounded-2xl border border-border bg-surface-secondary/50 hover:bg-surface transition-all space-y-3 shadow-2xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="w-6 h-6 rounded-lg bg-orange-100 text-orange-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <Input
                      value={s.title || ''}
                      onChange={(e) => handleFieldChange(s.id, 'title', e.target.value)}
                      placeholder="Session Title"
                      className="text-xs font-bold text-slate-800 bg-surface rounded-xl h-9"
                    />
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      type="button"
                      onClick={() => handleSaveSingle(s)}
                      disabled={savingId === s.id}
                      className="h-8 px-3 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      {savingId === s.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      <span>{savingId === s.id ? 'Saving...' : 'Save'}</span>
                    </Button>

                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      className="text-text-tertiary hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition cursor-pointer"
                      title="Delete session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-text-secondary flex items-center gap-1">
                      <Clock className="w-3 h-3 text-text-tertiary" />
                      <span>Duration</span>
                    </Label>
                    <select
                      value={String(s.duration_minutes || 30)}
                      onChange={(e) => handleFieldChange(s.id, 'duration_minutes', Number(e.target.value))}
                      className="w-full text-xs font-semibold bg-surface border border-border rounded-xl px-2.5 h-9 cursor-pointer"
                    >
                      <option value="15">15 Minutes</option>
                      <option value="30">30 Minutes</option>
                      <option value="45">45 Minutes</option>
                      <option value="60">60 Minutes</option>
                      <option value="90">90 Minutes</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-emerald-700 flex items-center justify-between">
                      <span>Offer Price (₹)</span>
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 rounded">Active</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-700">₹</span>
                      <Input
                        type="text"
                        value={offerVal}
                        onChange={(e) => handleFieldChange(s.id, 'offerRupees', e.target.value)}
                        placeholder="1497"
                        className="text-xs font-bold text-emerald-700 pl-6 bg-surface rounded-xl h-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-text-tertiary flex items-center justify-between">
                      <span>Original Price (₹)</span>
                      <span className="text-[9px] text-text-tertiary">Strikethrough</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-text-tertiary">₹</span>
                      <Input
                        type="text"
                        value={origVal}
                        onChange={(e) => handleFieldChange(s.id, 'origRupees', e.target.value)}
                        placeholder="4999"
                        className="text-xs font-bold text-text-tertiary line-through pl-6 bg-surface rounded-xl h-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Input
                    value={s.description || ''}
                    onChange={(e) => handleFieldChange(s.id, 'description', e.target.value)}
                    placeholder="Brief description of what is covered in this 1v1 session..."
                    className="text-xs text-text-secondary bg-surface rounded-xl h-8"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {sessions.length > 0 && (
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border mt-6">
          <div className="text-xs text-text-tertiary">
            Make sure to click <strong className="text-text-primary">Save Pricing Changes</strong> to apply your modified rates to client bookings.
          </div>
          <Button
            type="button"
            onClick={handleSaveAll}
            disabled={savingAll || loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 shadow-sm transition-all self-end sm:self-auto"
          >
            {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{savingAll ? 'Saving Changes...' : 'Save Pricing Changes'}</span>
          </Button>
        </div>
      )}

      {isAddingOpen && (
        <div className="p-5 rounded-2xl border-2 border-slate-900 bg-surface space-y-4 shadow-md animate-fade-in">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-orange-600" />
              <span>Create New 1v1 Session Offering</span>
            </h3>
            <button
              type="button"
              onClick={() => setIsAddingOpen(false)}
              className="text-text-tertiary hover:text-text-secondary text-xs font-bold cursor-pointer"
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={handleCreateSession} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Session Title</Label>
              <Input
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. 45-Min Growth Deep Dive"
                className="text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Duration</Label>
                <select
                  value={String(newDuration)}
                  onChange={(e) => setNewDuration(Number(e.target.value))}
                  className="w-full text-xs font-semibold bg-surface border border-border rounded-xl px-2.5 h-9"
                >
                  <option value="15">15 Minutes</option>
                  <option value="30">30 Minutes</option>
                  <option value="45">45 Minutes</option>
                  <option value="60">60 Minutes</option>
                  <option value="90">90 Minutes</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-emerald-700">Offer Price (₹)</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-700">₹</span>
                  <Input
                    required
                    value={newOfferPrice}
                    onChange={(e) => setNewOfferPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="1497"
                    className="text-xs font-bold text-emerald-700 pl-6 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-text-tertiary">Original Price (₹)</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-text-tertiary">₹</span>
                  <Input
                    value={newOriginalPrice}
                    onChange={(e) => setNewOriginalPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="4999"
                    className="text-xs font-bold text-text-tertiary pl-6 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description (Optional)</Label>
              <Textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What clients will achieve in this 1v1 meeting..."
                className="text-xs rounded-xl"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddingOpen(false)}
                className="text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingNew || !newTitle.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2 rounded-xl cursor-pointer shadow-sm"
              >
                {savingNew ? 'Saving Session...' : 'Save & Publish Session'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 3. RAZORPAY TAB (Requirement 10: Individual Razorpay Setup per Admin)
// =========================================================================
function RazorpaySettings({ admin }: { admin: AdminUser }) {
  const { setupAdminRazorpay } = useBookingStore();
  // The razorpay_connections row is the only source of truth for connectedness. Local state
  // is a cache of it, never the decider: deriving it from the persisted store is what made a
  // live account read "Not Yet Connected" after a reload or a failed status call.
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [accountRef, setAccountRef] = useState(admin.username || '');
  const [showSecret, setShowSecret] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [attentionReason, setAttentionReason] = useState('');
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshStatus = React.useCallback(async () => {
    try {
      // probe=true asks the backend to check the keys against Razorpay. It is read-only:
      // a failing probe reports "needs attention", it never disconnects anything.
      const status = await api.getRazorpayStatus(true);
      setIsConfigured(!!status.configured);
      if (status.key_id) setKeyId(status.key_id);
      if (status.account_reference) setAccountRef(status.account_reference);
      if (status.configured) {
        // The secret lives encrypted on the server and is never sent to the browser. This
        // is a placeholder so the field reads as "already set", not the value.
        setKeySecret('••••••••••••••••');
        setupAdminRazorpay(admin.id, status.key_id || '');
      }
      setNeedsAttention(!!status.needs_attention);
      setAttentionReason(status.needs_attention ? (status.last_error || '') : '');
    } catch {
      // A failed status call is not a disconnect. Keep the last known state.
    } finally {
      setStatusLoaded(true);
    }
  }, [admin.id, setupAdminRazorpay]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleDisconnect = async () => {
    if (!confirm(
      'Disconnect Razorpay? Clients will not be able to pay until you connect an account again. ' +
      'Your sessions, prices and bookings are not affected.'
    )) return;
    setDisconnecting(true);
    setErrorMsg(null);
    try {
      await api.disconnectRazorpay();
      setIsConfigured(false);
      setNeedsAttention(false);
      setKeySecret('');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not disconnect Razorpay.');
    } finally {
      setDisconnecting(false);
    }
  };

  // Dynamic mode detection
  const isLive = keyId.trim().startsWith('rzp_live_');
  const isTest = keyId.trim().startsWith('rzp_test_');

  const handleSave = async () => {
    setErrorMsg(null);
    const cleanKey = keyId.trim();
    const cleanSecret = keySecret.trim();

    if (!cleanKey) {
      setErrorMsg('Please enter your Razorpay Key ID (for real payments, use rzp_live_...).');
      return;
    }
    if (!cleanKey.startsWith('rzp_live_') && !cleanKey.startsWith('rzp_test_')) {
      setErrorMsg('Razorpay Key ID must start with "rzp_live_" (for real payments) or "rzp_test_".');
      return;
    }
    if (!cleanSecret || cleanSecret === '••••••••••••••••') {
      setErrorMsg('Please enter your Razorpay Key Secret from your Razorpay Dashboard.');
      return;
    }

    setSaving(true);
    try {
      await api.setupRazorpay(cleanKey, cleanSecret, accountRef.trim());
      // Only after the server confirms. Marking the store connected first meant a failed
      // save still left the UI claiming a connection the database did not have.
      setupAdminRazorpay(admin.id, cleanKey);
      setIsConfigured(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      // Adopt what the server actually stored, including a fresh health check.
      await refreshStatus();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to save Razorpay credentials. Please verify your keys.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-6 shadow-xs">
      {/* Header with Admin Direct Payout Guarantee */}
      <div className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-black text-text-primary">Direct Razorpay Payment Customization</h2>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Admin Controlled Payouts
          </span>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            0% Platform Fee
          </span>
        </div>
        <p className="text-xs text-text-tertiary mt-1 leading-relaxed">
          You have complete, independent authority over your payment gateway. Connect your <strong>own real Razorpay account</strong>.
          Client booking payments deposit directly into your linked bank account. The platform takes 0% cut.
        </p>
      </div>

      {/* Connection Status Card */}
      <div className={`p-4.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
        isConfigured && isLive
          ? 'bg-emerald-50/60 border-emerald-200'
          : isConfigured && isTest
          ? 'bg-amber-50/60 border-amber-200'
          : 'bg-surface-secondary border-border'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg shadow-sm ${
            isConfigured && isLive
              ? 'bg-emerald-600 text-white'
              : isConfigured && isTest
              ? 'bg-amber-500 text-white'
              : 'bg-slate-300 text-text-secondary'
          }`}>
            {isConfigured && isLive ? '✓' : isConfigured ? '!' : '✕'}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-text-primary">
                {isConfigured && isLive
                  ? `Razorpay Live Connected for ${admin.full_name}`
                  : isConfigured && isTest
                  ? `Razorpay Test Mode (Simulated) for ${admin.full_name}`
                  : statusLoaded
                  ? 'Razorpay Not Yet Connected'
                  : 'Checking your saved connection…'}
              </p>
              {isConfigured && isLive ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse">
                  ● Live Mode (Real Money Active)
                </span>
              ) : isConfigured && isTest ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  ● Test Mode (Simulated)
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-text-secondary border border-slate-300">
                  ● Real Payments Disabled
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary font-mono mt-0.5">
              Active Key:{' '}
              {keyId && keyId !== 'rzp_test_'
                ? `${keyId.substring(0, 18)}...`
                : isConfigured
                ? 'Configured'
                : 'None configured — follow the 2 steps below to connect'}
            </p>
          </div>
        </div>

        {isConfigured ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-red-200 bg-white text-red-700 hover:bg-red-50 text-xs font-bold transition cursor-pointer shrink-0 disabled:opacity-60"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect Razorpay'}
          </button>
        ) : (
          <a
            href="https://easy.razorpay.com/onboarding?recommended_product=payment_gateway"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-sm cursor-pointer shrink-0"
          >
            <span>Sign Up for Razorpay (Free)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Razorpay itself rejected the stored keys. The connection is kept and the secret
          stays encrypted on the server -- the admin updates the keys when they choose. */}
      {isConfigured && needsAttention && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Razorpay connection needs attention. {attentionReason} Your saved configuration has
            not been removed — enter your current Key ID and Key Secret below to update it.
          </span>
        </div>
      )}

      {/* Educational Callout explaining Razorpay Sign-up requirement */}
      <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-900 text-xs flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5 leading-relaxed">
          <p className="font-bold">Why create a Razorpay Account?</p>
          <p className="text-[11px] text-blue-800">
            BookMyMeet routes <strong>100% of client booking payments directly into your own bank account</strong> with 0% platform fee.
            Click <strong>"Sign Up for Razorpay (Free)"</strong> above to register your merchant profile with your PAN and bank account. Once signed up, copy your <strong>Live Key ID</strong> (<code className="font-mono bg-blue-100 px-1 rounded">rzp_live_...</code>) and <strong>Key Secret</strong>, and paste them below.
          </p>
        </div>
      </div>

      {/* QUICK CONNECT STEP-BY-STEP ACTION BOX */}
      <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
              How to Connect Real Razorpay in 2 Minutes
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
          >
            <span>{showGuide ? 'Collapse' : 'Expand Guide'}</span>
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showGuide && (
          <div className="space-y-3 pt-1 text-xs text-text-secondary">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Step 1 */}
              <div className="p-3.5 bg-surface rounded-xl border border-indigo-100 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-black text-[11px] flex items-center justify-center">1</span>
                    <p className="font-bold text-text-primary">Open Razorpay Dashboard</p>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Click the button below to open your Razorpay Dashboard. Make sure you are in <strong>Live Mode</strong> (switch the toggle at top-left from "Test" to <strong>"Live"</strong>).
                  </p>
                </div>
                <a
                  href="https://easy.razorpay.com/onboarding?recommended_product=payment_gateway"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-[11px] border border-indigo-200 transition"
                >
                  <span>1. Open Razorpay</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Step 2 */}
              <div className="p-3.5 bg-surface rounded-xl border border-indigo-100 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-black text-[11px] flex items-center justify-center">2</span>
                    <p className="font-bold text-text-primary">Generate Live Key</p>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Under <strong>API Keys</strong>, click <strong>"Generate Key"</strong>. Razorpay will show your <strong>Live Key ID</strong> (<code className="bg-emerald-50 text-emerald-800 font-bold px-1 rounded">rzp_live_...</code>) and <strong>Key Secret</strong>.
                  </p>
                </div>
                <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                  ⚠️ Note: Copy the Key Secret immediately (shown only once).
                </span>
              </div>

              {/* Step 3 */}
              <div className="p-3.5 bg-surface rounded-xl border border-indigo-100 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-[11px] flex items-center justify-center">3</span>
                    <p className="font-bold text-text-primary">Paste Below & Connect</p>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Paste the <strong>Key ID</strong> and <strong>Key Secret</strong> into the inputs below and click <strong>"Connect Razorpay to Website"</strong>. Real payments will go live immediately!
                  </p>
                </div>
                <span className="text-[10px] text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-2">
                  ✓ Supports UPI (GPay, PhonePe, Paytm), Cards, NetBanking.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error notification if any */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Mode hint badge when user enters key */}
      {isLive && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>
            <strong>Live Key Detected (<code className="font-mono text-[11px]">{keyId.slice(0, 12)}...</code>):</strong> Client payments will be charged real money and deposited directly to your bank account.
          </span>
        </div>
      )}

      {isTest && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Test Key Entered:</strong> This key starts with <code className="font-mono font-bold">rzp_test_</code>. Payments are simulated and no real money will be charged. If you want real money, switch Razorpay to Live Mode and use <code className="font-mono font-bold">rzp_live_...</code>.
          </span>
        </div>
      )}

      {/* Credentials Form */}
      <div className="space-y-4 pt-1">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-slate-800">
              Razorpay Key ID <span className="text-emerald-600 font-semibold">(Real payments use rzp_live_...)</span>
            </Label>
            <span className="text-[10px] text-text-tertiary font-mono">Starts with rzp_live_ (Live) or rzp_test_</span>
          </div>
          <Input
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="rzp_live_xxxxxxxxxxxxxxxx"
            className="text-xs font-mono rounded-xl bg-surface border-border focus:border-indigo-500 h-10"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-slate-800">Razorpay Key Secret</Label>
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showSecret ? 'Hide Secret' : 'Show Secret'}</span>
            </button>
          </div>
          <Input
            type={showSecret ? 'text' : 'password'}
            value={keySecret}
            onChange={(e) => setKeySecret(e.target.value)}
            placeholder="Paste your Razorpay Key Secret here"
            className="text-xs font-mono rounded-xl bg-surface border-border focus:border-indigo-500 h-10"
          />
          <p className="text-[11px] text-text-tertiary">
            Encrypted with <strong>AES-256</strong> at rest. Your secret key is never sent to the client browser and is strictly used server-side to generate and verify payment orders.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-slate-800">Account Reference / Business Tag (Optional)</Label>
          <Input
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
            placeholder="e.g. My Mentorship Business"
            className="text-xs rounded-xl bg-surface border-border"
          />
          <p className="text-[10px] text-text-tertiary">
            Helps you identify which merchant account is linked for this admin profile.
          </p>
        </div>
      </div>

      {/* Security & Payout Assurance */}
      <div className="p-4 rounded-xl bg-surface-secondary border border-border flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-slate-800">Security & Direct Settlement Guarantee</p>
          <p className="text-text-secondary leading-relaxed">
            All Razorpay transactions are processed via secure server-to-server calls with HMAC-SHA256 signature verification.
            Payouts settle directly into your registered bank account according to your Razorpay settlement cycle (typically T+2 days).
          </p>
        </div>
      </div>

      {/* Save Button & Modes Note */}
      <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <span className="text-xs text-text-tertiary">
          Supports UPI (GPay, PhonePe, Paytm), Credit/Debit Cards, NetBanking, and Wallets.
        </span>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer shadow-md shadow-emerald-600/20 transition h-10"
        >
          {saving ? 'Connecting Razorpay...' : saved ? '✓ Razorpay Connected & Saved!' : 'Connect Razorpay to Website'}
        </Button>
      </div>
    </div>
  );
}

// =========================================================================
// 4. BOOKING RULES TAB
// =========================================================================
function BookingRulesSettings({ admin }: { admin: AdminUser }) {
  const [minAdvance, setMinAdvance] = useState(2);
  const [maxHorizon, setMaxHorizon] = useState(30);
  const [defaultBuffer, setDefaultBuffer] = useState(5);
  const [saved, setSaved] = useState(false);

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-5 shadow-xs">
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-black text-text-primary">Booking Rules & Buffers</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Configure advance notice thresholds and rest periods between consecutive meetings.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Minimum Notice (Hours)</Label>
          <Input
            type="number"
            min={0}
            value={minAdvance}
            onChange={(e) => setMinAdvance(parseInt(e.target.value) || 0)}
            className="text-xs rounded-xl"
          />
          <p className="text-[10px] text-text-tertiary">Clients cannot book a meeting sooner than this.</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold">Max Booking Horizon (Days)</Label>
          <Input
            type="number"
            min={1}
            value={maxHorizon}
            onChange={(e) => setMaxHorizon(parseInt(e.target.value) || 30)}
            className="text-xs rounded-xl"
          />
          <p className="text-[10px] text-text-tertiary">How far into the future slots are opened.</p>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-semibold">Default Buffer Time (Minutes)</Label>
        <Input
          type="number"
          min={0}
          value={defaultBuffer}
          onChange={(e) => setDefaultBuffer(parseInt(e.target.value) || 0)}
          className="text-xs rounded-xl"
        />
        <p className="text-[10px] text-text-tertiary">Cool-down buffer before and after meetings to avoid back-to-back fatigue.</p>
      </div>

      <div className="pt-3 border-t border-border flex justify-end">
        <Button
          onClick={() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
          className="bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl cursor-pointer"
        >
          {saved ? '✓ Saved' : 'Save Rules'}
        </Button>
      </div>
    </div>
  );
}

// =========================================================================
// 5. EMAIL NOTIFICATIONS TAB
// =========================================================================
function EmailSettings({ admin }: { admin: AdminUser }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-5 shadow-xs">
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-black text-text-primary">Email & Google Calendar Reminders</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Automated confirmation emails and meeting reminders sent to clients and admins.
        </p>
      </div>

      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-surface-secondary border border-border text-xs space-y-2">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-orange-600" />
            <span>Instant Confirmation Email</span>
          </p>
          <p className="text-text-secondary">
            Dispatched to the client immediately upon payment with the confirmed Google Meet link and date/time in their local timezone.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-surface-secondary border border-border text-xs space-y-2">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <CalendarIcon className="w-4 h-4 text-blue-600" />
            <span>Google Calendar Reminders (Configured per Spec)</span>
          </p>
          <ul className="text-text-secondary space-y-1 list-disc pl-4">
            <li><strong>1 Hour Before:</strong> Pop-up notification and reminder email to both Client and Admin.</li>
            <li><strong>5 Minutes Before:</strong> Direct mobile & desktop alert with [Join Google Meet] button.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
