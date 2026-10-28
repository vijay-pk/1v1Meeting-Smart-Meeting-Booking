import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Video, Loader2, Info, RefreshCw, FlaskConical } from 'lucide-react';
import { formatBookingDate } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = {
  unsupported: 'Recording not configured',
  pending: 'Waiting for recording',
  processing: 'Processing',
  available: 'Available',
  unavailable: 'Unavailable',
};

const STATUS_STYLE: Record<string, string> = {
  available: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  processing: 'text-blue-700 border-blue-200 bg-blue-50',
  pending: 'text-slate-600',
  unavailable: 'text-red-700 border-red-200 bg-red-50',
  unsupported: 'text-slate-500',
};

export const StudentRecordingsPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [streams, setStreams] = useState<Record<string, string>>({});
  // 1s tick, aligned to the server clock. The estimate itself is stored on the server (scheduled
  // end + estimate), so reloading or opening another device never restarts it.
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  const loadedAt = React.useRef(Date.now());
  const clockOffset = (() => {
    const first = (data?.recordings || []).find((r: any) => r.server_now);
    return first ? Date.parse(first.server_now) - loadedAt.current : 0;
  })();
  const nowMs = tick + clockOffset;
  const fmt = (ms: number) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const load = useCallback((quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    api.studentRecordings()
      .then((d) => { loadedAt.current = Date.now(); setData(d); })
      .catch((e) => setError(e?.message || 'Could not load recordings.'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    load();
    // A recording moves from pending to available while the student is away; refetch on return.
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // While anything is still being prepared, re-check on our own every 30s. This only refreshes the
  // display: the server keeps checking Google whether or not this page is open.
  const waiting = (data?.recordings || []).some((r: any) => !r.simulated && (r.status === 'pending' || r.status === 'processing'));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const play = async (id: string) => {
    setPlaying(id);
    setNote((n) => ({ ...n, [id]: '' }));
    try {
      const r = await api.studentRecordingPlay(id);
      if (r?.stream_url) {
        setStreams((s) => ({ ...s, [id]: r.stream_url }));
      } else {
        setNote((n) => ({ ...n, [id]: r?.message || 'Playback is not available for this entry.' }));
      }
    } catch (e: any) {
      setNote((n) => ({ ...n, [id]: e?.message || 'This recording is not available.' }));
    } finally {
      setPlaying(null);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>;
  if (error) return (
    <div className="space-y-3">
      <p className="text-sm text-red-600">{error}</p>
      <Button size="sm" variant="outline" onClick={() => load()}>Try again</Button>
    </div>
  );

  const cap = data?.capability;
  const items = data?.recordings || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">My Recordings</h1>
        <Button size="sm" variant="outline" className="gap-1" disabled={refreshing} onClick={() => load(true)}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      {cap && !cap.supported && !cap.simulation && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{cap.message || 'Automatic recording retrieval is not configured yet.'}</span>
        </div>
      )}
      {cap?.simulation && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Development mode: entries marked TEST are simulated. They contain no video.</span>
        </div>
      )}
      {items.length === 0 && <p className="text-sm text-text-secondary">No recordings yet. They appear here after a recorded session is processed.</p>}
      {items.map((r: any) => (
        <Card key={r.booking_id} className="border-border">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Video className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-text-primary truncate">{r.title || r.session_title}</h3>
                  <p className="text-xs text-text-tertiary">{formatBookingDate(r.start_time)}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {r.simulated && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800" title={r.test_label || 'Simulated entry'}>
                    TEST · simulated, no video
                  </Badge>
                )}
                <Badge variant="outline" className={STATUS_STYLE[r.status] || 'text-slate-600'}>
                  {STATUS_LABEL[r.status] || r.status}
                </Badge>
              </div>
            </div>
            {r.status === 'unavailable' && (
              <p className="text-xs text-red-600">
                {r.detail || 'Google did not produce a recording for this session.'} If you expected one, contact your host or support with this meeting's date.
              </p>
            )}
            {/* Being prepared: an ESTIMATE from the server, never a promise and never a status change. */}
            {!r.simulated && r.meeting_ended && (r.status === 'pending' || r.status === 'processing') && (() => {
              const est = r.estimated_ready_at ? Date.parse(r.estimated_ready_at) : 0;
              const past = est > 0 && nowMs >= est;
              return (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900 space-y-1">
                  <p className="font-semibold">
                    {r.status === 'processing' ? 'Recording status: Processing' : 'Recording status: Waiting for recording'}
                  </p>
                  {est > 0 && !past && (
                    <p>Estimated availability in <span className="font-mono font-bold">{fmt(est - nowMs)}</span> <span className="text-blue-700">(estimate, not a guarantee)</span></p>
                  )}
                  {past && <p className="font-semibold">Still processing</p>}
                  <p className="text-blue-800">
                    {past
                      ? "The recording is taking longer than estimated. Google may need additional time to finish preparing the video. We'll keep checking automatically."
                      : "Your meeting recording is being processed by Google. We'll check automatically and make it available when the video is ready. The time above is an estimate."}
                  </p>
                </div>
              );
            })()}
            {/* Why a real recording is not ready yet (e.g. a missing Google permission). */}
            {!r.simulated && (r.status === 'pending' || r.status === 'processing') && r.detail && (
              <p className="text-xs text-text-secondary">{r.detail}</p>
            )}
            {r.status === 'available' && (
              r.simulated
                ? <Button size="sm" variant="outline" disabled className="gap-1">Simulated – no video</Button>
                : r.playable && (
                  streams[r.booking_id]
                    ? (
                      <video
                        controls
                        autoPlay
                        preload="metadata"
                        className="w-full rounded-lg bg-black"
                        src={streams[r.booking_id]}
                        onError={() => {
                          // The signed link is short-lived; drop it so Play can issue a fresh one.
                          setStreams((s) => { const { [r.booking_id]: _drop, ...rest } = s; return rest; });
                          setNote((n) => ({ ...n, [r.booking_id]: 'The recording could not be played. Press Watch Recording to try again.' }));
                        }}
                      />
                    )
                    : (
                      <Button size="sm" className="gap-1 bg-primary-600 text-white hover:bg-primary-700" disabled={playing === r.booking_id} onClick={() => play(r.booking_id)}>
                        {playing === r.booking_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} Watch Recording
                      </Button>
                    )
                )
            )}
            {note[r.booking_id] && <p className="text-xs text-text-secondary">{note[r.booking_id]}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
