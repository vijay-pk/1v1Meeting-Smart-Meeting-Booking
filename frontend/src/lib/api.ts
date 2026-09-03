const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('bmm_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
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
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username_or_email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('bmm_auth_token', data.access_token);
    localStorage.setItem('bmm_current_user_role', data.role);
    localStorage.setItem('bmm_logged_admin_id', data.user_id);
    if (data.username) localStorage.setItem('bmm_logged_username', data.username);
    if (data.name) localStorage.setItem('bmm_logged_admin_name', data.name);
    return data;
  },

  signup: async (data: { name: string; email: string; password: string; phone?: string; username: string }) => {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Signup failed');
    }
    const resData = await res.json();
    localStorage.setItem('bmm_auth_token', resData.access_token);
    localStorage.setItem('bmm_current_user_role', resData.role);
    localStorage.setItem('bmm_logged_admin_id', resData.user_id);
    if (resData.username) localStorage.setItem('bmm_logged_username', resData.username);
    if (resData.name) localStorage.setItem('bmm_logged_admin_name', resData.name);
    return resData;
  },

  // --- Google sign-in (Supabase runs the OAuth dance, the backend owns the account) ---

  // First leg. Returns either status:"authenticated" with a token, or
  // status:"registration_required" with a suggested username for a new Google user.
  googleAuth: async (supabaseAccessToken: string) => {
    const res = await fetch(`${API_BASE}/auth/google`, {
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
    const res = await fetch(`${API_BASE}/auth/google/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_access_token: supabaseAccessToken, username, phone })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Could not create your account');
    persistSession(data);
    return data;
  },

  checkUsername: async (username: string) => {
    const res = await fetch(`${API_BASE}/auth/username-available?username=${encodeURIComponent(username)}`);
    if (!res.ok) return { username, available: false, reason: 'Could not check availability right now.' };
    return res.json();
  },

  getMe: async () => {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  // Public Profiles
  getMyProfile: async () => {
    const res = await fetch(`${API_BASE}/profiles/me`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  getPublicProfile: async (username: string) => {
    const res = await fetch(`${API_BASE}/profiles/public/${encodeURIComponent(username)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Profile not found');
    }
    return res.json();
  },

  updateMyProfile: async (updates: any) => {
    const res = await fetch(`${API_BASE}/profiles/me`, {
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

  // --- Import from SuperProfile -------------------------------------------------------
  // Two steps on purpose: preview parses the public page into a pending import row and
  // returns it for review; apply writes only what the admin selected, to their own records.
  // pageHtml is the supported fallback when SuperProfile refuses an automated request:
  // the page owner opens their own page, copies the source, and pastes it here.
  importPreview: async (sourceUrl: string, pageHtml?: string) => {
    const res = await fetch(`${API_BASE}/profile-import/preview`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_url: sourceUrl, page_html: pageHtml || null }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Unable to access this public page.');
    }
    return res.json();
  },

  importApply: async (payload: {
    import_id: string;
    mode: 'add' | 'replace' | 'sessions_only' | 'profile_only';
    profile_fields?: string[];
    sessions?: Array<{
      index: number;
      action: 'create' | 'update' | 'skip';
      target_session_id?: string | null;
      title?: string;
      description?: string;
      duration_minutes?: number | null;
      price?: number | null;
      currency?: string;
    }>;
    import_image?: boolean;
    image_permission_confirmed?: boolean;
    confirm_replace?: boolean;
  }) => {
    const res = await fetch(`${API_BASE}/profile-import/apply`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'The import could not be applied.');
    }
    return res.json();
  },

  importCancel: async (importId: string) => {
    const res = await fetch(`${API_BASE}/profile-import/${importId}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  },

  getImport: async (importId: string) => {
    const res = await fetch(`${API_BASE}/profile-import/${importId}`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },
  // Availability & Slots
  getAvailableSlots: async (params: { admin_id?: string; username?: string; session_id: string; date_str: string }) => {
    const query = new URLSearchParams();
    if (params.admin_id) query.append('admin_id', params.admin_id);
    if (params.username) query.append('username', params.username);
    query.append('session_id', params.session_id);
    query.append('date_str', params.date_str);

    // Errors are reported, not swallowed: "the backend is down" and "this day is full"
    // must not look identical to the booking UI.
    try {
      const res = await fetch(`${API_BASE}/availability/slots?${query.toString()}`);
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
    const res = await fetch(`${API_BASE}/availability/rules`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not load your availability.');
    }
    return res.json();
  },

  getMyAvailabilityExceptions: async () => {
    const res = await fetch(`${API_BASE}/availability/exceptions`, { headers: getAuthHeaders() });
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
    const res = await fetch(`${API_BASE}/availability/exceptions`, {
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
    const res = await fetch(`${API_BASE}/availability/exceptions/${exceptionId}`, {
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
    const res = await fetch(`${API_BASE}/availability/rules`, {
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
    const res = await fetch(`${API_BASE}/bookings/hold-slot`, {
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
    const res = await fetch(`${API_BASE}/bookings/my-bookings${query}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not load your bookings.');
    }
    return res.json();
  },

  cancelMyBooking: async (bookingId: string) => {
    const res = await fetch(`${API_BASE}/bookings/${encodeURIComponent(bookingId)}/cancel`, {
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
    const res = await fetch(`${API_BASE}/bookings/public/${encodeURIComponent(publicId)}`);
    if (!res.ok) return null;
    return res.json();
  },

  releaseHold: async (lockId: string) => {
    await fetch(`${API_BASE}/bookings/release-hold/${lockId}`, { method: 'POST' });
  },

  // Payments & Booking
  createOrder: async (data: any) => {
    const res = await fetch(`${API_BASE}/payments/create-order`, {
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
    const res = await fetch(`${API_BASE}/payments/verify`, {
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
    const res = await fetch(`${API_BASE}/google/auth-url`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not start Google authorization');
    }
    return res.json() as Promise<{ auth_url: string | null; configured?: boolean; message?: string }>;
  },

  getGoogleStatus: async () => {
    const res = await fetch(`${API_BASE}/google/admin/status`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch Google status');
    }
    return res.json();
  },

  connectMockGoogle: async (googleEmail: string) => {
    const res = await fetch(`${API_BASE}/google/admin/connect-mock?google_email=${encodeURIComponent(googleEmail)}`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return res.json();
  },

  disconnectGoogle: async () => {
    const res = await fetch(`${API_BASE}/google/admin/disconnect`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return res.json();
  },

  // Razorpay
  getRazorpayStatus: async () => {
    const res = await fetch(`${API_BASE}/payments/admin/status`, { headers: getAuthHeaders() });
    if (!res.ok) return { configured: false };
    return res.json();
  },

  setupRazorpay: async (key_id: string, key_secret: string, account_reference?: string) => {
    const res = await fetch(`${API_BASE}/payments/admin/setup`, {
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
    const res = await fetch(`${API_BASE}/sessions/`, { headers: getAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  },

  createSession: async (sessionData: any) => {
    const res = await fetch(`${API_BASE}/sessions/`, {
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
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
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
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
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

    const res = await fetch(`${API_BASE}/super-admin/admins?${q.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch admins');
    return res.json();
  },

  superAdminUpdateStatus: async (adminId: string, status: string) => {
    const res = await fetch(`${API_BASE}/super-admin/admins/${adminId}/status`, {
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
    const res = await fetch(`${API_BASE}/super-admin/admins/${adminId}?confirm=true`, {
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
    const res = await fetch(`${API_BASE}/super-admin/analytics`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  superAdminGetBookings: async () => {
    const res = await fetch(`${API_BASE}/super-admin/bookings`, { headers: getAuthHeaders() });
    if (!res.ok) return [];
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
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);

    const token = localStorage.getItem('bmm_auth_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/upload`, {
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
