import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBookingDate, formatBookingTime } from '@/lib/format';
import { Video, RotateCcw, XCircle, Loader2 } from 'lucide-react';

const ATTENDANCE_LABEL: Record<string, string> = {
  completed: 'Counted (by schedule)',
  no_show: 'Marked as not attended',
  pending_review: 'Under review',
  pending: 'Not recorded yet',
};

// What the student sees. Every deadline below comes from the server as a UTC instant; the browser
// only compares them with a server-aligned clock. (The old code parsed the business-time
// `start_time` as if it were UTC, so Cancel and Reschedule stayed visible for 5.5 hours after a
// session had started.) The backend re-checks every request, so this is display only.
export const StudentMeetingsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadedAt = useRef<number>(Date.now());

  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  const offset = rows[0]?.server_now ? Date.parse(rows[0].server_now) - loadedAt.current : 0;
  const now = tick + offset;

  const load = () => {
    setLoading(true);
    api.studentMyBookings()
      .then((r) => { loadedAt.current = Date.now(); setRows(r); })
      .catch((e) => setError(e?.message || 'Could not load meetings.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this meeting? This cannot be undone.')) return;
    setBusyId(id);
    try { await api.studentCancel(id); load(); }
    catch (e: any) { alert(e?.message || 'Could not cancel.'); load(); }
    finally { setBusyId(null); }
  };

  const left = (ms: number) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };

  if (loading && rows.length === 0) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">My Meetings</h1>
      {rows.length === 0 && <p className="text-sm text-text-secondary">No meetings yet. <Link to="/student/book" className="text-primary-600 underline">Book one</Link>.</p>}
      {rows.map((b) => {
        const startMs = b.scheduled_start_at ? Date.parse(b.scheduled_start_at) : 0;
        const endMs = b.scheduled_end_at ? Date.parse(b.scheduled_end_at) : 0;
        const termMs = b.termination_at ? Date.parse(b.termination_at) : 0;
        const deadlineMs = b.change_deadline_at ? Date.parse(b.change_deadline_at) : 0;
        const confirmed = b.status === 'confirmed';
        const cancelled = b.status === 'cancelled';
        // The scheduled time is over: shown as Completed immediately, without a refresh.
        const completed = confirmed && (b.lifecycle_status === 'completed' || (endMs > 0 && now >= endMs));
        const inProgress = confirmed && !completed && startMs > 0 && now >= startMs;
        // Self-service is allowed only before the cutoff (start - 24h), only while upcoming, and
        // only if the server said so when it sent the row.
        const canChange = confirmed && !completed && Boolean(b.can_change) && deadlineMs > 0 && now < deadlineMs;
        const locked = confirmed && !completed && !canChange;
        const showJoin = confirmed && b.google_meet_link && termMs > 0 && now < termMs && b.meeting_phase !== 'ended' && b.meeting_phase !== 'termination_failed';

        let statusLabel = b.status;
        let statusClass = '';
        if (cancelled) { statusLabel = 'Cancelled'; statusClass = 'text-slate-500'; }
        else if (completed) { statusLabel = 'Completed'; statusClass = 'text-slate-700 border-slate-300 bg-slate-100'; }
        else if (inProgress) { statusLabel = 'In progress'; statusClass = 'text-emerald-700 border-emerald-200 bg-emerald-50'; }
        else if (confirmed) { statusLabel = 'Upcoming'; statusClass = 'text-blue-700 border-blue-200 bg-blue-50'; }
        else if (b.status === 'pending_payment') { statusLabel = 'Awaiting payment'; }

        return (
          <Card key={b.id} className="border-border">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-text-primary">{b.session_title}</h3>
                  <Badge variant="outline" className={b.category === 'student_free' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-indigo-700 border-indigo-200 bg-indigo-50'}>
                    {b.category === 'student_free' ? 'Free' : 'Paid'}
                  </Badge>
                  <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>
                </div>
                <p className="text-sm text-text-secondary">{formatBookingDate(b.start_time)} · {formatBookingTime(b.start_time)}–{formatBookingTime(b.end_time)} ({b.timezone})</p>
                <p className="text-xs text-text-tertiary">
                  Ref {b.public_id}
                  {(completed || cancelled) && ` · Attendance: ${ATTENDANCE_LABEL[b.attendance_status || 'pending'] || b.attendance_status}`}
                </p>
                {inProgress && endMs > 0 && (
                  <p className="mt-1 text-xs text-text-secondary"><span className="font-semibold">In progress</span> · {left(endMs - now)} left</p>
                )}
                {completed && termMs > now && b.meeting_phase !== 'ended' && (
                  <p className="mt-1 text-xs text-amber-700">Session time is over. The Google Meet closes automatically in {left(termMs - now)}.</p>
                )}
                {completed && b.meeting_phase === 'termination_failed' && (
                  <p className="mt-1 text-xs text-red-600">Google did not confirm the call was closed automatically. Your host has been notified.</p>
                )}
                {locked && (
                  <p className="mt-1 text-xs text-text-tertiary">Cancellation and rescheduling close 24 hours before the session.</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showJoin && (
                  <a href={b.google_meet_link} target="_blank" rel="noreferrer">
                    <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"><Video className="w-4 h-4" /> Join</Button>
                  </a>
                )}
                {canChange && b.reschedule_token && (
                  <Link to={`/booking/reschedule/${b.reschedule_token}`}>
                    <Button size="sm" variant="outline" className="gap-1"><RotateCcw className="w-4 h-4" /> Reschedule</Button>
                  </Link>
                )}
                {canChange && (
                  <Button size="sm" variant="ghost" className="gap-1 text-red-600 hover:bg-red-50" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
                    <XCircle className="w-4 h-4" /> Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-text-tertiary">Cancellation and rescheduling close 24 hours before the session. Completed meetings stay here as your history.</p>
    </div>
  );
};
