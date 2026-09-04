import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminUser, MeetingType, WeeklyScheduleBlock, Booking, TimeSlot, EmailNotification } from '@/types';
import { format, addDays } from 'date-fns';
import { generateGoogleCalendarUrl } from '@/lib/calendar';

interface BookingStoreState {
  admins: AdminUser[];
  meetingTypes: MeetingType[];
  scheduleBlocks: WeeklyScheduleBlock[];
  bookings: Booking[];
  currentSuperAdmin: AdminUser;

  // Actions for Super Admin
  updateSuperAdminCredentials: (username: string, email: string, password?: string) => void;
  addAdmin: (adminData: {
    full_name: string;
    title: string;
    email: string;
    username: string;
    password?: string;
    avatar_color?: string;
  }) => AdminUser;
  removeAdmin: (id: string) => void;
  updateAdmin: (id: string, updates: Partial<AdminUser>) => void;

  // Meeting types & Per-Admin Pricing
  updateMeetingType: (id: string, updates: Partial<MeetingType>) => void;
  addMeetingType: (newMeeting: Omit<MeetingType, 'id' | 'created_at' | 'updated_at'>) => void;
  removeMeetingType: (id: string) => void;
  getMeetingTypesForAdmin: (adminId: string | null) => MeetingType[];

  // Schedules
  addScheduleBlock: (adminId: string, dayOfWeek: number, startTime: string, endTime: string) => void;
  removeScheduleBlock: (blockId: string) => void;

  // Booking
  createBooking: (bookingData: {
    meetingTypeId: string;
    adminId: string | null; // null means 'Any available'
    startTime: string;
    endTime: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    notes?: string;
    customerTimezone: string;
  }) => Booking;

  getAvailableSlots: (date: Date, meetingTypeId: string, adminId: string | null) => TimeSlot[];

  // Multi-step booking funnel state
  pendingBooking: {
    meetingTypeId: string | null;
    adminId: string | null;
    date: string | null;
    slot: TimeSlot | null;
  };
  setPendingBooking: (data: Partial<{
    meetingTypeId: string | null;
    adminId: string | null;
    date: string | null;
    slot: TimeSlot | null;
  }>) => void;
  // Admin status and profiles
  getAdminByUsername: (username: string) => AdminUser | undefined;
  setAdminStatus: (id: string, status: import('@/types').AdminStatus) => void;
  updateAdminProfile: (id: string, updates: Partial<AdminUser>) => void;
  connectGoogleCalendar: (id: string, email: string) => void;
  disconnectGoogleCalendar: (id: string) => void;
  setupAdminRazorpay: (id: string, keyId: string) => void;

  getBookingById: (id: string) => Booking | undefined;
  emailNotifications: EmailNotification[];
  getEmailNotificationsForBooking: (bookingId: string) => EmailNotification[];
}

// No seeded accounts, sessions, availability or bookings.
//
// This store used to ship four complete admin identities -- names, emails, plaintext
// passwords and fake "Google connected / Razorpay configured" flags -- straight to the
// browser bundle, and public pages fell back to them whenever the API said 404. That made
// deleted or nonexistent admins render as live, bookable profiles. Everything here is now
// empty: the real data comes from the FastAPI backend, and a username the backend does not
// know is a 404, not a demo profile.
const NO_ADMINS: AdminUser[] = [];
const NO_MEETING_TYPES: MeetingType[] = [];
const NO_SCHEDULE_BLOCKS: WeeklyScheduleBlock[] = [];
const NO_BOOKINGS: Booking[] = [];

// Shape-only placeholder for the super admin slot, carrying no identity. It is replaced
// with the real account from GET /api/auth/me as soon as a super admin signs in.
const EMPTY_SUPER_ADMIN: AdminUser = {
  id: '',
  username: '',
  full_name: '',
  title: '',
  role: 'super_admin',
  status: 'ACTIVE',
  avatar_color: 'bg-slate-600',
  avatar_letter: '',
  photo_url: '',
  email: '',
  bio: '',
};


