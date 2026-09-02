// ============================================================
// Constants
// ============================================================

export const APP_NAME = 'BookMyMeet';

export const CURRENCIES: Record<string, { symbol: string; name: string; locale: string }> = {
  INR: { symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  USD: { symbol: '$', name: 'US Dollar', locale: 'en-US' },
  EUR: { symbol: '€', name: 'Euro', locale: 'en-IE' },
  GBP: { symbol: '£', name: 'British Pound', locale: 'en-GB' },
};

export const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const SLOT_HOLD_MINUTES = 5;

export const CALENDAR_COLORS = [
  { id: 1, name: 'Lavender', hex: '#7986cb' },
  { id: 2, name: 'Sage', hex: '#33b679' },
  { id: 3, name: 'Grape', hex: '#8e24aa' },
  { id: 4, name: 'Flamingo', hex: '#e67c73' },
  { id: 5, name: 'Banana', hex: '#f6bf26' },
  { id: 6, name: 'Tangerine', hex: '#f4511e' },
  { id: 7, name: 'Peacock', hex: '#039be5' },
  { id: 8, name: 'Graphite', hex: '#616161' },
  { id: 9, name: 'Blueberry', hex: '#3f51b5' },
  { id: 10, name: 'Basil', hex: '#0b8043' },
  { id: 11, name: 'Tomato', hex: '#d50000' },
] as const;

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending Payment',
  payment_received: 'Payment Received',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  expired: 'Expired',
  refunded: 'Refunded',
  calendar_failed: 'Calendar Pending',
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending_payment: 'bg-amber-50 text-amber-700 border-amber-200',
  payment_received: 'bg-blue-50 text-blue-700 border-blue-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  completed: 'bg-slate-50 text-slate-700 border-slate-200',
  expired: 'bg-gray-50 text-gray-500 border-gray-200',
  refunded: 'bg-purple-50 text-purple-700 border-purple-200',
  calendar_failed: 'bg-orange-50 text-orange-700 border-orange-200',
};

export const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST)', offset: '+05:30' },
  { value: 'America/New_York', label: 'Eastern Time (ET)', offset: '-05:00' },
  { value: 'America/Chicago', label: 'Central Time (CT)', offset: '-06:00' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', offset: '-07:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', offset: '-08:00' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT)', offset: '+00:00' },
  { value: 'Europe/Berlin', label: 'Central European Time (CET)', offset: '+01:00' },
  { value: 'Europe/Paris', label: 'Central European Time (CET)', offset: '+01:00' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST)', offset: '+04:00' },
  { value: 'Asia/Singapore', label: 'Singapore Time (SGT)', offset: '+08:00' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time (JST)', offset: '+09:00' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (AET)', offset: '+10:00' },
  { value: 'Pacific/Auckland', label: 'New Zealand Standard Time (NZST)', offset: '+12:00' },
] as const;

export const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
