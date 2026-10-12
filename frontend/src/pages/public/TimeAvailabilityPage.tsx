import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { api } from '@/lib/api';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import type { MeetingType, TimeSlot, AdminUser } from '@/types';
import {
  format,
  addDays,
  isSameDay,
  startOfToday,
} from 'date-fns';
import {
  Clock,
  ArrowLeft,
  AlertCircle,
  Globe,
  Sun,
  Sunrise,
  Moon,
  ShieldCheck,
  Share2,
  Copy,
  Check,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

/** How many days the date strip offers. Also the window the slot counts are fetched for. */
const DATE_STRIP_DAYS = 14;

export const TimeAvailabilityPage: React.FC = () => {
  const navigate = useNavigate();
  const { username: routeUsername, meetingId } = useParams<{ username?: string; meetingId?: string }>();
  const [searchParams] = useSearchParams();

  const {
    admins,
    meetingTypes,
    pendingBooking,
    setPendingBooking,
  } = useBookingStore();

  const queryAdminId = searchParams.get('adminId') || searchParams.get('username') || routeUsername;
  const targetAdminId = queryAdminId || pendingBooking.adminId;

  const [remoteProfile, setRemoteProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchRemote = async () => {
      if (!targetAdminId) {
        setRemoteProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadFailed(false);
      try {
        const data = await api.getPublicProfile(targetAdminId);
        if (isMounted) setRemoteProfile(data);
      } catch (err: any) {
        if (!isMounted) return;
        setRemoteProfile(null);
        setLoadFailed(!err?.notFound);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchRemote();
    return () => { isMounted = false; };
  }, [targetAdminId, reloadKey]);

  const selectedAdminUser = useMemo<AdminUser | null>(() => {
    if (!remoteProfile) return null;
    return {
      id: remoteProfile.id,
      username: remoteProfile.username,
      full_name: remoteProfile.name,
      title: remoteProfile.title || 'Consultant & Mentor',
      role: 'admin',
      status: remoteProfile.status || 'ACTIVE',
      avatar_color: 'bg-indigo-600',
      avatar_letter: remoteProfile.name ? remoteProfile.name.charAt(0).toUpperCase() : 'C',
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
    } as AdminUser;
  }, [remoteProfile]);

  const selectedAdminId = selectedAdminUser?.id || '';

  const adminMeetingTypes: MeetingType[] = useMemo(() => {
    if (!selectedAdminUser || !remoteProfile?.sessions) return [];
    return remoteProfile.sessions.map((s: any) => ({
      id: s.id,
      admin_id: selectedAdminUser.id,
      name: s.title,
      description: s.description || '',
      duration_minutes: s.duration_minutes,
      price: s.price,
      original_price: s.original_price,
      offer_price: s.price,
      currency: s.currency || 'INR',
      is_active: s.is_active,
      buffer_before_minutes: s.buffer_before_minutes || 5,
      buffer_after_minutes: s.buffer_after_minutes || 5,
      min_advance_hours: s.min_advance_hours || 1,
      max_advance_days: s.max_advance_days || 30,
      cancellation_window_hours: 24,
      reschedule_allowed: true,
      max_bookings_per_day: 8,
      color_id: 1,
      sort_order: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }, [remoteProfile, selectedAdminUser]);

  const currentMeetingId = meetingId || pendingBooking.meetingTypeId;
  const selectedMeeting = useMemo(() => {
    if (currentMeetingId) {
      const found = adminMeetingTypes.find((m: MeetingType) => m.id === currentMeetingId) ||
                    meetingTypes.find((m: MeetingType) => m.id === currentMeetingId);
      if (found) return found;
    }
    return adminMeetingTypes[0] || meetingTypes[0];
  }, [currentMeetingId, adminMeetingTypes, meetingTypes]);

  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(pendingBooking.slot || null);
  const [selectedPeriod, setSelectedPeriod] = useState<'Morning' | 'Midday' | 'Evening'>('Morning');

  const daysList = useMemo(() => {
    const list: Date[] = [];
    const today = startOfToday();
    for (let i = 0; i < DATE_STRIP_DAYS; i++) {
      list.push(addDays(today, i));
    }
    return list;
  }, []);

  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [slotsRetryKey, setSlotsRetryKey] = useState(0);
  const [slotTimezone, setSlotTimezone] = useState<string>('');
  const [dayCounts, setDayCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!selectedMeeting || !selectedAdminUser?.id) {
      setAvailableSlots([]);
      return;
    }

    let ignore = false;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    setSlotsLoading(true);
    setSlotsError('');

    api
      .getAvailableSlots({
        admin_id: selectedAdminUser.id,
        session_id: selectedMeeting.id,
        date_str: dateStr,
      })
      .then((res: any) => {
        if (ignore) return;
        if (res?.timezone) setSlotTimezone(res.timezone);
        if (res?.error || res?.calendar_error) {
          setAvailableSlots([]);
          setSlotsError(res.message || 'Could not load availability. Please try again.');
          return;
        }
        setAvailableSlots(
          (res?.available_slots || []).map((s: any) => ({
            start: s.start_time_iso,
            end: s.end_time_iso,
            display_start: s.label,
            display_end: s.end,
          }))
        );
      })
      .catch((err: any) => {
        if (ignore) return;
        setAvailableSlots([]);
        setSlotsError(err?.message || 'Could not load availability. Please try again.');
      })
      .finally(() => {
        if (!ignore) setSlotsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAdminUser?.id, selectedMeeting?.id, selectedDate, slotsRetryKey]);

  useEffect(() => {
    if (!selectedMeeting || !selectedAdminUser?.id) {
      setDayCounts(null);
      return;
    }
    let ignore = false;
    api
      .getSlotCounts({
        admin_id: selectedAdminUser.id,
        session_id: selectedMeeting.id,
        days: DATE_STRIP_DAYS,
      })
      .then((res: any) => {
        if (ignore) return;
        const map: Record<string, number> = {};
        for (const day of res?.days || []) map[day.date] = day.count;
        setDayCounts(map);
      })
      .catch(() => {
        if (!ignore) setDayCounts(null);
      });
    return () => {
      ignore = true;
    };
  }, [selectedAdminUser?.id, selectedMeeting?.id, slotsRetryKey]);

  const [dateAutoAdvanced, setDateAutoAdvanced] = useState(false);
  useEffect(() => {
    if (!dayCounts || dateAutoAdvanced) return;
    const currentKey = format(selectedDate, 'yyyy-MM-dd');
    if ((dayCounts[currentKey] ?? 0) > 0) {
      setDateAutoAdvanced(true);
      return;
    }
    const firstOpen = daysList.find((day) => (dayCounts[format(day, 'yyyy-MM-dd')] ?? 0) > 0);
    if (firstOpen) setSelectedDate(firstOpen);
    setDateAutoAdvanced(true);
  }, [dayCounts, daysList, selectedDate, dateAutoAdvanced]);

  // Split available slots by part of day
  const morningSlots = useMemo(() => {
    return availableSlots.filter((s) => Number(s.start.slice(11, 13)) < 12);
  }, [availableSlots]);

  const middaySlots = useMemo(() => {
    return availableSlots.filter((s) => {
      const h = Number(s.start.slice(11, 13));
      return h >= 12 && h < 17;
    });
  }, [availableSlots]);

  const eveningSlots = useMemo(() => {
    return availableSlots.filter((s) => Number(s.start.slice(11, 13)) >= 17);
  }, [availableSlots]);

  // Auto-switch period to the first that has slots
  useEffect(() => {
    if (availableSlots.length > 0) {
      const mCount = morningSlots.length;
      const midCount = middaySlots.length;
      const eCount = eveningSlots.length;
      if (selectedPeriod === 'Morning' && mCount === 0) {
        if (midCount > 0) setSelectedPeriod('Midday');
        else if (eCount > 0) setSelectedPeriod('Evening');
      } else if (selectedPeriod === 'Midday' && midCount === 0) {
        if (mCount > 0) setSelectedPeriod('Morning');
        else if (eCount > 0) setSelectedPeriod('Evening');
      } else if (selectedPeriod === 'Evening' && eCount === 0) {
        if (mCount > 0) setSelectedPeriod('Morning');
        else if (midCount > 0) setSelectedPeriod('Midday');
      }
    }
  }, [availableSlots, morningSlots.length, middaySlots.length, eveningSlots.length, selectedPeriod]);

  // Auto-select first slot
  useEffect(() => {
    if (availableSlots.length > 0) {
      if (!selectedSlot || !availableSlots.some((s) => s.start === selectedSlot.start)) {
        setSelectedSlot(availableSlots[0]);
      }
    } else {
      setSelectedSlot(null);
    }
  }, [availableSlots]);

  const activePeriodSlots = useMemo(() => {
    if (selectedPeriod === 'Morning') return morningSlots;
    if (selectedPeriod === 'Midday') return middaySlots;
    return eveningSlots;
  }, [selectedPeriod, morningSlots, middaySlots, eveningSlots]);

  const handleCopyLink = () => {
    const fullUrl = window.location.href;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareUrls = useMemo(() => {
    const currentUrl = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(`Book a session with ${selectedAdminUser?.full_name || 'Mentor'}`);
    return {
      whatsapp: `https://api.whatsapp.com/send?text=${text}%20${currentUrl}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${currentUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${currentUrl}`,
      twitter: `https://twitter.com/intent/tweet?text=${text}&url=${currentUrl}`,
    };
  }, [selectedAdminUser]);

  const handleProceedToPayment = () => {
    if (!selectedMeeting || !selectedSlot) return;

    setPendingBooking({
      meetingTypeId: selectedMeeting.id,
      adminId: selectedAdminId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      slot: selectedSlot,
    });

    navigate(`/book/payment?adminId=${selectedAdminUser?.id}&username=${selectedAdminUser?.username}&meetingId=${selectedMeeting.id}`);
  };

  const profileLink = selectedAdminUser?.username ? `/${selectedAdminUser.username}` : '/';
  const themeBg = selectedAdminUser?.theme_settings?.bg_gradient || 'from-[#873600] via-[#A04000] to-[#6E2C00]';
  const buttonColor = selectedAdminUser?.theme_settings?.button_color || '#D32F2F';
  const buttonTextColor = selectedAdminUser?.theme_settings?.button_text_color || '#FFFFFF';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-orange-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading booking page&hellip;</p>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold mb-2">Couldn&rsquo;t load this page</h1>
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

  if (!selectedAdminUser || selectedAdminUser.status === 'PERMANENTLY_DELETED') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <h1 className="text-2xl font-extrabold mb-2">Booking page not available</h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          This booking page does not exist or has been permanently removed.
        </p>
        <Link to="/" className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition">
          Go to Home
        </Link>
      </div>
    );
  }

  if (selectedAdminUser.status === 'TEMPORARILY_DISABLED') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <h1 className="text-2xl font-extrabold mb-2">Bookings are paused</h1>
        <p className="text-slate-400 max-w-md text-sm">
          {selectedAdminUser.full_name} is not accepting bookings at the moment.
        </p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-b ${themeBg} text-slate-800 antialiased font-sans py-4 sm:py-6 px-3.5 sm:px-6 pb-14`}>
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        
        {/* =========================================================================
            A. COMPACT PROFILE HEADER (Horizontally aligned, on gradient background)
           ========================================================================= */}
        <header className="flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <Link
              to={profileLink}
              aria-label={`Back to ${selectedAdminUser.full_name}'s profile`}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/20 hover:bg-black/35 text-white/90 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0 border border-white/15"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </Link>

            <img
              src={selectedAdminUser.photo_url || DEFAULT_AVATAR}
              alt={selectedAdminUser.full_name}
              className="w-11 h-11 sm:w-13 sm:h-13 rounded-full object-cover object-top border-2 border-white/70 shadow-sm shrink-0"
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.endsWith(DEFAULT_AVATAR)) img.src = DEFAULT_AVATAR;
              }}
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-tight truncate">
                  {selectedAdminUser.full_name}
                </h1>
                <ShieldCheck className="w-3.5 h-3.5 text-blue-300 shrink-0" aria-label="Verified host" />
              </div>
              <p className="text-xs sm:text-sm text-white/80 leading-snug truncate mt-0.5">
                {selectedAdminUser.heading_text || selectedAdminUser.title || selectedAdminUser.bio}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* SuperProfile branding notice */}
            <span className="hidden sm:inline-flex text-xs text-white/75 font-medium items-center gap-1">
              Built with <span className="text-orange-300">🧡</span> on SuperProfile
            </span>

            {/* Share profile button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShareOpen(!shareOpen)}
                aria-label="Share booking page"
                aria-expanded={shareOpen}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/20 hover:bg-black/35 text-white border border-white/15 flex items-center justify-center transition cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Share2 className="w-4 h-4" />}
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

        {/* =========================================================================
            B. MAIN WHITE CARD (Two-Column Layout Matching Reference Screenshot)
           ========================================================================= */}
        <main className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-7 md:p-8 shadow-xl border border-white/20">
          <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">

            {/* ---------------------------------------------------------------------
                LEFT COLUMN: Selected Session Information and Intro Video
               --------------------------------------------------------------------- */}
            <section className="space-y-4">
              {selectedMeeting ? (
                <div>
                  {/* Meeting Title */}
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-snug">
                    {selectedMeeting.name}
                  </h2>

                  {/* Duration | Google Meet */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600 mt-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span>{selectedMeeting.duration_minutes} mins</span>
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="inline-flex items-center gap-1.5 text-slate-800">
                      <Video className="w-4 h-4 text-emerald-600" />
                      <span>Google Meet</span>
                    </span>
                  </div>

                  {/* Price, currency indicator, and badges */}
                  <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 mt-3">
                    {selectedMeeting.original_price && selectedMeeting.original_price > selectedMeeting.price && (
                      <span className="text-sm sm:text-base text-slate-400 line-through">
                        {formatPrice(selectedMeeting.original_price, selectedMeeting.currency)}
                      </span>
                    )}
                    <span className="text-xl sm:text-2xl font-extrabold text-slate-900">
                      {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
                    </span>

                    {/* Pay in Currency indicator */}
                    <div className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 bg-slate-50 flex items-center gap-1">
                      <span className="text-slate-500">Pay in</span>
                      <span className="font-semibold text-slate-900">
                        {selectedMeeting.currency || 'INR'} · Indian Rupee (₹)
                      </span>
                    </div>

                    {/* Rating badge */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                      ★ 5
                    </span>
                    {/* Most popular badge */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80">
                      Most Popular
                    </span>
                  </div>

                  {/* Session Description */}
                  {selectedMeeting.description && (
                    <p className="text-xs sm:text-sm text-slate-500 mt-2.5 leading-relaxed line-clamp-3">
                      {selectedMeeting.description}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-slate-500 text-sm">No meeting session selected.</div>
              )}

              {/* Admin Intro Video Player with Cover Thumbnail */}
              {selectedAdminUser.intro_video ? (
                <div className="rounded-xl overflow-hidden border border-slate-200 shadow-xs max-w-md">
                  <IntroVideoPlayer
                    url={selectedAdminUser.intro_video}
                    className="rounded-xl"
                  />
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800 text-sm">What to expect:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>1:1 private video call with {selectedAdminUser.full_name}</li>
                    <li>Instant Google Meet link & calendar invitation</li>
                    <li>Confirmed time slot reserved exclusively for you</li>
                  </ul>
                </div>
              )}

              {/* Quick switch to another session if host has more than 1 */}
              {adminMeetingTypes.length > 1 && (
                <div className="pt-1">
                  <Link
                    to={profileLink}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 underline underline-offset-2 transition"
                  >
                    View other available session types &rarr;
                  </Link>
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------------------
                RIGHT COLUMN: Date strip, Time-of-day tabs, Slot pills & Confirm Action
               --------------------------------------------------------------------- */}
            <section className="space-y-5 lg:pl-2">
              
              {/* 1. Date Selection Carousel / Strip */}
              <div>
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1.5 scrollbar-none">
                  {daysList.map((day) => {
                    const isSelected = isSameDay(day, selectedDate);
                    const key = format(day, 'yyyy-MM-dd');
                    const count = dayCounts ? dayCounts[key] ?? 0 : undefined;
                    const isEmpty = count === 0;

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => !isEmpty && setSelectedDate(day)}
                        disabled={isEmpty}
                        aria-label={`${format(day, 'EEEE d MMMM')}${count !== undefined ? `, ${count} slots` : ''}`}
                        aria-pressed={isSelected}
                        style={isSelected ? { borderColor: buttonColor, backgroundColor: `${buttonColor}0A` } : undefined}
                        className={`shrink-0 w-16 sm:w-[72px] min-h-[74px] p-2 rounded-xl flex flex-col items-center justify-between transition cursor-pointer ${
                          isEmpty
                            ? 'bg-slate-50/70 text-slate-300 border border-slate-100 cursor-not-allowed opacity-60'
                            : isSelected
                            ? 'border-2 shadow-xs'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                        }`}
                      >
                        <span
                          style={isSelected ? { color: buttonColor } : undefined}
                          className={`text-[11px] font-bold tracking-wide uppercase ${
                            isSelected ? '' : isEmpty ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {format(day, 'EEE')}
                        </span>
                        <span className={`text-sm sm:text-base font-extrabold ${
                          isSelected ? 'text-slate-900' : isEmpty ? 'text-slate-300' : 'text-slate-800'
                        }`}>
                          {format(day, 'd MMM')}
                        </span>
                        <span
                          style={isSelected ? { color: buttonColor } : undefined}
                          className={`text-[10px] font-semibold ${
                            isSelected ? '' : isEmpty ? 'text-slate-300' : 'text-amber-600'
                          }`}
                        >
                          {count !== undefined ? `${count} slots` : 'Available'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Time Slot Selection Heading */}
              <div>
                <h3 className="text-sm sm:text-[15px] font-semibold text-slate-900 mb-3">
                  Select your preferred time slot
                </h3>

                {/* Time of Day Filter Tabs */}
                <div className="flex items-center gap-2 mb-4 p-1 bg-slate-100 rounded-xl max-w-sm sm:max-w-md">
                  <button
                    type="button"
                    onClick={() => setSelectedPeriod('Morning')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedPeriod === 'Morning'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Sunrise className="w-3.5 h-3.5 text-amber-500" />
                    <span>Morning</span>
                    {morningSlots.length > 0 && <span className="text-[10px] text-slate-500">({morningSlots.length})</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPeriod('Midday')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedPeriod === 'Midday'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    <span>Midday</span>
                    {middaySlots.length > 0 && <span className="text-[10px] text-slate-500">({middaySlots.length})</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPeriod('Evening')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedPeriod === 'Evening'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Evening</span>
                    {eveningSlots.length > 0 && <span className="text-[10px] text-slate-500">({eveningSlots.length})</span>}
                  </button>
                </div>

                {/* Slot Pills / States */}
                {slotsLoading ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2 animate-pulse" />
                    <p className="text-sm font-medium text-slate-600">Checking availability…</p>
                  </div>
                ) : slotsError ? (
                  <div className="p-6 text-center bg-amber-50 rounded-2xl border border-dashed border-amber-300">
                    <p className="text-sm font-semibold text-amber-900">Availability unavailable right now</p>
                    <p className="text-xs text-amber-700 mt-1">{slotsError}</p>
                    <button
                      type="button"
                      onClick={() => setSlotsRetryKey((k) => k + 1)}
                      className="mt-3 min-h-[40px] px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      Try again
                    </button>
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-sm font-semibold text-slate-700">No times available on this date</p>
                    <p className="text-xs text-slate-400 mt-1">Please select another date from the strip above.</p>
                  </div>
                ) : activePeriodSlots.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-xs sm:text-sm text-slate-600">
                      No {selectedPeriod.toLowerCase()} slots available on this day.
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Check another part of day above.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto pr-1">
                    {activePeriodSlots.map((slot) => {
                      const isSelected = selectedSlot?.start === slot.start;
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          aria-pressed={isSelected}
                          style={
                            isSelected
                              ? {
                                  borderColor: buttonColor,
                                  backgroundColor: `${buttonColor}12`,
                                  color: buttonColor,
                                }
                              : undefined
                          }
                          className={`min-h-[42px] px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition text-center border cursor-pointer ${
                            isSelected
                              ? 'border-2 shadow-xs'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          {slot.display_start}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Bottom Row: Timezone and Confirm Details Action */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 mt-6 border-t border-slate-100">
                <div className="text-xs sm:text-sm text-slate-600 flex items-center gap-1.5 font-medium">
                  <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>{slotTimezone || 'Asia/Calcutta (GMT+5:30)'}</span>
                </div>

                <Button
                  type="button"
                  onClick={handleProceedToPayment}
                  disabled={!selectedSlot}
                  style={{
                    backgroundColor: selectedSlot ? buttonColor : undefined,
                    color: buttonTextColor,
                  }}
                  className="px-8 py-3 min-h-[44px] rounded-full font-bold text-sm shadow-md hover:opacity-95 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  Confirm details
                </Button>
              </div>

            </section>

          </div>
        </main>

      </div>
    </div>
  );
};
