import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Loader2, Calendar, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatBookingDate, formatBookingTime } from '@/lib/format';
import type { Booking } from '@/types';

export const CancelBookingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  // A load failure used to be a dead end: an error screen whose only action was a link away
  // from the page the visitor was sent. Re-running the fetch is almost always what they want.
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tz = booking?.customer_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  useEffect(() => {
    const fetchBooking = async () => {
      if (!token) {
        setError('Invalid cancellation link.');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchErr } = await supabase
          .from('bookings')
          .select('*, meeting_type:meeting_types(*), admin:profiles(*), customer:customers(*)')
          .eq('cancellation_token', token)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!data) {
          setError('Booking not found or token has expired.');
        } else {
          setBooking(data as unknown as Booking);
          if (data.status === 'cancelled') {
            setCancelled(true);
          }
        }
      } catch (err: any) {
        console.error('Error fetching booking for cancellation:', err);
        setError(err.message || 'Unable to load booking details.');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [token, reloadKey]);

  const handleCancel = async () => {
    if (!booking || !token) return;
    setCancelling(true);
    setError(null);

    try {
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason || 'Cancelled by customer',
          updated_at: new Date().toISOString()
        })
        .eq('id', booking.id);

      if (updateErr) throw updateErr;

      setCancelled(true);
    } catch (err: any) {
      console.error('Cancellation failed:', err);
      setError(err.message || 'Failed to cancel booking. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm text-text-secondary">Loading booking details...</p>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Cancellation Error</h2>
              <p className="text-sm text-text-secondary mt-1">{error}</p>
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
            <Link to="/" className="mt-2 inline-block">
              <Button variant="outline" tabIndex={-1}>
                Back to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-border shadow-md">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">Booking Cancelled</h2>
              <p className="text-sm text-text-secondary mt-1">
                Your appointment has been cancelled successfully. Any applicable refund will be processed according to the host's policy.
              </p>
            </div>
            <Link to="/">
              <Button className="mt-4 bg-primary-600 hover:bg-primary-700 text-white">
                Done
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4 sm:px-6">
      <Card className="border-border shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider">Cancel Appointment</span>
          </div>
          <CardTitle className="text-xl font-bold">Are you sure you want to cancel?</CardTitle>
          <CardDescription>
            This will release your reserved time slot and notify the host.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {booking && (
            <div className="rounded-lg bg-surface-secondary p-4 space-y-2 text-sm border border-border">
              <p className="font-semibold text-text-primary">
                {booking.meeting_type?.name || 'Scheduled Meeting'}
              </p>
              <div className="flex items-center gap-2 text-text-secondary text-xs">
                <Calendar className="w-4 h-4" />
                <span>{formatBookingDate(booking.start_time)}</span>
                <Clock className="w-4 h-4 ml-2" />
                <span>{formatBookingTime(booking.start_time)} – {formatBookingTime(booking.end_time)} ({tz})</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cancellation-reason" className="text-sm font-medium">
              Reason for cancellation (optional)
            </Label>
            <Textarea
              id="cancellation-reason"
              placeholder="Let the host know why you are cancelling..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link to={`/booking/confirmation/${booking?.id || ''}`} className="flex-1">
              <Button variant="outline" className="w-full">
                Keep Booking
              </Button>
            </Link>
            <Button
              variant="destructive"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Cancelling...
                </>
              ) : (
                'Confirm Cancellation'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
