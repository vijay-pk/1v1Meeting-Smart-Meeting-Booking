import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import type { AdminUser, MeetingType } from '@/types';
import {
  ShieldCheck,
  ArrowRight,
  Clock,
  Share2,
  Copy,
  Check,
  AlertCircle,
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
    const text = encodeURIComponent(`Book a 1:1 session with ${activeAdmin?.full_name || 'Mentor'}`);
    return {
      whatsapp: `https://api.whatsapp.com/send?text=${text}%20${currentUrl}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${currentUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${currentUrl}`,
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${currentUrl}`,
    };
  }, [activeAdmin]);

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
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">
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
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Profile not available</h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          This booking page does not exist or has been permanently removed by the platform administrator.
        </p>
        <Link
          to="/"
          className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition"
        >
          Go to home
        </Link>
      </div>
    );
  }

  // 4c. Status checks: Temporarily Disabled
  if (activeAdmin.status === 'TEMPORARILY_DISABLED') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <Clock className="w-7 h-7" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">
          Bookings are paused
        </h1>
        <p className="text-slate-300 max-w-md text-sm mb-6 leading-relaxed">
          {activeAdmin.full_name} is not accepting new bookings right now. Existing bookings are
          unaffected.
        </p>
        <Link
          to="/"
          className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition"
        >
          Go to home
        </Link>
      </div>
    );
  }

  const themeBg = activeAdmin.theme_settings?.bg_gradient || 'from-[#873600] via-[#A04000] to-[#6E2C00]';
  const buttonColor = activeAdmin.theme_settings?.button_color || '#D32F2F';
  const buttonTextColor = activeAdmin.theme_settings?.button_text_color || '#FFFFFF';

  return (
    <div className={`min-h-screen bg-gradient-to-b ${themeBg} text-slate-800 antialiased font-sans overflow-x-hidden pb-10`}>
      {/* HEADER: photo, name + verification, headline, compact share */}
      <header className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 pb-4 sm:pt-6 sm:pb-5 relative z-10">
        <div className="flex items-start gap-3 sm:gap-4">
          <img
            src={activeAdmin.photo_url || DEFAULT_AVATAR}
            alt={activeAdmin.full_name}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover object-top border-2 border-white/70 bg-slate-800 shrink-0"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith(DEFAULT_AVATAR)) img.src = DEFAULT_AVATAR;
            }}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                {activeAdmin.full_name}
              </h1>
              <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0" aria-label="Verified host" />
            </div>
            <p className="text-xs sm:text-sm text-white/80 mt-0.5 leading-snug">
              {activeAdmin.heading_text || activeAdmin.title}
            </p>
          </div>

          {/* Compact share action */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShareOpen(!shareOpen)}
              aria-label="Share profile"
              aria-expanded={shareOpen}
              className="w-10 h-10 rounded-full bg-black/25 hover:bg-black/40 text-white border border-white/15 flex items-center justify-center transition cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            </button>

            {shareOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 text-slate-800 space-y-0.5">
                <a
                  href={shareUrls.whatsapp}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition"
                >
                  WhatsApp
                </a>
                <a
                  href={shareUrls.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition"
                >
                  LinkedIn
                </a>
                <a
                  href={shareUrls.facebook}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition"
                >
                  Facebook
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition cursor-pointer"
                >
                  <span>{copied ? 'Copied' : 'Copy link'}</span>
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN: sessions first, everything else after */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 relative z-10 space-y-4">
        <section className="bg-white rounded-2xl p-4 sm:p-6 border border-white/20 shadow-sm space-y-4">
          <div>
            <h2 className="text-[17px] sm:text-lg font-semibold text-slate-900 tracking-tight">
              {activeAdmin.welcome_message || 'Book a 1:1 session'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Google Meet included.</p>
          </div>

          {/* Uploaded Custom Sections & Links */}
          {activeAdmin.custom_sections && activeAdmin.custom_sections.length > 0 && (
            <div className="space-y-2">
              {activeAdmin.custom_sections.map((sec) => (
                <div
                  key={sec.id}
                  className="p-3 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900">{sec.title}</h4>
                    {sec.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{sec.description}</p>
                    )}
                  </div>
                  {sec.button_url && (
                    <a
                      href={sec.button_url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-[40px] px-4 inline-flex items-center justify-center text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 transition shrink-0"
                    >
                      {sec.button_text || 'Open'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sessions — one flat list, one card treatment */}
          {adminMeetings.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No sessions are published yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {adminMeetings.map((meeting: MeetingType) => (
                <button
                  key={meeting.id}
                  type="button"
                  onClick={() => handleSelectMeeting(meeting.id)}
                  className="group text-left rounded-xl border border-slate-200 hover:border-slate-300 transition p-4 bg-white flex flex-col gap-2.5 cursor-pointer"
                >
                  <div>
                    <h3 className="font-semibold text-slate-900 text-[15px] leading-snug">
                      {meeting.name}
                    </h3>
                    {meeting.description && (
                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mt-1">
                        {meeting.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-auto">
                    {/* Compact duration · price */}
                    <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                      <span>{meeting.duration_minutes} min</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-semibold text-slate-900">
                        {formatPrice(meeting.price, meeting.currency)}
                      </span>
                      {meeting.original_price && meeting.original_price > meeting.price && (
                        <span className="text-slate-400 line-through">
                          {formatPrice(meeting.original_price, meeting.currency)}
                        </span>
                      )}
                    </div>

                    <span
                      style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                      className="shrink-0 font-semibold text-xs px-3.5 min-h-[36px] rounded-full inline-flex items-center gap-1.5"
                    >
                      <span>Choose time</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* OPTIONAL INTRO VIDEO — compact, non-dominant, below the booking action.
            Provider-neutral by design: no YouTube/Vimeo logo, icon, badge or name is added
            by this card. */}
        {activeAdmin.intro_video && (
          <section className="bg-white rounded-2xl p-4 border border-white/20 shadow-sm">
            <IntroVideoPlayer
              url={activeAdmin.intro_video}
              className="rounded-xl border border-slate-200 max-w-md mx-auto"
            />
          </section>
        )}
      </main>
    </div>
  );
};
