import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { formatBookingDate, formatBookingTime, formatPrice } from '@/lib/format';
import type { Booking } from '@/types';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Video,
  RotateCcw,
  Loader2,
  AlertCircle
} from 'lucide-react';

export const BookingStatusPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  // A load failure used to be a dead end: an error screen whose only action was a link away
  // from the page the visitor was sent. Re-running the fetch is almost always what they want.
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tz = booking?.customer_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  useEffect(() => {
    const fetchBooking = async () => {
      if (!token) {
        setError('No access token or booking identifier provided.');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchErr } = await supabase
          .from('bookings')
          .select('*, meeting_type:meeting_types(*), admin:profiles(*), customer:customers(*), payment:payments(*)')
          .or(`cancellation_token.eq.${token},reschedule_token.eq.${token},public_id.eq.${token},id.eq.${token}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!data) {
          setError('Booking not found. Please verify the URL.');
        } else {
          setBooking(data as unknown as Booking);
        }
      } catch (err: any) {
        console.error('Error fetching booking status:', err);
        setError(err.message || 'Unable to load booking status.');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [token, reloadKey]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm text-text-secondary">Checking booking status...</p>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Status Unavailable</h2>
              <p className="text-sm text-text-secondary mt-1">{error || 'Booking record could not be found.'}</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                className="mt-2 min-h-[44px]"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setReloadKey((k) => k + 1);
                }}
              >
                Try again
              </Button>
            </div>
            <Link to="/">
              <Button variant="outline" className="mt-2">
                Go to Homepage
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isCancelled = booking.status === 'cancelled';
  const isCompleted = booking.status === 'completed';
  const isConfirmed = booking.status === 'confirmed';
  const attendeeName = booking.customer?.name || 'Attendee';
  const amount = booking.payment?.amount || booking.meeting_type?.price || 0;
  const currency = booking.payment?.currency || booking.meeting_type?.currency || 'INR';

  return (
    <div className="max-w-xl mx-auto py-10 px-4 sm:px-6">
      <Card className="border-border shadow-md">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-2">
            {isConfirmed && <CheckCircle2 className="w-12 h-12 text-emerald-500" />}
            {isCancelled && <XCircle className="w-12 h-12 text-red-500" />}
            {isCompleted && <CheckCircle2 className="w-12 h-12 text-blue-500" />}
            {!isConfirmed && !isCancelled && !isCompleted && <Clock className="w-12 h-12 text-amber-500" />}
          </div>
          <CardTitle className="text-xl font-bold">Booking Status</CardTitle>
          <div className="mt-2">
            <Badge
              variant="outline"
              className={
                isConfirmed
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isCancelled
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-primary-50 text-primary-700 border-primary-200'
              }
            >
              {booking.status.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg bg-surface-secondary p-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Meeting</span>
              <span className="font-semibold text-text-primary">
                {booking.meeting_type?.name || 'Meeting'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Host</span>
              <span className="font-semibold text-text-primary">
                {(booking as any).admin?.full_name || 'Host'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Date & Time</span>
              <span className="font-semibold text-text-primary text-right">
                {formatBookingDate(booking.start_time)}, {formatBookingTime(booking.start_time)} – {formatBookingTime(booking.end_time)} ({tz})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Attendee</span>
              <span className="font-semibold text-text-primary">{attendeeName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Amount</span>
              <span className="font-semibold text-text-primary">
                {formatPrice(amount, currency)}
              </span>
            </div>
          </div>

          {isConfirmed && booking.google_meet_url && (
            <a
              href={booking.google_meet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <Button className="w-full bg-primary-600 hover:bg-primary-700 text-white gap-2">
                <Video className="w-4 h-4" />
                Join Video Meeting
              </Button>
            </a>
          )}

          {isConfirmed && (
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {booking.reschedule_token && (
                <Link to={`/booking/reschedule/${booking.reschedule_token}`} className="flex-1">
                  <Button variant="outline" className="w-full gap-2">
                    <RotateCcw className="w-4 h-4" />
                    Reschedule
                  </Button>
                </Link>
              )}
              {booking.cancellation_token && (
                <Link to={`/booking/cancel/${booking.cancellation_token}`} className="flex-1">
                  <Button variant="ghost" className="w-full text-red-600 hover:bg-red-50 gap-2">
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
