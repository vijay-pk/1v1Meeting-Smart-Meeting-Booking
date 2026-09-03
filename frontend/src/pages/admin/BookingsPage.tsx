import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS, CURRENCIES } from '@/lib/constants';
import type { Booking } from '@/types';
import { formatDistanceToNow, format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonList } from '@/components/common/Skeleton';
import { DataList } from '@/components/common/DataList';
import { ErrorNote } from '@/components/common/ErrorNote';

export function BookingsPage() {
  const { user } = useAuthStore();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [loadError, setLoadError] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    if (user) fetchBookings();
  }, [user, filter]);

  async function fetchBookings() {
    setLoading(true);
    let query = supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(*),
        meeting_type:meeting_types(*),
        payment:payments(*)
      `)
      .eq('admin_id', user!.id)
      .order('created_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    if (!error && data) {
      setBookings(data as unknown as Booking[]);
      setLoadError('');
    } else if (error) {
      // Previously this failed silently and rendered the empty state, so a connection
      // problem looked exactly like "you have no bookings". The query is unchanged.
      setLoadError('We could not load your bookings just now.');
    }
    setLoading(false);
  }

  const statusFilters = [
    { value: 'all', label: 'All Bookings' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending_payment', label: 'Pending Payment' },
    { value: 'payment_received', label: 'Payment Received' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'completed', label: 'Completed' },
    { value: 'calendar_failed', label: 'Calendar Pending' },
  ];

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Bookings" description="Manage all your bookings" />

      {/* Status filters. The strip scrolls horizontally on a phone rather than wrapping into
          three rows, with momentum scrolling and no visible scrollbar. */}
      <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {statusFilters.map((sf) => (
          <button
            key={sf.value}
            onClick={() => setFilter(sf.value)}
            aria-pressed={filter === sf.value}
            className={`press inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors ${
              filter === sf.value
                ? 'bg-primary-600 text-white'
                : 'border border-border bg-surface text-text-secondary hover:bg-surface-tertiary'
            }`}
          >
            {sf.label}
          </button>
        ))}
      </div>

      {loadError && <ErrorNote message={loadError} onRetry={fetchBookings} />}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <DataList
          rows={bookings}
          rowKey={(booking) => booking.id}
          onRowClick={(booking) => setSelectedBooking(booking)}
          empty={
            <EmptyState
              icon={CalendarDays}
              title="No bookings yet"
              description="Bookings will appear here when customers book meetings on your page."
            />
          }
          columns={[
            {
              header: 'Customer',
              primary: true,
              cell: (booking) => (
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {booking.customer?.name || '—'}
                  </p>
                  <p className="truncate text-xs font-normal text-text-tertiary">
                    {booking.customer?.email}
                  </p>
                </div>
              ),
            },
            {
              header: 'Status',
              trailing: true,
              cell: (booking) => (
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    BOOKING_STATUS_COLORS[booking.status] || 'bg-gray-50 text-gray-700'
                  }`}
                >
                  {BOOKING_STATUS_LABELS[booking.status] || booking.status}
                </span>
              ),
            },
            {
              header: 'Booking ID',
              cell: (booking) => (
                <span className="font-mono text-xs text-primary-600">{booking.public_id}</span>
              ),
            },
            {
              header: 'Meeting',
              cell: (booking) => booking.meeting_type?.name || '—',
            },
            {
              header: 'Date & time',
              cell: (booking) => (
                <div>
                  <p className="text-text-primary">
                    {format(new Date(booking.start_time), 'MMM d, yyyy')}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {format(new Date(booking.start_time), 'h:mm a')} –{' '}
                    {format(new Date(booking.end_time), 'h:mm a')}
                  </p>
                </div>
              ),
            },
            {
              header: 'Amount',
              cell: (booking) => (
                <span className="font-medium text-text-primary">
                  {booking.meeting_type
                    ? `${CURRENCIES[booking.meeting_type.currency]?.symbol || '₹'}${(booking.meeting_type.price / 100).toLocaleString()}`
                    : '—'}
                </span>
              ),
            },
            {
              header: 'Meet',
              cell: (booking) =>
                booking.google_meet_url ? (
                  <a
                    href={booking.google_meet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="press inline-flex min-h-[36px] items-center rounded-lg px-2 text-xs font-semibold text-primary-600 hover:bg-primary-50"
                  >
                    Join Meet
                  </a>
                ) : (
                  <span className="text-xs text-text-tertiary">—</span>
                ),
            },
            {
              header: 'Created',
              collapse: true,
              cell: (booking) => (
                <span className="text-xs text-text-tertiary">
                  {formatDistanceToNow(new Date(booking.created_at), { addSuffix: true })}
                </span>
              ),
            },
          ]}
        />
      )}


      {/* Booking Detail Modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onRefresh={fetchBookings}
        />
      )}
    </div>
  );
}

// Booking Detail Modal
function BookingDetailModal({
  booking,
  onClose,
  onRefresh,
}: {
  booking: Booking;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    setCancelling(true);
    try {
      await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Cancelled by admin',
        })
        .eq('id', booking.id);
      onRefresh();
      onClose();
    } catch (err) {
      console.error('Cancel error:', err);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-dropdown max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text-primary">Booking Details</h2>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1">
              ✕
            </button>
          </div>

          {/* Booking ID & Status */}
          <div className="flex items-center justify-between mb-6 p-3 bg-surface-secondary rounded-lg">
            <span className="text-sm font-mono text-text-secondary">{booking.public_id}</span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                BOOKING_STATUS_COLORS[booking.status]
              }`}
            >
              {BOOKING_STATUS_LABELS[booking.status]}
            </span>
          </div>

          {/* Customer Info */}
          <section className="mb-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
              Customer
            </h3>
            <div className="space-y-1">
              <p className="text-sm font-medium">{booking.customer?.name}</p>
              <p className="text-sm text-text-secondary">{booking.customer?.email}</p>
              <p className="text-sm text-text-secondary">{booking.customer?.phone}</p>
            </div>
          </section>

          {/* Meeting Info */}
          <section className="mb-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
              Meeting
            </h3>
            <p className="text-sm font-medium">{booking.meeting_type?.name}</p>
            <p className="text-sm text-text-secondary">
              {format(new Date(booking.start_time), 'EEEE, MMMM d, yyyy')}
            </p>
            <p className="text-sm text-text-secondary">
              {format(new Date(booking.start_time), 'h:mm a')} –{' '}
              {format(new Date(booking.end_time), 'h:mm a')} ({booking.customer_timezone})
            </p>
          </section>

          {/* Google Meet */}
          {booking.google_meet_url && (
            <section className="mb-5">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                Google Meet
              </h3>
              <a
                href={booking.google_meet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-100 transition-colors"
              >
                📹 Join Google Meet
              </a>
            </section>
          )}

          {/* Payment */}
          {booking.payment && (
            <section className="mb-5">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                Payment
              </h3>
              <div className="space-y-1 text-sm">
                <p>
                  Amount:{' '}
                  <span className="font-medium">
                    {CURRENCIES[booking.payment.currency]?.symbol}
                    {(booking.payment.amount / 100).toLocaleString()}
                  </span>
                </p>
                {booking.payment.razorpay_order_id && (
                  <p className="text-text-secondary">
                    Order: <span className="font-mono text-xs">{booking.payment.razorpay_order_id}</span>
                  </p>
                )}
                {booking.payment.razorpay_payment_id && (
                  <p className="text-text-secondary">
                    Payment: <span className="font-mono text-xs">{booking.payment.razorpay_payment_id}</span>
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Notes */}
          {booking.notes && (
            <section className="mb-5">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                Notes
              </h3>
              <p className="text-sm text-text-secondary">{booking.notes}</p>
            </section>
          )}

          {/* Question Answers */}
          {booking.question_answers && Object.keys(booking.question_answers).length > 0 && (
            <section className="mb-5">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                Custom Questions
              </h3>
              <div className="space-y-2">
                {Object.entries(booking.question_answers).map(([q, a]) => (
                  <div key={q}>
                    <p className="text-xs text-text-tertiary">{q}</p>
                    <p className="text-sm text-text-primary">{a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Timeline */}
          <section className="mb-5">
            <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
              Timeline
            </h3>
            <div className="space-y-2 text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary-500" />
                Booking created — {format(new Date(booking.created_at), 'MMM d, h:mm a')}
              </div>
              {booking.payment_status === 'completed' && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Payment received
                </div>
              )}
              {booking.calendar_status === 'created' && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Calendar event created
                </div>
              )}
              {booking.google_meet_url && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Google Meet created
                </div>
              )}
              {booking.status === 'confirmed' && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Booking confirmed
                </div>
              )}
              {booking.cancelled_at && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Cancelled — {format(new Date(booking.cancelled_at), 'MMM d, h:mm a')}
                </div>
              )}
            </div>
          </section>

          {/* Actions */}
          {!['cancelled', 'completed', 'refunded', 'expired'].includes(booking.status) && (
            <div className="flex gap-3 pt-4 border-t border-border">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Cancel Booking'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
