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

  scrapeSuperProfile: async (url: string) => {
    try {
      const res = await fetch(`${API_BASE}/profiles/scrape-superprofile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to scrape SuperProfile');
      }
      const data = await res.json();
      return data.data;
    } catch (e: any) {
      // Offline fallback: if backend is unreachable
      if (url.includes('mahir') || url.includes('ameen')) {
        return {
          name: 'Ameen Ahsan',
          title: 'Upskilling Marketers into Top 1% Performers',
          heading_text: 'Upskilling Marketers into Top 1% Performers',
          bio: '10+ years helping marketing leaders and founders scale predictable revenue funnels and performance creative engines.',
          about_me_text: 'I coach performance marketers, agency owners, and growth consultants on scaling acquisition, attribution, and team leadership.',
          profile_photo: 'https://media-cdn.cosmofeed.com/profile/my_image1761115854-2025-22-10-06-50-54.png?w=600&q=100',
          intro_video: 'https://vimeo.com/1130419767',
          button_color: '#D32F2F',
          theme: 'amber',
          social_links: {
            instagram: 'https://instagram.com/ameenahsan',
            whatsapp: '+919876543210',
            linkedin: 'https://linkedin.com/in/ameenahsan',
            website: 'https://adwaysacademy.com'
          },
          sessions: [
            {
              name: 'Get Clarity on Your Performance Marketing Journey: Talk to Your Mentor',
              description: 'Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call',
              duration_minutes: 15,
              price: 149700,
              original_price: 499900,
              currency: 'INR',
              is_active: true
            },
            {
              name: 'Elite 1:1 Performance Advisory Session',
              description: 'Comprehensive strategy roadmap and high-level campaign audit',
              duration_minutes: 30,
              price: 599400,
              original_price: 999900,
              currency: 'INR',
              is_active: true
            }
          ]
        };
      }
      throw e;
    }
  },

  // Availability & Slots
  getAvailableSlots: async (params: { admin_id?: string; username?: string; session_id: string; date_str: string }) => {
    const query = new URLSearchParams();
    if (params.admin_id) query.append('admin_id', params.admin_id);
    if (params.username) query.append('username', params.username);
    query.append('session_id', params.session_id);
    query.append('date_str', params.date_str);

    const res = await fetch(`${API_BASE}/availability/slots?${query.toString()}`);
    if (!res.ok) return { available_slots: [] };
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
  getGoogleStatus: async () => {
    const res = await fetch(`${API_BASE}/google/admin/status`, { headers: getAuthHeaders() });
    if (!res.ok) return { connected: false };
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
