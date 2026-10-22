import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Ticket, CheckCircle2, Clock } from 'lucide-react';

export const StudentOverviewPage: React.FC = () => {
  const { me } = useOutletContext<{ me: any }>();
  const a = me?.allowance || { allocated: 0, completed: 0, available: 0 };
  const tiles = [
    { label: 'Free meetings', value: a.allocated, icon: Ticket },
    { label: 'Completed', value: a.completed, icon: CheckCircle2 },
    { label: 'Remaining', value: a.available, icon: Clock },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Welcome{me?.name ? `, ${me.name}` : ''}</h1>
          <p className="text-sm text-text-secondary">Book free or paid 1:1 sessions and see your meetings.</p>
        </div>
        <Link to="/student/book"><Button className="bg-primary-600 hover:bg-primary-700 text-white gap-2"><CalendarPlus className="w-4 h-4" /> Book</Button></Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Card key={t.label} className="border-border">
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><t.icon className="w-5 h-5" /></div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{t.value}</p>
                <p className="text-xs text-text-secondary">{t.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {a.available <= 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          All your free meetings are used, but you can still book another session.{' '}
          <Link to="/student/book" className="font-semibold underline">Choose a paid session</Link> to continue.
        </div>
      )}
    </div>
  );
};
