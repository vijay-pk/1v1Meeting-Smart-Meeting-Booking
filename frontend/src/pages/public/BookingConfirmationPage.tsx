import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { formatBookingDate, formatBookingTime, formatPrice } from '@/lib/format';
import type { Booking } from '@/types';
import {
  CheckCircle2,
  Calendar,
  Clock,
  Video,
  User,
  Receipt,
  RotateCcw,
  XCircle,
  Loader2,
  AlertTriangle
} from 'lucide-react';

import { api } from '@/lib/api';
import { generateGoogleCalendarUrl, downloadIcsFile } from '@/lib/calendar';

export const BookingConfirmationPage: React.FC = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "We could not reach the server" and "there is no such booking" are different facts and
  // get different screens: one offers a retry, the other does not.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  // Server time minus browser time, measured when the booking loads. Every deadline below is
  // compared against the server's clock, so a wrong device clock cannot show a wrong countdown.
  // Informational only: the backend ends the meeting, not this page.
  const [clockOffset, setClockOffset] = useState<number>(0);

  // Timer interval for real-time grace period countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const tz = booking?.customer_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) {
        setError('No booking reference provided.');
        setLoading(false);
        return;
      }

      // The backend is the only thing that can confirm a booking, because it is the only
      // thing that saw the payment. Everything below it is a read of an older store, never a
      // substitute for this answer.
      try {
        const remote = await api.getPublicBooking(bookingId);
        if (remote) {
          setBooking({
            id: bookingId,
            public_id: remote.public_id,
            start_time: remote.start_time,
            end_time: remote.end_time,
            status: remote.status,
            customer_timezone: remote.timezone,
            google_meet_url: remote.google_meet_link,
            is_expired: remote.is_expired,
            is_grace_period: remote.is_grace_period,
            grace_remaining_seconds: remote.grace_remaining_seconds,
            grace_termination_time: remote.grace_termination_time,
            termination_status: remote.termination_status,
            meeting_phase: remote.meeting_phase,
            scheduled_start_at: remote.scheduled_start_at,
            scheduled_end_at: remote.scheduled_end_at,
            termination_at: remote.termination_at,
            grace_minutes: remote.grace_minutes,
            termination_detail: remote.termination_detail,
            assigned_admin_name: remote.admin_name,
            reschedule_token: remote.reschedule_token,
            cancellation_token: remote.cancellation_token,
            meeting_type: {
              name: remote.session_title,
              duration_minutes: remote.duration_minutes,
            },
            customer: {
              name: remote.client_name,
              email: remote.client_email,
            },
            payment: { status: remote.payment_status, amount: remote.amount, currency: remote.currency },
            // Facts from the server, so the page states what happened instead of assuming it.
            payment_status: remote.payment_status,
            category: remote.category,
            email_enabled: remote.email_enabled === true,
          } as any);
          if (remote.server_now) setClockOffset(Date.parse(remote.server_now) - Date.now());
          setLoading(false);
          return;
        }
      } catch (err: any) {
        // A 404 is a real answer -- there is no such booking -- and the Supabase lookup below
        // may still find a legacy row. Anything else is us failing to reach the server, and
        // that must not be dressed up as a confirmation.
        //
        // What was here before: an empty `catch {}` that swallowed this error, then a read
        // from the local zustand store which rendered the full "Booking Confirmed!" screen
        // with payment.status hardcoded to 'captured'. A client whose payment never reached
        // the backend was shown a confirmed booking that existed only in their own browser.
        if (!err?.notFound) {
          setError(
            err?.message ||
            'We could not load this booking right now. Your booking is not affected.'
          );
          setLoadFailed(true);
          setLoading(false);
          return;
        }
      }

      try {
        const { data, error: fetchErr } = await supabase
          .from('bookings')
          .select('*, meeting_type:meeting_types(*), admin:profiles(*), customer:customers(*), payment:payments(*)')
          .or(`id.eq.${bookingId},public_id.eq.${bookingId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!data) {
          setError('Booking not found. Please check your reference ID or link.');
        } else {
          setBooking(data as unknown as Booking);
        }
      } catch (err: any) {
        console.error('Error fetching booking confirmation:', err);
        setError(err.message || 'Unable to load booking details.');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, reloadKey]);

  // Deadlines come from the server as UTC instants: scheduled end, and termination = end +
  // grace. The old code rebuilt them from end_time in the browser's timezone (wrong for anyone
  // outside the host's zone) with a hardcoded grace. These hooks MUST run on every render,
  // before any early return below, or React sees a different hook count once `booking` loads.
  const graceMinutes = booking?.grace_minutes ?? 3;
  const now = nowTs + clockOffset;

  const startTs = useMemo(() => (booking?.scheduled_start_at ? Date.parse(booking.scheduled_start_at) : 0), [booking?.scheduled_start_at]);
  const endTs = useMemo(() => (booking?.scheduled_end_at ? Date.parse(booking.scheduled_end_at) : 0), [booking?.scheduled_end_at]);
  const graceEndTs = useMemo(() => {
    if (booking?.termination_at) return Date.parse(booking.termination_at);
    return endTs ? endTs + graceMinutes * 60 * 1000 : 0;
  }, [booking?.termination_at, endTs, graceMinutes]);

  const serverEnded = booking?.meeting_phase === 'ended' || booking?.meeting_phase === 'termination_failed' || booking?.meeting_phase === 'cancelled';

  const isInGracePeriod = useMemo(() => {
    if (booking?.is_expired || serverEnded) return false;
    if (!endTs || !graceEndTs) return Boolean(booking?.is_grace_period);
    return now >= endTs && now < graceEndTs;
  }, [booking?.is_expired, booking?.is_grace_period, serverEnded, endTs, graceEndTs, now]);

  const isExpired = useMemo(() => {
    if (booking?.is_expired) return true;
    if (graceEndTs && now >= graceEndTs) return true;
    return false;
  }, [booking?.is_expired, graceEndTs, now]);

  // Five states the visitor can see. A terminal state comes from the server; the others are
  // derived from the server's own timestamps and the server-aligned clock.
  const phase: 'scheduled' | 'in_progress' | 'termination_pending' | 'ended' | 'termination_failed' | 'cancelled' = (() => {
    const p = booking?.meeting_phase;
    if (p === 'ended' || p === 'termination_failed' || p === 'cancelled') return p;
    if (!startTs || !endTs) return isExpired ? 'ended' : 'scheduled';
    if (now < startTs) return 'scheduled';
    if (now < endTs) return 'in_progress';
    return 'termination_pending';
  })();

  // Past the deadline but not yet confirmed ended: ask the server again (informational refresh).
  useEffect(() => {
    if (!booking || phase !== 'termination_pending' || !graceEndTs || now < graceEndTs) return;
    const t = setInterval(() => setReloadKey(k => k + 1), 10000);
    return () => clearInterval(t);
  }, [booking, phase, graceEndTs, now]);

  const fmtCountdown = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const secondsRemaining = useMemo(() => {
    if (!isInGracePeriod || !graceEndTs) return 0;
    return Math.max(0, Math.floor((graceEndTs - now) / 1000));
  }, [isInGracePeriod, graceEndTs, now]);

  const formattedCountdown = fmtCountdown(secondsRemaining * 1000);

  const timeIn = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const scheduledEndDisplay = endTs ? timeIn(endTs) : '';
  const terminationTimeDisplay = booking?.grace_termination_time
    || (graceEndTs ? timeIn(graceEndTs) : `${graceMinutes} minutes after the scheduled end`);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm text-text-secondary">Loading your booking details...</p>
      </div>
    );
  }

  // The server could not be reached. The booking is very likely fine -- say so, and offer a
  // retry rather than implying it does not exist.
  if (loadFailed) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Couldn&rsquo;t load your booking</h2>
              <p className="text-sm text-text-secondary mt-1">
                We could not reach the booking service just now. If you completed payment,
                your booking is confirmed and your confirmation email is on its way.
              </p>
            </div>
            <Button
              variant="outline"
              className="mt-2 min-h-[44px]"
              onClick={() => {
                setError(null);
                setLoadFailed(false);
                setLoading(true);
                setReloadKey((k) => k + 1);
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Booking Not Found</h2>
              <p className="text-sm text-text-secondary mt-1">{error || 'Unknown error'}</p>
            </div>
            <Link to="/">
              <Button variant="outline" className="mt-2">
                Return Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The success screen below asserts "Your Meeting Is Confirmed!". Only the backend can make
  // that claim: `status === 'confirmed'` is set by POST /payments/verify *after* the Razorpay
  // signature is checked, so it is the authoritative "paid and confirmed" signal. Any other
  // status (pending_payment, cancelled, failed) must not be dressed up as a confirmation.
  const bookingStatus = String(booking.status || '').toLowerCase();
  if (bookingStatus !== 'confirmed') {
    const pending = bookingStatus === 'pending_payment' || bookingStatus === 'pending';
    const cancelled = bookingStatus === 'cancelled' || bookingStatus === 'completed';
    const heading = pending
      ? 'Payment Being Confirmed'
      : cancelled
        ? 'This Booking Is Not Active'
        : 'Booking Not Confirmed';
    const message = pending
      ? 'We have not yet received confirmation of your payment. If you just paid, this can take a few moments — refresh in a minute. No second payment is needed.'
      : cancelled
        ? 'This booking has been cancelled or has already taken place, so there is nothing to confirm here.'
        : 'This booking has not been confirmed. If you completed payment, please wait a moment and try again.';
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">{heading}</h2>
              <p className="text-sm text-text-secondary mt-1">{message}</p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
              {pending && (
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    setLoading(true);
                    setReloadKey((k) => k + 1);
                  }}
                >
                  Refresh status
                </Button>
              )}
              <Link to="/">
                <Button variant="ghost" className="min-h-[44px]">Return Home</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hostName = booking.assigned_admin_name || (booking as any).admin?.full_name || 'your host';
  const hostEmail = (booking as any).assigned_admin_email || (booking as any).admin?.email || '';
  const meetingName = booking.meeting_type?.name || 'Scheduled Meeting';
  const attendeeName = booking.customer?.name || 'Attendee';
  const attendeeEmail = booking.customer?.email || '';
  const amount = booking.payment?.amount || booking.meeting_type?.price || 0;
  const currency = booking.payment?.currency || booking.meeting_type?.currency || 'INR';

  // What really happened to the money and the email, as reported by the server.
  const paymentStatus: string | undefined = (booking as any).payment_status || booking.payment?.status;
  const isFree = paymentStatus === 'free' || (booking as any).category === 'student_free';
  const isTestPayment = paymentStatus === 'simulated'; // no money moved
  // Only promise an email when this site can send one (unknown for older records).
  const emailEnabled = (booking as any).email_enabled === true;

  const googleCalUrl =
    booking.google_calendar_url ||
    generateGoogleCalendarUrl({
      title: `1:1 Session: ${meetingName} - ${attendeeName} with ${hostName}`,
      description: `1-on-1 Consultation Session\nMeeting: ${meetingName}\nDuration: ${booking.meeting_type?.duration_minutes || 15} mins\nHost: ${hostName} (${hostEmail})\nAttendee: ${attendeeName} (${attendeeEmail})`,
      location: booking.google_meet_url || '',
      startTime: booking.start_time,
      endTime: booking.end_time,
      clientName: attendeeName,
      clientEmail: attendeeEmail,
      adminName: hostName,
      adminEmail: hostEmail,
    });

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <Card className="border-border shadow-lg overflow-hidden">
        <div className="bg-emerald-600 px-6 py-8 text-white text-center">
          <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Your Meeting Is Confirmed!</h1>
          <p className="text-emerald-100 text-sm mt-1">
            {isFree
              ? 'Your free session is booked.'
              : isTestPayment
                ? 'Your meeting has been confirmed.'
                : 'Your payment was successful, and your meeting has been confirmed.'}
          </p>
          {emailEnabled && attendeeEmail && (
            <p className="text-emerald-100 text-xs mt-1">
              A confirmation email is being sent to{' '}
              <span className="font-semibold text-white">{attendeeEmail}</span>.
            </p>
          )}
        </div>

        <CardContent className="p-6 sm:p-8 space-y-6">
          {/* Main Info */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Meeting Type
                </span>
                <h3 className="text-xl font-bold text-text-primary">{meetingName}</h3>
                <p className="text-sm text-text-secondary">with {hostName}</p>
              </div>
              <Badge variant="outline" className="w-fit bg-emerald-50 text-emerald-700 border-emerald-200">
                {booking.status.toUpperCase()}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-primary-600 mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary">Date</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {formatBookingDate(booking.start_time)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary">Time</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {formatBookingTime(booking.start_time)} – {formatBookingTime(booking.end_time)}{' '}
                    <span className="text-xs text-text-tertiary">({tz})</span>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-primary-600 mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary">Attendee</p>
                  <p className="text-sm font-semibold text-text-primary">{attendeeName}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Receipt className="w-5 h-5 text-primary-600 mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary">Payment</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {isFree ? (
                      'Free session'
                    ) : isTestPayment ? (
                      'No charge (test payment)'
                    ) : (
                      <>
                        {formatPrice(amount, currency)}{' '}
                        <span className="text-xs font-normal text-emerald-600">
                          ({paymentStatus === 'completed' ? 'paid' : paymentStatus})
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Google Calendar & Google Meet Actions */}
          <div className="space-y-3">
            {/* Auto-end notice + live status. Informational: the server ends the meeting. */}
            {(phase === 'scheduled' || phase === 'in_progress') && endTs > 0 && booking.google_meet_url && (
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 flex items-start sm:items-center gap-3.5 text-slate-800">
                <div className="w-10 h-10 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm">{phase === 'in_progress' ? 'In progress' : 'Scheduled'}</h4>
                    {phase === 'in_progress' && (
                      <Badge className="bg-slate-200 text-slate-800 border-slate-300 font-mono text-[11px] font-bold">
                        {fmtCountdown(endTs - now)} left
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Your session is booked until {scheduledEndDisplay}. This Google Meet ends automatically {graceMinutes} minutes after the scheduled end, at {terminationTimeDisplay}, even if people are still talking.
                  </p>
                </div>
              </div>
            )}

            {/* Grace period: booked time over, Meet still open until the termination time */}
            {isInGracePeriod && (
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 flex items-start sm:items-center gap-3.5 text-amber-900 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm text-amber-950">Termination pending: booked time ended</h4>
                    <Badge className="bg-amber-200 text-amber-900 border-amber-300 font-mono text-[11px] font-bold">
                      {formattedCountdown} remaining
                    </Badge>
                  </div>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Your scheduled session has ended. You have {graceMinutes} minutes to wrap up. This Google Meet will end automatically at {terminationTimeDisplay}.
                  </p>
                </div>
              </div>
            )}

            {isExpired ? (
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-center sm:text-left">
                  <div className="w-12 h-12 rounded-xl bg-slate-400 text-white flex items-center justify-center shrink-0 shadow-md">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <h4 className="font-bold text-slate-700 text-base">Google Meet Session Concluded</h4>
                      <Badge className={phase === 'termination_failed' ? 'bg-red-100 text-red-800 text-[10px]' : 'bg-slate-200 text-slate-700 text-[10px]'}>
                        {phase === 'termination_failed' ? 'Termination failed' : phase === 'termination_pending' ? 'Termination pending' : 'Ended'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {phase === 'termination_failed'
                        ? `This meeting's booked time (until ${scheduledEndDisplay || formatBookingTime(booking.end_time)}) is over, but Google did not confirm the call was ended automatically. The host has been notified.`
                        : phase === 'termination_pending'
                          ? `This meeting's booked time (until ${scheduledEndDisplay || formatBookingTime(booking.end_time)}) is over and it is being ended now.`
                          : `This meeting was scheduled to end at ${scheduledEndDisplay || formatBookingTime(booking.end_time)} and has ended.`}
                    </p>
                  </div>
                </div>
                <Button disabled className="w-full sm:w-auto bg-slate-200 text-slate-500 gap-2 font-bold px-5 h-11 rounded-xl cursor-not-allowed">
                  <Video className="w-4 h-4" />
                  <span>Session Ended</span>
                </Button>
              </div>
            ) : booking.google_meet_url ? (
              <div className="bg-emerald-50/80 rounded-2xl p-5 border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-center sm:text-left">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <h4 className="font-bold text-slate-900 text-base">Google Meet Video Call</h4>
                      {isInGracePeriod ? (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Grace Period</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Active</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isInGracePeriod ? 'Wrap up your conversation before automatic termination' : 'Join directly at your scheduled time with 1-click'}
                    </p>
                  </div>
                </div>

                <a
                  href={
                    booking.google_meet_url && !booking.google_meet_url.includes('bmm-')
                      ? booking.google_meet_url
                      : 'https://meet.google.com/new'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto"
                >
                  <Button className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold px-5 h-11 rounded-xl shadow-md cursor-pointer">
                    <Video className="w-4 h-4" />
                    <span>{isInGracePeriod ? 'Wrap up on Google Meet' : 'Join Google Meet'}</span>
                  </Button>
                </a>
              </div>
            ) : null}

            {/* Direct Google Calendar 1-Click Sync */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a
                href={googleCalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full"
              >
                <Button
                  variant="outline"
                  className="w-full border-blue-200 hover:bg-blue-50 text-blue-700 font-bold gap-2 h-11 rounded-xl cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <span>Add to Google Calendar</span>
                </Button>
              </a>

              <Button
                variant="outline"
                onClick={() =>
                  downloadIcsFile({
                    title: `${meetingName} - ${attendeeName} & ${hostName}`,
                    description: `1:1 Consultation Session\nService: ${meetingName}${booking.notes ? `\nTopic: ${booking.notes}` : ''}`,
                    location: booking.google_meet_url || '',
                    startTime: booking.start_time,
                    endTime: booking.end_time,
                    clientName: attendeeName,
                    clientEmail: attendeeEmail,
                    adminName: hostName,
                    adminEmail: hostEmail,
                  })
                }
                className="w-full border-slate-300 hover:bg-slate-50 text-slate-700 font-bold gap-2 h-11 rounded-xl cursor-pointer"
              >
                <Calendar className="w-4 h-4 text-slate-500" />
                <span>Download .ics File</span>
              </Button>
            </div>
          </div>

          {/* What happens next. Every line states what is true for THIS booking: this card used to
              claim invitations and links were "Delivered" to the client and the host for every
              booking, whether or not a meeting link existed or email was configured. */}
          <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center gap-1.5 border-b pb-2 font-bold text-slate-900">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>What happens next</span>
            </div>
            <ul className="space-y-1.5 text-slate-600">
              <li>
                <strong>Meeting link:</strong>{' '}
                {isExpired
                  ? 'This session has ended.'
                  : booking.google_meet_url
                    ? 'Ready. Use the Join Google Meet button above at your scheduled time.'
                    : 'Not created yet. Your host will share the link before the session.'}
              </li>
              <li>
                <strong>Calendar:</strong> Use “Add to Google Calendar” or “Download .ics File” above to put this session on your calendar.
              </li>
              <li>
                <strong>Email:</strong>{' '}
                {emailEnabled
                  ? `A confirmation is being sent to ${attendeeEmail || 'your email'}. Check your spam folder if it doesn't arrive.`
                  : 'Email confirmations are not available right now. Keep this page and your reference code below.'}
              </li>
            </ul>
          </div>

          {/* Booking Public ID / Reference */}
          <div className="bg-surface-secondary p-3.5 rounded-xl flex items-center justify-between text-xs border">
            <span className="text-text-secondary font-medium">Reference Code:</span>
            <span className="font-mono font-bold text-text-primary text-sm">{booking.public_id || booking.id}</span>
          </div>

          {/* Actions: Reschedule / Cancel */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            {booking.reschedule_token && (
              <Link to={`/booking/reschedule/${booking.reschedule_token}`} className="w-full sm:w-auto">
                <Button variant="outline" size="sm" className="w-full gap-2 text-text-secondary">
                  <RotateCcw className="w-4 h-4" />
                  Reschedule Appointment
                </Button>
              </Link>
            )}
            {booking.cancellation_token && (
              <Link to={`/booking/cancel/${booking.cancellation_token}`} className="w-full sm:w-auto">
                <Button variant="ghost" size="sm" className="w-full gap-2 text-red-600 hover:text-red-700 hover:bg-red-50">
                  <XCircle className="w-4 h-4" />
                  Cancel Booking
                </Button>
              </Link>
            )}
            <Link to="/" className="w-full sm:w-auto">
              <Button variant="ghost" size="sm" className="w-full gap-2 text-text-secondary">
                Return Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
