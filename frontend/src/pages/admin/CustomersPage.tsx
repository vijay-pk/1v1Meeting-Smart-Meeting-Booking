import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';
import { Search, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonList } from '@/components/common/Skeleton';
import { DataList } from '@/components/common/DataList';
import { ErrorNote } from '@/components/common/ErrorNote';

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
  const [loadError, setLoadError] = useState('');

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

    if (error) {
      // Was silent: a failed request rendered as "no records".
      setLoadError('We could not load your customers just now.');
    }
    if (!error && data) {
      setLoadError('');
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
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Customers"
        description={`${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
      />

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
          aria-hidden="true"
        />
        <input
          type="search"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search customers"
          className="h-11 w-full max-w-md rounded-xl border border-border bg-surface pl-9 pr-4 text-sm text-text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {loadError && <ErrorNote message={loadError} onRetry={fetchCustomers} />}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <DataList
          rows={filtered}
          rowKey={(customer) => customer.id}
          empty={
            <EmptyState
              icon={Users}
              title="No customers found"
              description={
                search
                  ? 'No customer matches that search. Try a different name, email or phone number.'
                  : 'Customers appear here once someone books a session with you.'
              }
            />
          }
          columns={[
            {
              header: 'Name',
              primary: true,
              cell: (customer) => (
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-medium text-primary-700">
                    {customer.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate font-medium text-text-primary">{customer.name}</span>
                </div>
              ),
            },
            {
              header: 'Bookings',
              trailing: true,
              cell: (customer) => (
                <span className="font-semibold text-text-primary">
                  {customer.booking_count || 0}
                </span>
              ),
            },
            { header: 'Email', cell: (customer) => <span className="break-all">{customer.email}</span> },
            { header: 'Phone', cell: (customer) => customer.phone || '—' },
            {
              header: 'Since',
              collapse: true,
              cell: (customer) => format(new Date(customer.created_at), 'MMM d, yyyy'),
            },
          ]}
        />
      )}
    </div>
  );
}