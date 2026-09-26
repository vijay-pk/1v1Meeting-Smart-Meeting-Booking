import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useBookingStore } from '@/stores/bookingStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { buildPublicProfileUrl } from '@/lib/publicUrl';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MeetingTypesPage } from '@/pages/admin/MeetingTypesPage';
import { AvailabilityPage } from '@/pages/admin/AvailabilityPage';
import { TIMEZONES } from '@/lib/constants';
import type { AdminUser, AdminThemeSettings } from '@/types';
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
// The admin preview must show exactly what a client will see, so it uses the same normalizer
// as the public pages rather than a second copy that can drift.
import { getVideoEmbedUrl, INTRO_VIDEO_LABEL } from '@/lib/video';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';

type SettingsTab = 'profile' | 'meeting-types' | 'availability' | 'payment' | 'calendar' | 'email';

const SETTINGS_TABS: SettingsTab[] = ['profile', 'meeting-types', 'availability', 'payment', 'calendar', 'email'];

/** Canonical URL of each section; Profile is the Settings root. */
function settingsPath(tab: SettingsTab): string {
  return tab === 'profile' ? '/admin/settings' : `/admin/settings/${tab}`;
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
  // The section lives in the URL (/admin/settings/availability), so every section can be
  // linked to, bookmarked and reached with the back button. ?tab= is still honoured: the
  // Google OAuth callback returns to /admin/settings?tab=calendar&connected=true.
  const { section } = useParams<{ section?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedTab = section || searchParams.get('tab') || 'profile';
  const activeTab: SettingsTab = (SETTINGS_TABS as string[]).includes(requestedTab)
    ? (requestedTab as SettingsTab)
    : 'profile';
  const setActiveTab = (tab: SettingsTab) => {
    // Keep ?from=setup so the "Back to setup" bar survives switching sections.
    const from = searchParams.get('from');
    navigate(from ? `${settingsPath(tab)}?from=${encodeURIComponent(from)}` : settingsPath(tab));
  };
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
  // Whether the database has answered yet. Until it has, this page must not save: the
  // fallback identity below is a placeholder for rendering, and writing it back would
  // overwrite the admin's real name, bio, photo and slug with empty strings.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState('');

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
          if (isMounted) {
            setProfileLoaded(true);
            setProfileLoadError('');
          }
        }
      } catch (e: any) {
        if (isMounted) {
          setProfileLoadError(
            e?.message || 'Could not load your saved profile. Nothing has been changed.'
          );
        }
      }
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
    } as AdminUser;
  }, [liveAdmin, admins, storedAdminId, storedUsername, storedAdminName, isSuperAdmin, currentSuperAdmin, profile]);

  const [copied, setCopied] = useState(false);

  const tabs: { id: SettingsTab; label: string; description: string; icon: any }[] = [
    { id: 'profile', label: 'Profile', description: 'Your public booking page', icon: Palette },
    { id: 'meeting-types', label: 'Meeting Types', description: 'Sessions you offer', icon: Video },
    { id: 'availability', label: 'Availability', description: 'When clients can book', icon: Clock },
    { id: 'payment', label: 'Payments', description: 'Payment gateway', icon: CreditCard },
    { id: 'calendar', label: 'Google Calendar', description: 'Calendar sync and Meet links', icon: CalendarIcon },
    { id: 'email', label: 'Email & Notifications', description: 'Booking emails and alerts', icon: Mail },
  ];

  // Only from the loaded server row: before that, currentAdmin can be a placeholder whose
  // username is 'admin', and copying that would hand a client somebody else's page.
  const publicProfileUrl =
    (profileLoaded && buildPublicProfileUrl(currentAdmin?.username)) || '';

  const handleCopyLink = () => {
    if (!publicProfileUrl) return;
    navigator.clipboard?.writeText(publicProfileUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
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
              ? 'Your booking page, sessions, and integrations.'
              : 'What clients see on your booking page.'}
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
            href={publicProfileUrl || undefined}
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
          {/* Two columns of touch targets on a phone -- every section visible without sideways
              scrolling -- and a labelled list with descriptions beside the content from lg. */}
          <ul className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-surface p-2 sm:grid-cols-3 lg:grid-cols-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <li key={tab.id} className="min-w-0">
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`press flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition-all cursor-pointer ${
                      activeTab === tab.id
                        ? 'bg-orange-50 font-extrabold text-orange-700 shadow-2xs'
                        : 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block leading-tight">{tab.label}</span>
                      <span className="hidden text-[11px] font-medium leading-snug text-text-tertiary lg:block">
                        {tab.description}
                      </span>
                    </span>
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
                href={publicProfileUrl || undefined}
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
        <div className="min-w-0 flex-1 max-w-3xl">
          {activeTab === 'meeting-types' && <MeetingTypesPage />}
          {activeTab === 'availability' && <AvailabilityPage />}
          {activeTab === 'profile' && (
            <ProfileCustomizer
              admin={currentAdmin}
              profileLoaded={profileLoaded}
              profileLoadError={profileLoadError}
              onUpdate={(updated) => setLiveAdmin(updated)}
            />
          )}
          {activeTab === 'payment' && <RazorpaySettings admin={currentAdmin} />}
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
  profileLoaded,
  profileLoadError,
  onUpdate,
}: {
  admin: AdminUser;
  /** True once this admin's row has actually come back from the database. */
  profileLoaded: boolean;
  profileLoadError: string;
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
    // SVG is rejected by the server (it can carry script and these objects are public), so it
    // is not offered here either.
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setPhotoUploadError('Please select a valid image file (PNG, JPG, WEBP or GIF).');
      setTimeout(() => setPhotoUploadError(''), 5000);
      return;
    }
    // Same 8MB cap the upload endpoint enforces, so an oversized file fails here with a clear
    // message instead of after the round trip.
    if (file.size > 8 * 1024 * 1024) {
      setPhotoUploadError('Image is larger than 8MB. Please choose a smaller file.');
      setTimeout(() => setPhotoUploadError(''), 5000);
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoUploadError('');
    setPhotoUploadSuccess('');

    try {
      const res = await api.uploadMedia(file, 'photo');
      if (!res || !res.url) {
        throw new Error('Upload returned no URL');
      }
      setPhotoUrl(res.url);
      const kb = Math.max(1, Math.round((res.size || 0) / 1024));
      setPhotoUploadSuccess(
        res.optimized
          ? `Profile photo uploaded successfully. Image optimized to ${kb} KB — save your profile to publish it.`
          : 'Profile photo uploaded successfully — save your profile to publish it.'
      );
      setTimeout(() => setPhotoUploadSuccess(''), 8000);
    } catch (err: any) {
      // There is deliberately no local fallback. This used to read the file with FileReader
      // and put the resulting base64 data: URI into photo_url, which then got saved into the
      // profile row as the "photo" -- a megabytes-long string that is not in persistent
      // storage, cannot be served or purged like a stored object, and silently replaced a
      // real uploaded photo. A failed upload must leave the saved photo untouched and say so.
      setPhotoUploadError(
        err?.message
          ? `Upload failed: ${err.message}. Your saved photo has not been changed.`
          : 'Upload failed. Your saved photo has not been changed.'
      );
      setTimeout(() => setPhotoUploadError(''), 8000);
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
    setCustomSections(admin.custom_sections || []);
  }, [admin.id, admin.username, admin.photo_url, admin.intro_video]);

  const handleAddSection = () => {
    const newSec = {
      id: `sec-${Date.now()}`,
      title: '',
      description: '',
      button_text: '',
      button_url: '',
      badge: '',
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

  const [saveError, setSaveError] = useState('');

  const handleSave = async () => {
    // The database is the source of truth, and this form is only a view of it. Saving a form
    // that was populated from the placeholder identity (used while the profile is still
    // loading, or when the request failed) would write empty strings over the admin's real
    // name, bio, photo, video and slug -- which is exactly how a live booking link ended up
    // pointing at nothing.
    if (!profileLoaded) {
      setSaveError(
        profileLoadError ||
        'Your saved profile has not loaded yet. Nothing was changed - please wait a moment and try again.'
      );
      return;
    }

    setSaving(true);
    setSaveError('');

    const cleanUsername = (username || admin.username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '');

    if (!cleanUsername) {
      setSaving(false);
      setSaveError('Your booking link cannot be empty.');
      return;
    }

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
      custom_sections: customSections,
    };

    // The server first. The local store and localStorage are caches, and updating them
    // before the write is confirmed is what made a failed save look successful.
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
      });
    } catch (e: any) {
      setSaving(false);
      setSaveError(e?.message || 'Could not save your profile. Nothing was changed.');
      return;
    }

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
          <h2 className="text-lg font-black text-text-primary">Public Profile</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            Shown on your booking page at{' '}
            <a
              href={currentPublicLink}
              target="_blank"
              rel="noreferrer"
              className="press -my-1 inline-flex min-h-11 items-center rounded px-1 font-mono font-bold text-orange-600 hover:underline sm:min-h-6"
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
                className="press -my-1 inline-flex min-h-11 items-center break-all rounded px-1 font-mono font-bold text-orange-600 hover:underline sm:min-h-6"
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
              // SVG is deliberately absent: it can carry script, and these files are served from a
              // public bucket. The server decides from the bytes regardless of what is offered here.
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/avif"
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
                              Optimizing…
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
                          className="press inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg text-[10px] font-medium text-red-600 hover:text-red-700 cursor-pointer sm:min-h-6"
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
                        {isUploadingPhoto ? 'Optimizing and uploading your photo…' : 'Click to add picture from device'}
                      </p>
                      <p className="text-[10px] text-text-tertiary mt-0.5">
                        PNG, JPG, JPEG, WEBP, GIF (up to 8MB)
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
                  // Same component the public pages use, so the preview shows exactly what a
                  // client sees: our own neutral card, with the provider's player mounted
                  // only on an explicit press.
                  if (
                    getVideoEmbedUrl(introVideo) ||
                    introVideo.endsWith('.mp4') ||
                    introVideo.endsWith('.webm') ||
                    introVideo.includes('/uploads/')
                  ) {
                    return (
                      <IntroVideoPlayer
                        url={introVideo}
                        label={`${INTRO_VIDEO_LABEL} preview`}
                        className="rounded-lg border border-slate-300 shadow-sm"
                      />
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
                      className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-[10px] font-medium text-red-600 hover:text-red-700 cursor-pointer sm:min-h-6"
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

      {/* 4. Custom Uploaded Sections & Resource Blocks */}
      <div className="space-y-4 pt-4 border-t border-border">
        {/* Stacks below sm: the heading, its badge and the button fought over a 272px column. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary flex flex-wrap items-center gap-1.5">
              <span>4. Custom Sections & Resource Uploads</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold">
                {customSections.length} Sections
              </span>
            </h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Upload custom highlighted cards on your public page (e.g. Free Guides, Portfolio).
            </p>
          </div>
          <Button
            type="button"
            onClick={handleAddSection}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-3.5 h-9 rounded-xl cursor-pointer flex w-full items-center justify-center gap-1 sm:h-8 sm:w-auto"
          >
            <Plus className="w-3 h-3" />
            <span>+ Add Section</span>
          </Button>
        </div>

        {customSections.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-text-tertiary">
            No custom sections uploaded yet. Click "+ Add Section" to feature custom links or guides on your public page.
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
                    placeholder="Section Title"
                    className="text-xs rounded-lg bg-surface h-8 font-semibold"
                  />
                  <Input
                    value={sec.badge || ''}
                    onChange={(e) => handleUpdateSection(sec.id, 'badge', e.target.value)}
                    placeholder="Badge Tag (e.g. Free, Popular)"
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
                    placeholder="Button Label (e.g. Download PDF)"
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
      {(saveError || (profileLoadError && !profileLoaded)) && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{saveError || profileLoadError}</span>
        </div>
      )}

      <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-text-tertiary">
          {profileLoaded
            ? 'Saved to your live public profile. Only what you change here changes.'
            : 'Loading your saved profile…'}
        </p>
        <Button
          onClick={handleSave}
          // Disabled until the database has answered. Saving a form built from the
          // placeholder identity would blank the real profile.
          disabled={saving || !profileLoaded}
          className="min-h-[44px] w-full sm:w-auto bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs px-6 rounded-xl transition shadow-md shadow-orange-600/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
          Sync your Google Calendar to block busy times and auto-create Meet links.
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
              Busy times on this calendar are blocked automatically.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-amber-900 leading-relaxed">
                Can't read your calendar. Bookings are paused until you reconnect.
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
              Stays connected until you disconnect.
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-surface-secondary border border-border rounded-2xl space-y-2">
            <p className="text-xs font-bold text-slate-800">Why connect?</p>
            <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
              <li><strong>No double booking:</strong> busy times are blocked automatically.</li>
              <li><strong>Google Meet:</strong> event created with the client as attendee.</li>
              <li><strong>Reminders:</strong> alerts 1 hour and 5 minutes before.</li>
            </ul>
          </div>

          <p className="text-[11px] text-text-tertiary leading-relaxed">
            You'll sign in on Google's consent screen. That account stays connected until you disconnect here.
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
  const [showGuide, setShowGuide] = useState(false);
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
        // The secret lives encrypted on the server and is never sent to the browser, so the
        // field stays empty. "Connected" comes from the row, not from anything in this input.
        // A blank field on save means "keep the stored secret", never "delete it".
        setKeySecret('');
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
    // A secret is required only when connecting for the first time. Once connected, an empty
    // field means "keep the stored secret" -- the admin can change the Key ID or business tag
    // without re-entering it. A new secret typed in still replaces the stored one.
    if (!cleanSecret && !isConfigured) {
      setErrorMsg('Razorpay Key Secret is required.');
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

  const statusTitle = !statusLoaded && !isConfigured
    ? 'Checking…'
    : isConfigured && isTest
    ? 'Test mode'
    : isConfigured
    ? 'Connected'
    : 'Not connected';
  const statusDetail = isConfigured && isLive
    ? 'Live payments on'
    : isConfigured && isTest
    ? 'Payments are simulated'
    : isConfigured
    ? 'Keys saved'
    : 'Live payments off';

  return (
    <div className="max-w-2xl bg-surface rounded-2xl border border-border p-4 sm:p-5 space-y-4 shadow-xs">
      <div>
        <h2 className="text-base font-bold text-text-primary">Razorpay</h2>
        <p className="text-xs text-text-tertiary mt-0.5">Connect Razorpay to receive payments.</p>
      </div>

      {/* Status comes from the razorpay_connections row (see refreshStatus), never the store. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-secondary px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              isConfigured && isLive ? 'bg-emerald-500' : isConfigured ? 'bg-amber-500' : 'bg-slate-400'
            }`}
          />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold text-text-primary">
              {statusTitle}
              {isConfigured && isLive && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            </p>
            <p className="truncate text-xs text-text-tertiary">
              {statusDetail}
              {isConfigured && keyId && <span className="font-mono"> · {keyId.substring(0, 14)}…</span>}
            </p>
          </div>
        </div>
        {isConfigured && (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="press inline-flex min-h-9 shrink-0 items-center rounded-lg border border-red-200 bg-surface px-3 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-60"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>

      {/* Razorpay itself rejected the stored keys. The connection is kept and the secret
          stays encrypted on the server -- the admin updates the keys when they choose. */}
      {isConfigured && needsAttention && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Needs attention. {attentionReason} Your keys are kept — enter current keys to update.</span>
        </div>
      )}

      {/* One compact guide, collapsed by default. The link is the same Razorpay URL this
          page has always used. */}
      <div className="rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            aria-expanded={showGuide}
            className="press inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-text-primary cursor-pointer"
          >
            <Info className="w-3.5 h-3.5 text-text-tertiary" />
            <span>How to get your keys</span>
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <a
            href="https://easy.razorpay.com/onboarding?recommended_product=payment_gateway"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            <span>Open Razorpay</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {showGuide && (
          <ol className="list-decimal space-y-1 border-t border-border py-2.5 pl-7 pr-3 text-xs text-text-secondary">
            <li>Open Razorpay Dashboard</li>
            <li>Switch to Live Mode</li>
            <li>Go to API Keys</li>
            <li>Generate a Live Key</li>
            <li>Copy Key ID + Key Secret (the secret is shown only once)</li>
          </ol>
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="rzp-key-id" className="text-xs font-semibold text-text-primary">Razorpay Key ID</Label>
          <Input
            id="rzp-key-id"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="rzp_live_xxxxxxxxxxxxxxxx"
            autoComplete="off"
            className="h-10 rounded-lg text-xs font-mono"
          />
          {isTest ? (
            <p className="text-[11px] text-amber-700">Test key — payments are simulated, no real money.</p>
          ) : (
            <p className="text-[11px] text-text-tertiary">Starts with rzp_live_ for live payments</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="rzp-key-secret" className="text-xs font-semibold text-text-primary">Razorpay Key Secret</Label>
          <div className="relative">
            <Input
              id="rzp-key-secret"
              type={showSecret ? 'text' : 'password'}
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder={isConfigured ? 'Enter new secret to replace' : 'Enter your Razorpay Key Secret'}
              autoComplete="off"
              className="h-10 rounded-lg pr-10 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-tertiary hover:text-text-primary cursor-pointer"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-text-tertiary">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
            <span>
              Encrypted and used server-side only.
              {isConfigured && ' Leave blank to keep your saved secret.'}
            </span>
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="rzp-account-ref" className="text-xs font-semibold text-text-primary">
            Business tag <span className="font-normal text-text-tertiary">· Optional</span>
          </Label>
          <Input
            id="rzp-account-ref"
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
            placeholder="e.g. my-business"
            className="h-10 rounded-lg text-xs"
          />
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-10 w-full rounded-lg bg-emerald-600 px-5 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer sm:w-auto"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : isConfigured ? 'Save changes' : 'Connect Razorpay'}
        </Button>
      </div>
    </div>
  );
}


// =========================================================================
// 5. EMAIL NOTIFICATIONS TAB
// =========================================================================
function EmailSettings({ admin }: { admin: AdminUser }) {
  // The Google Calendar Reminders info block is shown only to the Super Admin. Regular admins
  // no longer see it here -- the reminder functionality itself is unchanged (backend jobs,
  // notifications, emails and the meeting-reminder setting all keep working).
  const isSuperAdmin = admin?.role === 'super_admin';
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 space-y-5 shadow-xs">
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-black text-text-primary">
          {isSuperAdmin ? 'Email & Google Calendar Reminders' : 'Email & Notifications'}
        </h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Confirmation emails and reminders for clients and admins.
        </p>
      </div>

      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-surface-secondary border border-border text-xs space-y-2">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-orange-600" />
            <span>Instant Confirmation Email</span>
          </p>
          <p className="text-text-secondary">
            Sent to the client on payment, with the Meet link and time in their timezone.
          </p>
        </div>

        {isSuperAdmin && (
          <div className="p-4 rounded-xl bg-surface-secondary border border-border text-xs space-y-2">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4 text-blue-600" />
              <span>Google Calendar Reminders</span>
            </p>
            <ul className="text-text-secondary space-y-1 list-disc pl-4">
              <li><strong>1 hour before:</strong> notification and email to client and admin.</li>
              <li><strong>5 minutes before:</strong> alert with a Join Google Meet button.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
