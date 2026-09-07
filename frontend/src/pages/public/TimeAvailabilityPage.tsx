import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { INTRO_VIDEO_LABEL } from '@/lib/video';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import { api } from '@/lib/api';
import type { MeetingType, TimeSlot, AdminUser } from '@/types';
import {
  format,
  addDays,
  isSameDay,
  startOfToday,
} from 'date-fns';
import {
  Clock,
  Video,
  Calendar,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Star,
  CheckCircle,
  Play,
  Award,
  CreditCard,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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

  // The host comes from the API and nowhere else. Three outcomes have to stay distinct,
  // because they are three different things to tell a client who is mid-booking:
  // still asking, the request failed, and this page genuinely does not exist.
  const [remoteProfile, setRemoteProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
        // Only a genuine 404 means there is no such page. A 500, a CORS failure, or a
        // backend still waking from a cold start is temporary and must offer a retry --
        // this is a link a host has already shared with the client reading it.
        setLoadFailed(!err?.notFound);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchRemote();
    return () => { isMounted = false; };
  }, [targetAdminId, reloadKey]);

  // Resolve the host from the API only. Falling back to a locally cached admin -- or, as
  // this page used to, to admins[0] -- meant an unknown or deleted username silently
  // rendered somebody else's scheduling page, with their Razorpay key on the next step.
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
      social_links: remoteProfile.social_links,
      razorpay_key_id: remoteProfile.razorpay_key_id,
      razorpay_configured: remoteProfile.razorpay_configured,
    } as AdminUser;
  }, [remoteProfile]);

  const selectedAdminId = selectedAdminUser?.id || '';

  // Sessions come from the API response for this host and nowhere else. The old fallback
  // invented "₹299 advisory call" packages for any admin the store did not know about.
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

  // Selected meeting type
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

  // Generate 14 selectable days for horizontal date strip
  const daysList = useMemo(() => {
    const list: Date[] = [];
    const today = startOfToday();
    for (let i = 0; i < 14; i++) {
      list.push(addDays(today, i));
    }
    return list;
  }, []);

  // Available slots come from the backend engine only. It is the single place that knows
  // the host's working hours, leave, confirmed bookings, slot locks and — crucially — the
  // busy blocks on their connected Google Calendar.
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');

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
        if (ignore) return; // a newer date/session request has superseded this one
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
      .finally(() => {
        if (!ignore) setSlotsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAdminUser?.id, selectedMeeting?.id, selectedDate]);

  // Auto-select first available slot if none selected or if slot is outside available range
  useEffect(() => {
    if (availableSlots.length > 0) {
      if (!selectedSlot || !availableSlots.some((s) => s.start === selectedSlot.start)) {
        setSelectedSlot(availableSlots[0]);
      }
    } else {
      setSelectedSlot(null);
    }
  }, [availableSlots]);

  // Proceed to Step 3: Payment
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
  const buttonColor = selectedAdminUser?.theme_settings?.button_color || '#D32F2F';

  // Hooks above have all run, so these early returns are safe.

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

  // Unknown or permanently deleted host: no scheduling page.
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 antialiased font-sans pb-32">
      {/* =========================================================================
          TOP NAVBAR & BREADCRUMB
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 shadow-2xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={profileLink}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer"
              title={`Back to ${selectedAdminUser.full_name}'s Profile`}
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <img
              src={selectedAdminUser.photo_url || DEFAULT_AVATAR}
              alt={selectedAdminUser.full_name}
              className="w-9 h-9 rounded-xl object-cover border border-slate-200 shadow-xs"
            />

            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">
                  {selectedAdminUser.full_name}
                </span>
                <ShieldCheck className="w-4 h-4 text-blue-600 fill-blue-50" />
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                Step 2: Choose Your Date & Time Slot
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to={profileLink}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition flex items-center gap-1"
            >
              <span>Change Session</span>
            </Link>
          </div>
        </div>
      </header>

      {/* =========================================================================
          HERO SECTION DYNAMICALLY FOR SELECTED ADMIN
         ========================================================================= */}
      <section className="bg-gradient-to-b from-slate-900 via-[#0B1E3B] to-slate-900 text-white pt-8 pb-14 px-4 sm:px-6 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-r from-orange-500/20 via-indigo-500/20 to-purple-500/20 blur-3xl pointer-events-none rounded-full" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">

            {/* Left: Video or Profile Portrait */}
            <div className="md:col-span-5 flex flex-col items-center md:items-start">
              {selectedAdminUser.intro_video ? (
                <div className="relative group w-full max-w-md">
                  <div className="absolute -inset-1 bg-gradient-to-tr from-orange-500 to-indigo-500 rounded-3xl blur-md opacity-75 group-hover:opacity-100 transition duration-500" />
                  {/* Click-to-load, so the provider's logo, channel name and title bar are
                      never what a visitor lands on. See components/ui/IntroVideoPlayer. */}
                  <IntroVideoPlayer
                    url={selectedAdminUser.intro_video}
                    className="relative rounded-2xl border-2 border-white/20 shadow-2xl"
                  />

                  {/* Video Info Badge */}
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-300 px-1">
                    <div className="flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5 text-orange-400 fill-orange-400" aria-hidden="true" />
                      <span className="font-semibold text-white">{INTRO_VIDEO_LABEL} &mdash; {selectedAdminUser.full_name}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative group flex items-center justify-center">
                  <div className="absolute -inset-2 bg-gradient-to-tr from-orange-500 to-amber-500 rounded-3xl blur-md opacity-50 group-hover:opacity-75 transition duration-500" />
                  <div className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-3xl overflow-hidden bg-slate-800 border-2 border-white/20 shadow-2xl flex items-center justify-center">
                    <img
                      src={selectedAdminUser.photo_url || DEFAULT_AVATAR}
                      alt={selectedAdminUser.full_name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Right: Mentor Authority, Bio & Stats */}
            <div className="md:col-span-7 space-y-4 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/40 text-orange-300 text-xs font-bold tracking-wide">
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                <span>1-on-1 Personalized Mentorship • Direct Video Call</span>
              </div>

              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center justify-center md:justify-start gap-2 flex-wrap">
                  <span>{selectedAdminUser.full_name}</span>
                  {selectedAdminUser.title && (
                    <span className="text-slate-400 font-normal text-base sm:text-xl">• {selectedAdminUser.title}</span>
                  )}
                  <ShieldCheck className="w-5 h-5 text-blue-400 fill-blue-500/20" />
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 mt-2 font-medium max-w-xl leading-relaxed">
                  {selectedAdminUser.bio || (selectedAdminUser as any).description || selectedAdminUser.about_me_text ||
                   `Schedule a private 1-on-1 advisory session with ${selectedAdminUser.full_name}. Real-time calendar sync and direct Google Meet link included.`}
                </p>
              </div>

              {/* Trust Badge Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-center md:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-orange-400">1-on-1</div>
                  <div className="text-[10px] text-slate-400 font-medium">Private Video Call</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-center md:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-amber-400">Instant</div>
                  <div className="text-[10px] text-slate-400 font-medium">Google Meet Invite</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-center md:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-blue-400">Direct</div>
                  <div className="text-[10px] text-slate-400 font-medium">Razorpay Gateway</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-center md:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-emerald-400">Zero</div>
                  <div className="text-[10px] text-slate-400 font-medium">Double-Booking</div>
                </div>
              </div>

            </div>

          </div>
        </div>
      </section>

      {/* =========================================================================
          STEP 2: TIME AVAILABILITY MAIN SECTION
         ========================================================================= */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 -mt-6 relative z-20">

        {/* Selected Package Banner */}
        {selectedMeeting && (
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-md mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-lg">
                🎯
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-600">Selected Session</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                    {selectedMeeting.duration_minutes} mins
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    Host: {selectedAdminUser.full_name}
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                  {selectedMeeting.name}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
              <div className="text-right">
                {selectedMeeting.original_price && selectedMeeting.original_price > selectedMeeting.price && (
                  <span className="text-xs text-slate-400 line-through block">
                    {formatPrice(selectedMeeting.original_price, selectedMeeting.currency)}
                  </span>
                )}
                <span className="text-lg sm:text-xl font-black text-slate-900">
                  {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
                </span>
              </div>
              <Link
                to={profileLink}
                className="text-xs font-bold text-orange-600 hover:text-orange-700 underline"
              >
                Change
              </Link>
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-200/80 shadow-md space-y-8">

            {/* 1. Pick a Day */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-orange-600" />
                  <span>Pick a Day</span>
                </h3>
                <span className="text-xs font-semibold text-slate-500">
                  {format(selectedDate, 'MMMM yyyy')}
                </span>
              </div>

              {/* Horizontal Date Carousel */}
              <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none">
                {daysList.map((day) => {
                  const isSelected = isSameDay(day, selectedDate);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      className={`flex-shrink-0 w-16 py-3 rounded-2xl flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-[#0B1E3B] text-white shadow-md shadow-slate-900/20 scale-102 font-bold'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/80'
                      }`}
                    >
                      <span className={`text-xs font-medium ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                        {format(day, 'EEE')}
                      </span>
                      <span className={`text-lg font-extrabold mt-0.5 ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                        {format(day, 'd')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Pick a Time */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-600" />
                  <span>Pick a Time</span>
                </h3>
                <span className="text-xs text-slate-500 font-medium">
                  {slotsLoading ? 'Checking availability…' : `${availableSlots.length} slots available`} • {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
              </div>

              {slotsLoading ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2 animate-pulse" />
                  <p className="text-sm font-semibold text-slate-700">Checking the host's calendar…</p>
                </div>
              ) : slotsError ? (
                <div className="p-8 text-center bg-amber-50 rounded-xl border border-dashed border-amber-300">
                  <Clock className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-amber-900">Availability unavailable right now</p>
                  <p className="text-xs text-amber-700 mt-1">{slotsError}</p>
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No slots available on this day</p>
                  <p className="text-xs text-slate-400 mt-1">Please select another date on the calendar strip above.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {availableSlots.map((slot) => {
                    const isSelected = selectedSlot?.start === slot.start;
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 text-center border cursor-pointer ${
                          isSelected
                            ? 'border-[#FF5722] bg-[#FFF8F6] text-[#FF5722] ring-2 ring-[#FF5722]/20 font-bold shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        {slot.display_start}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* What to Expect Trust Banner */}
            <div className="pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-600">
              <div className="flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Direct Google Meet video call link delivered immediately to your email</span>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>1-click calendar sync with Google Calendar & Apple Calendar</span>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Free reschedule up to 24 hours prior to session</span>
              </div>
            </div>

          </div>
        </div>

      </main>

      {/* =========================================================================
          BOTTOM STICKY ACTION BAR (Proceed to Payment)
         ========================================================================= */}
      {selectedMeeting && selectedSlot && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-4 z-40 shadow-xl">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-0.5 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <span className="font-bold text-slate-900 text-sm">
                  {selectedMeeting.name}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  ({selectedMeeting.duration_minutes} min)
                </span>
              </div>
              <p className="text-xs text-slate-600 font-medium">
                📅 {format(selectedDate, 'EEEE, MMMM d')} at ⏰ {selectedSlot.display_start} with <span className="font-bold text-slate-800">{selectedAdminUser.full_name}</span>
              </p>
            </div>

            <Button
              onClick={handleProceedToPayment}
              style={{ backgroundColor: buttonColor }}
              className="w-full sm:w-auto text-white px-8 py-5 rounded-full font-bold text-sm shadow-lg shadow-black/10 flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-98 hover:opacity-95"
            >
              <span>Proceed to Payment</span>
              <span className="font-extrabold ml-1">({formatPrice(selectedMeeting.price, selectedMeeting.currency)})</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
