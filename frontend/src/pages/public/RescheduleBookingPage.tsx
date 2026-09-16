import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { formatBookingDate, formatBookingTime } from '@/lib/format';
import type { Booking, MeetingType, TimeSlot } from '@/types';
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths
} from 'date-fns';

export const RescheduleBookingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [booking, setBooking] = useState<Booking | null>(null);
  // A load failure used to be a dead end: an error screen whose only action was a link away
  // from the page the visitor was sent. Re-running the fetch is almost always what they want.
  const [reloadKey, setReloadKey] = useState(0);
  const [meetingType, setMeetingType] = useState<MeetingType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reschedule state
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [success, setSuccess] = useState(false);

  const tz = booking?.customer_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  useEffect(() => {
    const fetchBooking = async () => {
      if (!token) {
        setError('Invalid reschedule token.');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchErr } = await supabase
          .from('bookings')
          .select('*, meeting_type:meeting_types(*), admin:profiles(*)')
          .eq('reschedule_token', token)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!data) {
          setError('Booking not found or reschedule window has expired.');
        } else {
          setBooking(data as unknown as Booking);
          setMeetingType((data as any).meeting_type as MeetingType);
        }
      } catch (err: any) {
        console.error('Error loading booking for reschedule:', err);
        setError(err.message || 'Unable to load booking details.');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [token, reloadKey]);

  // Real availability for the selected date.
  //
  // This used to fabricate slots client-side from a fixed [9,10,11,14,15,16,17] hour list,
  // so a client could reschedule into a time the host was not free -- straight past the
  // working hours, leave, existing bookings and Google Calendar busy blocks that the
  // backend slot engine accounts for.
  useEffect(() => {
    if (!selectedDate || !meetingType || !booking) return;

    let ignore = false;
    setSlotsLoading(true);
    setAvailableSlots([]);

    api
      .getAvailableSlots({
        admin_id: (booking as any).admin_id,
        session_id: meetingType.id,
        date_str: format(selectedDate, 'yyyy-MM-dd'),
      })
      .then((res: any) => {
        if (ignore) return;
        if (res?.error || res?.calendar_error) {
          setError(res.message || 'Could not load availability. Please try again.');
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
  }, [selectedDate, meetingType, booking]);

  const handleConfirmReschedule = async () => {
    if (!booking || !selectedSlot) return;
    setRescheduling(true);
    setError(null);

    try {
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({
          start_time: selectedSlot.start,
          end_time: selectedSlot.end,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);

      if (updateErr) throw updateErr;

      setSuccess(true);
    } catch (err: any) {
      console.error('Reschedule error:', err);
      setError(err.message || 'Failed to reschedule. Please try another slot.');
    } finally {
      setRescheduling(false);
    }
  };

  // Calendar dates generator
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm text-text-secondary">Loading reschedule options...</p>
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
              <h2 className="text-lg font-bold text-text-primary">Unable to Reschedule</h2>
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
              <Link to="/">
                <Button variant="outline" className="mt-2 min-h-[44px]">
                  Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="border-border shadow-md">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">Rescheduled Successfully!</h2>
              <p className="text-sm text-text-secondary mt-1">
                Your new time is confirmed for{' '}
                <span className="font-semibold text-text-primary">
                  {selectedDate && format(selectedDate, 'MMMM d, yyyy')} at {selectedSlot?.display_start}
                </span>.
              </p>
            </div>
            <Link to={`/booking/confirmation/${booking?.id}`}>
              <Button className="mt-4 bg-primary-600 hover:bg-primary-700 text-white">
                View Updated Confirmation
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <Card className="border-border shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary-600 mb-1">
            <RotateCcw className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider">Reschedule Appointment</span>
          </div>
          <CardTitle className="text-xl font-bold">Pick a new date and time</CardTitle>
          <CardDescription>
            Current booking: {booking?.start_time ? `${formatBookingDate(booking.start_time)} at ${formatBookingTime(booking.start_time)} (${tz})` : ''}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Calendar */}
            <div className="border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-sm text-text-primary">
                  {format(currentMonth, 'MMMM yyyy')}
                </h4>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-7 text-center text-xs font-medium text-text-secondary mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day) => {
                  const isPast = isBefore(day, new Date()) && !isToday(day);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  const inMonth = isSameMonth(day, currentMonth);

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={isPast || !inMonth}
                      onClick={() => {
                        setSelectedDate(day);
                        setSelectedSlot(null);
                      }}
                      className={`h-9 w-full rounded-md text-xs font-medium transition-colors flex items-center justify-center
                        ${!inMonth ? 'text-text-tertiary/40 cursor-not-allowed' : ''}
                        ${isPast ? 'text-text-tertiary cursor-not-allowed line-through' : ''}
                        ${isSelected ? 'bg-primary-600 text-white font-bold' : ''}
                        ${!isSelected && inMonth && !isPast ? 'hover:bg-primary-50 text-text-primary' : ''}
                      `}
                    >
                      {format(day, 'd')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time Slots */}
            <div>
              <h4 className="font-semibold text-sm text-text-primary mb-3">
                {selectedDate ? (
                  <>Available Slots for {format(selectedDate, 'EEE, MMM d')}</>
                ) : (
                  <>Select a date to view available times</>
                )}
              </h4>

              {!selectedDate && (
                <div className="h-64 flex flex-col items-center justify-center text-text-tertiary border border-dashed rounded-xl p-4 text-center">
                  <CalendarIcon className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-xs">Select any available date on the calendar</p>
                </div>
              )}

              {selectedDate && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {slotsLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                  ) : (
                    availableSlots.map((slot) => (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`w-full py-2.5 px-4 rounded-lg border text-sm font-medium transition-all flex items-center justify-between
                          ${
                            selectedSlot?.start === slot.start
                              ? 'border-primary-600 bg-primary-50 text-primary-900 ring-2 ring-primary-500/20 font-semibold'
                              : 'border-border hover:border-primary-300 bg-surface'
                          }
                        `}
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-primary-600" />
                          <span>{slot.display_start}</span>
                        </div>
                        <span className="text-xs text-text-secondary">{slot.display_end}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Link to="/">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button
              className="bg-primary-600 hover:bg-primary-700 text-white min-w-36"
              disabled={!selectedSlot || rescheduling}
              onClick={handleConfirmReschedule}
            >
              {rescheduling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Confirm New Time'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
