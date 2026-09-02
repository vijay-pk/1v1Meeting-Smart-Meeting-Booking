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

const DEFAULT_ADMINS: AdminUser[] = [
  {
    id: 'ameen-ahsan',
    username: 'ameen',
    full_name: 'Ameen Ahsan',
    title: 'CEO of Adways Academy',
    role: 'super_admin',
    status: 'ACTIVE',
    avatar_color: 'bg-indigo-600',
    avatar_letter: 'A',
    photo_url: '/assets/mahir.png',
    cover_image: '',
    intro_video: 'https://vimeo.com/1130419767',
    heading_text: 'Upskilling Marketers into Top 1% Performers',
    about_me_text: 'Ameen Ahsan has coached over 10,000 performance marketers and founders to scale past ₹5 Cr+ in ad revenue.',
    welcome_message: 'Choose your session below to schedule your 1:1 call with Ameen Ahsan.',
    bio: 'CEO & Lead Strategist at Adways Academy. 10,000+ Students Mentored | ₹5 Cr+ Ad Spend Managed | 3.8x Avg ROAS Improvement.',
    email: 'mahir@adwaysacademy.com',
    phone: '+919876543210',
    password: 'admin123',
    theme_settings: {
      theme: 'amber',
      bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]',
      button_color: '#D32F2F',
      button_text_color: '#FFFFFF',
      card_style: 'rounded',
      show_video: true,
      show_stats: true,
      show_socials: true,
    },
    social_links: {
      instagram: 'https://instagram.com/ameenahsan',
      whatsapp: '+919876543210',
      linkedin: 'https://linkedin.com/in/ameenahsan',
      youtube: 'https://youtube.com/@adwaysacademy',
      website: 'https://adwaysacademy.com',
    },
    google_connected: true,
    google_email: 'mahir@adwaysacademy.com',
    razorpay_configured: true,
    razorpay_key_id: 'rzp_test_ameen_123456',
  },
  {
    id: 'admin-a',
    username: 'alex',
    full_name: 'Alex Rivera',
    title: 'Senior Technical Consultant',
    role: 'admin',
    status: 'ACTIVE',
    avatar_color: 'bg-amber-500',
    avatar_letter: 'A',
    photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&crop=face',
    cover_image: '',
    intro_video: 'https://vimeo.com/1130419767',
    heading_text: 'Technical Architecture & Conversion Tracking Audit',
    about_me_text: 'Senior tech consultant specializing in Conversions API, server-side Google Tag Manager, and full stack performance.',
    welcome_message: 'Select a time slot to diagnose your tracking setup or API integrations.',
    bio: 'Senior Technical Consultant & Ad Tracking Architect with 8+ years resolving attribution drop-offs.',
    email: 'alex@adwaysacademy.com',
    phone: '+919876500001',
    password: 'alex@123',
    theme_settings: {
      theme: 'amber',
      bg_gradient: 'from-[#78350f] via-[#b45309] to-[#451a03]',
      button_color: '#d97706',
      button_text_color: '#FFFFFF',
      show_video: true,
      show_stats: true,
      show_socials: true,
    },
    social_links: {
      linkedin: 'https://linkedin.com/in/alexrivera',
      whatsapp: '+919876500001',
      website: 'https://adwaysacademy.com',
    },
    google_connected: true,
    google_email: 'alex@adwaysacademy.com',
    razorpay_configured: true,
    razorpay_key_id: 'rzp_test_alex_987654',
  },
  {
    id: 'admin-b',
    username: 'priya',
    full_name: 'Priya Sharma',
    title: 'Product & Growth Strategist',
    role: 'admin',
    status: 'ACTIVE',
    avatar_color: 'bg-blue-500',
    avatar_letter: 'P',
    photo_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&crop=face',
    cover_image: '',
    intro_video: '',
    heading_text: '1:1 Growth Architecture & Retention Strategy',
    about_me_text: 'Helped 30+ startups and D2C brands scale customer lifetime value and optimize activation funnels.',
    welcome_message: 'Schedule a session to scale your product growth.',
    bio: 'Product & Growth Strategist specializing in retention loops and conversion rate optimization.',
    email: 'priya@adwaysacademy.com',
    phone: '+919876500002',
    password: 'priya@123',
    theme_settings: {
      theme: 'indigo',
      bg_gradient: 'from-[#1e1b4b] via-[#3730a3] to-[#0f172a]',
      button_color: '#4f46e5',
      button_text_color: '#FFFFFF',
      show_video: false,
      show_stats: true,
      show_socials: true,
    },
    social_links: {
      linkedin: 'https://linkedin.com/in/priyasharma',
      instagram: 'https://instagram.com/priya_growth',
      whatsapp: '+919876500002',
    },
    google_connected: true,
    google_email: 'priya@adwaysacademy.com',
    razorpay_configured: true,
    razorpay_key_id: 'rzp_test_priya_555444',
  },
  {
    id: 'admin-c',
    username: 'david',
    full_name: 'David Chen',
    title: 'Marketing & Automation Lead',
    role: 'admin',
    status: 'ACTIVE',
    avatar_color: 'bg-emerald-500',
    avatar_letter: 'D',
    photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face',
    cover_image: '',
    intro_video: '',
    heading_text: 'Automate & Scale Your Lead Funnels with David',
    about_me_text: 'Specialist in Zapier, Make, CRM pipelines, and automated WhatsApp nurturing funnels.',
    welcome_message: 'Book a session to automate your manual sales workflows.',
    bio: 'Marketing & Automation Lead focused on CRM integration and multi-channel drip automation.',
    email: 'david@adwaysacademy.com',
    phone: '+919876500003',
    password: 'david@123',
    theme_settings: {
      theme: 'emerald',
      bg_gradient: 'from-[#064e3b] via-[#047857] to-[#022c22]',
      button_color: '#059669',
      button_text_color: '#FFFFFF',
      show_video: false,
      show_stats: true,
      show_socials: true,
    },
    social_links: {
      linkedin: 'https://linkedin.com/in/davidchen',
      whatsapp: '+919876500003',
    },
    google_connected: false,
    google_email: '',
    razorpay_configured: true,
    razorpay_key_id: 'rzp_test_david_333222',
  },
];

