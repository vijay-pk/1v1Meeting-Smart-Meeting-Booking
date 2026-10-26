import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { loadRazorpayCheckout } from '@/lib/razorpay';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { format, parseISO } from 'date-fns';
import { Loader2, Clock, CalendarDays, AlertCircle, Info, RefreshCw } from 'lucide-react';

type MType = { id: string; title: string; description?: string; duration_minutes: number; price: number; currency: string; audience: string };
type Slot = { start: string; end: string; label: string; start_time_iso: string; end_time_iso: string };
type Availability = {
  timezone: string;
  calendar: { status: 'connected' | 'disconnected' | 'error'; checked: boolean };
  horizon_days: number;
  days: { date: string; count: number }[];
  first_available_date: string | null;
  selected_date: string | null;
  requested_date_unavailable: boolean;
  slots: Slot[];
  // Set when nothing is bookable because of a saved setting (no working hours, hours that never
  // overlap, ...). null means the setup is fine and the calendar is simply full.
  diagnosis: { code: string; message: string } | null;
};
// loading: first fetch for a type. error: the request or the host calendar failed (never "empty").
// empty: the server confirmed nothing is bookable in the horizon. ready: dates + times to pick.
type Phase = 'loading' | 'error' | 'empty' | 'ready';

function fingerprint() {
  return 'stu-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** "IST" for Asia/Kolkata etc. Always the BOOKING zone from the server, never the browser's. */
function zoneLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    return part ? `${tz} (${part})` : tz;
  } catch {
    return tz;
  }
}

// A server date is a plain calendar day; parseISO reads it as that local day with no zone shift.
const dayLabel = (iso: string, pattern: string) => format(parseISO(iso), pattern);

