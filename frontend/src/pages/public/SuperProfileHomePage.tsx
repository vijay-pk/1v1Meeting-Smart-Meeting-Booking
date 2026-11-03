import React, { useState, useEffect, useMemo } from 'react';
import { LegalFooter } from '@/components/layout/LegalFooter';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';
import { DEFAULT_AVATAR } from '@/lib/utils';
import type { AdminUser } from '@/types';
import { Clock, AlertCircle } from 'lucide-react';
import { resolveTheme, themeVars } from '@/lib/themes';
import { usePublicMode } from '@/hooks/usePublicMode';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { HostProfilePanel } from '@/components/booking/HostProfilePanel';
import { SessionCard } from '@/components/booking/SessionCard';
import { BenefitsStrip } from '@/components/booking/BenefitsStrip';
import { PublicSections } from '@/components/booking/PublicSections';

// The backend default for welcome_message; shown as the subtitle only when the host wrote their own.
const DEFAULT_WELCOME = 'Welcome to my booking portal';

export const SuperProfileHomePage: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useParams<{ username?: string }>();
  const { setPendingBooking } = useBookingStore();

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

  // Theme and the visitor's light/dark choice. Hooks stay above every early return below.
  const theme = useMemo(() => resolveTheme(remoteProfile?.theme_settings), [remoteProfile]);
  const { mode, toggle } = usePublicMode(theme.native);

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


  const vars = themeVars(theme, mode, activeAdmin.theme_settings) as React.CSSProperties;
  const showVideo = activeAdmin.theme_settings?.show_video !== false;
  const welcome = (activeAdmin.welcome_message || '').trim();
  const subtitle = welcome && welcome !== DEFAULT_WELCOME ? welcome : 'Book a personalized 1:1 session.';
  const hasAbout = Boolean(
    (showVideo && activeAdmin.intro_video) || activeAdmin.bio || activeAdmin.about_me_text || activeAdmin.full_name
  );

  return (
    <div className="bm-page" style={vars} data-theme-id={theme.id} data-mode={mode}>
      <BookingHeader
        hostName={activeAdmin.full_name}
        username={activeAdmin.username}
        mode={mode}
        onToggleMode={toggle}
        hasAbout={hasAbout}
        hasSessions
      />

      <main className="mx-auto max-w-[1280px] px-4 pb-10 pt-2 sm:px-6 sm:pt-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8 xl:gap-9">
          {/* Left on desktop, first on phones: video, then who the host is. */}
          <div className="lg:sticky lg:top-4">
            <HostProfilePanel
              name={activeAdmin.full_name}
              title={activeAdmin.heading_text && activeAdmin.heading_text !== 'Book a 1:1 Mentorship Session' ? activeAdmin.heading_text : activeAdmin.title}
              photoUrl={activeAdmin.photo_url}
              bio={remoteProfile?.bio || remoteProfile?.description}
              about={activeAdmin.about_me_text}
              introVideo={activeAdmin.intro_video}
              showVideo={showVideo}
            />
          </div>

          <section id="sessions" aria-label="Sessions" className="scroll-mt-4">
            <div className="bm-card p-5 sm:p-6">
              <h2 className="text-xl font-bold leading-snug bm-text sm:text-2xl">
                Choose your session and pick a convenient time.
              </h2>
              <p className="mt-1.5 text-sm bm-muted sm:text-base">{subtitle}</p>

              {adminMeetings.length === 0 ? (
                <p className="py-8 text-center text-sm bm-muted">No sessions are published yet.</p>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-3.5">
                  {adminMeetings.map((meeting: any) => (
                    <SessionCard
                      key={meeting.id}
                      title={meeting.name}
                      description={meeting.description}
                      durationMinutes={meeting.duration_minutes}
                      price={meeting.price}
                      originalPrice={meeting.original_price}
                      currency={meeting.currency}
                      onChoose={() => handleSelectMeeting(meeting.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <BenefitsStrip googleConnected={Boolean(remoteProfile?.google_connected)} />

        {/* The host's custom sections, in the order they saved them. Renders nothing when there are none. */}
        <PublicSections sections={remoteProfile?.sections} />
      </main>

      <div style={{ color: 'var(--bm-on-bg-muted)' }}>
        <LegalFooter />
      </div>
    </div>
  );
};
