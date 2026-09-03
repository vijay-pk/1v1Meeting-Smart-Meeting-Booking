import React, { useState, useMemo } from 'react';
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
  parseISO
} from 'date-fns';
import { useBookingStore } from '@/stores/bookingStore';
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
  const { bookings, admins, meetingTypes } = useBookingStore();
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

  // Filter bookings for this admin (or all if super admin and no filter)
  const myBookings = useMemo(() => {
    return bookings.filter(
      (b) =>
        b.admin_id === loggedAdminId ||
        b.assigned_admin_id === loggedAdminId ||
        !b.admin_id
    );
  }, [bookings, loggedAdminId]);

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
        const d = parseISO(b.start_time);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Calendar & Appointments</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold border border-blue-200">
              1:1 Sessions
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            View scheduled client calls, synchronized Google Meet invitations, and upcoming sessions for {currentAdmin?.full_name || 'Admin'}.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Month Grid
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'agenda' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Agenda List
            </button>
          </div>

          <Link
            to="/admin/settings"
            className="px-3 py-2 rounded-xl text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Google Calendar Sync</span>
          </Link>
        </div>
      </div>

      {/* Main Calendar View */}
      {viewMode === 'month' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Month Grid */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-border p-5 shadow-xs space-y-4">
            {/* Month Navigation */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900">
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
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] uppercase tracking-wider text-slate-400 py-1 border-b border-slate-100">
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
                        ? 'border-slate-100 hover:bg-slate-50'
                        : 'border-transparent text-slate-300 bg-slate-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-bold rounded-md px-1.5 py-0.5 ${
                          isTodayDate
                            ? 'bg-blue-600 text-white'
                            : isSelected
                            ? 'bg-orange-600 text-white'
                            : 'text-slate-700'
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
                          {format(parseISO(b.start_time), 'HH:mm')} {b.customer_name?.split(' ')[0]}
                        </div>
                      ))}
                      {dayBookings.length > 2 && (
                        <span className="text-[9px] text-slate-400 font-bold pl-1">
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
            <div className="bg-white rounded-2xl border border-border p-5 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
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
                <div className="p-8 text-center space-y-2 border border-dashed border-slate-200 rounded-xl">
                  <CalendarDays className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold text-slate-600">No appointments scheduled</p>
                  <p className="text-[11px] text-slate-400">
                    Share your personal link to start accepting bookings on this date.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDateBookings.map((booking, idx) => (
                    <div
                      key={booking.id || idx}
                      onClick={() => setSelectedBooking(booking)}
                      className="p-3.5 rounded-xl border border-slate-200 hover:border-orange-300 hover:bg-orange-50/30 transition cursor-pointer space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                          <Clock className="w-3.5 h-3.5 text-orange-600" />
                          <span>
                            {format(parseISO(booking.start_time), 'hh:mm a')} –{' '}
                            {format(parseISO(booking.end_time), 'hh:mm a')}
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
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {booking.customer_name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
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
      ) : (
        /* Agenda List View */
        <div className="bg-white rounded-2xl border border-border p-6 shadow-xs space-y-4">
          <h2 className="text-base font-black text-slate-900">Upcoming 1:1 Sessions Agenda</h2>
          {myBookings.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No upcoming appointments found.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {myBookings.map((b, idx) => (
                <div key={b.id || idx} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        {format(parseISO(b.start_time), 'EEEE, MMMM d, yyyy')}
                      </span>
                      <span className="text-xs text-slate-500">•</span>
                      <span className="text-xs font-mono font-bold text-orange-600">
                        {format(parseISO(b.start_time), 'hh:mm a')} – {format(parseISO(b.end_time), 'hh:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
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
                      <span className="text-xs text-slate-400 italic">No Meet link</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedBooking(b)}
                      className="text-xs h-8"
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Booking Details Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Appointment Details</h3>
              <button
                onClick={() => setSelectedBooking(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <p className="text-slate-500 font-semibold">Scheduled Date & Time</p>
                <p className="font-bold text-slate-900 text-sm">
                  {format(parseISO(selectedBooking.start_time), 'EEEE, MMMM d, yyyy')}
                </p>
                <p className="font-mono text-orange-600 font-bold">
                  {format(parseISO(selectedBooking.start_time), 'hh:mm a')} –{' '}
                  {format(parseISO(selectedBooking.end_time), 'hh:mm a')}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-slate-700">Client:</span>
                  <span className="font-bold text-slate-900">{selectedBooking.customer_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-slate-700">Email:</span>
                  <span className="text-slate-900">{selectedBooking.customer_email}</span>
                </div>
                {selectedBooking.customer_phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-slate-700">Phone:</span>
                    <span className="text-slate-900">{selectedBooking.customer_phone}</span>
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