export const StudentBookPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<{ host_admin_id: string; available: number; free: MType[]; paid: MType[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MType | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [availError, setAvailError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);

  // Only the newest request may update the page: a slow reply for an old type or date is dropped.
  const reqId = useRef(0);
  // One browser session = one fingerprint, so a retry re-holds the same slot instead of being
  // refused by this student's own earlier hold.
  const fp = useRef(fingerprint());

  useEffect(() => {
    api.studentMeetingTypes().then(setData).catch((e) => setError(e?.message || 'Could not load meeting types.')).finally(() => setLoading(false));
  }, []);

  const loadAvailability = useCallback(async (type: MType, date?: string, opts: { quiet?: boolean; note?: string } = {}) => {
    const id = ++reqId.current;
    if (!opts.quiet) {
      if (date) setSlotsLoading(true); else setPhase('loading');
    }
    try {
      const res: Availability = await api.studentAvailability(type.id, date);
      if (id !== reqId.current) return;
      setAvail(res);
      if (res.calendar.status === 'error') {
        setPhase('error');
        setAvailError("We couldn't check the host's calendar, so times are paused. Please try again shortly.");
      } else if (!res.first_available_date) {
        setPhase('empty');
        setAvailError(null);
      } else {
        setPhase('ready');
        setAvailError(null);
      }
      setSlot((cur) => (cur && res.slots.some((s) => s.start_time_iso === cur.start_time_iso) ? cur : null));
      if (opts.note) {
        setNotice(opts.note);
      } else if (date && res.requested_date_unavailable && res.selected_date) {
        setNotice(`${dayLabel(date, 'EEE d MMM')} has no available times. Showing the next available date, ${dayLabel(res.selected_date, 'EEE d MMM')}.`);
      } else if (!opts.quiet) {
        setNotice(null);
      }
    } catch (e: any) {
      if (id !== reqId.current) return;
      setPhase('error');
      setAvailError(e?.message || 'Could not load availability.');
    } finally {
      if (id === reqId.current) setSlotsLoading(false);
    }
  }, []);

  const pickType = (m: MType) => {
    setSelected(m);
    setSlot(null);
    setAvail(null);
    setNotice(null);
    setError(null);
    loadAvailability(m); // no date: the server returns the earliest date with a slot
  };

  const resetType = () => {
    reqId.current++; // drop anything still in flight
    setSelected(null); setAvail(null); setSlot(null); setNotice(null); setError(null); setPhase('loading');
  };

  // Times change while the page sits open (other bookings, calendar edits): refresh quietly on return.
  useEffect(() => {
    if (!selected) return;
    const onFocus = () => { if (phase === 'ready' && !booking) loadAvailability(selected, avail?.selected_date || undefined, { quiet: true }); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selected, phase, booking, avail?.selected_date, loadAvailability]);

  const book = async () => {
    if (!selected || !slot || !data) return;
    setBooking(true);
    setError(null);
    let lockId: string | undefined;
    const refreshAfterFailure = (message: string) => {
      setBooking(false);
      setError(message);
      setSlot(null);
      // The slot may be gone (or the calendar down): show the real, current picture.
      loadAvailability(selected, avail?.selected_date || undefined, { note: 'Times were refreshed. Please choose again.' });
    };
    try {
      const hold = await api.holdSlot({
        admin_id: data.host_admin_id, session_id: selected.id,
        start_time: slot.start_time_iso, end_time: slot.end_time_iso, session_fingerprint: fp.current,
      });
      lockId = hold.lock_id;
      if (selected.audience === 'student_free') {
        const res = await api.studentBookFree({ session_id: selected.id, start_time: slot.start_time_iso, end_time: slot.end_time_iso, lock_id: hold.lock_id });
        navigate(`/booking/confirmation/${res.public_id}`);
        return;
      }
      // Paid: order -> Razorpay -> verify (same server verification as public checkout).
      const order = await api.studentPaidOrder({ session_id: selected.id, start_time: slot.start_time_iso, end_time: slot.end_time_iso, lock_id: hold.lock_id });
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
        modal: { ondismiss: () => { if (hold.lock_id) api.releaseHold(hold.lock_id).catch(() => {}); setBooking(false); } },
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (f: any) => { setBooking(false); setError(f?.error?.description || 'The payment did not go through.'); });
      rzp.open();
    } catch (e: any) {
      if (lockId) api.releaseHold(lockId).catch(() => {}); // free the hold so a retry is not blocked
      refreshAfterFailure(e?.message || 'Could not book that session.');
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
      {error && <p className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</p>}

      {/* Meeting type selection */}
      {!selected && (
        <div className="space-y-4">
          {!noFree && data.free.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-text-secondary">Free sessions · {data.available} left</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.free.map((m) => <TypeCard key={m.id} m={m} free onPick={() => pickType(m)} />)}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-secondary">Paid sessions</h2>
            {data.paid.length === 0 ? <p className="text-sm text-text-tertiary">No paid sessions available.</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.paid.map((m) => <TypeCard key={m.id} m={m} onPick={() => pickType(m)} />)}
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
            <Button variant="outline" size="sm" onClick={resetType}>Change</Button>
          </div>

          {phase === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin text-primary-600" /> Finding the next available times…
            </div>
          )}

          {phase === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-3">
              <p className="flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {availError || 'Could not load availability.'}</p>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => loadAvailability(selected, avail?.selected_date || undefined)}>
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </Button>
            </div>
          )}

          {phase === 'empty' && avail && (
            avail.diagnosis ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
                <p className="flex items-start gap-2"><Info className="w-4 h-4 mt-0.5 shrink-0" /> {avail.diagnosis.message}</p>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => loadAvailability(selected)}>
                  <RefreshCw className="w-3.5 h-3.5" /> Check again
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface-secondary p-4 text-sm text-text-secondary space-y-2">
                <p>No available sessions found in the next {avail.horizon_days} days. Please check back later or contact the Super Admin.</p>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => loadAvailability(selected)}>
                  <RefreshCw className="w-3.5 h-3.5" /> Check again
                </Button>
              </div>
            )
          )}

          {phase === 'ready' && avail && (
            <>
              <p className="text-xs text-text-tertiary">Times are shown in {zoneLabel(avail.timezone)}.</p>
              {avail.calendar.status === 'disconnected' && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> The host's calendar isn't connected, so conflicts outside this app were not checked.</p>
              )}
              {notice && <p className="flex items-start gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {notice}</p>}

              <div>
                <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-text-secondary"><CalendarDays className="w-4 h-4" /> Pick a date</p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {avail.days.map((d) => {
                    const on = d.date === avail.selected_date;
                    const none = d.count === 0;
                    return (
                      <button key={d.date} disabled={none || slotsLoading} aria-pressed={on}
                        onClick={() => { setSlot(null); loadAvailability(selected, d.date); }}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-center text-xs transition-colors ${
                          on ? 'border-primary-600 bg-primary-600 text-white'
                            : none ? 'border-border bg-surface-secondary text-text-tertiary opacity-60 cursor-not-allowed'
                            : 'border-border hover:border-primary-300'}`}>
                        <div className="font-semibold">{dayLabel(d.date, 'EEE')}</div>
                        <div>{dayLabel(d.date, 'd MMM')}</div>
                        <div className="mt-0.5 text-[10px]">{none ? 'Full' : `${d.count} open`}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-text-secondary">
                  Available times{avail.selected_date ? ` · ${dayLabel(avail.selected_date, 'EEEE, d MMMM')}` : ''}
                </p>
                {slotsLoading ? <div className="flex py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>
                  : avail.slots.length === 0 ? <p className="text-sm text-text-tertiary">No times are open on this date. Pick another date above.</p>
                  : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {avail.slots.map((s) => (
                        <button key={s.start_time_iso} onClick={() => setSlot(s)}
                          className={`flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm ${slot?.start_time_iso === s.start_time_iso ? 'border-primary-600 bg-primary-50 font-semibold text-primary-900' : 'border-border hover:border-primary-300'}`}>
                          <Clock className="w-3.5 h-3.5 text-primary-600" /> {s.label}
                        </button>
                      ))}
                    </div>
                  )}
              </div>

              <p className="text-xs text-text-tertiary">
                This session may be recorded by the host. Any recording appears only in your My Recordings page
                and is visible only to you. By booking you acknowledge the student meeting policy.
              </p>

              <div className="flex justify-end border-t pt-4">
                <Button disabled={!slot || booking} onClick={book} className="min-w-40 bg-primary-600 hover:bg-primary-700 text-white">
                  {booking ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Booking…</> : selected.audience === 'student_free' ? 'Confirm free booking' : 'Pay and book'}
                </Button>
              </div>
            </>
          )}
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
