import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Video, Loader2, Info, RefreshCw, FlaskConical } from 'lucide-react';
import { formatBookingDate } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = {
  unsupported: 'Recording not configured',
  pending: 'Pending',
  processing: 'Processing',
  available: 'Available',
  unavailable: 'Failed',
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

  const load = useCallback((quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    api.studentRecordings()
      .then(setData)
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
            {r.status === 'unavailable' && r.detail && <p className="text-xs text-red-600">{r.detail}</p>}
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
                          setNote((n) => ({ ...n, [r.booking_id]: 'The recording could not be played. Press Play to try again.' }));
                        }}
                      />
                    )
                    : (
                      <Button size="sm" className="gap-1 bg-primary-600 text-white hover:bg-primary-700" disabled={playing === r.booking_id} onClick={() => play(r.booking_id)}>
                        {playing === r.booking_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} Play
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
