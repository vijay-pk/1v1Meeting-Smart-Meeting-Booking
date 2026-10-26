/**
 * Google Calendar & iCalendar (.ics) integration helpers
 */

export interface CalendarEventParams {
  title: string;
  description: string;
  location: string; // Google Meet URL
  startTime: string; // ISO string
  endTime: string; // ISO string
  clientName: string;
  clientEmail: string;
  adminName: string;
  adminEmail: string;
}

/**
 * Format ISO date string into Google Calendar UTC string: YYYYMMDDTHHmmssZ
 */
export function formatGoogleCalendarDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toISOString().replace(/-|:|\.\d+/g, '');
}

/**
 * Generates a direct 1-click Google Calendar Web URL with attendees & Google Meet link
 */
export function generateGoogleCalendarUrl(params: CalendarEventParams): string {
  const startUtc = formatGoogleCalendarDate(params.startTime);
  const endUtc = formatGoogleCalendarDate(params.endTime);

  // The Meet line and location are added only when a meeting link actually exists. Callers used
  // to pass a generic meet.google.com address when there was none, putting a link to nowhere in
  // the visitor's calendar.
  const meetLine = params.location ? `📹 Join Google Meet: ${params.location}\n` : '';
  const fullDescription = `${params.description}\n\n${meetLine}👤 Client: ${params.clientName} (${params.clientEmail})\n👨‍🏫 Host: ${params.adminName} (${params.adminEmail})`;

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);
  url.searchParams.set('dates', `${startUtc}/${endUtc}`);
  url.searchParams.set('details', fullDescription);
  if (params.location) url.searchParams.set('location', params.location);
  
  // Add both client and admin as attendees
  const attendees = [params.clientEmail, params.adminEmail].filter(Boolean).join(',');
  if (attendees) {
    url.searchParams.set('add', attendees);
  }

  return url.toString();
}

/**
 * Generates standard RFC 5545 iCalendar (.ics) content and triggers browser download
 */
export function downloadIcsFile(params: CalendarEventParams, filename?: string): void {
  const startUtc = formatGoogleCalendarDate(params.startTime);
  const endUtc = formatGoogleCalendarDate(params.endTime);
  const nowUtc = formatGoogleCalendarDate(new Date().toISOString());
  const uid = `bkm-${Date.now()}@bookmymeet.app`;

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookMyMeet//Appointment Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${params.title}`,
    `DESCRIPTION:${params.description.replace(/\n/g, '\\n')}${params.location ? `\\n\\nJoin Google Meet: ${params.location}` : ''}`,
    ...(params.location ? [`LOCATION:${params.location}`] : []),
    `ORGANIZER;CN=${params.adminName}:mailto:${params.adminEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=${params.adminName}:mailto:${params.adminEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=${params.clientName}:mailto:${params.clientEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: 1-on-1 Consultation Call starting in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute('download', filename || `appointment-${params.clientName.replace(/\s+/g, '-').toLowerCase()}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
