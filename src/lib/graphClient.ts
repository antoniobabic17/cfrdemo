import { isDemoActive } from './demoMode';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl: string };
  attendees?: Array<{ emailAddress: { address: string; name: string }; status: { response: string } }>;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  location: string;
  joinUrl: string;
  attendees: Array<{ email: string; name: string; response: string }>;
}

let graphAvailable: boolean | null = null;

async function graphFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });
}

export async function isGraphAvailable(): Promise<boolean> {
  if (isDemoActive()) return false; // no network in demo; calendar UI hides
  if (graphAvailable !== null) return graphAvailable;
  try {
    const res = await graphFetch('/me?$select=id', { method: 'GET' });
    graphAvailable = res.ok;
  } catch {
    graphAvailable = false;
  }
  return graphAvailable;
}

function mapEvent(e: GraphEvent): CalendarEvent {
  return {
    id: e.id,
    subject: e.subject,
    startDateTime: e.start.dateTime,
    endDateTime: e.end.dateTime,
    location: e.location?.displayName ?? '',
    joinUrl: e.onlineMeeting?.joinUrl ?? '',
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.emailAddress.address,
      name: a.emailAddress.name,
      response: a.status.response,
    })),
  };
}

export async function createCalendarEvent(params: {
  subject: string;
  startDateTime: string;
  endDateTime: string;
  location?: string;
  attendees?: Array<{ email: string; name: string }>;
  isOnlineMeeting?: boolean;
}): Promise<CalendarEvent> {
  if (isDemoActive()) {
    return {
      id: `demo-evt-${Date.now()}`,
      subject: params.subject,
      startDateTime: params.startDateTime,
      endDateTime: params.endDateTime,
      location: params.location ?? '',
      joinUrl: '',
      attendees: (params.attendees ?? []).map((a) => ({ email: a.email, name: a.name, response: 'none' })),
    };
  }
  const body: Record<string, unknown> = {
    subject: params.subject,
    start: { dateTime: params.startDateTime, timeZone: 'UTC' },
    end: { dateTime: params.endDateTime, timeZone: 'UTC' },
    isOnlineMeeting: params.isOnlineMeeting ?? true,
  };
  if (params.location) body.location = { displayName: params.location };
  if (params.attendees?.length) {
    body.attendees = params.attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name },
      type: 'required',
    }));
  }
  const res = await graphFetch('/me/events', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Graph create event failed: ${res.status}`);
  return mapEvent(await res.json());
}

export async function updateCalendarEvent(eventId: string, params: {
  subject?: string;
  startDateTime?: string;
  endDateTime?: string;
  location?: string;
}): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};
  if (params.subject) body.subject = params.subject;
  if (params.startDateTime) body.start = { dateTime: params.startDateTime, timeZone: 'UTC' };
  if (params.endDateTime) body.end = { dateTime: params.endDateTime, timeZone: 'UTC' };
  if (params.location) body.location = { displayName: params.location };
  const res = await graphFetch(`/me/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Graph update event failed: ${res.status}`);
  return mapEvent(await res.json());
}

export async function getCalendarEvent(eventId: string): Promise<CalendarEvent> {
  const res = await graphFetch(`/me/events/${eventId}?$select=id,subject,start,end,location,isOnlineMeeting,onlineMeeting,attendees`);
  if (!res.ok) throw new Error(`Graph get event failed: ${res.status}`);
  return mapEvent(await res.json());
}
