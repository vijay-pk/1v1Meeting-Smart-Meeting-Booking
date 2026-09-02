import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { CURRENCIES } from '@/lib/constants';
import { format } from 'date-fns';

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

    if (!error && data) {
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
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Payments</h1>
          <p className="text-sm text-text-secondary mt-1">
            Track all payment activity across your 1:1 sessions
          </p>
        </div>
        <Link
          to="/admin/settings"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
          <span>Manage Razorpay Gateway</span>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider">Total Revenue</p>
          <p className="text-2xl font-bold text-text-primary mt-1">
            ₹{(stats.revenue / 100).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider">Successful</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.successful}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider">Failed</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{stats.failed}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider">Refunds</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{stats.refunded}</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs text-text-tertiary uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stats.total}</p>
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">💳</div>
            <h3 className="text-lg font-medium">No payments yet</h3>
            <p className="text-sm text-text-secondary mt-1">Payments will appear here as customers book meetings</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-secondary">
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Order ID</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Payment ID</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Customer</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Booking</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {payment.razorpay_order_id}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">
                      {payment.razorpay_payment_id || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{payment.booking?.customer?.name || '—'}</p>
                      <p className="text-xs text-text-tertiary">{payment.booking?.customer?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-primary-600">
                      {payment.booking?.public_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {CURRENCIES[payment.currency]?.symbol || '₹'}
                      {(payment.amount / 100).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[payment.status] || 'bg-gray-50 text-gray-600'}`}>
                        {payment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-tertiary">
                      {format(new Date(payment.created_at), 'MMM d, h:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
