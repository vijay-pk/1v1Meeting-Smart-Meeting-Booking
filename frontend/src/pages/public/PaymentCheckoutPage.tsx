import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { api } from '@/lib/api';
import { format, parseISO } from 'date-fns';
import type { AdminUser } from '@/types';
import {
  ShieldCheck,
  Lock,
  ArrowLeft,
  Clock,
  Video,
  Calendar,
  User,
  Mail,
  Phone,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export const PaymentCheckoutPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    meetingTypes,
    admins,
    pendingBooking,
    createBooking,
  } = useBookingStore();

  const queryAdminId = searchParams.get('adminId') || searchParams.get('username');
  const targetAdminId = queryAdminId || pendingBooking.adminId;

  // Remote profile state for newly added / backend admins
  const [remoteProfile, setRemoteProfile] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchRemote = async () => {
      if (!targetAdminId) return;
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

  // The host is whoever the API says owns this page. Never a locally cached admin and
  // never admins[0]: this page picks the Razorpay key money is charged with, so resolving
  // an unknown username to "some other admin" would route a payment to the wrong merchant.
  const selectedAdmin = useMemo<AdminUser | null>(() => {
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

  // Find meeting and slot
  const queryMeetingId = searchParams.get('meetingId');
  const currentMeetingId = queryMeetingId || pendingBooking.meetingTypeId;

  const selectedMeeting = useMemo(() => {
    if (remoteProfile?.sessions && remoteProfile.sessions.length > 0) {
      const remoteSess = remoteProfile.sessions.find((s: any) => s.id === currentMeetingId);
      if (remoteSess) {
        return {
          id: remoteSess.id,
          admin_id: selectedAdmin?.id || remoteSess.admin_id,
          name: remoteSess.title,
          description: remoteSess.description || '',
          duration_minutes: remoteSess.duration_minutes,
          price: remoteSess.price,
          original_price: remoteSess.original_price,
          offer_price: remoteSess.price,
          currency: remoteSess.currency || 'INR',
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
        };
      }
    }

    if (currentMeetingId) {
      const found = meetingTypes.find((m) => m.id === currentMeetingId);
      if (found) return found;
    }

    if (selectedAdmin) {
      const adminMts = meetingTypes.filter((m) => m.admin_id === selectedAdmin.id);
      if (adminMts.length > 0) return adminMts[0];
    }

    return meetingTypes[0];
  }, [remoteProfile, currentMeetingId, meetingTypes, selectedAdmin]);

  const slot = pendingBooking.slot;
  const dateStr = pendingBooking.date || format(new Date(), 'yyyy-MM-dd');

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 10-Minute Hold Countdown Timer (600 seconds)
  const [secondsRemaining, setSecondsRemaining] = useState(600);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // If no slot is selected, redirect back to schedule page
  useEffect(() => {
    if (!slot && selectedMeeting) {
      const returnUrl = selectedAdmin
        ? `/schedule/${selectedMeeting.id}?adminId=${selectedAdmin.id}&username=${selectedAdmin.username}`
        : `/schedule/${selectedMeeting.id}`;
      navigate(returnUrl);
    }
  }, [slot, selectedMeeting, selectedAdmin, navigate]);

  // Each Admin's Distinct Razorpay Key ID
  const adminRazorpayKey = selectedAdmin?.razorpay_key_id?.trim();
  const isCustomAdminKey = Boolean(adminRazorpayKey && adminRazorpayKey.length > 5);
  const effectiveRazorpayKey = isCustomAdminKey
    ? adminRazorpayKey!
    : (import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_dummy1234567890');

  // Handle Payment & Confirmation
  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim() || !email.trim()) {
      setErrorMessage('Please fill in your full name and email address.');
      return;
    }

    if (!slot || !selectedMeeting) {
      setErrorMessage('Please select a valid time slot before proceeding.');
      return;
    }

    setIsProcessing(true);

    try {
      const isRealRazorpay =
        typeof window !== 'undefined' &&
        window.Razorpay &&
        effectiveRazorpayKey &&
        !effectiveRazorpayKey.includes('dummy');

      if (isRealRazorpay) {
        const options = {
          key: effectiveRazorpayKey,
          amount: selectedMeeting.price, // in paise
          currency: selectedMeeting.currency || 'INR',
          name: selectedAdmin?.full_name || '1:1 Session',
          description: `${selectedMeeting.name} (${selectedMeeting.duration_minutes} mins)`,
          image: selectedAdmin?.photo_url || DEFAULT_AVATAR,
          prefill: {
            name: name.trim(),
            email: email.trim(),
            contact: phone.trim(),
          },
          theme: {
            color: selectedAdmin?.theme_settings?.button_color || '#D32F2F',
          },
          handler: function () {
            finishBooking();
          },
          modal: {
            ondismiss: function () {
              setIsProcessing(false);
            },
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      } else {
        // Fast test payment simulation for instant checkout
        setTimeout(() => {
          finishBooking();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Payment error:', err);
      setIsProcessing(false);
      setErrorMessage('Payment processing failed. Please try again.');
    }
  };

  const finishBooking = () => {
    if (!selectedMeeting || !slot) return;

    try {
      const newBooking = createBooking({
        meetingTypeId: selectedMeeting.id,
        adminId: selectedAdmin?.id || null,
        startTime: slot.start,
        endTime: slot.end,
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || undefined,
        notes: notes.trim(),
        customerTimezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      });

      navigate(`/booking/confirmation/${newBooking.id}`);
    } catch (err) {
      console.error('Failed to create booking:', err);
      setErrorMessage('Could not record your booking. Please try again.');
      setIsProcessing(false);
    }
  };

  if (!selectedMeeting || !slot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-600">Loading your session...</p>
          <Link
            to={selectedAdmin ? `/${selectedAdmin.username}` : '/'}
            className="text-xs text-orange-600 font-bold underline"
          >
            Return to Session Selection
          </Link>
        </div>
      </div>
    );
  }

  const discountAmount =
    selectedMeeting.original_price &&
    selectedMeeting.original_price > selectedMeeting.price
      ? selectedMeeting.original_price - selectedMeeting.price
      : 0;

  const backUrl = selectedAdmin
    ? `/schedule/${selectedMeeting.id}?adminId=${selectedAdmin.id}&username=${selectedAdmin.username}`
    : `/schedule/${selectedMeeting.id}`;

  const buttonColor = selectedAdmin?.theme_settings?.button_color || '#D32F2F';

  // No host resolved (unknown or deleted username), or the host is not taking bookings:
  // do not present a payment form. Charging a card here would settle into whichever
  // merchant account happened to be resolved.
  if (!selectedAdmin || selectedAdmin.status !== 'ACTIVE') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <h1 className="text-2xl font-extrabold mb-2">Checkout unavailable</h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          This booking page is no longer accepting payments.
        </p>
        <Link to="/" className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 antialiased font-sans pb-24">
      {/* =========================================================================
          TOP NAVBAR
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={backUrl}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer"
              title="Back to Time Availability"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <img
              src={selectedAdmin?.photo_url || DEFAULT_AVATAR}
              alt={selectedAdmin?.full_name || 'Host'}
              className="w-9 h-9 rounded-xl object-cover border border-slate-200 shadow-xs"
            />

            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-slate-900 text-base tracking-tight">
                  {selectedAdmin?.full_name || '1:1 Session'}
                </span>
                <ShieldCheck className="w-4 h-4 text-blue-600 fill-blue-50" />
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Step 3: Attendee Details & Secure Payment
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
            <Lock className="w-3.5 h-3.5" />
            <span>256-Bit SSL Encrypted</span>
          </div>
        </div>
      </header>

      {/* =========================================================================
          10-MINUTE SLOT HOLD BANNER
         ========================================================================= */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white py-2.5 px-4 text-center text-xs sm:text-sm font-semibold shadow-xs flex items-center justify-center gap-2">
        <Clock className="w-4 h-4 animate-spin text-white" />
        <span>Your time slot is reserved for</span>
        <span className="bg-black/25 px-2 py-0.5 rounded-md font-mono font-extrabold text-white text-sm">
          {formatTimer(secondsRemaining)}
        </span>
        <span className="hidden sm:inline">• Please complete checkout before the timer expires</span>
      </div>

      {/* =========================================================================
          CHECKOUT MAIN CONTAINER
         ========================================================================= */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: Attendee Information Form */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md space-y-6">
            <div>
              <div className="flex items-center gap-2 text-orange-600 text-xs font-bold uppercase tracking-wider mb-1">
                <Sparkles className="w-4 h-4" />
                <span>Instant Confirmation • Direct with {selectedAdmin?.full_name || 'Mentor'}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                Enter Your Details
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Your direct Google Meet video invitation and calendar invite will be sent to this email address.
              </p>
            </div>

            {/* Individual Razorpay Indicator */}
            <div className="p-3 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-blue-900 font-medium">
                <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  Direct Payment to <strong>{selectedAdmin?.full_name}</strong> via Razorpay
                </span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white border border-blue-200 text-blue-800 font-semibold">
                {isCustomAdminKey && adminRazorpayKey?.startsWith('rzp_live_')
                  ? '● Live Secure Payment'
                  : isCustomAdminKey
                  ? `${adminRazorpayKey?.slice(0, 14)}...`
                  : 'Direct Payment'}
              </span>
            </div>

            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handlePayment} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cust-name" className="text-xs font-bold text-slate-700">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <Input
                    id="cust-name"
                    required
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 rounded-xl text-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Google Meet link and session recording link are sent here.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-phone" className="text-xs font-bold text-slate-700">
                  Phone / WhatsApp Number <span className="text-slate-400 font-normal">(Optional)</span>
                </Label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <Input
                    id="cust-phone"
                    placeholder="e.g. +91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10 h-11 rounded-xl text-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Used for SMS/WhatsApp reminder 1 hour before the session.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-notes" className="text-xs font-bold text-slate-700">
                  What would you like to discuss? <span className="text-slate-400 font-normal">(Optional)</span>
                </Label>
                <Textarea
                  id="cust-notes"
                  placeholder="Share details or questions you would like to cover during this 1:1 call..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="rounded-xl text-sm"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={isProcessing}
                  style={{ backgroundColor: buttonColor }}
                  className="w-full text-white font-extrabold text-base h-13 rounded-2xl shadow-lg shadow-black/10 transition-all cursor-pointer flex items-center justify-center gap-2 hover:opacity-95"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    {isProcessing
                      ? 'Processing Secure Checkout...'
                      : `Pay ${formatPrice(selectedMeeting.price, selectedMeeting.currency)} & Confirm`}
                  </span>
                </Button>
              </div>

              {/* Payment Trust Badges */}
              <div className="pt-3 flex items-center justify-center gap-4 text-[11px] text-slate-500 font-medium">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>100% Satisfaction Guarantee</span>
                </span>
                <span className="flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                  <span>UPI / Cards / NetBanking</span>
                </span>
              </div>
            </form>
          </div>

          {/* Right Column: Order Summary Card */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-md space-y-5">
              <h3 className="text-base font-bold text-slate-900 border-b pb-3">
                Order Summary
              </h3>

              {/* Session Details */}
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm sm:text-base leading-snug">
                      {selectedMeeting.name}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Host: <strong className="text-slate-700">{selectedAdmin?.full_name || 'Verified Consultant'}</strong>
                      {selectedAdmin?.title && <span> • {selectedAdmin.title}</span>}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    <span>
                      {slot ? `${format(parseISO(slot.start), 'EEEE, MMMM d, yyyy')}` : dateStr}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <Clock className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    <span>
                      {slot.display_start} – {slot.display_end} ({selectedMeeting.duration_minutes} mins)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                    <Video className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Google Meet video invite included</span>
                  </div>
                  <div className="flex items-center gap-2 text-blue-700 font-semibold">
                    <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>Auto-synced to Google Calendar for Client & Host</span>
                  </div>
                </div>
              </div>

              {/* Price Breakdown */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100 text-xs sm:text-sm">
                {selectedMeeting.original_price && selectedMeeting.original_price > selectedMeeting.price && (
                  <>
                    <div className="flex justify-between text-slate-500">
                      <span>Standard Rate</span>
                      <span className="line-through">
                        {formatPrice(selectedMeeting.original_price, selectedMeeting.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-emerald-600 font-medium">
                      <span>Special Discount Applied</span>
                      <span>
                        - {formatPrice(discountAmount, selectedMeeting.currency)}
                      </span>
                    </div>
                  </>
                )}

                <div className="flex justify-between items-baseline pt-2 border-t border-slate-100">
                  <span className="font-extrabold text-slate-900 text-base">Total Payable</span>
                  <span
                    style={{ color: buttonColor }}
                    className="font-black text-xl sm:text-2xl"
                  >
                    {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
                  </span>
                </div>
              </div>

              {/* Policy Notes */}
              <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200/80 text-[11px] text-amber-800 space-y-1">
                <p className="font-bold">Cancellation & Reschedule Policy:</p>
                <p>
                  Free rescheduling up to 24 hours prior to session. Links to manage your booking are provided on the confirmation page and via email.
                </p>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};
