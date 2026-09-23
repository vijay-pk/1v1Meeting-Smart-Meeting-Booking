import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useBookingStore } from '@/stores/bookingStore';
import { formatPrice } from '@/lib/format';
import { DEFAULT_AVATAR } from '@/lib/utils';
import { api } from '@/lib/api';
import { loadRazorpayCheckout } from '@/lib/razorpay';
import { format, parseISO } from 'date-fns';
import type { AdminUser } from '@/types';
import {
  Lock,
  ArrowLeft,
  Clock,
  Calendar,
  AlertCircle,
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
  } = useBookingStore();

  const queryAdminId = searchParams.get('adminId') || searchParams.get('username');
  const targetAdminId = queryAdminId || pendingBooking.adminId;

  // The host comes from the API and nowhere else. "Still loading", "we could not reach the
  // service" and "there is no such page" are three different things to tell someone who is
  // one step away from paying, so they are tracked separately.
  const [remoteProfile, setRemoteProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const fetchRemote = async () => {
      if (!targetAdminId) {
        setRemoteProfile(null);
        setProfileLoading(false);
        return;
      }
      setProfileLoading(true);
      setProfileLoadFailed(false);
      try {
        const data = await api.getPublicProfile(targetAdminId);
        if (isMounted) setRemoteProfile(data);
      } catch (err: any) {
        if (!isMounted) return;
        setRemoteProfile(null);
        // Only a genuine 404 means this host does not exist. Anything else -- a 500, a CORS
        // failure, a backend waking from a cold start -- is temporary, and telling a paying
        // client the page is gone loses the booking outright.
        setProfileLoadFailed(!err?.notFound);
      } finally {
        if (isMounted) setProfileLoading(false);
      }
    };
    fetchRemote();
    return () => { isMounted = false; };
  }, [targetAdminId, reloadKey]);

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

  /**
   * Identifies this browser tab to the slot-lock endpoint, so the hold created here can be
   * told apart from another visitor's hold on the same time.
   */
  const getSessionFingerprint = () => {
    const KEY = 'bmm_session_fingerprint';
    try {
      let value = sessionStorage.getItem(KEY);
      if (!value) {
        value = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(KEY, value);
      }
      return value;
    } catch {
      // Private mode or blocked storage: a per-attempt value still identifies this hold.
      return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  };

  // Handle Payment & Confirmation
  //
  // The real flow, end to end:
  //   hold-slot -> create-order (server, under THIS admin's Razorpay key)
  //             -> Razorpay Checkout -> verify (server, HMAC signature)
  //             -> confirmation
  //
  // This page previously did none of that: it checked `window.Razorpay` while nothing ever
  // loaded the SDK, so the check was always false and it fell into a 1.2s setTimeout that
  // wrote a booking straight into localStorage and navigated to "Booking Confirmed". No
  // order, no payment, no signature, and nothing the admin could ever see.
  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim() || !email.trim()) {
      setErrorMessage('Please fill in your full name and email address.');
      return;
    }

    if (!slot || !selectedMeeting || !selectedAdmin?.id) {
      setErrorMessage('Please select a valid time slot before proceeding.');
      return;
    }

    setIsProcessing(true);
    let lockId: string | null = null;

    try {
      // 1. Load Razorpay before creating anything server-side, so a blocked or offline SDK
      //    does not leave a pending booking behind.
      const sdkReady = await loadRazorpayCheckout();
      if (!sdkReady) {
        setIsProcessing(false);
        setErrorMessage(
          'Could not reach the payment provider. Check your connection and try again.'
        );
        return;
      }

      // 2. Hold the slot so nobody else can take it while this client pays.
      try {
        const lock = await api.holdSlot({
          admin_id: selectedAdmin.id,
          session_id: selectedMeeting.id,
          start_time: slot.start,
          end_time: slot.end,
          session_fingerprint: getSessionFingerprint(),
        });
        lockId = lock?.lock_id || null;
      } catch (lockErr: any) {
        setIsProcessing(false);
        setErrorMessage(
          lockErr?.message || 'That time was just taken. Please choose another slot.'
        );
        return;
      }

      // 3. Create the order under this admin's own Razorpay account. The backend refuses
      //    (503) when the host has not connected one, rather than inventing a fake order.
      const order = await api.createOrder({
        admin_id: selectedAdmin.id,
        session_id: selectedMeeting.id,
        start_time: slot.start,
        end_time: slot.end,
        client_name: name.trim(),
        client_email: email.trim(),
        client_phone: phone.trim() || null,
        notes: notes.trim() || null,
        lock_id: lockId,
      });

      // 4. Razorpay Checkout, keyed with the order's own key_id -- the server's answer, not
      //    a key this page guessed at.
      const options = {
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency || 'INR',
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
        handler: async (response: any) => {
          // 5. Only the server may confirm a booking: it re-checks the HMAC signature with
          //    this admin's secret before anything is marked paid.
          try {
            const confirmed = await api.verifyPayment({
              booking_id: order.booking_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            // The public reference is what the confirmation page (and the client's emailed
            // link) can look a booking up by.
            navigate(`/booking/confirmation/${confirmed?.public_id || order.booking_id}`);
          } catch (verifyErr: any) {
            setIsProcessing(false);
            setErrorMessage(
              verifyErr?.message ||
                'We could not confirm that payment. If you were charged, contact your host before trying again.'
            );
          }
        },
        modal: {
          ondismiss: () => {
            // Abandoned checkout: free the slot for the next person. The booking stays in
            // pending_payment so the host can still see the attempt.
            if (lockId) api.releaseHold(lockId).catch(() => {});
            setIsProcessing(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (failure: any) => {
        setIsProcessing(false);
        setErrorMessage(
          failure?.error?.description || 'The payment did not go through. Please try again.'
        );
      });
      rzp.open();
    } catch (err: any) {
      if (lockId) api.releaseHold(lockId).catch(() => {});
      setIsProcessing(false);
      setErrorMessage(
        err?.message || 'Payment could not be started. Please try again in a moment.'
      );
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-orange-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading checkout&hellip;</p>
      </div>
    );
  }

  if (profileLoadFailed) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-sans">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold mb-2">Couldn&rsquo;t load checkout</h1>
        <p className="text-slate-400 max-w-md text-sm mb-6">
          We could not reach the booking service just now. Nothing has been charged and your
          slot selection is intact &mdash; please try again in a moment.
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 antialiased font-sans pb-10">
      {/* =========================================================================
          COMPACT CONTEXT HEADER — one back action
         ========================================================================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            to={backUrl}
            aria-label="Back to time selection"
            className="w-10 h-10 -ml-2 rounded-xl hover:bg-slate-100 text-slate-700 flex items-center justify-center transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <img
            src={selectedAdmin?.photo_url || DEFAULT_AVATAR}
            alt=""
            className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
          />

          <p className="text-sm font-semibold text-slate-900 truncate min-w-0 flex-1">
            {selectedAdmin?.full_name || '1:1 session'}
            <span className="font-normal text-slate-500">{' · '}{selectedMeeting.name}</span>
          </p>

          {/* The hold is real: create-order consumes a 10-minute SlotLock. */}
          <span className="shrink-0 text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono tabular-nums">{formatTimer(secondsRemaining)}</span>
            <span className="sr-only">remaining on your slot hold</span>
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

          {/* Left: attendee details + payment */}
          <div className="lg:col-span-7 bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 space-y-4">
            <div>
              <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">
                Your details
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Your Google Meet link and calendar invite are sent to this email.
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handlePayment} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="cust-name" className="text-xs font-semibold text-slate-700">
                  Full name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="cust-name"
                  required
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-email" className="text-xs font-semibold text-slate-700">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="cust-email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-phone" className="text-xs font-semibold text-slate-700">
                  Phone <span className="text-slate-400 font-normal">(optional)</span>
                </Label>
                <Input
                  id="cust-phone"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 rounded-xl text-sm"
                />
              </div>

              {/* Optional note, visually minimized behind a disclosure. */}
              <details className="group">
                <summary className="text-xs font-semibold text-slate-600 cursor-pointer min-h-[36px] flex items-center hover:text-slate-900">
                  Add a note (optional)
                </summary>
                <Textarea
                  id="cust-notes"
                  aria-label="What would you like to discuss?"
                  placeholder="Anything you would like to cover"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="rounded-xl text-sm mt-2"
                />
              </details>

              <div className="pt-1">
                <Button
                  type="submit"
                  disabled={isProcessing}
                  style={{ backgroundColor: buttonColor }}
                  className="w-full text-white font-semibold text-base min-h-[48px] rounded-2xl transition cursor-pointer flex items-center justify-center gap-2 hover:opacity-95"
                >
                  <span>
                    {isProcessing
                      ? 'Processing…'
                      : `Pay ${formatPrice(selectedMeeting.price, selectedMeeting.currency)}`}
                  </span>
                </Button>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <Lock className="w-3 h-3" />
                  <span>Secure payment via Razorpay</span>
                </p>
              </div>
            </form>
          </div>

          {/* Right: what is being booked */}
          <div className="lg:col-span-5 bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-3">
            <h2 className="text-[15px] font-semibold text-slate-900">
              {selectedMeeting.name}
            </h2>

            <div className="space-y-1.5 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{slot ? format(parseISO(slot.start), 'EEE, d MMM yyyy') : dateStr}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {/* Start plus duration, not start–end: the backend's end label is 24-hour
                    ("09:30") while the start is 12-hour, and the pair read as a typo. */}
                <span>
                  {slot.display_start} · {selectedMeeting.duration_minutes} min
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-sm">
              {selectedMeeting.original_price && selectedMeeting.original_price > selectedMeeting.price && (
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>Standard rate</span>
                  <span className="line-through">
                    {formatPrice(selectedMeeting.original_price, selectedMeeting.currency)}
                  </span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 text-xs">
                  <span>Discount</span>
                  <span>- {formatPrice(discountAmount, selectedMeeting.currency)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline">
                <span className="font-semibold text-slate-900">Total</span>
                <span style={{ color: buttonColor }} className="font-bold text-lg">
                  {formatPrice(selectedMeeting.price, selectedMeeting.currency)}
                </span>
              </div>
            </div>

            <p className="pt-2 border-t border-slate-100 text-xs text-slate-500">
              Google Meet · Calendar invite. Links to manage your booking are on the
              confirmation page and in your email.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
};
