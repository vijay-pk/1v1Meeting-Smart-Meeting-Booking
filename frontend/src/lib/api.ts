const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

/**
 * How long any single request may take before we give up on it.
 *
 * The backend can be cold: a real measurement against production showed
 * GET /auth/username-available returning 200 after **37 seconds**. `fetch` has no timeout of
 * its own, so a request like that hangs until the browser abandons it, and every caller sat
 * there with no way to distinguish "slow" from "dead". This ceiling is generous enough to
 * survive a cold start and short enough that a genuinely dead backend is reported rather
 * than spun on forever.
 */
const REQUEST_TIMEOUT_MS = 90_000;

/** After this long, a request is slow enough that the UI should explain itself. */
export const SLOW_REQUEST_MS = 3_000;

/** Thrown when a request exceeded REQUEST_TIMEOUT_MS. Callers can offer a retry. */
export class RequestTimeoutError extends Error {
  readonly isTimeout = true;
  constructor() {
    super('The server took too long to respond. It may be waking up — please try again.');
    this.name = 'RequestTimeoutError';
  }
}

/** Thrown when the request never reached the server at all (offline, DNS, CORS, cold start). */
export class NetworkError extends Error {
  readonly isNetwork = true;
  constructor() {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

/**
 * The single fetch used by every call below.
 *
 * Adds the timeout `fetch` lacks, and turns the two failures that used to surface as the raw
 * string "Failed to fetch" into named errors a caller can actually branch on. That raw string
 * reaching the signup screen -- next to "midhunvijay is available", because the availability
 * check eventually succeeded while the submit did not -- is what this replaces.
 *
 * `signal` lets a caller cancel its own request (used by the username check, so a stale
 * response cannot overwrite a newer one).
 */
async function attempt(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, signal });
  // One place, so no endpoint can forget. The server sets this only when the credential
  // itself is finished -- an ordinary 403 (wrong role for this endpoint) does not carry it
  // and must not sign anyone out.
  if (res.headers.get('X-Auth-Revoked') === '1') handleRevokedSession();
  return res;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Honour a caller-supplied signal as well as our timeout.
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // Retrying is only safe for reads. A GET that never reached the server can be repeated
  // freely; a POST cannot -- it may have been received and only its response lost, so an
  // automatic second attempt risks creating an account or a booking twice. Writes get one
  // attempt and an honest error the caller can offer a retry for.
  const method = (init.method || 'GET').toUpperCase();
  const retries = method === 'GET' ? 1 : 0;

