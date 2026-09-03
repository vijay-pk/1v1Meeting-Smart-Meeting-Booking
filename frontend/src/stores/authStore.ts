import { create } from 'zustand';
import type { Profile, UserRole } from '@/types';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;

  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, username: string) => Promise<void>;
  signOut: () => Promise<void>;
  fetchProfile: (userId: string) => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: false,
  initialized: true,

  initialize: async () => {
    // 1. Instant sync from active local admin session
    try {
      const loggedId = localStorage.getItem('bmm_logged_admin_id');
      const loggedUsername = localStorage.getItem('bmm_logged_username');
      const role = (localStorage.getItem('bmm_current_user_role') as UserRole) || 'admin';

      if (loggedId || loggedUsername) {
        const loggedName = localStorage.getItem('bmm_logged_admin_name');
        let name = loggedName || 'Admin';
        let username = loggedUsername || loggedId || 'admin';
        let photo_url: string | null = null;
        let bio: string | null = null;

        try {
          const raw = localStorage.getItem('bmm_booking_store_v1');
          if (raw) {
            const parsed = JSON.parse(raw);
            const matched = parsed.state?.admins?.find(
              (a: any) =>
                (loggedId && a.id === loggedId) ||
                (loggedUsername && a.username?.toLowerCase() === loggedUsername.toLowerCase())
            );
            if (matched) {
              name = matched.full_name || name;
              username = matched.username || username;
              photo_url = matched.photo_url || null;
              bio = matched.bio || null;
            }
          }
        } catch (e) {}

        const effectiveId = loggedId || `admin-${username}`;

        const localUser: any = {
          id: effectiveId,
          email: '',
          user_metadata: { full_name: name, username }
        };

        const localProfile: Profile = {
          id: effectiveId,
          username,
          full_name: name,
          bio,
          photo_url,
          role,
          timezone: 'Asia/Kolkata',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        set({
          user: localUser,
          profile: localProfile,
          loading: false,
          initialized: true,
        });

        // Background sync with live profile from backend
        import('@/lib/api').then(({ api }) => {
          api.getMyProfile().then((bp) => {
            if (bp) {
              set({
                profile: {
                  id: bp.user_id,
                  username: bp.username,
                  full_name: bp.name,
                  email: bp.email,
                  bio: bp.bio,
                  photo_url: bp.profile_photo,
                  role: (bp.role as UserRole) || role,
                  timezone: 'Asia/Kolkata',
                  is_active: bp.status === 'ACTIVE',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              });
            }
          }).catch(() => {});
        });
      }
    } catch (e) {}

    // 2. Non-blocking Supabase auth check with 600ms timeout
    try {
      const timeoutPromise = new Promise<any>((res) => setTimeout(() => res({ data: { session: null } }), 600));
      const sessionPromise = supabase.auth.getSession();
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);

      if (session?.user) {
        set({ user: session.user, session, loading: false, initialized: true });
        get().fetchProfile(session.user.id).catch(() => {});
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          set({ user: session.user, session });
          get().fetchProfile(session.user.id).catch(() => {});
        }
      });
    } catch (error) {
      // Offline fallback already active
    } finally {
      set({ loading: false, initialized: true });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false });
      throw error;
    }
    set({ loading: false });
  },

  signUp: async (email: string, password: string, fullName: string, username: string) => {
    set({ loading: true });
    try {
      // Check username availability
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username.toLowerCase())
        .single();

      if (existingProfile) {
        throw new Error('Username is already taken');
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username: username.toLowerCase(),
          },
        },
      });

      if (error) throw error;

      // Create profile
      if (data.user) {
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id,
          username: username.toLowerCase(),
          full_name: fullName,
          role: 'admin',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
          is_active: true,
        });

        if (profileError) throw profileError;

        // Create default admin settings
        await supabase.from('admin_settings').insert({
          admin_id: data.user.id,
          min_advance_notice_hours: 2,
          max_booking_horizon_days: 60,
          default_buffer_minutes: 0,
        });

        // Create default availability rules (Mon-Fri 10am-6pm)
        const defaultRules = [1, 2, 3, 4, 5].map((day) => ({
          admin_id: data.user!.id,
          day_of_week: day,
          start_time: '10:00:00',
          end_time: '18:00:00',
          is_active: true,
        }));
        await supabase.from('availability_rules').insert(defaultRules);
      }
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {}
    localStorage.removeItem('bmm_current_user_role');
    localStorage.removeItem('bmm_logged_role');
    localStorage.removeItem('bmm_logged_admin_id');
    localStorage.removeItem('bmm_logged_username');
    localStorage.removeItem('bmm_logged_admin_name');
    localStorage.removeItem('token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('bmm_auth_token');
    localStorage.removeItem('bmm_auth_user');
    sessionStorage.clear();
    set({ user: null, session: null, profile: null });
    window.location.href = '/signup';
  },

  fetchProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return;
    }

    set({ profile: data as Profile });
  },

  updateProfile: async (updates: Partial<Profile>) => {
    const { user } = get();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (error) throw error;

    set((state) => ({
      profile: state.profile ? { ...state.profile, ...updates } : null,
    }));
  },
}));
