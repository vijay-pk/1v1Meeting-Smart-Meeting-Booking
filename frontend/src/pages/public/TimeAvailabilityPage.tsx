import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export const TimeAvailabilityPage: React.FC = () => {
  const navigate = useNavigate();
  const { username: routeUsername, meetingId } = useParams<{ username?: string; meetingId?: string }>();
  const [searchParams] = useSearchParams();

  const {
    admins,
    meetingTypes,
    getAvailableSlots,
    pendingBooking,
    setPendingBooking,
  } = useBookingStore();

  const queryAdminId = searchParams.get('adminId') || searchParams.get('username') || routeUsername;
  const targetAdminId = queryAdminId || pendingBooking.adminId;

  // Local admin state with remote fallback support
  const [remoteProfile, setRemoteProfile] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchRemote = async () => {
      if (!targetAdminId) return;
      // If already in local store, no urgent need, but still try to get latest
      try {
        const data = await api.getPublicProfile(targetAdminId);
        if (isMounted) setRemoteProfile(data);
      } catch (err) {
        // Fall back to local store
      }
    };
    fetchRemote();
    return () => { isMounted = false; };
  }, [targetAdminId]);

  // Resolve active admin
  const selectedAdminUser = useMemo<AdminUser>(() => {
    if (targetAdminId) {
      const found = admins.find(
        (a) => a.id === targetAdminId || a.username.toLowerCase() === targetAdminId.toLowerCase()
      );
      if (found) {
        if (remoteProfile) {
          return {
            ...found,
            ...remoteProfile,
            full_name: found.full_name || remoteProfile.name,
            username: found.username || remoteProfile.username,
            razorpay_key_id: remoteProfile.razorpay_key_id || found.razorpay_key_id,
            razorpay_configured: remoteProfile.razorpay_configured ?? found.razorpay_configured,
          };
        }
        return found;
      }
    }

    if (remoteProfile) {
      return {
        id: remoteProfile.id,
        username: remoteProfile.username,
        full_name: remoteProfile.name,
        title: remoteProfile.title || 'Consultant & Mentor',
        role: 'admin',
        status: remoteProfile.status || 'ACTIVE',
        avatar_color: 'bg-indigo-600',
        avatar_letter: remoteProfile.name ? remoteProfile.name.charAt(0).toUpperCase() : 'C',
        photo_url: remoteProfile.profile_photo || '/assets/mahir.png',
        cover_image: remoteProfile.cover_image,
        intro_video: remoteProfile.intro_video,
        heading_text: remoteProfile.heading_text,
        about_me_text: remoteProfile.about_me_text,
        welcome_message: remoteProfile.welcome_message,
        bio: remoteProfile.bio,
        email: `${remoteProfile.username}@adwaysacademy.com`,
        theme_settings: remoteProfile.theme_settings,
        social_links: remoteProfile.social_links,
        razorpay_key_id: remoteProfile.razorpay_key_id,
        razorpay_configured: remoteProfile.razorpay_configured,
      };
    }

    // If meeting has owner
    if (meetingId) {
      const m = meetingTypes.find((item) => item.id === meetingId);
      if (m?.admin_id) {
        const found = admins.find((a) => a.id === m.admin_id);
        if (found) return found;
      }
    }

    return admins[0];
  }, [admins, targetAdminId, remoteProfile, meetingId, meetingTypes]);

  const selectedAdminId = selectedAdminUser.id;

  // Filter meeting types for this admin
  const adminMeetingTypes: MeetingType[] = useMemo(() => {
    if (remoteProfile?.sessions && remoteProfile.sessions.length > 0) {
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
    }
    const filtered = meetingTypes.filter(
      (m) => m.admin_id === selectedAdminUser.id || (selectedAdminUser.id === 'ameen-ahsan' && !m.admin_id)
    );
    if (filtered.length > 0) return filtered;
    if (selectedAdminUser.id === 'ameen-ahsan') return meetingTypes.slice(0, 3);
    return [
      {
        id: `mt-${selectedAdminUser.id}-15`,
        admin_id: selectedAdminUser.id,
        name: `1:1 Advisory Call with ${selectedAdminUser.full_name}`,
        description: `Get dedicated guidance and answers tailored to your goals in a private 15-minute consultation.`,
        duration_minutes: 15,
        price: 29900,
        original_price: 59900,
        offer_price: 29900,
        currency: 'INR',
        is_active: true,
        buffer_before_minutes: 5,
        buffer_after_minutes: 5,
        min_advance_hours: 1,
        max_advance_days: 30,
        cancellation_window_hours: 24,
        reschedule_allowed: true,
        max_bookings_per_day: 8,
        color_id: 1,
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: `mt-${selectedAdminUser.id}-30`,
        admin_id: selectedAdminUser.id,
        name: `30-Min Strategy Deep Dive with ${selectedAdminUser.full_name}`,
        description: `In-depth consultation and tactical blueprint review with ${selectedAdminUser.full_name}.`,
        duration_minutes: 30,
        price: 49900,
        original_price: 99900,
        offer_price: 49900,
        currency: 'INR',
        is_active: true,
        buffer_before_minutes: 5,
        buffer_after_minutes: 10,
        min_advance_hours: 2,
        max_advance_days: 30,
        cancellation_window_hours: 24,
        reschedule_allowed: true,
        max_bookings_per_day: 6,
        color_id: 2,
        sort_order: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ];
  }, [remoteProfile, selectedAdminUser, meetingTypes]);

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

  // Compute available slots for the selected date & meeting
  const availableSlots = useMemo(() => {
    if (!selectedMeeting) return [];
    const all = getAvailableSlots(selectedDate, selectedMeeting.id, selectedAdminId);
    return all.filter((s) => {
      try {
        const mins = new Date(s.start).getMinutes();
        return mins === 0 || mins === 30;
      } catch (e) {
        return true;
      }
    });
  }, [selectedDate, selectedMeeting?.id, selectedAdminId, getAvailableSlots]);

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

    navigate(`/book/payment?adminId=${selectedAdminUser.id}&username=${selectedAdminUser.username}&meetingId=${selectedMeeting.id}`);
  };

  // Video embed helper
  const getVideoEmbedUrl = (url?: string) => {
    if (!url) return null;
    if (url.includes('vimeo.com')) {
      const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (match && match[1]) {
        return `https://player.vimeo.com/video/${match[1]}?title=0&byline=0&portrait=0&badge=0&autopause=0`;
      }
    }
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/${match[1]}?rel=0`;
      }
    }
    return null;
  };

  const videoEmbedUrl = getVideoEmbedUrl(selectedAdminUser.intro_video);
  const profileLink = selectedAdminUser.username ? `/${selectedAdminUser.username}` : '/';
  const buttonColor = selectedAdminUser.theme_settings?.button_color || '#D32F2F';

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

            {selectedAdminUser.photo_url ? (
              <img
                src={selectedAdminUser.photo_url}
                alt={selectedAdminUser.full_name}
                className="w-9 h-9 rounded-xl object-cover border border-slate-200 shadow-xs"
              />
            ) : (
              <div
                className={`w-9 h-9 rounded-xl ${selectedAdminUser.avatar_color || 'bg-indigo-600'} text-white font-black flex items-center justify-center shadow-xs text-base`}
              >
                {selectedAdminUser.avatar_letter || selectedAdminUser.full_name.charAt(0)}
              </div>
            )}

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
              {videoEmbedUrl ? (
                <div className="relative group w-full max-w-md">
                  <div className="absolute -inset-1 bg-gradient-to-tr from-orange-500 to-indigo-500 rounded-3xl blur-md opacity-75 group-hover:opacity-100 transition duration-500" />
                  <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border-2 border-white/20 shadow-2xl">
                    <iframe
                      src={videoEmbedUrl}
                      className="w-full h-full border-0"
                      allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                      title={`1 to 1 call with ${selectedAdminUser.full_name}`}
                      allowFullScreen
                    />
                  </div>

                  {/* Video Info Badge */}
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-300 px-1">
                    <div className="flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5 text-orange-400 fill-orange-400" />
                      <span className="font-semibold text-white">Watch: 1 to 1 Call with {selectedAdminUser.full_name}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative group flex items-center justify-center">
                  <div className="absolute -inset-2 bg-gradient-to-tr from-orange-500 to-amber-500 rounded-3xl blur-md opacity-50 group-hover:opacity-75 transition duration-500" />
                  <div className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-3xl overflow-hidden bg-slate-800 border-2 border-white/20 shadow-2xl flex items-center justify-center">
                    {selectedAdminUser.photo_url ? (
                      <img
                        src={selectedAdminUser.photo_url}
                        alt={selectedAdminUser.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-5xl font-black text-white">
                        {selectedAdminUser.avatar_letter || selectedAdminUser.full_name.charAt(0)}
                      </span>
                    )}
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
                  {availableSlots.length} slots available • {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
              </div>

              {availableSlots.length === 0 ? (
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
