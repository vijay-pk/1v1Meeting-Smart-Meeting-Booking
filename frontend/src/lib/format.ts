import type { Currency } from '@/types';
import { CURRENCIES } from './constants';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/**
 * Format price from smallest currency unit to display string
 * e.g., 99900 INR → ₹999
 */
export function formatPrice(amountInSmallestUnit: number, currency: Currency = 'INR'): string {
  const curr = CURRENCIES[currency];
  const amount = amountInSmallestUnit / 100;
  return new Intl.NumberFormat(curr.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date string for display in a given timezone
 */
export function formatDate(isoString: string, timezone: string, formatStr: string = 'PPP'): string {
  const date = parseISO(isoString);
  const zonedDate = toZonedTime(date, timezone);
  return format(zonedDate, formatStr);
}

/**
 * Format a time string for display in a given timezone
 */
export function formatTime(isoString: string, timezone: string): string {
  const date = parseISO(isoString);
  const zonedDate = toZonedTime(date, timezone);
  return format(zonedDate, 'h:mm a');
}

/**
 * Format a date-time range
 */
export function formatTimeRange(
  startIso: string,
  endIso: string,
  timezone: string
): string {
  return `${formatTime(startIso, timezone)} – ${formatTime(endIso, timezone)}`;
}

/**
 * Get timezone abbreviation
 */
export function getTimezoneAbbr(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

/**
 * Generate a session ID for anonymous booking holds
 */
export function generateSessionId(): string {
  const stored = sessionStorage.getItem('bmm_session_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  sessionStorage.setItem('bmm_session_id', id);
  return id;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return format(date, 'MMM d');
}

/**
 * A stored booking time, as the wall clock it records.
 *
 * Booking start/end times are the host's business-timezone wall clock with a cosmetic
 * trailing "Z" ("2026-09-15T21:48:00Z" means 9:48 PM in that zone, not UTC). `new Date()` on
 * that string reads it as UTC and the browser then shifts it into its own zone, which is how a
 * 9:48 PM IST booking was shown as 3:18 AM the next day. Dropping the marker and parsing the
 * components as local time makes date-fns print exactly the stored clock time, whatever zone
 * the viewer's browser is in.
 */
export function parseBookingWallClock(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value || '');
  if (!match) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
}

/**
 * The current time in `timezone`, in the same wall-clock frame as parseBookingWallClock, so
 * "is this booking upcoming / today" compares like with like in any browser zone.
 */
export function wallClockNow(timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    return parseBookingWallClock(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`);
  } catch {
    return new Date();
  }
}

/**
 * A real instant sent by the server (created_at and similar).
 *
 * Older responses serialize naive UTC with no offset, which a browser reads as local time --
 * "about 6 hours ago" for something created a minute ago in IST. A missing offset means UTC.
 */
export function parseServerInstant(value: string): Date {
  if (!value) return new Date(NaN);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}