  try {
    for (let remaining = retries; ; remaining--) {
      try {
        return await attempt(path, init, controller.signal);
      } catch (err: any) {
        if (callerSignal?.aborted || controller.signal.aborted) throw err;
        // A refused connection while Render spins up looks exactly like this. One quick
        // second attempt turns most cold starts into a slightly slow read instead of an error.
        if (remaining > 0 && err?.name !== 'AbortError') {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        throw err;
      }
    }
  } catch (err: any) {
    // A caller-initiated cancel is not a failure; let it propagate as an AbortError so the
    // caller can ignore it rather than render an error for a request it abandoned itself.
    if (callerSignal?.aborted) throw err;
    if (err?.name === 'AbortError') throw new RequestTimeoutError();
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wakes the backend, without waiting for it.
 *
 * The Render instance sleeps when idle and takes tens of seconds to come back -- measured at
 * 32s. That cost lands on whoever makes the first request, which on the signup screen is the
 * form submission: the visitor spends a minute filling the form against a warm-looking page,
 * presses the button, and the POST is the request that pays for the spin-up. It fails, and
 * the availability check beside it has already succeeded, so the screen says a name is
 * available and the server is unreachable at the same time.
 *
 * Calling this on mount moves the wake-up to the moment the page opens, so the backend is
 * usually up by the time anything is submitted. It fixes nothing about the instance itself --
 * a paid Render plan is the actual fix -- it just stops the cold start landing on the one
 * request that cannot be safely retried. Deliberately fire-and-forget: nothing waits on it and
 * a failure is not the visitor's problem.
 */
export function warmUpBackend(): void {
  fetch(`${API_BASE.replace(/\/api$/, '')}/health`, { method: 'GET' }).catch(() => {});
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  booking_id?: string | null;
  is_read: boolean;
  created_at: string | null;
}

export interface SuperAdminAccount {
  id: string;
  name: string;
  username: string | null;
  email: string;
  role: string;
}

export interface ReminderSettings {
  enabled: boolean;
  lead_minutes: number;
  choices: number[];
  updated_at: string | null;
}

export interface OnboardingStatus {
  profile: boolean;
  working_hours: boolean;
  meeting_type: boolean;
  gateway: boolean;
  completed_count: number;
  total_count: number;
  setup_completed: boolean;
  setup_completed_at: string | null;
  username: string | null;
  role: string;
}

/** Reads the backend's error detail, falling back to a message the user can act on. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({} as any));
  const detail = typeof body?.detail === 'string' ? body.detail : null;
  const error = new Error(detail || fallback) as Error & { status?: number; notFound?: boolean };
  error.status = res.status;
  error.notFound = res.status === 404;
  return error;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('bmm_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

/**
 * Every key a signed-in session writes. Kept beside persistSession() so the two cannot drift:
 * a key added on sign-in and forgotten here would survive a revocation and keep the UI
 * believing someone is logged in.
 */
const SESSION_KEYS = [
  'bmm_auth_token',
  'bmm_current_user_role',
  'bmm_logged_admin_id',
  'bmm_logged_username',
  'bmm_logged_admin_name',
  'bmm_logged_role',
  'bmm_auth_user',
  'bmm_logged_admin_photo',
  'bmm_logged_admin_video',
];

/** Where the client is sent after its credential is revoked, and why. */
export const REVOKED_REDIRECT = '/admin/login?revoked=1';

let revocationHandled = false;

/**
 * Ends the session because the server said the credential is finished.
 *
 * The server is the authority here; this only makes the browser agree with it. A deleted
 * admin is already locked out of every endpoint by `deps.get_current_user` -- without this
 * they simply kept a dashboard shell that threw errors, which looks like a broken app rather
 * than a closed account.
 *
 * Guarded by a flag because a dashboard fires several requests at once: without it, five
 * concurrent 401s would each try to redirect.
 */
function handleRevokedSession(): void {
  if (revocationHandled) return;
  revocationHandled = true;
  try {
    for (const key of SESSION_KEYS) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    // Private mode or blocked storage: the redirect below still matters more than the cleanup.
  }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin/login')) {
    window.location.replace(REVOKED_REDIRECT);
  }
}

function persistSession(data: any) {
  if (!data || !data.access_token) return;
  localStorage.setItem('bmm_auth_token', data.access_token);
  localStorage.setItem('bmm_current_user_role', data.role);
  localStorage.setItem('bmm_logged_admin_id', data.user_id);
  if (data.username) localStorage.setItem('bmm_logged_username', data.username);
  if (data.name) localStorage.setItem('bmm_logged_admin_name', data.name);
}

export const api = {
  // Auth
  login: async (username_or_email: string, password: string) => {
    const res = await request(`/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username_or_email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    persistSession(data);
    return data;
  },

  signup: async (data: { name: string; email: string; password: string; phone?: string; username: string }) => {
    const res = await request(`/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Signup failed');
    }
    const resData = await res.json();
    persistSession(resData);
    return resData;
  },

  // --- Google sign-in (Supabase runs the OAuth dance, the backend owns the account) ---

  // First leg. Returns either status:"authenticated" with a token, or
  // status:"registration_required" with a suggested username for a new Google user.
  googleAuth: async (supabaseAccessToken: string) => {
    const res = await request(`/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_access_token: supabaseAccessToken })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Google sign-in failed');
    if (data.status === 'authenticated') persistSession(data);
    return data;
  },

  // Second leg, for a Google address with no account yet.
  googleAuthComplete: async (supabaseAccessToken: string, username: string, phone?: string) => {
    const res = await request(`/auth/google/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_access_token: supabaseAccessToken, username, phone })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Could not create your account');
    persistSession(data);
    return data;
  },

  /**
   * Asks whether a username is free.
   *
   * Throws when the answer is unknown rather than guessing. This used to return
   * `{ available: false }` on any HTTP error, so an unreachable backend was reported to the
   * user as "that name is taken" -- advice that is wrong, unactionable, and indistinguishable
   * from the real thing.
   *
   * `signal` cancels a superseded check: typing "midhun" fires several of these, and without
   * cancellation a slow reply for "midh" can land after the reply for "midhun" and overwrite
   * a correct answer with a stale one.
   */
  checkUsername: async (
    username: string,
    signal?: AbortSignal
  ): Promise<{ username: string; available: boolean; reason: string | null }> => {
    const res = await request(
      `/auth/username-available?username=${encodeURIComponent(username)}`,
      { signal }
    );
    if (!res.ok) throw await failure(res, 'Could not check that name right now.');
    return res.json();
  },

  getMe: async () => {
    const res = await request(`/auth/me`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  // --- In-app notifications (FastAPI notifications table) ---
  getNotifications: async (): Promise<AppNotification[]> => {
    const res = await request(`/notifications/`, { headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not load notifications.');
    return res.json();
  },

  markNotificationRead: async (id: string) => {
    const res = await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not update that notification.');
  },

  markAllNotificationsRead: async () => {
    const res = await request(`/notifications/read-all`, { method: 'POST', headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not update notifications.');
  },

  // --- Super Admin: own account and platform settings ---
  superAdminGetAccount: async (): Promise<SuperAdminAccount> => {
    const res = await request(`/super-admin/account`, { headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not load your account.');
    return res.json();
  },

  superAdminUpdateAccount: async (body: {
    name?: string;
    username?: string;
    email?: string;
    current_password?: string;
  }): Promise<SuperAdminAccount> => {
    const res = await request(`/super-admin/account`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, 'Could not save your account.');
    const data = await res.json();
    // Keep the shell's cached identity in step with the server.
    if (data.username) localStorage.setItem('bmm_logged_username', data.username);
    if (data.name) localStorage.setItem('bmm_logged_admin_name', data.name);
    return data;
  },

  superAdminChangePassword: async (body: {
    current_password: string;
    new_password: string;
    confirm_password: string;
  }): Promise<{ message: string }> => {
    const res = await request(`/super-admin/account/password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, 'Could not change your password.');
    const data = await res.json();
    // Every older session was just revoked server-side; this browser gets the fresh token.
    if (data.access_token) localStorage.setItem('bmm_auth_token', data.access_token);
    return { message: data.message };
  },

  superAdminGetReminderSettings: async (): Promise<ReminderSettings> => {
    const res = await request(`/super-admin/settings/reminders`, { headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not load reminder settings.');
    return res.json();
  },

  superAdminUpdateReminderSettings: async (body: { enabled: boolean; lead_minutes: number }): Promise<ReminderSettings> => {
    const res = await request(`/super-admin/settings/reminders`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, 'Could not save reminder settings.');
    return res.json();
  },

  // Public Profiles
  getMyProfile: async () => {
    const res = await request(`/profiles/me`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  // First-time setup status, derived server-side from this admin's persisted rows. Throws
  // on failure: an unreachable server must never read as "nothing is set up yet".
  getOnboardingStatus: async (): Promise<OnboardingStatus> => {
    const res = await request(`/profiles/me/onboarding`, { headers: getAuthHeaders() });
    if (!res.ok) throw await failure(res, 'Could not load your setup status.');
    return res.json();
  },

  // Throws with `notFound` set only for a genuine 404. Everything else -- a 500, a CORS
  // failure, the API being unreachable -- is a *transient* failure, and the public page must
  // not tell a visitor the host's booking page "has been removed" because of one.
  getPublicProfile: async (username: string) => {
    const res = await request(`/profiles/public/${encodeURIComponent(username)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(
        typeof err.detail === 'string' ? err.detail : 'Could not load this profile.'
      ) as Error & { notFound?: boolean };
      error.notFound = res.status === 404;
      throw error;
    }
    return res.json();
  },

  updateMyProfile: async (updates: any) => {
    const res = await request(`/profiles/me`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update profile');
    }
    return res.json();
  },

  // Availability & Slots
  /**
   * Per-day slot counts for the date strip, in one request.
   *
   * The alternative is one /slots call per day, which is fourteen round trips on a link
   * people open from a phone. The backend runs the same engine for each day, so a count can
   * never disagree with the slots behind it.
   */
  getSlotCounts: async (params: {
    admin_id?: string;
    username?: string;
    session_id: string;
    days?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.admin_id) query.append('admin_id', params.admin_id);
    if (params.username) query.append('username', params.username);
    query.append('session_id', params.session_id);
    query.append('days', String(params.days ?? 14));

    const res = await request(`/availability/slot-counts?${query.toString()}`);
    if (!res.ok) throw await failure(res, 'Could not load availability.');
    return res.json();
  },

  getAvailableSlots: async (params: { admin_id?: string; username?: string; session_id: string; date_str: string }) => {
    const query = new URLSearchParams();
    if (params.admin_id) query.append('admin_id', params.admin_id);
    if (params.username) query.append('username', params.username);
    query.append('session_id', params.session_id);
    query.append('date_str', params.date_str);

    // Errors are reported, not swallowed: "the backend is down" and "this day is full"
    // must not look identical to the booking UI.
    try {
      const res = await request(`/availability/slots?${query.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { available_slots: [], error: true, message: err.detail || 'Could not load availability' };
      }
      return res.json();
    } catch (e: any) {
      return { available_slots: [], error: true, message: e?.message || 'Could not reach the booking service' };
    }
  },

  // Availability is server state. These throw rather than returning [] on failure, so the
  // page can tell "you have not set hours yet" apart from "we could not load your hours" --
  // the two used to look identical, which is why a load failure read as "No hours set".
  getMyAvailabilityRules: async () => {
    const res = await request(`/availability/rules`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not load your availability.');
    }
    return res.json();
  },

  getMyAvailabilityExceptions: async () => {
    const res = await request(`/availability/exceptions`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not load your blocked dates.');
    }
    return res.json();
  },

  addMyAvailabilityException: async (payload: {
    exception_date: string;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
  }) => {
    const res = await request(`/availability/exceptions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ is_available: false, ...payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not block that date.');
    }
    return res.json();
  },

  deleteMyAvailabilityException: async (exceptionId: string) => {
    const res = await request(`/availability/exceptions/${exceptionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not remove that blocked date.');
    }
    return res.json();
  },

  saveMyAvailabilityRules: async (rules: { day_of_week: number; start_time: string; end_time: string; is_active: boolean }[]) => {
    const res = await request(`/availability/rules`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rules })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not save availability');
    }
    return res.json();
  },

  // Slot Lock
  holdSlot: async (data: { admin_id: string; session_id: string; start_time: string; end_time: string; session_fingerprint: string }) => {
    const res = await request(`/bookings/hold-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Slot could not be reserved');
    }
    return res.json();
  },

  /**
   * The signed-in admin's own bookings, straight from the database that the booking flow
   * writes to. Throws on failure so the page can tell "no bookings yet" apart from
   * "could not load".
   */
  getMyBookings: async (statusFilter?: string) => {
    const query = statusFilter && statusFilter !== 'all'
      ? `?status_filter=${encodeURIComponent(statusFilter)}`
      : '';
    const res = await request(`/bookings/my-bookings${query}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not load your bookings.');
    }
    return res.json();
  },

  cancelMyBooking: async (bookingId: string) => {
    const res = await request(`/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not cancel that booking.');
    }
    return res.json();
  },

  /** A confirmed booking, by its public reference (BK-YYYYMMDD-XXXXXX). */
  getPublicBooking: async (publicId: string) => {
    const res = await request(`/bookings/public/${encodeURIComponent(publicId)}`);
    if (!res.ok) return null;
    return res.json();
  },

  releaseHold: async (lockId: string) => {
    await request(`/bookings/release-hold/${lockId}`, { method: 'POST' });
  },

  // Payments & Booking
  createOrder: async (data: any) => {
    const res = await request(`/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create order');
    }
    return res.json();
  },

  verifyPayment: async (data: { booking_id: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
    const res = await request(`/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Payment verification failed');
    }
    return res.json();
  },

  // Google Calendar
  getGoogleAuthUrl: async () => {
    const res = await request(`/google/auth-url`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not start Google authorization');
    }
    return res.json() as Promise<{ auth_url: string | null; configured?: boolean; message?: string }>;
  },

  getGoogleStatus: async () => {
    const res = await request(`/google/admin/status`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch Google status');
    }
    return res.json();
  },

  connectMockGoogle: async (googleEmail: string) => {
    const res = await request(`/google/admin/connect-mock?google_email=${encodeURIComponent(googleEmail)}`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return res.json();
  },

  disconnectGoogle: async () => {
    const res = await request(`/google/admin/disconnect`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return res.json();
  },

  // Razorpay
  // `probe` asks the backend to check the stored keys against Razorpay. It never changes the
  // stored connection -- the answer is only used to show a "needs attention" hint.
  //
  // This throws on failure rather than returning { configured: false }. Reporting an
  // unreachable API as "not connected" is what made a live Razorpay account look disconnected
  // after a blip; the caller must keep its last known state instead.
  getRazorpayStatus: async (probe = false) => {
    const res = await request(`/payments/admin/status${probe ? '?probe=true' : ''}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch Razorpay status');
    }
    return res.json();
  },

  disconnectRazorpay: async () => {
    const res = await request(`/payments/admin/disconnect`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to disconnect Razorpay');
    }
    return res.json();
  },

  setupRazorpay: async (key_id: string, key_secret: string, account_reference?: string) => {
    const res = await request(`/payments/admin/setup`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ key_id, key_secret, account_reference })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to setup Razorpay');
    }
    return res.json();
  },

  // Sessions & 1v1 Pricing Customization
  getMySessions: async () => {
    const res = await request(`/sessions/`, { headers: getAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  },

  createSession: async (sessionData: any) => {
    const res = await request(`/sessions/`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(sessionData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create session');
    }
    return res.json();
  },

  updateSession: async (sessionId: string, sessionData: any) => {
    const res = await request(`/sessions/${sessionId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(sessionData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update session');
    }
    return res.json();
  },

  deleteSession: async (sessionId: string) => {
    const res = await request(`/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete session');
    }
    return res.json();
  },

  // Super Admin
  superAdminListAdmins: async (search?: string, status_filter?: string) => {
    const q = new URLSearchParams();
    if (search) q.append('search', search);
    if (status_filter && status_filter !== 'all') q.append('status_filter', status_filter);

    const res = await request(`/super-admin/admins?${q.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch admins');
    return res.json();
  },

  superAdminUpdateStatus: async (adminId: string, status: string) => {
    const res = await request(`/super-admin/admins/${adminId}/status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update admin status');
    }
    return res.json();
  },

  superAdminDeleteAdmin: async (adminId: string) => {
    const res = await request(`/super-admin/admins/${adminId}?confirm=true`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete admin');
    }
    return res.json();
  },

  superAdminGetAnalytics: async () => {
    const res = await request(`/super-admin/analytics`, { headers: getAuthHeaders() });
    // Throw rather than return null: an unanswered request is not zero revenue.
    if (!res.ok) throw await failure(res, 'Could not load platform figures.');
    return res.json();
  },

  superAdminGetBookings: async () => {
    const res = await request(`/super-admin/bookings`, { headers: getAuthHeaders() });
    // Throw rather than return []: an unanswered request is not "no bookings".
    if (!res.ok) throw await failure(res, 'Could not load platform bookings.');
    return res.json();
  },

  // Media Upload (Photos & Videos from Device)
  uploadMedia: async (file: File, fileType: 'photo' | 'video' | 'auto' = 'auto'): Promise<{
    success: boolean;
    url: string;
    filename: string;
    saved_as: string;
    type: string;
    size: number;
    /** Bytes received, before server-side optimization. */
    original_size?: number;
    optimized?: boolean;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);

    const token = localStorage.getItem('bmm_auth_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await request(`/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload media file to server');
    }

    return await res.json();
  }
};