export const useBookingStore = create<BookingStoreState>()(
  persist(
    (set, get) => ({
      admins: NO_ADMINS,
      meetingTypes: NO_MEETING_TYPES,
      scheduleBlocks: NO_SCHEDULE_BLOCKS,
      bookings: NO_BOOKINGS,
      emailNotifications: [],
      currentSuperAdmin: EMPTY_SUPER_ADMIN,
      pendingBooking: {
        meetingTypeId: null,
        adminId: null,
        date: null,
        slot: null,
      },

      updateSuperAdminCredentials: (username, email, password) => {
        set((state) => {
          const updatedSuperAdmin: AdminUser = {
            ...state.currentSuperAdmin,
            username,
            email,
            password: password || state.currentSuperAdmin.password,
          };
          return {
            currentSuperAdmin: updatedSuperAdmin,
            admins: state.admins.map((a) =>
              a.role === 'super_admin' ? updatedSuperAdmin : a
            ),
          };
        });
      },

      addAdmin: (data) => {
        const id = `admin-${Date.now()}`;
        const letter = data.full_name.trim().charAt(0).toUpperCase() || 'A';
        const colors = ['bg-purple-600', 'bg-teal-600', 'bg-rose-500', 'bg-sky-500', 'bg-amber-600'];
        const avatarColor = data.avatar_color || colors[Math.floor(Math.random() * colors.length)];

        const newAdmin: AdminUser = {
          id,
          username: data.username.toLowerCase().replace(/\s+/g, '-'),
          full_name: data.full_name,
          title: data.title,
          email: data.email,
          role: 'admin',
          status: 'ACTIVE',
          avatar_color: avatarColor,
          avatar_letter: letter,
          password: data.password || 'welcome@123',
        };

        set((state) => ({
          admins: [...state.admins, newAdmin],
        }));

        // Give default schedule
        get().addScheduleBlock(id, 1, '09:00', '17:00');
        get().addScheduleBlock(id, 2, '09:00', '17:00');
        get().addScheduleBlock(id, 3, '09:00', '17:00');
        get().addScheduleBlock(id, 4, '09:00', '17:00');
        get().addScheduleBlock(id, 5, '09:00', '17:00');

        // No seeded meeting types. This used to create two sessions priced at 29900 and
        // 59900 paise -- amounts nobody chose, which then sat in localStorage and could be
        // written over the admin's real prices by any save that read from the store.

        return newAdmin;
      },

      removeAdmin: (id) => {
        set((state) => ({
          admins: state.admins.filter((a) => a.id !== id && a.role !== 'super_admin'),
          scheduleBlocks: state.scheduleBlocks.filter((b) => b.admin_id !== id),
          meetingTypes: state.meetingTypes.filter((m) => m.admin_id !== id),
        }));
      },

      updateAdmin: (id, updates) => {
        set((state) => ({
          admins: state.admins.map((a) => (a.id === id ? { ...a, ...updates } : a)),
        }));
      },

      getAdminByUsername: (username: string) => {
        const clean = username.trim().toLowerCase();
        return get().admins.find((a) => a.username.toLowerCase() === clean);
      },

      setAdminStatus: (id: string, status: import('@/types').AdminStatus) => {
        set((state) => ({
          admins: state.admins.map((a) => (a.id === id ? { ...a, status } : a)),
        }));
      },

      updateAdminProfile: (id: string, updates: Partial<AdminUser>) => {
        set((state) => {
          const updatedAdmins = state.admins.map((a) => (a.id === id ? { ...a, ...updates } : a));
          const isSuper = state.currentSuperAdmin.id === id;
          return {
            admins: updatedAdmins,
            currentSuperAdmin: isSuper ? { ...state.currentSuperAdmin, ...updates } : state.currentSuperAdmin,
          };
        });
      },

      connectGoogleCalendar: (id: string, email: string) => {
        set((state) => ({
          admins: state.admins.map((a) =>
            a.id === id ? { ...a, google_connected: true, google_email: email } : a
          ),
        }));
      },

      disconnectGoogleCalendar: (id: string) => {
        set((state) => ({
          admins: state.admins.map((a) =>
            // Clear the address too, so a disconnected admin never shows a stale account.
            a.id === id ? { ...a, google_connected: false, google_email: '' } : a
          ),
        }));
      },

      setupAdminRazorpay: (id: string, keyId: string) => {
        set((state) => ({
          admins: state.admins.map((a) =>
            a.id === id ? { ...a, razorpay_configured: true, razorpay_key_id: keyId } : a
          ),
        }));
      },

      updateMeetingType: (id, updates) => {
        set((state) => ({
          meetingTypes: state.meetingTypes.map((mt) => {
            if (mt.id !== id) return mt;
            const updated = { ...mt, ...updates, updated_at: new Date().toISOString() };
            if (updates.offer_price !== undefined) {
              updated.price = updates.offer_price;
              updated.offer_price = updates.offer_price;
            } else if (updates.price !== undefined) {
              updated.offer_price = updates.price;
            }
            return updated;
          }),
        }));
      },

      addMeetingType: (newMeeting) => {
        const id = `mt-${Date.now()}`;
        // Whatever the caller passed, never a made-up amount: the old defaults here (49900,
        // and an "original price" of offer * 1.5) were prices no admin had ever set.
        const offer = newMeeting.offer_price ?? newMeeting.price ?? 0;
        const fullMeeting: MeetingType = {
          ...newMeeting,
          id,
          price: offer,
          offer_price: offer,
          original_price: newMeeting.original_price ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        set((state) => ({
          meetingTypes: [...state.meetingTypes, fullMeeting],
        }));
      },

      removeMeetingType: (id) => {
        set((state) => ({
          meetingTypes: state.meetingTypes.filter((mt) => mt.id !== id),
        }));
      },

      getMeetingTypesForAdmin: (adminId) => {
        const state = get();
        if (!adminId) {
          return state.meetingTypes;
        }
        // Strictly this admin's own. The old "fall back to the general list" branch returned
        // every admin's meeting types whenever this one had none, so Admin A could be shown
        // Admin B's sessions and prices.
        return state.meetingTypes.filter((m) => m.admin_id === adminId);
      },

      addScheduleBlock: (adminId, dayOfWeek, startTime, endTime) => {
        const newBlock: WeeklyScheduleBlock = {
          id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          admin_id: adminId,
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
          is_active: true,
        };
        set((state) => ({
          scheduleBlocks: [...state.scheduleBlocks, newBlock],
        }));
      },

      removeScheduleBlock: (blockId) => {
        set((state) => ({
          scheduleBlocks: state.scheduleBlocks.filter((b) => b.id !== blockId),
        }));
      },

      createBooking: (data) => {
        const state = get();
        const meeting = state.meetingTypes.find((m) => m.id === data.meetingTypeId);
        
        const reqStart = new Date(data.startTime).getTime();
        const reqEnd = new Date(data.endTime).getTime();

        // 1. Resolve Target Admin: prioritize data.adminId, then meeting.admin_id, then super admin
        let assignedAdmin: AdminUser | undefined;
        if (data.adminId) {
          const reqAdminId = data.adminId;
          assignedAdmin = state.admins.find(
            (a) => a.id === reqAdminId || a.username.toLowerCase() === reqAdminId.toLowerCase()
          );
        }

        if (!assignedAdmin && meeting?.admin_id) {
          const meetingAdminId = meeting.admin_id;
          assignedAdmin = state.admins.find(
            (a) => a.id === meetingAdminId || a.username.toLowerCase() === meetingAdminId.toLowerCase()
          );
        }

        if (!assignedAdmin) {
          // If no specific admin was requested (e.g. platform pooled booking), fall back
          // to the first known admin rather than any hardcoded identity.
          const primaryAdmin = state.admins[0];
          const isPrimaryBusy = state.bookings.some((b) => {
            if (b.status === 'cancelled') return false;
            const isAssigned = b.assigned_admin_id === primaryAdmin.id || b.admin_id === primaryAdmin.id;
            if (!isAssigned) return false;
            const bStart = new Date(b.start_time).getTime();
            const bEnd = new Date(b.end_time).getTime();
            return reqStart < bEnd && reqEnd > bStart;
          });

          if (!isPrimaryBusy) {
            assignedAdmin = primaryAdmin;
          } else {
            const availableOtherAdmins = state.admins.filter((adm) => {
              if (adm.id === primaryAdmin.id) return false;
              const hasConflict = state.bookings.some((b) => {
                if (b.status === 'cancelled') return false;
                const isAssigned = b.assigned_admin_id === adm.id || b.admin_id === adm.id;
                if (!isAssigned) return false;
                const bStart = new Date(b.start_time).getTime();
                const bEnd = new Date(b.end_time).getTime();
                return reqStart < bEnd && reqEnd > bStart;
              });
              return !hasConflict;
            });
            assignedAdmin = availableOtherAdmins.length > 0 ? availableOtherAdmins[0] : primaryAdmin;
          }
        }

        const publicId = `BMM-${Math.floor(1000 + Math.random() * 9000)}`;
        const bookingId = `bk-${Date.now()}`;
        
        // Use https://meet.google.com/new so Google Meet creates an instant active meeting room
        // on launch rather than failing with "No such meeting" on fabricated random codes.
        const googleMeetUrl = 'https://meet.google.com/new';

        // Generate 1-click Google Calendar Web URL (pre-filled with both client and admin as attendees)
        const gCalUrl = generateGoogleCalendarUrl({
          title: `1:1 Session: ${meeting?.name || 'Consultation'} - ${data.customerName} with ${assignedAdmin.full_name}`,
          description: `Appointment: ${meeting?.name || '1-on-1 Consultation'}\nDuration: ${meeting?.duration_minutes || 15} mins\nTopic: ${data.notes || '1:1 Mentorship Session'}\n\nClient: ${data.customerName} (${data.customerEmail})\nHost: ${assignedAdmin.full_name} (${assignedAdmin.email})`,
          location: googleMeetUrl,
          startTime: data.startTime,
          endTime: data.endTime,
          clientName: data.customerName,
          clientEmail: data.customerEmail,
          adminName: assignedAdmin.full_name,
          adminEmail: assignedAdmin.email,
        });

        // Email notifications dispatched to BOTH Client and Admin with meeting link and booked time
        const formattedDate = format(new Date(data.startTime), 'EEEE, MMMM d, yyyy');
        const formattedTime = `${format(new Date(data.startTime), 'h:mm a')} – ${format(new Date(data.endTime), 'h:mm a')} (${data.customerTimezone || 'IST'})`;

        const clientNotification: EmailNotification = {
          id: `email-client-${Date.now()}`,
          booking_id: bookingId,
          recipient_type: 'client',
          recipient_email: data.customerEmail,
          recipient_name: data.customerName,
          subject: `Booking Confirmed: ${meeting?.name || 'Consultation'} with ${assignedAdmin.full_name}`,
          meet_url: googleMeetUrl,
          google_calendar_url: gCalUrl,
          booked_time: data.startTime,
          formatted_time: `${formattedDate} at ${formattedTime}`,
          sent_at: new Date().toISOString(),
          status: 'delivered',
        };

        const adminNotification: EmailNotification = {
          id: `email-admin-${Date.now()}`,
          booking_id: bookingId,
          recipient_type: 'admin',
          recipient_email: assignedAdmin.email,
          recipient_name: assignedAdmin.full_name,
          subject: `New Paid Booking Alert: ${data.customerName} - ${meeting?.name || 'Consultation'}`,
          meet_url: googleMeetUrl,
          google_calendar_url: gCalUrl,
          booked_time: data.startTime,
          formatted_time: `${formattedDate} at ${formattedTime}`,
          sent_at: new Date().toISOString(),
          status: 'delivered',
        };

        const newBooking: Booking = {
          id: bookingId,
          public_id: publicId,
          admin_id: assignedAdmin.id,
          assigned_admin_id: assignedAdmin.id,
          assigned_admin_name: assignedAdmin.full_name,
          assigned_admin_email: assignedAdmin.email,
          customer_id: `cust-${Date.now()}`,
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone,
          meeting_type_id: data.meetingTypeId,
          meeting_type_name: meeting?.name || 'Consultation Session',
          start_time: data.startTime,
          end_time: data.endTime,
          customer_timezone: data.customerTimezone,
          status: 'confirmed',
          payment_status: 'completed',
          calendar_status: 'created',
          google_calendar_event_id: `cal-${Date.now()}`,
          google_meet_url: googleMeetUrl,
          google_calendar_url: gCalUrl,
          notifications_sent: {
            client_email: data.customerEmail,
            admin_email: assignedAdmin.email,
            sent_at: new Date().toISOString(),
            meet_url: googleMeetUrl,
          },
          cancellation_token: `cancel-${Date.now()}`,
          reschedule_token: `resched-${Date.now()}`,
          cancelled_at: null,
          cancellation_reason: null,
          calendar_retry_count: 0,
          question_answers: null,
          notes: data.notes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          customer: {
            id: `cust-${Date.now()}`,
            name: data.customerName,
            email: data.customerEmail,
            phone: data.customerPhone,
            created_at: new Date().toISOString(),
          },
          meeting_type: meeting,
        };

        set((s) => ({
          bookings: [newBooking, ...s.bookings],
          emailNotifications: [clientNotification, adminNotification, ...(s.emailNotifications || [])],
        }));

        return newBooking;
      },

      getAvailableSlots: (date, meetingTypeId, adminId) => {
        const state = get();
        const meeting = state.meetingTypes.find((m) => m.id === meetingTypeId);
        const duration = meeting?.duration_minutes || 15;
        const dayOfWeek = date.getDay(); // 0=Sun..6=Sat

        let blocks = state.scheduleBlocks.filter(
          (b) => b.day_of_week === dayOfWeek && b.is_active
        );

        if (adminId) {
          const specific = blocks.filter((b) => b.admin_id === adminId);
          if (specific.length > 0) {
            blocks = specific;
          }
        }

        if (blocks.length === 0) {
          blocks = [
            { id: 'fb-1', admin_id: adminId || 'default', day_of_week: dayOfWeek, start_time: '09:00', end_time: '18:00', is_active: true }
          ];
        }

        const candidateSlots: { start: string; end: string; admin_id: string; slotDate: Date; endDate: Date }[] = [];

        blocks.forEach((block) => {
          const [startHour, startMin] = block.start_time.split(':').map(Number);
          const [endHour, endMin] = block.end_time.split(':').map(Number);

          const blockStartMinutes = startHour * 60 + startMin;
          const blockEndMinutes = endHour * 60 + endMin;

          for (let mins = blockStartMinutes; mins + duration <= blockEndMinutes; mins += 15) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;

            // Only allow :00 and :30 minute slots (exclude :15 and :45)
            if (m !== 0 && m !== 30) {
              continue;
            }

            const slotDate = new Date(date);
            slotDate.setHours(h, m, 0, 0);

            const endDate = new Date(slotDate.getTime() + duration * 60000);
            
            candidateSlots.push({
              start: slotDate.toISOString(),
              end: endDate.toISOString(),
              admin_id: block.admin_id,
              slotDate,
              endDate,
            });
          }
        });

        // Filter out slots that collide with already booked appointments for that admin
        const activeBookings = state.bookings.filter((b) => b.status !== 'cancelled');

        const availableSlots: TimeSlot[] = [];
        const addedStartTimes = new Set<string>();

        candidateSlots.forEach((slot) => {
          const slotStartMs = slot.slotDate.getTime();
          const slotEndMs = slot.endDate.getTime();

          if (adminId) {
            // Check if this specific admin is already in a session during this slot
            const isBooked = activeBookings.some((b) => {
              const matchesAdmin = b.assigned_admin_id === adminId || b.admin_id === adminId;
              if (!matchesAdmin) return false;
              const bStartMs = new Date(b.start_time).getTime();
              const bEndMs = new Date(b.end_time).getTime();
              // Overlap check: slotStart < bEnd && slotEnd > bStart
              return slotStartMs < bEndMs && slotEndMs > bStartMs;
            });

            if (!isBooked && !addedStartTimes.has(slot.start)) {
              addedStartTimes.add(slot.start);
              availableSlots.push({
                start: slot.start,
                end: slot.end,
                display_start: format(slot.slotDate, 'h:mm a'),
                display_end: format(slot.endDate, 'h:mm a'),
              });
            }
          } else {
            // Any available: slot is valid if AT LEAST ONE admin is free and working
            const workingAdminIds = Array.from(
              new Set(
                blocks
                  .filter((b) => b.admin_id !== 'default')
                  .map((b) => b.admin_id)
              )
            );

            const targetAdmins = workingAdminIds.length > 0 ? workingAdminIds : state.admins.map((a) => a.id);

            const hasFreeAdmin = targetAdmins.some((tAdminId) => {
              const isOccupied = activeBookings.some((b) => {
                const matches = b.assigned_admin_id === tAdminId || b.admin_id === tAdminId;
                if (!matches) return false;
                const bStartMs = new Date(b.start_time).getTime();
                const bEndMs = new Date(b.end_time).getTime();
                return slotStartMs < bEndMs && slotEndMs > bStartMs;
              });
              return !isOccupied;
            });

            if (hasFreeAdmin && !addedStartTimes.has(slot.start)) {
              addedStartTimes.add(slot.start);
              availableSlots.push({
                start: slot.start,
                end: slot.end,
                display_start: format(slot.slotDate, 'h:mm a'),
                display_end: format(slot.endDate, 'h:mm a'),
              });
            }
          }
        });

        availableSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        return availableSlots;
      },

      setPendingBooking: (data) => {
        set((state) => ({
          pendingBooking: {
            ...state.pendingBooking,
            ...data,
          },
        }));
      },

      getBookingById: (id) => {
        const state = get();
        return state.bookings.find((b) => b.id === id || b.public_id === id);
      },

      getEmailNotificationsForBooking: (bookingId) => {
        const state = get();
        return (state.emailNotifications || []).filter((n) => n.booking_id === bookingId);
      },
    }),
    {
      // v4: the key change is deliberate. Browsers that still hold the v3 payload have the
      // four seeded demo admins (with plaintext passwords) in localStorage; starting from a
      // new key drops that data instead of rehydrating it.
      name: 'bookmymeet-platform-state-v4',
    }
  )
);
