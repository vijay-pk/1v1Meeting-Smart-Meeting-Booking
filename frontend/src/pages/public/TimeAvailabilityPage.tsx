import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
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
  ArrowRight,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

/** How many days the date strip offers. Also the window the slot counts are fetched for. */
const DATE_STRIP_DAYS = 14;

/**
 * Splits slots into the parts of the day people actually think in.
 *
 * A flat list of a dozen times is read one item at a time; three short labelled groups are
 * scanned. Empty groups are dropped so the headings never promise something that is not
 * there.
 */
function groupByPartOfDay(slots: TimeSlot[]): { label: string; slots: TimeSlot[] }[] {
  const buckets: Record<string, TimeSlot[]> = { Morning: [], Midday: [], Evening: [] };
  for (const slot of slots) {
    // start is "YYYY-MM-DDTHH:MM:00Z" wall clock in the host's zone; read the hour directly
    // rather than through Date, which would shift it into the browser's zone.
    const hour = Number(slot.start.slice(11, 13));
    if (hour < 12) buckets.Morning.push(slot);
    else if (hour < 17) buckets.Midday.push(slot);
    else buckets.Evening.push(slot);
  }
  return Object.entries(buckets)
    .filter(([, group]) => group.length > 0)
    .map(([label, group]) => ({ label, slots: group }));
}

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

  // The horizontal date strip.
  const daysList = useMemo(() => {
    const list: Date[] = [];
    const today = startOfToday();
    for (let i = 0; i < DATE_STRIP_DAYS; i++) {
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
  const [slotsRetryKey, setSlotsRetryKey] = useState(0);
  // The zone the backend computed these times in -- the host's, which is where their working
  // hours and calendar live. Never the browser's: this caption used to read
  // Intl.DateTimeFormat().resolvedOptions().timeZone, so a client in London was shown IST
  // slots labelled "Europe/London" and would have arrived five and a half hours late.
  const [slotTimezone, setSlotTimezone] = useState<string>('');
  // Per-day slot counts for the date strip, fetched in one request rather than one per day.
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
        if (ignore) return; // a newer date/session request has superseded this one
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
        // Without this the promise rejected unhandled and the grid simply rendered
        // "0 slots available" -- a failed request shown as a host with no free time.
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

  // Slot counts for the whole date strip, in one request.
  //
  // Without these every pill looks identical and a visitor has to click through empty days
  // to find one that has anything. One call, so a phone on a slow connection pays for one
  // round trip instead of fourteen.
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
        // Counts are an enhancement. If they cannot be fetched the strip still works --
        // every day stays selectable and the slot grid gives the real answer.
        if (!ignore) setDayCounts(null);
      });
    return () => {
      ignore = true;
    };
  }, [selectedAdminUser?.id, selectedMeeting?.id, slotsRetryKey]);

  // Land on a day that actually has times.
  //
  // The strip defaults to today, and today is very often full -- by mid-afternoon every
  // remaining slot has passed the host's minimum notice. A visitor arriving on an empty grid
  // has to work out for themselves that they should try another pill. Once the counts are
  // known, move to the first day with availability; only ever automatically, and never away
  // from a day the visitor picked themselves.
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 antialiased font-sans pb-28">
      {/* =========================================================================
          COMPACT CONTEXT HEADER — one back action, no repeated profile block
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            to={profileLink}
            aria-label={`Back to ${selectedAdminUser.full_name}'s profile`}
            className="w-10 h-10 -ml-2 rounded-xl hover:bg-slate-100 text-slate-700 flex items-center justify-center transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <img
            src={selectedAdminUser.photo_url || DEFAULT_AVATAR}
            alt=""
            className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {selectedAdminUser.full_name}
              {selectedMeeting && (
                <span className="font-normal text-slate-500">
                  {' · '}{selectedMeeting.name}
                </span>
              )}
            </p>
          </div>

          {/* Only offered when there is actually another session to switch to. */}
          {adminMeetingTypes.length > 1 && (
            <Link
              to={profileLink}
              className="shrink-0 text-xs font-semibold px-3 min-h-[36px] inline-flex items-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition"
            >
              Change
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 space-y-4">

        {/* Session context: title, duration · price */}
        {selectedMeeting && (
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight leading-tight">
              {selectedMeeting.name}
            </h1>
            <p className="text-sm text-slate-600 whitespace-nowrap">
              {selectedMeeting.duration_minutes} min
              <span className="text-slate-300"> · </span>
              <span className="font-semibold text-slate-900">
                {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
              </span>
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-5">

          {/* 1. Choose date */}
          <div>
            <div className="flex items-baseline justify-between mb-2.5">
              <h2 className="text-[15px] font-semibold text-slate-900">Choose date</h2>
              <span className="text-xs text-slate-500">{format(selectedDate, 'MMMM yyyy')}</span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {daysList.map((day) => {
                const isSelected = isSameDay(day, selectedDate);
                const key = format(day, 'yyyy-MM-dd');
                // undefined = counts unavailable, so every day stays open and the slot
                // grid gives the real answer.
                const count = dayCounts ? dayCounts[key] ?? 0 : undefined;
                const isEmpty = count === 0;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => !isEmpty && setSelectedDate(day)}
                    disabled={isEmpty}
                    aria-label={
                      `${format(day, 'EEEE d MMMM')}` +
                      (count === undefined ? '' : `, ${count} ${count === 1 ? 'slot' : 'slots'}`)
                    }
                    aria-pressed={isSelected}
                    className={`flex-shrink-0 w-14 min-h-[60px] py-2 rounded-xl flex flex-col items-center justify-center transition ${
                      isEmpty
                        ? 'bg-slate-50 text-slate-300 border border-slate-100 cursor-not-allowed'
                        : isSelected
                        ? 'bg-[#0B1E3B] text-white font-semibold cursor-pointer'
                        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 cursor-pointer'
                    }`}
                  >
                    <span className={`text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                      {format(day, 'EEE')}
                    </span>
                    <span className={`text-base font-semibold ${isSelected ? 'text-white' : isEmpty ? 'text-slate-300' : 'text-slate-800'}`}>
                      {format(day, 'd')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Choose time */}
          <div>
            <div className="flex items-baseline justify-between mb-2.5 gap-3">
              <h2 className="text-[15px] font-semibold text-slate-900">Choose time</h2>
              {/* The zone the backend computed in -- never the browser's. */}
              {slotTimezone && (
                <span className="text-xs text-slate-500 truncate">{slotTimezone}</span>
              )}
            </div>

            {slotsLoading ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <Clock className="w-6 h-6 text-slate-300 mx-auto mb-2 animate-pulse" />
                <p className="text-sm text-slate-600">Checking availability…</p>
              </div>
            ) : slotsError ? (
              <div className="p-6 text-center bg-amber-50 rounded-xl border border-dashed border-amber-300">
                <p className="text-sm font-semibold text-amber-900">Availability unavailable right now</p>
                <p className="text-xs text-amber-700 mt-1">{slotsError}</p>
                {/* This screen previously had no way out: a transient failure left the
                    visitor on a dead end with no action but to leave. */}
                <button
                  type="button"
                  onClick={() => setSlotsRetryKey((k) => k + 1)}
                  className="mt-3 min-h-[44px] px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition cursor-pointer"
                >
                  Try again
                </button>
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-sm text-slate-700">No times available on this day</p>
                <p className="text-xs text-slate-400 mt-1">Pick another date above.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {groupByPartOfDay(availableSlots).map((group) => (
                  <div key={group.label}>
                    <h3 className="text-xs font-semibold text-slate-400 mb-1.5">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {group.slots.map((slot) => {
                        const isSelected = selectedSlot?.start === slot.start;
                        return (
                          <button
                            key={slot.start}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            aria-pressed={isSelected}
                            className={`min-h-[44px] px-2 rounded-xl text-xs sm:text-sm font-medium transition text-center border cursor-pointer ${
                              isSelected
                                ? 'border-[#FF5722] bg-[#FFF8F6] text-[#FF5722] font-semibold'
                                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                            }`}
                          >
                            {slot.display_start}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* What the booking actually includes, as one line. */}
        <p className="text-xs text-slate-500 text-center px-2">
          Google Meet · Calendar invite
        </p>
      </main>

      {/* =========================================================================
          STICKY CTA — selected date · time, price, one primary action
         ========================================================================= */}
      {selectedMeeting && selectedSlot && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 z-40">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-900 truncate">
                {format(selectedDate, 'EEE, MMM d')} · {selectedSlot.display_start}
              </p>
              <p className="text-xs text-slate-500">
                {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
              </p>
            </div>

            <Button
              onClick={handleProceedToPayment}
              style={{ backgroundColor: buttonColor }}
              className="shrink-0 text-white px-6 min-h-[44px] rounded-full font-semibold text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-98 hover:opacity-95"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
