import React, { useState, useMemo, useEffect } from 'react';
import {
  format,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
} from 'date-fns';
import { useBookingStore } from '@/stores/bookingStore';
import { api } from '@/lib/api';
import { parseBookingWallClock } from '@/lib/format';
import { ErrorNote } from '@/components/common/ErrorNote';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Video,
  User,
  Mail,
  Phone,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  Sparkles,
  Link as LinkIcon
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function CalendarPage() {
  const { admins } = useBookingStore();
  const { profile } = useAuthStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'agenda'>('month');
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);

  // Identify logged in admin
  const loggedAdminId =
    localStorage.getItem('bmm_logged_admin_id') ||
    profile?.id ||
    '';

  const currentAdmin =
    admins.find((a) => a.id === loggedAdminId || a.username === loggedAdminId) ||
    admins[0];

  // This admin's bookings from the backend the booking flow writes to. The calendar used to
  // read the browser store, which nothing fills with real bookings, so it was always empty.
  // The endpoint scopes to the signed-in admin server-side.
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [loadError, setLoadError] = useState('');
  const loadBookings = () => {
    setLoadError('');
    api
      .getMyBookings()
      .then((rows: any[]) =>
        setMyBookings(
          (Array.isArray(rows) ? rows : []).map((row) => ({
            id: row.id,
            start_time: row.start_time,
            end_time: row.end_time,
            timezone: row.timezone,
            status: row.status,
            session_title: row.session_title,
            customer_name: row.client_name,
            customer_email: row.client_email,
            customer_phone: row.client_phone,
            google_meet_url: row.google_meet_link,
          }))
        )
      )
      .catch((err: any) => setLoadError(err?.message || 'Could not load your bookings.'));
  };
  useEffect(() => {
    loadBookings();
  }, []);

  // Calendar days calculation
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  // Map bookings to dates
  const bookingsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    myBookings.forEach((b) => {
      try {
        const d = parseBookingWallClock(b.start_time);
        const key = format(d, 'yyyy-MM-dd');
        const existing = map.get(key) || [];
        existing.push(b);
        map.set(key, existing);
      } catch (e) {}
    });
    return map;
  }, [myBookings]);

  // Selected date bookings
  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedDateBookings = bookingsByDate.get(selectedDateKey) || [];

  return (
    <div className="space-y-6 animate-fade-in font-sans pb-16">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-text-primary sm:text-2xl">Calendar</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold border border-blue-200">
              1:1 Sessions
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            View scheduled client calls, synchronized Google Meet invitations, and upcoming sessions for {currentAdmin?.full_name || 'Admin'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View mode. The month grid is unreadable on a narrow phone, so below sm the
              toggle is hidden and the agenda list is shown instead (see below). */}
          <div
            role="tablist"
            aria-label="Calendar view"
            className="hidden items-center rounded-xl border border-border bg-surface-tertiary p-1 sm:flex"
          >
            <button
              role="tab"
              aria-selected={viewMode === 'month'}
              onClick={() => setViewMode('month')}
              className={`press h-9 rounded-lg px-3 text-xs font-bold transition cursor-pointer ${
                viewMode === 'month' ? 'bg-surface text-text-primary shadow-xs' : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              Month Grid
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'agenda'}
              onClick={() => setViewMode('agenda')}
              className={`press h-9 rounded-lg px-3 text-xs font-bold transition cursor-pointer ${
                viewMode === 'agenda' ? 'bg-surface text-text-primary shadow-xs' : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              Agenda List
            </button>
          </div>

          <Link
            to="/admin/settings"
            className="press inline-flex h-11 items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-700 transition hover:bg-orange-100 sm:h-9"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Google Calendar Sync</span>
          </Link>
        </div>
      </div>

      {loadError && <ErrorNote message={loadError} onRetry={loadBookings} />}

      {/* Main calendar view.
          `hidden sm:block` on the month branch: a 7-column grid inside a 272px phone column
          gives ~33px cells holding a date, a count and two booking chips — illegible and
          untappable. Phones get the agenda list, which is the same data in a readable form. */}
      {viewMode === 'month' && (
        <div className="hidden grid-cols-1 gap-6 sm:grid lg:grid-cols-12">
          {/* Month Grid */}
          <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5 lg:col-span-8">
            {/* Month Navigation */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-text-primary">
                {format(currentDate, 'MMMM yyyy')}
              </h2>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                  className="text-xs h-8 px-3 rounded-lg"
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                  className="w-8 h-8 p-0 rounded-lg"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                  className="w-8 h-8 p-0 rounded-lg"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Days of the Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] uppercase tracking-wider text-text-tertiary py-1 border-b border-border">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Month Grid Cells */}
            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day, idx) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayBookings = bookingsByDate.get(dayKey) || [];
                const isSelected = isSameDay(day, selectedDate);
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isTodayDate = isToday(day);

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={`min-h-[85px] p-1.5 rounded-xl text-left flex flex-col justify-between transition cursor-pointer border ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50/50 ring-2 ring-orange-500/20'
                        : isTodayDate
                        ? 'border-blue-400 bg-blue-50/30'
                        : isCurrentMonth
                        ? 'border-border hover:bg-surface-secondary'
                        : 'border-transparent text-slate-300 bg-surface-secondary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-bold rounded-md px-1.5 py-0.5 ${
                          isTodayDate
                            ? 'bg-blue-600 text-white'
                            : isSelected
                            ? 'bg-orange-600 text-white'
                            : 'text-text-secondary'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>
                      {dayBookings.length > 0 && (
                        <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800">
                          {dayBookings.length}
                        </span>
                      )}
                    </div>

                    {/* Booking Badges */}
                    <div className="space-y-1 mt-1 overflow-hidden">
                      {dayBookings.slice(0, 2).map((b, bIdx) => (
                        <div
                          key={bIdx}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBooking(b);
                          }}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 truncate cursor-pointer hover:bg-emerald-100"
                        >
                          {format(parseBookingWallClock(b.start_time), 'HH:mm')} {b.customer_name?.split(' ')[0]}
                        </div>
                      ))}
                      {dayBookings.length > 2 && (
                        <span className="text-[9px] text-text-tertiary font-bold pl-1">
                          +{dayBookings.length - 2} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Date Details Sidebar */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-surface rounded-2xl border border-border p-5 shadow-xs space-y-4">
              <div className="border-b border-border pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-text-primary">
                    {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <p className="text-[11px] text-text-tertiary">
                    {selectedDateBookings.length} session(s) scheduled
                  </p>
                </div>
                {isToday(selectedDate) && (
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    Today
                  </span>
                )}
              </div>

              {selectedDateBookings.length === 0 ? (
                <div className="p-8 text-center space-y-2 border border-dashed border-border rounded-xl">
                  <CalendarDays className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold text-text-secondary">No appointments scheduled</p>
                  <p className="text-[11px] text-text-tertiary">
                    Share your personal link to start accepting bookings on this date.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDateBookings.map((booking, idx) => (
                    <div
                      key={booking.id || idx}
                      onClick={() => setSelectedBooking(booking)}
                      className="p-3.5 rounded-xl border border-border hover:border-orange-300 hover:bg-orange-50/30 transition cursor-pointer space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                          <Clock className="w-3.5 h-3.5 text-orange-600" />
                          <span>
                            {format(parseBookingWallClock(booking.start_time), 'hh:mm a')} –{' '}
                            {format(parseBookingWallClock(booking.end_time), 'hh:mm a')}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase">
                          {booking.status || 'Confirmed'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                          {booking.customer_name?.charAt(0).toUpperCase() || 'C'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-text-primary truncate">
                            {booking.customer_name}
                          </p>
                          <p className="text-[11px] text-text-tertiary truncate">
                            {booking.customer_email}
                          </p>
                        </div>
                      </div>

                      {booking.google_meet_url && (
                        <a
                          href={booking.google_meet_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <Video className="w-3.5 h-3.5" />
                          <span>Join Google Meet</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Agenda list. Always rendered on phones -- where it replaces the month grid -- and
          on every size when the admin explicitly picks the agenda view. */}
      <div
        className={`space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-6 ${
          viewMode === 'month' ? 'sm:hidden' : ''
        }`}
      >
          <h2 className="text-base font-black text-text-primary">Upcoming 1:1 Sessions</h2>
          {myBookings.length === 0 ? (
            <div className="p-10 text-center text-xs text-text-tertiary">
              No upcoming appointments yet. Share your booking page to receive one.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {myBookings.map((b, idx) => (
                <div key={b.id || idx} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-primary">
                        {format(parseBookingWallClock(b.start_time), 'EEEE, MMMM d, yyyy')}
                      </span>
                      <span className="text-xs text-text-tertiary">•</span>
                      <span className="text-xs font-mono font-bold text-orange-600">
                        {format(parseBookingWallClock(b.start_time), 'hh:mm a')} – {format(parseBookingWallClock(b.end_time), 'hh:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span className="font-semibold">{b.customer_name}</span>
                      <span>({b.customer_email})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {b.google_meet_url ? (
                      <a
                        href={b.google_meet_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition"
                      >
                        <Video className="w-3.5 h-3.5" />
                        <span>Google Meet</span>
                      </a>
                    ) : (
                      <span className="text-xs text-text-tertiary italic">No Meet link</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedBooking(b)}
                      className="h-11 text-xs sm:h-9"
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Booking Details Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-md rounded-2xl border border-border p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-black text-text-primary">Appointment Details</h3>
              <button
                onClick={() => setSelectedBooking(null)}
                className="text-text-tertiary hover:text-text-secondary text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-surface-secondary rounded-xl space-y-1">
                <p className="text-text-tertiary font-semibold">Scheduled Date & Time</p>
                <p className="font-bold text-text-primary text-sm">
                  {format(parseBookingWallClock(selectedBooking.start_time), 'EEEE, MMMM d, yyyy')}
                </p>
                <p className="font-mono text-orange-600 font-bold">
                  {format(parseBookingWallClock(selectedBooking.start_time), 'hh:mm a')} –{' '}
                  {format(parseBookingWallClock(selectedBooking.end_time), 'hh:mm a')}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-text-tertiary" />
                  <span className="font-semibold text-text-secondary">Client:</span>
                  <span className="font-bold text-text-primary">{selectedBooking.customer_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-text-tertiary" />
                  <span className="font-semibold text-text-secondary">Email:</span>
                  <span className="text-text-primary">{selectedBooking.customer_email}</span>
                </div>
                {selectedBooking.customer_phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-text-tertiary" />
                    <span className="font-semibold text-text-secondary">Phone:</span>
                    <span className="text-text-primary">{selectedBooking.customer_phone}</span>
                  </div>
                )}
              </div>

              {selectedBooking.google_meet_url && (
                <div className="pt-2">
                  <a
                    href={selectedBooking.google_meet_url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
                  >
                    <Video className="w-4 h-4" />
                    <span>Join Google Meet Call</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
