import React from 'react';
import { BellRing, CalendarCheck, CalendarClock, Video } from 'lucide-react';

interface Benefit {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  text: string;
}

/**
 * What a booking includes. Each tile states something the platform really does:
 *  - Google Meet and Calendar invitation need the host's Google account, so they are shown only when
 *    the public profile says it is connected (`googleConnected`); otherwise they are left out rather
 *    than promised.
 *  - Reminders: the platform reminds the HOST ahead of every session (Super Admin sets the lead time;
 *    it cannot be switched off), so the copy says that and does not promise the guest an email.
 *  - Rescheduling: a booking can be moved from its confirmation link (backend refuses past sessions).
 */
export const BenefitsStrip: React.FC<{ googleConnected: boolean }> = ({ googleConnected }) => {
  const items: Benefit[] = [
    ...(googleConnected
      ? [
          { icon: Video, label: 'Google Meet', text: 'Your video link is created automatically when you book.' },
          { icon: CalendarCheck, label: 'Calendar invitation', text: 'Booking details arrive as a Google Calendar invitation.' },
        ]
      : []),
    { icon: BellRing, label: 'Meeting reminders', text: 'Your host is reminded ahead of every session, so it starts on time.' },
    { icon: CalendarClock, label: 'Flexible rescheduling', text: 'Need another time? Reschedule from your confirmation link.' },
  ];
  return (
    <section aria-label="What every booking includes" className="mt-8">
      <ul className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${items.length >= 4 ? 'lg:grid-cols-4' : items.length === 3 ? 'lg:grid-cols-3' : ''}`}>
        {items.map(({ icon: Icon, label, text }) => (
          <li key={label} className="bm-card flex items-start gap-3 p-4">
            <span className="bm-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold bm-text">{label}</p>
              <p className="mt-0.5 text-xs leading-relaxed bm-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
