import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { CURRENCIES } from '@/lib/constants';
import { format } from 'date-fns';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonList } from '@/components/common/Skeleton';
import { DataList } from '@/components/common/DataList';
import { ErrorNote } from '@/components/common/ErrorNote';

interface PaymentRow {
  id: string;
  booking_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  booking?: {
    public_id: string;
    customer?: { name: string; email: string };
  };
}

export function PaymentsPage() {
  const { user } = useAuthStore();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stats, setStats] = useState({
    total: 0,
    successful: 0,
    failed: 0,
    refunded: 0,
    revenue: 0,
  });

  useEffect(() => {
    if (user) fetchPayments();
  }, [user]);

  async function fetchPayments() {
    setLoading(true);
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        booking:bookings!inner(
          public_id,
          admin_id,
          customer:customers(name, email)
        )
      `)
      .eq('booking.admin_id', user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      // Was silent: a failed request rendered as "no records".
      setLoadError('We could not load your payments just now.');
    }
    if (!error && data) {
      setLoadError('');
      const rows = data as unknown as PaymentRow[];
      setPayments(rows);

      // Calculate stats
      const successful = rows.filter((p) => p.status === 'captured');
      const failed = rows.filter((p) => p.status === 'failed');
      const refunded = rows.filter((p) => p.status === 'refunded');
      const revenue = successful.reduce((sum, p) => sum + p.amount, 0);

      setStats({
        total: rows.length,
        successful: successful.length,
        failed: failed.length,
        refunded: refunded.length,
        revenue,
      });
    }
    setLoading(false);
  }

  const statusColors: Record<string, string> = {
    created: 'bg-gray-50 text-gray-600',
    authorized: 'bg-blue-50 text-blue-600',
    captured: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-red-50 text-red-600',
    refunded: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Payments"
        description="Track all payment activity across your 1:1 sessions"
        actions={
          <Link
            to="/admin/settings"
            className="press inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-xs font-bold text-text-secondary shadow-2xs transition hover:bg-surface-tertiary"
          >
            <CreditCard className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <span>Manage Razorpay Gateway</span>
          </Link>
        }
      />

      {/* Stat tiles: 2-up on phones, 3-up on tablets, 5-up on desktop. Values use tabular
          figures and can shrink, so a large revenue number cannot blow out its tile. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {[
          { label: 'Total Revenue', value: `₹${(stats.revenue / 100).toLocaleString('en-IN')}`, tone: 'text-text-primary' },
          { label: 'Successful', value: stats.successful, tone: 'text-emerald-600' },
          { label: 'Failed', value: stats.failed, tone: 'text-red-600' },
          { label: 'Refunds', value: stats.refunded, tone: 'text-purple-600' },
          { label: 'Total', value: stats.total, tone: 'text-text-primary' },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-border bg-surface p-4">
            <p className="truncate text-[11px] uppercase tracking-wider text-text-tertiary">
              {tile.label}
            </p>
            <p className={`mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl ${tile.tone}`}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      {loadError && <ErrorNote message={loadError} onRetry={fetchPayments} />}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <DataList
          rows={payments}
          rowKey={(payment) => payment.id}
          empty={
            <EmptyState
              icon={CreditCard}
              title="No payments yet"
              description="Payments appear here once a client completes a booking through your Razorpay account."
            />
          }
          columns={[
            {
              header: 'Customer',
              primary: true,
              cell: (payment) => (
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {payment.booking?.customer?.name || '—'}
                  </p>
                  <p className="truncate text-xs font-normal text-text-tertiary">
                    {payment.booking?.customer?.email}
                  </p>
                </div>
              ),
            },
            {
              header: 'Amount',
              trailing: true,
              align: 'right',
              cell: (payment) => (
                <span className="font-semibold tabular-nums text-text-primary">
                  {CURRENCIES[payment.currency]?.symbol || '₹'}
                  {(payment.amount / 100).toLocaleString()}
                </span>
              ),
            },
            {
              header: 'Status',
              trailing: true,
              cell: (payment) => (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    statusColors[payment.status] || 'bg-gray-50 text-gray-600'
                  }`}
                >
                  {payment.status}
                </span>
              ),
            },
            {
              header: 'Booking',
              cell: (payment) => (
                <span className="font-mono text-xs text-primary-600">
                  {payment.booking?.public_id || '—'}
                </span>
              ),
            },
            {
              header: 'Order ID',
              collapse: true,
              cell: (payment) => (
                <span className="break-all font-mono text-xs">{payment.razorpay_order_id}</span>
              ),
            },
            {
              header: 'Payment ID',
              collapse: true,
              cell: (payment) => (
                <span className="break-all font-mono text-xs">
                  {payment.razorpay_payment_id || '—'}
                </span>
              ),
            },
            {
              header: 'Date',
              cell: (payment) => (
                <span className="text-xs text-text-tertiary">
                  {format(new Date(payment.created_at), 'MMM d, h:mm a')}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}