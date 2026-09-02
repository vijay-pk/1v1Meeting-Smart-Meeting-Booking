-- ============================================================
-- BookMyMeet — Database Schema
-- Run this against your Supabase PostgreSQL instance
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_-]{3,30}$'),
  full_name TEXT NOT NULL,
  bio TEXT,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. MEETING TYPES
-- ============================================================
CREATE TABLE IF NOT EXISTS meeting_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  price INTEGER NOT NULL CHECK (price >= 0),  -- in paise (smallest unit), acts as offer_price
  original_price INTEGER CHECK (original_price IS NULL OR original_price >= 0), -- regular price before discount
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  min_advance_hours INTEGER NOT NULL DEFAULT 2 CHECK (min_advance_hours >= 0),
  max_advance_days INTEGER NOT NULL DEFAULT 60 CHECK (max_advance_days > 0),
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24 CHECK (cancellation_window_hours >= 0),
  reschedule_allowed BOOLEAN NOT NULL DEFAULT true,
  max_bookings_per_day INTEGER CHECK (max_bookings_per_day IS NULL OR max_bookings_per_day > 0),
  color_id INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_types_admin ON meeting_types(admin_id);
CREATE INDEX idx_meeting_types_active ON meeting_types(admin_id, is_active);

-- ============================================================
-- 3. BOOKING QUESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_type_id UUID NOT NULL REFERENCES meeting_types(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'short_text' CHECK (question_type IN ('short_text', 'long_text', 'url')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_booking_questions_meeting ON booking_questions(meeting_type_id);

-- ============================================================
-- 4. AVAILABILITY RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS availability_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CHECK (end_time > start_time)
);

CREATE INDEX idx_availability_rules_admin ON availability_rules(admin_id, is_active);

-- ============================================================
-- 5. AVAILABILITY EXCEPTIONS (holidays, custom dates)
-- ============================================================
CREATE TABLE IF NOT EXISTS availability_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  UNIQUE(admin_id, exception_date)
);

CREATE INDEX idx_availability_exceptions_admin ON availability_exceptions(admin_id, exception_date);

-- ============================================================
-- 6. GOOGLE CALENDAR CONNECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  -- Refresh token stored encrypted; never returned to frontend
  encrypted_refresh_token TEXT NOT NULL,
  is_connected BOOLEAN NOT NULL DEFAULT true,
  selected_calendar_id TEXT DEFAULT 'primary',
  scopes TEXT[],
  connected_at TIMESTAMPTZ DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email, phone)
);

CREATE INDEX idx_customers_email ON customers(email);

-- ============================================================
-- 8. BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_id TEXT UNIQUE NOT NULL DEFAULT ('BK-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6)),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  assigned_admin_id UUID REFERENCES profiles(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  meeting_type_id UUID NOT NULL REFERENCES meeting_types(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  customer_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'pending_payment', 'payment_received', 'confirmed',
      'cancelled', 'completed', 'expired', 'refunded', 'calendar_failed'
    )),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  calendar_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (calendar_status IN ('pending', 'created', 'failed', 'cancelled', 'retry_scheduled')),
  google_calendar_event_id TEXT,
  google_meet_url TEXT,
  cancellation_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  reschedule_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  calendar_retry_count INTEGER NOT NULL DEFAULT 0,
  question_answers JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_bookings_admin ON bookings(admin_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_time ON bookings(admin_id, start_time, end_time);
CREATE INDEX idx_bookings_cancellation_token ON bookings(cancellation_token);
CREATE INDEX idx_bookings_reschedule_token ON bookings(reschedule_token);

-- Prevent overlapping confirmed/payment_received bookings for the same admin
CREATE UNIQUE INDEX idx_no_double_booking ON bookings (admin_id, start_time)
  WHERE status IN ('pending_payment', 'payment_received', 'confirmed');

-- ============================================================
-- 9. BOOKING HOLDS (temporary slot reservations)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  meeting_type_id UUID NOT NULL REFERENCES meeting_types(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  held_by_session TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  booking_id UUID REFERENCES bookings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_holds_active ON booking_holds(admin_id, start_time, end_time)
  WHERE released = false;
CREATE INDEX idx_booking_holds_expiry ON booking_holds(expires_at)
  WHERE released = false;

-- ============================================================
-- 10. PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  razorpay_order_id TEXT UNIQUE NOT NULL,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_signature TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),  -- in paise
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded')),
  refund_id TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_order ON payments(razorpay_order_id);

-- ============================================================
-- 11. WEBHOOK EVENTS (idempotency)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL DEFAULT 'razorpay',
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);

