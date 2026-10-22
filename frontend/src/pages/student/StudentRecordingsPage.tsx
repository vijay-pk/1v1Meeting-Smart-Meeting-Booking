import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Video, Loader2, Info } from 'lucide-react';
import { formatBookingDate } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = {
  unsupported: 'Recording not configured',
  pending: 'Recording pending',
  processing: 'Recording processing',
  available: 'Recording available',
  unavailable: 'Recording unavailable',
};

export const StudentRecordingsPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.studentRecordings().then(setData).catch((e) => setError(e?.message || 'Could not load recordings.')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  const cap = data?.capability;
  const items = data?.recordings || [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">My Recordings</h1>
      {cap && !cap.supported && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{cap.message || 'Automatic recording retrieval is not configured yet.'}</span>
        </div>
      )}
      {items.length === 0 && <p className="text-sm text-text-secondary">No recordings yet. They appear here after a recorded session is processed.</p>}
      {items.map((r: any) => (
        <Card key={r.booking_id} className="border-border">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Video className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold text-text-primary">{r.session_title}</h3>
                <p className="text-xs text-text-tertiary">{formatBookingDate(r.start_time)}</p>
              </div>
            </div>
            <Badge variant="outline" className={r.playable ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-slate-600'}>
              {STATUS_LABEL[r.status] || r.status}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
