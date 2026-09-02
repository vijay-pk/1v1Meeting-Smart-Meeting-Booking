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
