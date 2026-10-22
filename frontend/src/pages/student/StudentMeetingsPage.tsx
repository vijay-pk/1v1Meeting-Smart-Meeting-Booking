import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBookingDate, formatBookingTime } from '@/lib/format';
import { Video, RotateCcw, XCircle, Loader2 } from 'lucide-react';

export const StudentMeetingsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.studentMyBookings().then(setRows).catch((e) => setError(e?.message || 'Could not load meetings.')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this meeting? This cannot be undone.')) return;
    setBusyId(id);
    try { await api.studentCancel(id); load(); }
    catch (e: any) { alert(e?.message || 'Could not cancel.'); }
    finally { setBusyId(null); }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">My Meetings</h1>
      {rows.length === 0 && <p className="text-sm text-text-secondary">No meetings yet. <Link to="/student/book" className="text-primary-600 underline">Book one</Link>.</p>}
      {rows.map((b) => {
        const active = b.status === 'confirmed';
        const upcoming = active && new Date(b.start_time) > new Date();
        return (
          <Card key={b.id} className="border-border">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary">{b.session_title}</h3>
                  <Badge variant="outline" className={b.category === 'student_free' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-indigo-700 border-indigo-200 bg-indigo-50'}>
                    {b.category === 'student_free' ? 'Free' : 'Paid'}
                  </Badge>
                  <Badge variant="outline">{b.status}</Badge>
                </div>
                <p className="text-sm text-text-secondary">{formatBookingDate(b.start_time)} · {formatBookingTime(b.start_time)}–{formatBookingTime(b.end_time)} ({b.timezone})</p>
                <p className="text-xs text-text-tertiary">Ref {b.public_id} · Attendance: {b.attendance_status || '—'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {active && b.google_meet_link && (
                  <a href={b.google_meet_link} target="_blank" rel="noreferrer">
                    <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"><Video className="w-4 h-4" /> Join</Button>
                  </a>
                )}
                {upcoming && b.reschedule_token && (
                  <Link to={`/booking/reschedule/${b.reschedule_token}`}>
                    <Button size="sm" variant="outline" className="gap-1"><RotateCcw className="w-4 h-4" /> Reschedule</Button>
                  </Link>
                )}
                {upcoming && (
                  <Button size="sm" variant="ghost" className="gap-1 text-red-600 hover:bg-red-50" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
                    <XCircle className="w-4 h-4" /> Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-text-tertiary">Cancellation and rescheduling close 24 hours before the session.</p>
    </div>
  );
};
