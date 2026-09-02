import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  booking_count?: number;
}

export function CustomersPage() {
  const { user } = useAuthStore();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (user) fetchCustomers();
  }, [user]);

  async function fetchCustomers() {
    setLoading(true);
    // Get customers who have bookings with this admin
    const { data, error } = await supabase
      .from('customers')
      .select(`
        *,
        bookings!inner(admin_id)
      `)
      .eq('bookings.admin_id', user!.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Deduplicate and count bookings
      const customerMap = new Map<string, CustomerRow>();
      for (const row of data as any[]) {
        if (customerMap.has(row.id)) {
          const existing = customerMap.get(row.id)!;
          existing.booking_count = (existing.booking_count || 1) + 1;
        } else {
          customerMap.set(row.id, { ...row, booking_count: 1 });
        }
      }
      setCustomers(Array.from(customerMap.values()));
    }
    setLoading(false);
  }

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Customers</h1>
          <p className="text-sm text-text-secondary mt-1">
            {customers.length} customer{customers.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">👥</div>
            <h3 className="text-lg font-medium">No customers found</h3>
            <p className="text-sm text-text-secondary mt-1">
              {search ? 'Try adjusting your search' : 'Customers will appear here when they make bookings'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-secondary">
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Phone</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Bookings</th>
                  <th className="text-left text-xs font-medium text-text-tertiary uppercase px-4 py-3">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((customer) => (
                  <tr key={customer.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-medium">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-text-primary">{customer.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{customer.email}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{customer.phone}</td>
                    <td className="px-4 py-3 text-sm font-medium text-text-primary">
                      {customer.booking_count || 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-tertiary">
                      {format(new Date(customer.created_at), 'MMM d, yyyy')}
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