CREATE INDEX idx_webhook_events_lookup ON webhook_events(provider, event_id);

-- ============================================================
-- 12. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'new_booking', 'cancellation', 'reschedule',
    'payment_failed', 'calendar_failed', 'payment_received'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_admin ON notifications(admin_id, is_read, created_at DESC);

-- ============================================================
-- 13. ADMIN SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  min_advance_notice_hours INTEGER NOT NULL DEFAULT 2,
  max_booking_horizon_days INTEGER NOT NULL DEFAULT 60,
  default_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  cancellation_policy_text TEXT,
  booking_page_title TEXT,
  booking_page_description TEXT,
  email_from_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_meeting_types
  BEFORE UPDATE ON meeting_types FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_bookings
  BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_payments
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_admin_settings
  BEFORE UPDATE ON admin_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_google_calendar
  BEFORE UPDATE ON google_calendar_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 15. Expired holds cleanup function (call via pg_cron)
-- ============================================================
CREATE OR REPLACE FUNCTION release_expired_holds()
RETURNS void AS $$
BEGIN
  UPDATE booking_holds
  SET released = true
  WHERE released = false AND expires_at < now();

  -- Also expire bookings that never got paid
  UPDATE bookings
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending_payment'
    AND created_at < now() - INTERVAL '15 minutes';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 16. Row Level Security
-- ============================================================

-- Profiles: admins can read/update their own profile; public can read active profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_public_read ON profiles
  FOR SELECT USING (is_active = true);

CREATE POLICY profiles_owner_update ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Meeting Types: public read active; admin CRUD on own
ALTER TABLE meeting_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_types_public_read ON meeting_types
  FOR SELECT USING (is_active = true);

CREATE POLICY meeting_types_admin_all ON meeting_types
  FOR ALL USING (auth.uid() = admin_id);

-- Availability Rules: public read; admin CRUD
ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_rules_public_read ON availability_rules
  FOR SELECT USING (is_active = true);

CREATE POLICY availability_rules_admin_all ON availability_rules
  FOR ALL USING (auth.uid() = admin_id);

-- Availability Exceptions: public read; admin CRUD
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY exceptions_public_read ON availability_exceptions
  FOR SELECT USING (true);

CREATE POLICY exceptions_admin_all ON availability_exceptions
  FOR ALL USING (auth.uid() = admin_id);

-- Google Calendar: admin only, never exposed to public
ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY gcal_admin_only ON google_calendar_connections
  FOR ALL USING (auth.uid() = admin_id);

-- Customers: admin can read customers of their bookings
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_public_insert ON customers
  FOR INSERT WITH CHECK (true);

CREATE POLICY customers_admin_read ON customers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM bookings WHERE bookings.customer_id = customers.id AND bookings.admin_id = auth.uid())
  );

-- Bookings: admin reads own; public reads via token only
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookings_admin_all ON bookings
  FOR ALL USING (auth.uid() = admin_id);

CREATE POLICY bookings_public_insert ON bookings
  FOR INSERT WITH CHECK (true);

CREATE POLICY bookings_public_read_by_token ON bookings
  FOR SELECT USING (true);  -- Token-based access handled in Edge Functions

-- Booking Holds: admin CRUD; public insert
ALTER TABLE booking_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY holds_admin_all ON booking_holds
  FOR ALL USING (auth.uid() = admin_id);

CREATE POLICY holds_public_insert ON booking_holds
  FOR INSERT WITH CHECK (true);

CREATE POLICY holds_public_read ON booking_holds
  FOR SELECT USING (true);

-- Payments: admin reads; Edge Functions manage writes
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_admin_read ON payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM bookings WHERE bookings.id = payments.booking_id AND bookings.admin_id = auth.uid())
  );

CREATE POLICY payments_public_insert ON payments
  FOR INSERT WITH CHECK (true);

CREATE POLICY payments_public_read ON payments
  FOR SELECT USING (true);

-- Webhook Events: admin only read
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhooks_admin_read ON webhook_events
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY webhooks_service_all ON webhook_events
  FOR ALL USING (true);

-- Notifications: admin reads own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_admin_all ON notifications
  FOR ALL USING (auth.uid() = admin_id);

-- Admin Settings: admin only
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_settings_owner ON admin_settings
  FOR ALL USING (auth.uid() = admin_id);

-- Booking Questions: public read; admin CRUD
ALTER TABLE booking_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_questions_public_read ON booking_questions
  FOR SELECT USING (true);

CREATE POLICY booking_questions_admin_all ON booking_questions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM meeting_types WHERE meeting_types.id = booking_questions.meeting_type_id AND meeting_types.admin_id = auth.uid())
  );
