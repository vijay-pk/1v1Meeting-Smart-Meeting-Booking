// Google Calendar API Integration Client

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Failed to refresh Google token');
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function createGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId?: string;
  title: string;
  description: string;
  startTimeUtc: string; // ISO string
  endTimeUtc: string; // ISO string
  customerEmail: string;
  customerName: string;
  requestId: string;
}): Promise<{
  eventId: string;
  meetUrl: string | null;
  htmlLink: string | null;
}> {
  const calendarId = encodeURIComponent(params.calendarId || 'primary');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1`;

  const eventPayload = {
    summary: params.title,
    description: params.description,
    start: {
      dateTime: params.startTimeUtc,
      timeZone: 'UTC',
    },
    end: {
      dateTime: params.endTimeUtc,
      timeZone: 'UTC',
    },
    attendees: [
      {
        email: params.customerEmail,
        displayName: params.customerName,
        responseStatus: 'accepted',
      },
    ],
    conferenceData: {
      createRequest: {
        requestId: params.requestId,
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to create Google Calendar event');
  }

  const meetUrl =
    data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri ||
    data.hangoutLink ||
    null;

  return {
    eventId: data.id,
    meetUrl,
    htmlLink: data.htmlLink || null,
  };
}

export async function cancelGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId?: string;
  eventId: string;
}): Promise<boolean> {
  const calendarId = encodeURIComponent(params.calendarId || 'primary');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${params.eventId}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    const data = await res.json();
    throw new Error(data.error?.message || 'Failed to delete Google Calendar event');
  }

  return true;
}

export async function fetchGoogleBusyIntervals(params: {
  accessToken: string;
  calendarId?: string;
  timeMin: string; // ISO string
  timeMax: string; // ISO string
}): Promise<Array<{ start: string; end: string }>> {
  const calendarId = params.calendarId || 'primary';
  const url = 'https://www.googleapis.com/calendar/v3/freeBusy';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      items: [{ id: calendarId }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to fetch Google Calendar free/busy status');
  }

  const busyList = data.calendars?.[calendarId]?.busy || [];
  return busyList.map((item: any) => ({
    start: item.start,
    end: item.end,
  }));
}
