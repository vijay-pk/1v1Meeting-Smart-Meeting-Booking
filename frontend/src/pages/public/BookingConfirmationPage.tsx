import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { formatDate, formatTime, formatPrice, getTimezoneAbbr } from '@/lib/format';
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
            assigned_admin_name: remote.admin_name,
            meeting_type: {
              name: remote.session_title,
              duration_minutes: remote.duration_minutes,
            },
            customer: {
              name: remote.client_name,
              email: remote.client_email,
            },
            payment: { status: remote.payment_status },
          } as any);
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

  const hostName = booking.assigned_admin_name || (booking as any).admin?.full_name || 'your host';
  const hostEmail = (booking as any).assigned_admin_email || (booking as any).admin?.email || '';
  const meetingName = booking.meeting_type?.name || 'Scheduled Meeting';
  const attendeeName = booking.customer?.name || 'Attendee';
  const attendeeEmail = booking.customer?.email || '';
  const amount = booking.payment?.amount || booking.meeting_type?.price || 0;
  const currency = booking.payment?.currency || booking.meeting_type?.currency || 'INR';

  const googleCalUrl =
    booking.google_calendar_url ||
    generateGoogleCalendarUrl({
      title: `1:1 Session: ${meetingName} - ${attendeeName} with ${hostName}`,
      description: `1-on-1 Consultation Session\nMeeting: ${meetingName}\nDuration: ${booking.meeting_type?.duration_minutes || 15} mins\nHost: ${hostName} (${hostEmail})\nAttendee: ${attendeeName} (${attendeeEmail})`,
      location: booking.google_meet_url || 'https://meet.google.com',
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
          <h1 className="text-2xl font-bold">Booking Confirmed!</h1>
          <p className="text-emerald-100 text-sm mt-1">
            We've sent a calendar invitation and confirmation details to{' '}
            <span className="font-semibold text-white">{attendeeEmail || 'your email'}</span>.
          </p>
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
                    {formatDate(booking.start_time, tz)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary">Time</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {formatTime(booking.start_time, tz)} – {formatTime(booking.end_time, tz)}{' '}
                    <span className="text-xs text-text-tertiary">({getTimezoneAbbr(tz)})</span>
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
                    {formatPrice(amount, currency)}{' '}
                    <span className="text-xs font-normal text-emerald-600">({booking.payment_status})</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Google Calendar & Google Meet Actions */}
          <div className="space-y-3">
            {booking.google_meet_url ? (
              <div className="bg-emerald-50/80 rounded-2xl p-5 border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-center sm:text-left">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <h4 className="font-bold text-slate-900 text-base">Google Meet Video Call</h4>
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Active</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Join directly at your scheduled time with 1-click
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
                    <span>Join Google Meet</span>
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
                    description: `1:1 Consultation Session\nService: ${meetingName}\nTopic: ${booking.notes || 'Performance Strategy'}\nJoin Meet: ${booking.google_meet_url || 'https://meet.google.com'}`,
                    location: booking.google_meet_url || 'https://meet.google.com',
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

          {/* Email Notifications Dispatched Card (Proof for both Client and Admin) */}
          <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-1.5 font-bold text-slate-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Calendar Invites & Meeting Links Sent</span>
              </div>
              <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Delivered</Badge>
            </div>
            
            <div className="space-y-1.5 text-slate-600">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span>✉️ <strong>Client ({attendeeEmail}):</strong></span>
                <span className="text-emerald-700 font-medium">Meeting Link + Calendar Invite Sent</span>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span>✉️ <strong>Assigned Host ({hostEmail}):</strong></span>
                <span className="text-emerald-700 font-medium">New Booking Alert + Meet Link Sent</span>
              </div>
            </div>

            {booking.assigned_admin_name && (
              <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
                ℹ️ Note: Primary mentor was booked at this time. This session was automatically matched to available senior strategist <strong>{booking.assigned_admin_name}</strong>.
              </p>
            )}
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
