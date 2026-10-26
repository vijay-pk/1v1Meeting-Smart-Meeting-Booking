import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { loadRazorpayCheckout } from '@/lib/razorpay';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { format, addDays } from 'date-fns';
import { Loader2, Clock, CalendarDays } from 'lucide-react';

type MType = { id: string; title: string; description?: string; duration_minutes: number; price: number; currency: string; audience: string };

function fingerprint() {
  return 'stu-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const StudentBookPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<{ host_admin_id: string; available: number; free: MType[]; paid: MType[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MType | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<any>(null);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    api.studentMeetingTypes().then(setData).catch((e) => setError(e?.message || 'Could not load meeting types.')).finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(new Date(), i)), []);

  useEffect(() => {
    if (!selected || !date || !data) return;
    let ignore = false;
    setSlotsLoading(true);
    setSlots([]);
    setSlot(null);
    api.getAvailableSlots({ admin_id: data.host_admin_id, session_id: selected.id, date_str: format(date, 'yyyy-MM-dd') })
      .then((res: any) => {
        if (ignore) return;
        setSlots((res?.available_slots || []).map((s: any) => ({ start: s.start_time_iso, end: s.end_time_iso, label: s.label })));
      })
      .catch(() => !ignore && setSlots([]))
      .finally(() => !ignore && setSlotsLoading(false));
    return () => { ignore = true; };
  }, [selected, date, data]);

  const book = async () => {
    if (!selected || !slot || !data) return;
    setBooking(true);
    setError(null);
    try {
      const hold = await api.holdSlot({
        admin_id: data.host_admin_id, session_id: selected.id,
        start_time: slot.start, end_time: slot.end, session_fingerprint: fingerprint(),
      });
      const lock_id = hold.lock_id;
      if (selected.audience === 'student_free') {
        const res = await api.studentBookFree({ session_id: selected.id, start_time: slot.start, end_time: slot.end, lock_id });
        navigate(`/booking/confirmation/${res.public_id}`);
        return;
      }
      // Paid: order -> Razorpay -> verify (same server verification as public checkout).
      const order = await api.studentPaidOrder({ session_id: selected.id, start_time: slot.start, end_time: slot.end, lock_id });
      const ready = await loadRazorpayCheckout();
      if (!ready) throw new Error('Could not load the payment window. Please try again.');
      const options: any = {
        key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency || 'INR',
        name: selected.title, description: `${selected.title} (${selected.duration_minutes} mins)`,
        handler: async (response: any) => {
          try {
            const confirmed = await api.verifyPayment({
              booking_id: order.booking_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            navigate(`/booking/confirmation/${confirmed?.public_id || order.booking_id}`);
          } catch (e: any) {
            setBooking(false);
            setError(e?.message || 'We could not confirm that payment. If you were charged, contact the host before retrying.');
          }
        },
        modal: { ondismiss: () => { if (lock_id) api.releaseHold(lock_id).catch(() => {}); setBooking(false); } },
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (f: any) => { setBooking(false); setError(f?.error?.description || 'The payment did not go through.'); });
      rzp.open();
    } catch (e: any) {
      setBooking(false);
      setError(e?.message || 'Could not book that session.');
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>;
  if (!data) return <p className="text-sm text-red-600">{error || 'Could not load.'}</p>;

  const noFree = data.available <= 0;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Book a Meeting</h1>

      {noFree && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          All your free meetings are used, but you can still book another session. Choose a session below to continue with paid booking.
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Meeting type selection */}
      {!selected && (
        <div className="space-y-4">
          {!noFree && data.free.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-text-secondary">Free sessions · {data.available} left</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.free.map((m) => <TypeCard key={m.id} m={m} free onPick={() => setSelected(m)} />)}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-secondary">Paid sessions</h2>
            {data.paid.length === 0 ? <p className="text-sm text-text-tertiary">No paid sessions available.</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.paid.map((m) => <TypeCard key={m.id} m={m} onPick={() => setSelected(m)} />)}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Date + slot selection */}
      {selected && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text-primary">{selected.title}</p>
              <p className="text-xs text-text-tertiary">{selected.duration_minutes} min · {selected.audience === 'student_free' ? 'Free' : formatPrice(selected.price, selected.currency as any)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setSelected(null); setDate(null); setSlots([]); setSlot(null); }}>Change</Button>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-text-secondary"><CalendarDays className="w-4 h-4" /> Pick a date</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {days.map((d) => {
                const on = date && format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
                return (
                  <button key={d.toISOString()} onClick={() => setDate(d)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-center text-xs ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-border hover:border-primary-300'}`}>
                    <div className="font-semibold">{format(d, 'EEE')}</div>
                    <div>{format(d, 'd MMM')}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {date && (
            <div>
              <p className="mb-2 text-sm font-semibold text-text-secondary">Available times</p>
              {slotsLoading ? <div className="flex py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>
                : slots.length === 0 ? <p className="text-sm text-text-tertiary">No times available on this day.</p>
                : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {slots.map((s) => (
                      <button key={s.start} onClick={() => setSlot(s)}
                        className={`flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm ${slot?.start === s.start ? 'border-primary-600 bg-primary-50 font-semibold text-primary-900' : 'border-border hover:border-primary-300'}`}>
                        <Clock className="w-3.5 h-3.5 text-primary-600" /> {s.label}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            This session may be recorded by the host. Any recording appears only in your My Recordings page
            and is visible only to you. By booking you acknowledge the student meeting policy.
          </p>

          <div className="flex justify-end border-t pt-4">
            <Button disabled={!slot || booking} onClick={book} className="min-w-40 bg-primary-600 hover:bg-primary-700 text-white">
              {booking ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Booking…</> : selected.audience === 'student_free' ? 'Confirm free booking' : 'Pay and book'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const TypeCard: React.FC<{ m: MType; free?: boolean; onPick: () => void }> = ({ m, free, onPick }) => (
  <Card className="border-border transition-shadow hover:shadow-md">
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-text-primary">{m.title}</h3>
        <Badge variant="outline" className={free ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-indigo-700 border-indigo-200 bg-indigo-50'}>
          {free ? 'Free' : formatPrice(m.price, m.currency as any)}
        </Badge>
      </div>
      {m.description && <p className="mt-1 text-xs text-text-secondary line-clamp-2">{m.description}</p>}
      <p className="mt-1 text-xs text-text-tertiary">{m.duration_minutes} min</p>
      <Button size="sm" className="mt-3 w-full bg-primary-600 hover:bg-primary-700 text-white" onClick={onPick}>Select</Button>
    </CardContent>
  </Card>
);
