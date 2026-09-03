import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { api } from '@/lib/api';
import type { MeetingType, TimeSlot, AdminUser } from '@/types';
import {
  format,
  addDays,
  isSameDay,
  isToday,
  startOfToday,
} from 'date-fns';
import {
  Clock,
  Video,
  CheckCircle2,
  Calendar,
  Sparkles,
  User,
  Mail,
  Phone,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  ArrowRight,
  Star,
  ExternalLink,
  Award,
  TrendingUp,
  Users,
  Target,
  Zap,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const HIGHLIGHTS = [
  {
    icon: Target,
    title: '1-on-1 Live Account Audit',
    desc: 'Live screen sharing to review your active campaigns, funnels, and ad creative performance.',
  },
  {
    icon: Zap,
    title: 'Actionable Scaling Blueprint',
    desc: 'Customized step-by-step roadmap tailored specifically to your business metrics.',
  },
  {
    icon: Video,
    title: 'Instant Google Meet & Recording',
    desc: 'Automatic calendar invite and high-def session recording for your lifetime reference.',
  },
  {
    icon: ShieldCheck,
    title: '100% Satisfaction Guarantee',
    desc: 'Get unmatched clarity and value or reschedule with zero questions asked.',
  },
];

export const BookingPage: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useParams<{ username: string }>();

  const {
    admins,
    meetingTypes,
    createBooking,
  } = useBookingStore();

  // Selected states
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null); // null = "Any available"
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  // Sync selected admin from route parameter
  useEffect(() => {
    if (username) {
      const found = admins.find(
        (a) => a.username.toLowerCase() === username.toLowerCase() || a.id === username
      );
      if (found) {
        setSelectedAdminId(found.id);
      }
    }
  }, [username, admins]);

  // Dynamic meeting types for the selected admin
  const activeMeetingTypes = useMemo(() => {
    if (!selectedAdminId) {
      return meetingTypes.filter((m) => !m.admin_id);
    }
    const filtered = meetingTypes.filter(m => m.admin_id === selectedAdminId);
    return filtered.length > 0 ? filtered : meetingTypes;
  }, [meetingTypes, selectedAdminId]);

  const [selectedMeeting, setSelectedMeeting] = useState<MeetingType>(activeMeetingTypes[0] || meetingTypes[0] || null);

  // Keep selected meeting in sync when admin changes
  useEffect(() => {
    if (activeMeetingTypes.length > 0) {
      if (!selectedMeeting || !activeMeetingTypes.some(m => m.id === selectedMeeting.id)) {
        setSelectedMeeting(activeMeetingTypes[0]);
      }
    }
  }, [activeMeetingTypes, selectedMeeting]);

  // Form modal state (Zero-login attendee details)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate 14 selectable days for horizontal date strip
  const daysList = useMemo(() => {
    const list: Date[] = [];
    const today = startOfToday();
    for (let i = 0; i < 14; i++) {
      list.push(addDays(today, i));
    }
    return list;
  }, []);

  // Slots come from the backend engine, which subtracts the host's Google Calendar busy
  // blocks, leave, confirmed bookings and slot locks.
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');

  useEffect(() => {
    if (!selectedMeeting || !selectedAdminId) {
      setAvailableSlots([]);
      return;
    }

    let ignore = false;
    setSlotsLoading(true);
    setSlotsError('');

    api
      .getAvailableSlots({
        admin_id: selectedAdminId,
        session_id: selectedMeeting.id,
        date_str: format(selectedDate, 'yyyy-MM-dd'),
      })
      .then((res: any) => {
        if (ignore) return; // superseded by a newer request
        if (res?.error || res?.calendar_error) {
          setAvailableSlots([]);
          setSlotsError(res.message || 'Could not load availability. Please try again.');
          return;
        }
        setAvailableSlots(
          (res?.available_slots || []).map((slot: any) => ({
            start: slot.start_time_iso,
            end: slot.end_time_iso,
            display_start: slot.label,
            display_end: slot.end,
          }))
        );
      })
      .finally(() => {
        if (!ignore) setSlotsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAdminId, selectedMeeting?.id, selectedDate]);

  // Set default slot
  useEffect(() => {
    if (availableSlots.length > 0) {
      if (!selectedSlot || !availableSlots.some((s) => s.start === selectedSlot.start)) {
        setSelectedSlot(availableSlots[Math.min(2, availableSlots.length - 1)]);
      }
    } else {
      setSelectedSlot(null);
    }
  }, [availableSlots]);

  // Handle direct 1-click confirmation (Zero-login)
  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeeting || !selectedSlot || !customerName.trim() || !customerEmail.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const newBooking = createBooking({
        meetingTypeId: selectedMeeting.id,
        adminId: selectedAdminId,
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim() || undefined,
        notes: customerNotes.trim(),
        customerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      });

      setIsDetailsOpen(false);
      navigate(`/booking/confirmation/${newBooking.id}`);
    } catch (err) {
      console.error('Booking failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedAdminUser = admins.find((a) => a.id === selectedAdminId);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 antialiased font-sans pb-24">
      
      {/* =========================================================================
          TOP NAVBAR
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 shadow-2xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={selectedAdminUser?.photo_url || DEFAULT_AVATAR}
              alt={selectedAdminUser?.full_name || 'Host'}
              className="w-10 h-10 rounded-xl object-cover border border-slate-200 shadow-xs"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-slate-900 text-base sm:text-lg tracking-tight">
                  {selectedAdminUser?.full_name || 'BookMyMeet'}
                </span>
                <ShieldCheck className="w-4 h-4 text-blue-600 fill-blue-50" />
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                {selectedAdminUser?.title || 'Official 1-on-1 Consultation & Advisory Portal'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/admin/login"
              className="text-xs font-bold px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-colors shadow-xs flex items-center gap-1.5"
            >
              <span>Admin Login</span>
            </Link>
          </div>
        </div>
      </header>

      {/* =========================================================================
          HERO PROFILE SECTION (Host portrait & credibility)
         ========================================================================= */}
      <section className="bg-gradient-to-b from-slate-900 via-[#0B1E3B] to-slate-900 text-white pt-10 pb-16 px-4 sm:px-6 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-r from-orange-500/20 via-indigo-500/20 to-purple-500/20 blur-3xl pointer-events-none rounded-full" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            
            {/* Left: Host Portrait Photo */}
            <div className="md:col-span-4 flex justify-center md:justify-start">
              <div className="relative group">
                <div className="absolute -inset-1.5 bg-gradient-to-tr from-orange-500 to-indigo-500 rounded-3xl blur-md opacity-75 group-hover:opacity-100 transition duration-500" />
                <div className="relative w-56 sm:w-64 md:w-72 aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-b from-slate-800 to-slate-950 border-2 border-white/20 shadow-2xl flex items-end justify-center">
                  <img
                    src={selectedAdminUser?.photo_url || DEFAULT_AVATAR}
                    alt={`${selectedAdminUser?.full_name || 'Host'} profile photo`}
                    className="w-full h-full object-contain object-bottom transition-transform duration-300 group-hover:scale-103"
                  />
                  {/* Floating Trust Badge */}
                  <div className="absolute bottom-3 inset-x-3 bg-slate-900/90 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-center shadow-lg">
                    <div className="flex items-center justify-center gap-1 text-amber-400 text-xs font-extrabold">
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <span className="text-white ml-1 font-bold">4.9 / 5.0</span>
                    </div>
                    <p className="text-[10px] text-slate-300 font-medium mt-0.5">Top Rated Digital Mentor</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Bio, Metrics & Value Props */}
            <div className="md:col-span-8 space-y-5 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/40 text-orange-300 text-xs font-bold tracking-wide">
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                <span>1-on-1 Personalized Mentorship • Direct Video Call</span>
              </div>

              <div>
                <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white flex items-center justify-center md:justify-start gap-2.5 flex-wrap">
                  <span>{selectedAdminUser?.full_name || 'Your host'}</span>
                  {selectedAdminUser?.title && (
                    <span className="text-slate-400 font-normal text-lg sm:text-2xl">• {selectedAdminUser.title}</span>
                  )}
                  <ShieldCheck className="w-6 h-6 text-blue-400 fill-blue-500/20" />
                </h1>
                <p className="text-sm sm:text-base text-slate-300 mt-2 font-medium max-w-2xl leading-relaxed">
                  {selectedAdminUser?.bio || 'Book a private 1-on-1 consultation.'}
                </p>
              </div>

              {/* Credibility Stats Pill Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-xl text-center md:text-left">
                  <div className="text-lg sm:text-xl font-extrabold text-orange-400">10,000+</div>
                  <div className="text-[11px] text-slate-400 font-medium">Students Mentored</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-xl text-center md:text-left">
                  <div className="text-lg sm:text-xl font-extrabold text-amber-400">₹5 Cr+</div>
                  <div className="text-[11px] text-slate-400 font-medium">Ad Spend Managed</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-xl text-center md:text-left">
                  <div className="text-lg sm:text-xl font-extrabold text-blue-400">3.8x Avg</div>
                  <div className="text-[11px] text-slate-400 font-medium">ROAS Improvement</div>
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-3 rounded-xl text-center md:text-left">
                  <div className="text-lg sm:text-xl font-extrabold text-emerald-400">Instant</div>
                  <div className="text-[11px] text-slate-400 font-medium">Google Meet Invite</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* =========================================================================
          MAIN SLOTTED BOOKING CONTAINER (Screenshots 1 Layout)
         ========================================================================= */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 -mt-8 relative z-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT COLUMN: 1. Meeting Type & 2. Admin Selector */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* 1. Meeting Type */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-slate-400 font-medium">1.</span> Meeting type
                </h2>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  Special Offer Active
                </span>
              </div>

              <div className="space-y-3">
                {activeMeetingTypes.map((meeting) => {
                  const isSelected = selectedMeeting?.id === meeting.id;
                  const discountPercent =
                    meeting.original_price && meeting.original_price > meeting.price
                      ? Math.round(((meeting.original_price - meeting.price) / meeting.original_price) * 100)
                      : null;

                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      onClick={() => setSelectedMeeting(meeting)}
                      className={`w-full text-left p-4 rounded-xl transition-all duration-200 flex items-center justify-between border cursor-pointer ${
                        isSelected
                          ? 'border-[#FF5722] bg-[#FFF8F6] ring-2 ring-[#FF5722]/20 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-bold text-sm sm:text-base ${isSelected ? 'text-slate-900' : 'text-slate-800'}`}>
                            {meeting.name}
                          </h3>
                          {discountPercent && (
                            <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 border border-orange-200">
                              {discountPercent}% OFF
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-1 font-medium">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {meeting.duration_minutes} min duration
                        </p>
                      </div>

                      {/* Pricing: Struck-through Original Price + Highlighted Offer Price */}
                      <div className="text-right">
                        {meeting.original_price && meeting.original_price > meeting.price && (
                          <div className="text-xs text-slate-400 line-through font-medium">
                            {formatPrice(meeting.original_price, meeting.currency)}
                          </div>
                        )}
                        <div className={`text-base sm:text-lg font-black ${isSelected ? 'text-[#FF5722]' : 'text-slate-900'}`}>
                          {formatPrice(meeting.price, meeting.currency)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Admin (Optional) Selector */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-slate-400 font-medium">2.</span> Admin <span className="text-xs font-normal text-slate-400">(optional)</span>
                </h2>
              </div>

              <div className="space-y-2.5">
                {/* Any Available Option */}
                <button
                  type="button"
                  onClick={() => setSelectedAdminId(null)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-150 flex items-center justify-between border cursor-pointer ${
                    selectedAdminId === null
                      ? 'border-[#FF5722] bg-[#FFF8F6] ring-2 ring-[#FF5722]/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-xs">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-slate-900">Any available</p>
                      <p className="text-[11px] text-slate-400">Auto-match fastest available consultant</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">
                    fastest
                  </span>
                </button>

                {/* Individual Admins List */}
                {admins.map((adm) => {
                  const isSelected = selectedAdminId === adm.id;
                  return (
                    <button
                      key={adm.id}
                      type="button"
                      onClick={() => setSelectedAdminId(adm.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-150 flex items-center justify-between border cursor-pointer ${
                        isSelected
                          ? 'border-[#FF5722] bg-[#FFF8F6] ring-2 ring-[#FF5722]/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={adm.photo_url || DEFAULT_AVATAR}
                          alt={adm.full_name}
                          className="w-8 h-8 rounded-full object-cover object-top border border-slate-300"
                        />
                        <div>
                          <p className="font-bold text-sm text-slate-900">{adm.full_name}</p>
                          <p className="text-[11px] text-slate-400">{adm.title}</p>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[#FF5722]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: 3. Pick a Day & 4. Pick a Time */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-2xl p-5 sm:p-7 border border-slate-200/80 shadow-md space-y-8">
              
              {/* 3. Pick a day */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span className="text-slate-400 font-medium">3.</span> Pick a day
                  </h2>
                  <span className="text-xs font-semibold text-slate-500">
                    {format(selectedDate, 'MMMM yyyy')}
                  </span>
                </div>

                {/* Horizontal Date Pills Carousel */}
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

              {/* 4. Pick a time */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span className="text-slate-400 font-medium">4.</span> Pick a time
                  </h2>
                  <span className="text-xs text-slate-500 font-medium">
                        {slotsLoading ? 'Checking availability…' : `${availableSlots.length} available slots`} • {Intl.DateTimeFormat().resolvedOptions().timeZone}
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
                    <p className="text-xs text-slate-400 mt-1">Please select another date on the calendar.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 max-h-80 overflow-y-auto pr-1">
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

              {/* Summary & Book Action Banner */}
              {selectedMeeting && selectedSlot && (
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50 p-5 rounded-2xl border">
                  <div className="space-y-1 text-center sm:text-left">
                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <span className="font-bold text-slate-900 text-sm sm:text-base">
                        {selectedMeeting.name}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        ({selectedMeeting.duration_minutes} min)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 font-medium">
                      📅 {format(selectedDate, 'EEEE, MMMM d')} at ⏰ {selectedSlot.display_start}
                      {selectedAdminUser ? ` with ${selectedAdminUser.full_name}` : ' (Any available consultant)'}
                    </p>
                  </div>

                  <Button
                    onClick={() => setIsDetailsOpen(true)}
                    className="w-full sm:w-auto bg-[#FF5722] hover:bg-[#E64A19] text-white px-7 py-5 rounded-xl font-bold text-sm shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <span>Proceed to Book</span>
                    <span className="font-extrabold ml-1">({formatPrice(selectedMeeting.price, selectedMeeting.currency)})</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}

            </div>
          </div>

        </div>

        {/* =========================================================================
            SECTION: WHAT YOU GET
           ========================================================================= */}
        <section className="mt-14 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              What You Get in Every 1-on-1 Consultation
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 max-w-xl mx-auto">
              Every consultation is engineered to give you high-ROI clarity and tactical execution steps.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {HIGHLIGHTS.map((h, i) => (
              <div
                key={i}
                className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3"
              >
                <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                  <h.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">{h.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{h.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* =========================================================================
            SECTION: REVIEWS & SOCIAL PROOF
           ========================================================================= */}

      </main>

      {/* =========================================================================
          ATTENDEE DETAILS DIALOG (ZERO LOGIN REQUIRED)
         ========================================================================= */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-lg p-6 sm:p-8 rounded-3xl bg-white">
          <DialogHeader>
            <div className="flex items-center gap-2 text-orange-600 text-xs font-bold uppercase tracking-wider mb-1">
              <Sparkles className="w-4 h-4" />
              <span>Instant Confirmation • No Account Needed</span>
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900">
              Confirm Your Appointment
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Enter your details below. A Google Meet invitation will be delivered to your email instantly.
            </DialogDescription>
          </DialogHeader>

          {/* Quick Summary Pill */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
            <div className="flex justify-between font-medium">
              <span className="text-slate-500">Session</span>
              <span className="font-bold text-slate-900">{selectedMeeting?.name} ({selectedMeeting?.duration_minutes} min)</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-slate-500">Scheduled Time</span>
              <span className="font-bold text-slate-900">{format(selectedDate, 'MMM d, yyyy')} at {selectedSlot?.display_start}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-slate-500">Payable Amount</span>
              <span className="font-extrabold text-orange-600 text-sm">
                {selectedMeeting && formatPrice(selectedMeeting.price, selectedMeeting.currency)}
              </span>
            </div>
          </div>

          <form onSubmit={handleConfirmBooking} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="cust-name" className="text-xs font-bold text-slate-700">
                Your Full Name <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <Input
                  id="cust-name"
                  required
                  placeholder="Enter your full name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="pl-10 h-11 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cust-email" className="text-xs font-bold text-slate-700">
                Email Address <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <Input
                  id="cust-email"
                  type="email"
                  required
                  placeholder="rahul@example.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="pl-10 h-11 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cust-phone" className="text-xs font-bold text-slate-700">
                Phone / WhatsApp Number <span className="text-slate-400 font-normal">(Optional)</span>
              </Label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <Input
                  id="cust-phone"
                  placeholder="e.g. +91 9876543210 (optional)"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="pl-10 h-11 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cust-notes" className="text-xs font-bold text-slate-700">
                Topic or Notes (Optional)
              </Label>
              <Textarea
                id="cust-notes"
                placeholder="What challenge or topic would you like to discuss?"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                rows={2}
                className="rounded-xl text-sm"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDetailsOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#FF5722] hover:bg-[#E64A19] text-white font-bold rounded-xl px-6 h-11 cursor-pointer"
              >
                {isSubmitting ? 'Confirming...' : 'Confirm Appointment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
