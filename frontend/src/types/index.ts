// ============================================================
// BookMyMeet — Shared TypeScript Types
// ============================================================

// === Enums ===

export type UserRole = 'admin' | 'super_admin';

export type BookingStatus =
  | 'pending_payment'
  | 'payment_received'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'refunded'
  | 'calendar_failed';

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export type CalendarStatus = 'pending' | 'created' | 'failed' | 'cancelled' | 'retry_scheduled';

export type RazorpayPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export type QuestionType = 'short_text' | 'long_text' | 'url';

export type NotificationType =
  | 'new_booking'
  | 'cancellation'
  | 'reschedule'
  | 'payment_failed'
  | 'calendar_failed'
  | 'payment_received';

export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP';

// === Database Models ===

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  bio: string | null;
  photo_url: string | null;
  role: UserRole;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MeetingType {
  id: string;
  admin_id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number; // in smallest unit (paise/cents), acts as offer_price
  original_price?: number | null; // before discount (in smallest unit)
  offer_price?: number; // offer price (in smallest unit)
  currency: Currency;
  is_active: boolean;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_advance_hours: number;
  max_advance_days: number;
  cancellation_window_hours: number;
  reschedule_allowed: boolean;
  max_bookings_per_day: number | null;
  color_id: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WeeklyScheduleBlock {
  id: string;
  admin_id: string;
  day_of_week: number; // 0=Sunday, 1=Monday... 6=Saturday
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  is_active: boolean;
}

export type AdminStatus = 'ACTIVE' | 'TEMPORARILY_DISABLED' | 'PERMANENTLY_DELETED';

export interface AdminThemeSettings {
  theme?: string;
  bg_gradient?: string;
  button_color?: string;
  button_text_color?: string;
  card_style?: string;
  show_video?: boolean;
  show_stats?: boolean;
  show_socials?: boolean;
}

export interface CustomSectionItem {
  id: string;
  title: string;
  description?: string;
  button_text?: string;
  button_url?: string;
  badge?: string;
  image_url?: string;
}

export interface AdminSocialLinks {
  instagram?: string;
  whatsapp?: string;
  linkedin?: string;
  youtube?: string;
  website?: string;
  super_chat?: string;
  telegram?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  full_name: string;
  title: string;
  role: 'super_admin' | 'admin';
  status: AdminStatus;
  avatar_color: string;
  avatar_letter: string;
  photo_url?: string;
  cover_image?: string;
  intro_video?: string;
  heading_text?: string;
  about_me_text?: string;
  welcome_message?: string;
  bio?: string;
  email: string;
  phone?: string;
  password?: string;
  theme_settings?: AdminThemeSettings;
  social_links?: AdminSocialLinks;
  super_chat_url?: string;
  custom_sections?: CustomSectionItem[];
  google_connected?: boolean;
  google_email?: string;
  razorpay_configured?: boolean;
  razorpay_key_id?: string;
}

export interface BookingQuestion {
  id: string;
  meeting_type_id: string;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  sort_order: number;
}

export interface AvailabilityRule {
  id: string;
  admin_id: string;
  day_of_week: number; // 0=Sunday..6=Saturday
  start_time: string; // HH:MM:SS
  end_time: string;
  is_active: boolean;
}

export interface AvailabilityException {
  id: string;
  admin_id: string;
  exception_date: string; // YYYY-MM-DD
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

export interface GoogleCalendarConnection {
  id: string;
  admin_id: string;
  google_email: string;
  is_connected: boolean;
  selected_calendar_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  created_at: string;
}

export interface Booking {
  id: string;
  public_id: string;
  admin_id: string;
  assigned_admin_id?: string | null;
  assigned_admin_name?: string;
  assigned_admin_email?: string;
  customer_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  meeting_type_id: string;
  meeting_type_name?: string;
  start_time: string;
  end_time: string;
  customer_timezone: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  calendar_status: CalendarStatus;
  google_calendar_event_id: string | null;
  google_meet_url: string | null;
  google_calendar_url?: string | null;
  notifications_sent?: {
    client_email: string;
    admin_email: string;
    sent_at: string;
    meet_url: string;
  };
  cancellation_token: string;
  reschedule_token: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  calendar_retry_count: number;
  question_answers: Record<string, string> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  customer?: Customer;
  meeting_type?: MeetingType;
  payment?: Payment;
  admin?: any;
}

export interface BookingHold {
  id: string;
  admin_id: string;
  start_time: string;
  end_time: string;
  held_by_session: string;
  expires_at: string;
  released: boolean;
  created_at: string;
}

export interface Payment {
  id: string;
  booking_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  amount: number;
  currency: Currency;
  status: RazorpayPaymentStatus;
  refund_id: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  admin_id: string;
  type: NotificationType;
  title: string;
  message: string;
  booking_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AdminSettings {
  id: string;
  admin_id: string;
  min_advance_notice_hours: number;
  max_booking_horizon_days: number;
  default_buffer_minutes: number;
  cancellation_policy_text: string | null;
  booking_page_title: string | null;
  booking_page_description: string | null;
  email_from_name: string | null;
}

// === API Types ===

export interface TimeSlot {
  start: string; // ISO string
  end: string;
  display_start: string; // formatted for display
  display_end: string;
}

export interface AvailabilityResponse {
  date: string;
  timezone: string;
  slots: TimeSlot[];
}

export interface CreateHoldRequest {
  meeting_type_id: string;
  start_time: string;
  end_time: string;
  session_id: string;
}

export interface CreateHoldResponse {
  hold_id: string;
  expires_at: string;
}

export interface CreateOrderRequest {
  booking_id: string;
  hold_id: string;
}

export interface CreateOrderResponse {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  booking_id: string;
}

export interface VerifyPaymentRequest {
  booking_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface BookingConfirmationResponse {
  booking: Booking;
  google_meet_url: string | null;
  status: BookingStatus;
  message: string;
}

export interface CustomerDetailsInput {
  name: string;
  email: string;
  phone: string;
  notes?: string;
  question_answers?: Record<string, string>;
}

// === Dashboard Stats ===

export interface DashboardStats {
  todays_meetings: number;
  upcoming_meetings: number;
  total_bookings: number;
  total_revenue: number;
  pending_payments: number;
  cancelled_meetings: number;
  currency: Currency;
}

// === Booking Step ===
export type BookingStep = 'select' | 'date' | 'time' | 'details' | 'payment' | 'confirmation';

export interface EmailNotification {
  id: string;
  booking_id: string;
  recipient_type: 'client' | 'admin';
  recipient_email: string;
  recipient_name: string;
  subject: string;
  meet_url: string;
  google_calendar_url: string;
  booked_time: string;
  formatted_time: string;
  sent_at: string;
  status: 'sent' | 'delivered';
}
