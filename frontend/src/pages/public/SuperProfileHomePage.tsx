import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { getVideoEmbedUrl, INTRO_VIDEO_LABEL, INTRO_VIDEO_ARIA_LABEL } from '@/lib/video';
import type { AdminUser, MeetingType } from '@/types';
import {
  Video,
  ShieldCheck,
  Star,
  Flame,
  ArrowRight,
  Clock,
  Sparkles,
  Lock,
  Share2,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Play
} from 'lucide-react';

export const SuperProfileHomePage: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useParams<{ username?: string }>();
  const { setPendingBooking } = useBookingStore();

  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [remoteProfile, setRemoteProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // "This page does not exist" and "we could not reach the server" are different facts and
  // must not share a screen: telling a visitor a live host has been removed, because of one
  // failed request, sends them away for good.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 1. Resolve the admin from the API. The backend is the only source of truth for who
  //    exists: a profile that 404s (never existed, or was permanently deleted) must not be
  //    rendered from anything cached in this browser.
  useEffect(() => {
    let isMounted = true;
    const fetchRemote = async () => {
      if (!username) {
        setRemoteProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadFailed(false);
      try {
        const data = await api.getPublicProfile(username);
        if (isMounted) setRemoteProfile(data);
      } catch (err: any) {
        if (!isMounted) return;
        setRemoteProfile(null);
        // Only a 404 means the profile is genuinely not there. A 500, a CORS failure or an
        // unreachable API is a temporary problem the visitor can retry.
        setLoadFailed(!err?.notFound);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchRemote();
    return () => { isMounted = false; };
  }, [username, reloadKey]);

  const activeAdmin: AdminUser | null = useMemo(() => {
    if (remoteProfile) {
      return {
        id: remoteProfile.id,
        username: remoteProfile.username,
        full_name: remoteProfile.name,
        title: remoteProfile.title || 'Mentor & Consultant',
        role: 'admin',
        status: remoteProfile.status,
        avatar_color: 'bg-indigo-600',
        avatar_letter: remoteProfile.name ? remoteProfile.name.charAt(0).toUpperCase() : 'A',
        photo_url: remoteProfile.profile_photo || DEFAULT_AVATAR,
        cover_image: remoteProfile.cover_image,
        intro_video: remoteProfile.intro_video,
        heading_text: remoteProfile.heading_text,
        about_me_text: remoteProfile.about_me_text,
        welcome_message: remoteProfile.welcome_message,
        bio: remoteProfile.bio,
        email: '',
        theme_settings: remoteProfile.theme_settings,
        social_links: remoteProfile.social_links,
        razorpay_key_id: remoteProfile.razorpay_key_id,
        razorpay_configured: remoteProfile.razorpay_configured,
      };
    }
    return null;
  }, [remoteProfile]);

  // 2. Filter meeting types for this admin
  const adminMeetings = useMemo(() => {
    if (remoteProfile?.sessions && remoteProfile.sessions.length > 0) {
      return remoteProfile.sessions.map((s: any) => ({
        id: s.id,
        admin_id: activeAdmin?.id || s.admin_id,
        name: s.title,
        description: s.description || '',
        duration_minutes: s.duration_minutes,
        price: s.price,
        original_price: s.original_price,
        offer_price: s.price,
        currency: s.currency || 'INR',
        is_active: s.is_active,
        buffer_before_minutes: s.buffer_before_minutes,
        buffer_after_minutes: s.buffer_after_minutes,
        min_advance_hours: s.min_advance_hours,
        max_advance_days: s.max_advance_days,
        cancellation_window_hours: 24,
        reschedule_allowed: true,
        max_bookings_per_day: 8,
        color_id: 1,
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    }
    // No invented packages. If the API returned no sessions, this admin has none
    // published yet -- showing fabricated "₹299 advisory call" cards would offer clients
    // sessions the admin never created and cannot honour.
    return [];
  }, [remoteProfile, activeAdmin]);

  const handleSelectMeeting = (meetingId: string) => {
    if (!activeAdmin || activeAdmin.status !== 'ACTIVE') return;
    setPendingBooking({
      meetingTypeId: meetingId,
      adminId: activeAdmin.id,
    });
    navigate(`/schedule/${meetingId}?adminId=${activeAdmin.id}&username=${activeAdmin.username}`);
  };

  const handleCopyLink = () => {
    const fullUrl = window.location.href;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareUrls = useMemo(() => {
    const currentUrl = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(`Book a 1:1 mentorship session with ${activeAdmin?.full_name || 'Mentor'}`);
    return {
      whatsapp: `https://api.whatsapp.com/send?text=${text}%20${currentUrl}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${currentUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${currentUrl}`,
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${currentUrl}`,
    };
  }, [activeAdmin]);

  const getBadgeEmoji = (index: number) => {
    const emojis = ['🤠', '🕶️', '🚀', '🎯', '🔥'];
    return emojis[index % emojis.length];
  };

  // 3. Still asking the backend who this is -- do not flash "not found" first.
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-orange-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading profile…</p>
      </div>
    );
  }

  // 4a. The request failed rather than answering "no such profile". Say so, and offer a
  //     retry -- this page is what a host shares with their clients.
  if (loadFailed) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">
          Couldn&rsquo;t load this page
        </h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          We could not reach the booking service just now. This page has not gone anywhere
          &mdash; please try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  // 4b. Status checks: Not Found / Permanently Deleted
  if (!activeAdmin || activeAdmin.status === 'PERMANENTLY_DELETED') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">Profile Not Available</h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          This booking page does not exist or has been permanently removed by the platform administrator.
        </p>
        <Link
          to="/"
          className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition"
        >
          Go to Home
        </Link>
      </div>
    );
  }

  // 4. Status checks: Temporarily Disabled
  if (activeAdmin.status === 'TEMPORARILY_DISABLED') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <Clock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">
          {activeAdmin.full_name}'s Booking Portal is Currently Inactive
        </h1>
        <p className="text-slate-300 max-w-lg text-sm mb-6 leading-relaxed">
          This mentor is temporarily not accepting new bookings at this time. Existing bookings remain unaffected. Please check back later or explore other sessions.
        </p>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition"
          >
            Explore Other Mentors
          </Link>
          <Link
            to="/admin/login"
            className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition"
          >
            Admin Portal
          </Link>
        </div>
      </div>
    );
  }

  const introVideoEmbedUrl = getVideoEmbedUrl(activeAdmin.intro_video);

  const primaryMeetings = adminMeetings.slice(0, 3);
  const secondaryMeetings = adminMeetings.slice(3);

  const themeBg = activeAdmin.theme_settings?.bg_gradient || 'from-[#873600] via-[#A04000] to-[#6E2C00]';
  const buttonColor = activeAdmin.theme_settings?.button_color || '#D32F2F';
  const buttonTextColor = activeAdmin.theme_settings?.button_text_color || '#FFFFFF';

  return (
    <div className={`min-h-screen bg-gradient-to-b ${themeBg} text-slate-800 antialiased font-sans relative overflow-x-hidden pb-24`}>
      {/* Decorative Polygons */}
      <div className="absolute -bottom-10 -right-10 w-96 h-96 bg-gradient-to-tr from-fuchsia-700 to-purple-800 rotate-45 transform pointer-events-none opacity-80 blur-xs rounded-3xl" />
      <div className="absolute bottom-20 -right-20 w-72 h-72 bg-gradient-to-br from-pink-600 to-rose-700 rotate-12 transform pointer-events-none opacity-60 rounded-2xl" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-gradient-to-b from-amber-500/20 via-orange-500/10 to-transparent blur-3xl pointer-events-none rounded-full" />

      {/* TOP NAV BAR */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 flex items-center justify-between text-xs text-white/90 relative z-20">
        <div className="flex items-center gap-1.5 font-medium tracking-wide">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Live 1:1 Slots Open for Booking</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Share Profile Button */}
          <div className="relative">
            <button
              onClick={() => setShareOpen(!shareOpen)}
              className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white font-semibold transition border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>

            {shareOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 z-50 text-slate-800 space-y-2 animate-in fade-in zoom-in-95">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2">
                  Share Booking Page
                </p>
                <div className="space-y-1">
                  <a
                    href={shareUrls.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg transition"
                  >
                    <span>💬 WhatsApp</span>
                  </a>
                  <a
                    href={shareUrls.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700 rounded-lg transition"
                  >
                    <span>💼 LinkedIn</span>
                  </a>
                  <a
                    href={shareUrls.facebook}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg transition"
                  >
                    <span>📘 Facebook</span>
                  </a>
                  <button
                    onClick={handleCopyLink}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                    </span>
                    {copied && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <Link
            to="/admin/login"
            className="px-3 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white font-semibold transition border border-white/10 flex items-center gap-1.5"
          >
            <Lock className="w-3 h-3" />
            <span>Admin Portal</span>
          </Link>
        </div>
      </div>

      {/* HEADER PROFILE INFO */}
      <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-6 relative z-10">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <img
                src={activeAdmin.photo_url || DEFAULT_AVATAR}
                alt={activeAdmin.full_name}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover object-top border-2 border-white/80 shadow-xl bg-slate-800"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.endsWith(DEFAULT_AVATAR)) img.src = DEFAULT_AVATAR;
                }}
              />
              <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#873600]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {activeAdmin.full_name}
                </h1>
                <ShieldCheck className="w-5 h-5 text-blue-400 fill-blue-500/20" />
              </div>
              <p className="text-xs sm:text-sm text-amber-100/90 font-medium mt-0.5 max-w-xl">
                {activeAdmin.heading_text || activeAdmin.title}
              </p>

              {/* Social Media Links */}
              {activeAdmin.social_links && (
                <div className="flex items-center gap-2 mt-2">
                  {activeAdmin.social_links.whatsapp && (
                    <a
                      href={`https://wa.me/${activeAdmin.social_links.whatsapp.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/30 transition"
                    >
                      WhatsApp
                    </a>
                  )}
                  {activeAdmin.social_links.linkedin && (
                    <a
                      href={activeAdmin.social_links.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30 hover:bg-blue-500/30 transition"
                    >
                      LinkedIn
                    </a>
                  )}
                  {activeAdmin.social_links.instagram && (
                    <a
                      href={activeAdmin.social_links.instagram}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-200 border border-pink-400/30 hover:bg-pink-500/30 transition"
                    >
                      Instagram
                    </a>
                  )}
                  {activeAdmin.social_links.website && (
                    <a
                      href={activeAdmin.social_links.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/30 hover:bg-white/30 transition"
                    >
                      Website
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="text-right">
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 text-xs text-amber-100/90 hover:text-white font-medium border-b border-amber-200/40 pb-0.5 transition cursor-pointer"
            >
              <span>{copied ? 'Link Copied!' : 'Share Profile'}</span>
              <Share2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </header>

      {/* OPTIONAL EMBEDDED INTRO VIDEO
          Provider-neutral by design: no YouTube/Vimeo logo, icon, badge or name is added by
          this card. getVideoEmbedUrl() hides which provider hosts the video. */}
      {activeAdmin.intro_video && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-6 relative z-10">
          <div className="bg-slate-900/90 backdrop-blur-md rounded-3xl border border-white/10 p-4 sm:p-5 shadow-2xl">
            <div className="flex items-center justify-between text-xs text-slate-300 mb-3 px-1">
              <div className="flex items-center gap-1.5 font-bold text-white">
                <Play className="w-3.5 h-3.5 text-orange-400 fill-orange-400" aria-hidden="true" />
                <span>{INTRO_VIDEO_LABEL} &mdash; {activeAdmin.full_name}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-amber-300 font-mono">
                Verified Mentor
              </span>
            </div>

            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-white/10 shadow-lg">
              {introVideoEmbedUrl ? (
                <iframe
                  src={introVideoEmbedUrl}
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                  title={INTRO_VIDEO_ARIA_LABEL}
                  allowFullScreen
                />
              ) : (
                <video
                  src={activeAdmin.intro_video}
                  controls
                  playsInline
                  aria-label={INTRO_VIDEO_ARIA_LABEL}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* MAIN CONTAINER (PACKAGES) */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10">
        <div className="bg-white rounded-3xl p-5 sm:p-8 shadow-2xl border border-white/20 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                {activeAdmin.welcome_message || 'Available 1-to-1 Mentorship Sessions'}
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Instant Google Meet invitation generated after booking
              </p>
            </div>
            <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-100">
              {adminMeetings.length} Offerings
            </span>
          </div>

          {/* Priority Super Chat Card */}
          {(activeAdmin.social_links?.super_chat || activeAdmin.super_chat_url) && (
            <a
              href={activeAdmin.social_links?.super_chat || activeAdmin.super_chat_url}
              target="_blank"
              rel="noreferrer"
              className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-300/40 hover:border-amber-400 flex items-center justify-between gap-4 transition-all shadow-sm hover:shadow-md cursor-pointer group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white font-black flex items-center justify-center text-xl shadow-md group-hover:scale-105 transition-transform">
                  ⚡
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Ask a Priority Question / Super Chat
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">
                      Instant Priority
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Have a quick question or want direct advice? Send a priority message to {activeAdmin.full_name}.
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-orange-600 text-white shadow-xs group-hover:bg-orange-500 transition-colors flex items-center gap-1 shrink-0">
                <span>Chat Now</span>
                <span>→</span>
              </span>
            </a>
          )}

          {/* Uploaded Custom Sections & Links */}
          {activeAdmin.custom_sections && activeAdmin.custom_sections.length > 0 && (
            <div className="space-y-3">
              {activeAdmin.custom_sections.map((sec) => (
                <div
                  key={sec.id}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:border-slate-300 transition-all"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900">{sec.title}</h4>
                      {sec.badge && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {sec.badge}
                        </span>
                      )}
                    </div>
                    {sec.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{sec.description}</p>
                    )}
                  </div>
                  {sec.button_url && (
                    <a
                      href={sec.button_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition shrink-0 text-center shadow-xs"
                    >
                      {sec.button_text || 'Access Now →'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Primary Packages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {primaryMeetings.map((meeting: MeetingType, index: number) => {
              const discountPercent =
                meeting.original_price && meeting.original_price > meeting.price
                  ? Math.round(
                      ((meeting.original_price - meeting.price) /
                        meeting.original_price) *
                        100
                    )
                  : null;

              const isWide = index === 2;

              return (
                <div
                  key={meeting.id}
                  onClick={() => handleSelectMeeting(meeting.id)}
                  className={`group rounded-2xl border border-slate-200/90 hover:border-orange-400 hover:shadow-lg transition-all duration-200 p-5 bg-white flex flex-col justify-between cursor-pointer relative overflow-hidden ${
                    isWide ? 'md:col-span-2' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-xl shadow-2xs">
                      {getBadgeEmoji(index)}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {index === 0 && (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Star className="w-3 h-3 fill-emerald-500 text-emerald-500" />
                            <span>5</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                            <Flame className="w-3 h-3 fill-amber-500 text-amber-500" />
                            <span>Most Popular</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-5">
                    <h3 className="font-bold text-slate-900 text-base group-hover:text-orange-600 transition-colors leading-snug">
                      {meeting.name}
                    </h3>
                    <p className="text-xs text-slate-500 font-normal leading-relaxed line-clamp-2">
                      {meeting.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{meeting.duration_minutes} mins</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                        <Video className="w-3 h-3 text-emerald-500" />
                        <span>Google Meet</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {meeting.original_price && meeting.original_price > meeting.price && (
                        <div className="text-right">
                          <span className="text-xs text-slate-400 line-through font-medium block">
                            {formatPrice(meeting.original_price, meeting.currency)}
                          </span>
                          {discountPercent && (
                            <span className="text-[10px] text-orange-600 font-bold uppercase">
                              {discountPercent}% OFF
                            </span>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectMeeting(meeting.id);
                        }}
                        className="active:scale-95 font-extrabold text-xs sm:text-sm px-4 py-2 sm:px-5 sm:py-2.5 rounded-full shadow-md transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>{formatPrice(meeting.price, meeting.currency)}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Secondary Packages */}
          {secondaryMeetings.length > 0 && (
            <div className="pt-4 space-y-4">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Additional Consultations & Guidance
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {secondaryMeetings.map((meeting: MeetingType, idx: number) => {
                  const discountPercent =
                    meeting.original_price && meeting.original_price > meeting.price
                      ? Math.round(
                          ((meeting.original_price - meeting.price) /
                            meeting.original_price) *
                            100
                        )
                      : null;

                  return (
                    <div
                      key={meeting.id}
                      onClick={() => handleSelectMeeting(meeting.id)}
                      className="group rounded-2xl border border-slate-200/90 hover:border-orange-400 hover:shadow-lg transition-all duration-200 p-5 bg-white flex flex-col justify-between cursor-pointer"
                    >
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center text-lg">
                            {getBadgeEmoji(idx + 3)}
                          </div>
                          {discountPercent && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                              {discountPercent}% OFF
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-slate-900 text-sm group-hover:text-orange-600 transition-colors leading-snug">
                          {meeting.name}
                        </h4>
                        <p className="text-xs text-slate-500 font-normal leading-relaxed line-clamp-2">
                          {meeting.description}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                        <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{meeting.duration_minutes} mins</span>
                        </div>

                        <button
                          type="button"
                          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectMeeting(meeting.id);
                          }}
                          className="font-extrabold text-xs px-3.5 py-1.5 rounded-full shadow-xs transition flex items-center gap-1 cursor-pointer"
                        >
                          <span>{formatPrice(meeting.price, meeting.currency)}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trust Banner */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>100% Verified Mentor • Calendar invite with Google Meet automatically dispatched</span>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <span>Personal URL: /{activeAdmin.username}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