const DEFAULT_MEETING_TYPES: MeetingType[] = [
  // Ameen Ahsan (CEO / Super Admin) Pricing matching superprofile.bio/bookings/mahir6787
  {
    id: 'mt-clarity-15',
    admin_id: 'ameen-ahsan',
    name: 'Get Clarity on Your Performance Marketing Journey: Talk to Your Mentor',
    description: 'Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call',
    duration_minutes: 15,
    price: 149700, // ₹1,497
    original_price: 499900, // ₹4,999 (70% OFF)
    offer_price: 149700,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    min_advance_hours: 1,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 12,
    color_id: 1,
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-elite-30',
    admin_id: 'ameen-ahsan',
    name: 'Elite 1:1 Performance Marketing Advisory Session',
    description: 'Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call',
    duration_minutes: 30,
    price: 599400, // ₹5,994
    original_price: 999900, // ₹9,999 (40% OFF)
    offer_price: 599400,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 8,
    color_id: 2,
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-founder-60',
    admin_id: 'ameen-ahsan',
    name: 'Founder-Level 1:1 Revenue Scaling Intensive',
    description: 'Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call',
    duration_minutes: 60,
    price: 1975000, // ₹19,750
    original_price: 2499900, // ₹24,999
    offer_price: 1975000,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 10,
    buffer_after_minutes: 15,
    min_advance_hours: 4,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 4,
    color_id: 3,
    sort_order: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-audit-45',
    admin_id: 'ameen-ahsan',
    name: 'Comprehensive Meta Ads & Funnel Growth Audit',
    description: 'Deep dive audit into your Facebook/Instagram ad accounts, tracking architecture, and funnel drop-offs with Ameen Ahsan.',
    duration_minutes: 45,
    price: 399900, // ₹3,999
    original_price: 799900, // ₹7,999 (50% OFF)
    offer_price: 399900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 10,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 6,
    color_id: 4,
    sort_order: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-creative-30',
    admin_id: 'ameen-ahsan',
    name: 'High-ROAS Creative Strategy & Hook Architecture',
    description: 'Unlock viral performance hooks, ad creative scripting, and rapid iteration frameworks to scale past ₹10L/day.',
    duration_minutes: 30,
    price: 349900, // ₹3,499
    original_price: 599900, // ₹5,999 (42% OFF)
    offer_price: 349900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 6,
    color_id: 5,
    sort_order: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  // Admin A (Alex - Senior Technical Consultant) Pricing
  {
    id: 'mt-alex-1',
    admin_id: 'admin-a',
    name: 'Quick Tech Sync',
    description: '15-minute quick technical review and API/tracking debugging with Alex.',
    duration_minutes: 15,
    price: 24900, // ₹249
    original_price: 49900, // ₹499
    offer_price: 24900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    min_advance_hours: 1,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 8,
    color_id: 1,
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-alex-2',
    admin_id: 'admin-a',
    name: 'Technical Architecture Audit',
    description: '30-minute technical roadmap & conversion tracking review with Alex.',
    duration_minutes: 30,
    price: 49900, // ₹499
    original_price: 99900, // ₹999
    offer_price: 49900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 6,
    color_id: 2,
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-alex-3',
    admin_id: 'admin-a',
    name: 'Full Stack Optimization Session',
    description: '60-minute in-depth tech and infrastructure optimization.',
    duration_minutes: 60,
    price: 99900, // ₹999
    original_price: 199900, // ₹1,999
    offer_price: 99900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 10,
    buffer_after_minutes: 15,
    min_advance_hours: 4,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 4,
    color_id: 3,
    sort_order: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  // Admin B (Priya - Product & Growth Strategist) Pricing
  {
    id: 'mt-priya-1',
    admin_id: 'admin-b',
    name: 'Quick Growth Sync',
    description: '15-minute quick conversion rate check with Priya.',
    duration_minutes: 15,
    price: 29900, // ₹299
    original_price: 49900, // ₹499
    offer_price: 29900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    min_advance_hours: 1,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 8,
    color_id: 1,
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-priya-2',
    admin_id: 'admin-b',
    name: 'Funnel & Retention Strategy',
    description: '30-minute deep funnel optimization session with Priya.',
    duration_minutes: 30,
    price: 59900, // ₹599
    original_price: 119900, // ₹1,199
    offer_price: 59900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 6,
    color_id: 2,
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  // Admin C (David - Marketing & Automation Lead) Pricing
  {
    id: 'mt-david-1',
    admin_id: 'admin-c',
    name: 'Ad Account Health Check',
    description: '15-minute quick audit of ad setup and bidding structure with David.',
    duration_minutes: 15,
    price: 19900, // ₹199
    original_price: 39900, // ₹399
    offer_price: 19900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    min_advance_hours: 1,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 8,
    color_id: 1,
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'mt-david-2',
    admin_id: 'admin-c',
    name: 'Campaign Automation Consultation',
    description: '30-minute ad automation blueprint & ROAS scaling session with David.',
    duration_minutes: 30,
    price: 39900, // ₹399
    original_price: 79900, // ₹799
    offer_price: 39900,
    currency: 'INR',
    is_active: true,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    min_advance_hours: 2,
    max_advance_days: 30,
    cancellation_window_hours: 24,
    reschedule_allowed: true,
    max_bookings_per_day: 6,
    color_id: 2,
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEFAULT_SCHEDULE_BLOCKS: WeeklyScheduleBlock[] = [
  // Admin A Schedule
  { id: 'b-a-1', admin_id: 'admin-a', day_of_week: 1, start_time: '09:00', end_time: '12:00', is_active: true },
  { id: 'b-a-2', admin_id: 'admin-a', day_of_week: 1, start_time: '14:00', end_time: '18:00', is_active: true },
  { id: 'b-a-3', admin_id: 'admin-a', day_of_week: 2, start_time: '10:00', end_time: '16:00', is_active: true },
  { id: 'b-a-4', admin_id: 'admin-a', day_of_week: 4, start_time: '09:00', end_time: '15:00', is_active: true },
  { id: 'b-a-5', admin_id: 'admin-a', day_of_week: 5, start_time: '10:00', end_time: '17:00', is_active: true },

  // Admin B Schedule
  { id: 'b-b-1', admin_id: 'admin-b', day_of_week: 1, start_time: '10:00', end_time: '17:00', is_active: true },
  { id: 'b-b-2', admin_id: 'admin-b', day_of_week: 3, start_time: '09:00', end_time: '14:00', is_active: true },
  { id: 'b-b-3', admin_id: 'admin-b', day_of_week: 4, start_time: '13:00', end_time: '18:00', is_active: true },
  { id: 'b-b-4', admin_id: 'admin-b', day_of_week: 5, start_time: '09:00', end_time: '16:00', is_active: true },

  // Admin C Schedule
  { id: 'b-c-1', admin_id: 'admin-c', day_of_week: 2, start_time: '09:00', end_time: '17:00', is_active: true },
  { id: 'b-c-2', admin_id: 'admin-c', day_of_week: 3, start_time: '10:00', end_time: '18:00', is_active: true },
  { id: 'b-c-3', admin_id: 'admin-c', day_of_week: 5, start_time: '10:00', end_time: '15:00', is_active: true },
  { id: 'b-c-4', admin_id: 'admin-c', day_of_week: 6, start_time: '11:00', end_time: '15:00', is_active: true },

  // Ameen Ahsan (Super Admin) Schedule
  { id: 'b-m-1', admin_id: 'ameen-ahsan', day_of_week: 1, start_time: '09:00', end_time: '18:00', is_active: true },
  { id: 'b-m-2', admin_id: 'ameen-ahsan', day_of_week: 2, start_time: '09:00', end_time: '18:00', is_active: true },
  { id: 'b-m-3', admin_id: 'ameen-ahsan', day_of_week: 3, start_time: '09:00', end_time: '18:00', is_active: true },
  { id: 'b-m-4', admin_id: 'ameen-ahsan', day_of_week: 4, start_time: '09:00', end_time: '18:00', is_active: true },
  { id: 'b-m-5', admin_id: 'ameen-ahsan', day_of_week: 5, start_time: '09:00', end_time: '18:00', is_active: true },
];

const DEFAULT_BOOKINGS: Booking[] = [
  {
    id: 'bk-101',
    public_id: 'BMM-9821',
    admin_id: 'ameen-ahsan',
    assigned_admin_id: 'admin-a',
    assigned_admin_name: 'Admin A (Alex)',
    customer_id: 'cust-1',
    customer_name: 'Rahul Sharma',
    customer_email: 'rahul.s@example.com',
    customer_phone: '+91 9876543210',
    meeting_type_id: 'mt-1',
    meeting_type_name: 'Quick Sync',
    start_time: new Date(Date.now() + 86400000).toISOString(),
    end_time: new Date(Date.now() + 86400000 + 15 * 60000).toISOString(),
    customer_timezone: 'Asia/Kolkata',
    status: 'confirmed',
    payment_status: 'completed',
    calendar_status: 'created',
    google_calendar_event_id: 'cal-event-1',
    google_meet_url: 'https://meet.google.com/abc-defg-hij',
    cancellation_token: 'cancel-token-101',
    reschedule_token: 'resched-token-101',
    cancelled_at: null,
    cancellation_reason: null,
    calendar_retry_count: 0,
    question_answers: { 'Specific topic': 'Digital Marketing Campaign Setup' },
    notes: 'Please review current ad accounts',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'bk-102',
    public_id: 'BMM-9822',
    admin_id: 'ameen-ahsan',
    assigned_admin_id: 'admin-b',
    assigned_admin_name: 'Admin B (Priya)',
    customer_id: 'cust-2',
    customer_name: 'Anita Desai',
    customer_email: 'anita.d@techcorp.io',
    customer_phone: '+91 9123456780',
    meeting_type_id: 'mt-2',
    meeting_type_name: 'Consultation',
    start_time: new Date(Date.now() + 172800000).toISOString(),
    end_time: new Date(Date.now() + 172800000 + 30 * 60000).toISOString(),
    customer_timezone: 'Asia/Kolkata',
    status: 'confirmed',
    payment_status: 'completed',
    calendar_status: 'created',
    google_calendar_event_id: 'cal-event-2',
    google_meet_url: 'https://meet.google.com/xyz-uvwx-rst',
    cancellation_token: 'cancel-token-102',
    reschedule_token: 'resched-token-102',
    cancelled_at: null,
    cancellation_reason: null,
    calendar_retry_count: 0,
    question_answers: { 'Specific topic': 'Performance Strategy & Budgeting' },
    notes: 'Adways consultation series',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const useBookingStore = create<BookingStoreState>()(
  persist(
    (set, get) => ({
      admins: DEFAULT_ADMINS,
      meetingTypes: DEFAULT_MEETING_TYPES,
      scheduleBlocks: DEFAULT_SCHEDULE_BLOCKS,
      bookings: DEFAULT_BOOKINGS,
      emailNotifications: [],
      currentSuperAdmin: DEFAULT_ADMINS[0],
      pendingBooking: {
        meetingTypeId: 'mt-clarity-15',
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

        // Give default meeting types with customizable pricing for this new admin
        get().addMeetingType({
          admin_id: id,
          name: `Quick Advisory with ${data.full_name.split(' ')[0]}`,
          description: `15-minute quick strategy review with ${data.full_name}`,
          duration_minutes: 15,
          price: 29900,
          original_price: 49900,
          offer_price: 29900,
          currency: 'INR',
          is_active: true,
          buffer_before_minutes: 5,
          buffer_after_minutes: 5,
          min_advance_hours: 1,
          max_advance_days: 30,
          cancellation_window_hours: 24,
          reschedule_allowed: true,
          max_bookings_per_day: 8,
          color_id: 1,
          sort_order: 1,
        });

        get().addMeetingType({
          admin_id: id,
          name: `1-on-1 Consultation with ${data.full_name.split(' ')[0]}`,
          description: `30-minute private consultation session with ${data.full_name}`,
          duration_minutes: 30,
          price: 59900,
          original_price: 119900,
          offer_price: 59900,
          currency: 'INR',
          is_active: true,
          buffer_before_minutes: 5,
          buffer_after_minutes: 10,
          min_advance_hours: 2,
          max_advance_days: 30,
          cancellation_window_hours: 24,
          reschedule_allowed: true,
          max_bookings_per_day: 6,
          color_id: 2,
          sort_order: 2,
        });

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
            a.id === id ? { ...a, google_connected: false } : a
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
        const offer = newMeeting.offer_price || newMeeting.price || 49900;
        const fullMeeting: MeetingType = {
          ...newMeeting,
          id,
          price: offer,
          offer_price: offer,
          original_price: newMeeting.original_price || offer * 1.5,
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
          // General / Super Admin meetings
          return state.meetingTypes;
        }
        const adminMeetings = state.meetingTypes.filter((m) => m.admin_id === adminId);
        // Fallback to general meeting types if admin doesn't have custom ones
        return adminMeetings.length > 0 ? adminMeetings : state.meetingTypes;
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
          // If no specific admin was requested (e.g. platform pooled booking), check Ameen Ahsan availability
          const primaryAdmin = state.admins.find((a) => a.id === 'ameen-ahsan') || state.admins[0];
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
        
        // Generate valid Google Meet link
        const meetChars = 'abcdefghijklmnopqrstuvwxyz';
        const randomChunk = (len: number) =>
          Array.from({ length: len }, () => meetChars[Math.floor(Math.random() * meetChars.length)]).join('');
        const meetCode = `meet.google.com/${randomChunk(3)}-${randomChunk(4)}-${randomChunk(3)}`;
        const googleMeetUrl = `https://${meetCode}`;

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
      name: 'bookmymeet-platform-state-v3',
    }
  )
);
