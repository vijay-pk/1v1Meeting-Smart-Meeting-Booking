import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Boolean, Text, DateTime, ForeignKey, JSON, LargeBinary, Index
)
from sqlalchemy import text
from sqlalchemy.orm import relationship
from app.core.database import Base

def gen_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    phone = Column(String(30), nullable=True)
    role = Column(String(20), default="admin", nullable=False)  # "super_admin", "admin", "client"
    status = Column(String(30), default="ACTIVE", nullable=False)  # "ACTIVE", "TEMPORARILY_DISABLED", "PERMANENTLY_DELETED"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    profile = relationship("AdminProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="admin", cascade="all, delete-orphan")
    availability_rules = relationship("AvailabilityRule", back_populates="admin", cascade="all, delete-orphan")
    google_connection = relationship("GoogleConnection", back_populates="admin", uselist=False, cascade="all, delete-orphan")
    razorpay_connection = relationship("RazorpayConnection", back_populates="admin", uselist=False, cascade="all, delete-orphan")
    bookings = relationship("Booking", back_populates="admin", foreign_keys="Booking.admin_id")

class AdminProfile(Base):
    __tablename__ = "admin_profiles"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=False)
    title = Column(String(150), default="Mentor & Consultant")
    bio = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    profile_photo = Column(Text, nullable=True)
    cover_image = Column(Text, nullable=True)
    intro_video = Column(Text, nullable=True)
    heading_text = Column(String(200), default="Book a 1:1 Mentorship Session")
    about_me_text = Column(Text, nullable=True)
    custom_description = Column(Text, nullable=True)
    welcome_message = Column(String(255), default="Welcome to my booking portal")
    theme_settings = Column(JSON, default=lambda: {
        "theme": "amber",
        "bg_gradient": "from-[#873600] via-[#A04000] to-[#6E2C00]",
        "button_color": "#D32F2F",
        "button_text_color": "#FFFFFF",
        "card_style": "rounded",
        "show_video": True,
        "show_stats": True,
        "show_socials": True
    })
    social_links = Column(JSON, default=lambda: {
        "instagram": "",
        "whatsapp": "",
        "linkedin": "",
        "youtube": "",
        "website": ""
    })
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="profile")

class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    duration_minutes = Column(Integer, default=30, nullable=False)
    price = Column(Integer, default=0, nullable=False)  # in paise (e.g. 149700 = ₹1,497)
    original_price = Column(Integer, nullable=True)     # regular price before discount (paise)
    currency = Column(String(10), default="INR", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    buffer_before_minutes = Column(Integer, default=5, nullable=False)
    buffer_after_minutes = Column(Integer, default=10, nullable=False)
    min_advance_hours = Column(Integer, default=2, nullable=False)
    max_advance_days = Column(Integer, default=30, nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    admin = relationship("User", back_populates="sessions")
    bookings = relationship("Booking", back_populates="meeting_type")

class AvailabilityRule(Base):
    __tablename__ = "availability_rules"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    day_of_week = Column(Integer, nullable=False)  # 0=Sunday, 1=Monday... 6=Saturday
    start_time = Column(String(10), default="09:00", nullable=False)  # HH:MM
    end_time = Column(String(10), default="18:00", nullable=False)    # HH:MM
    is_active = Column(Boolean, default=True, nullable=False)

    admin = relationship("User", back_populates="availability_rules")

class AvailabilityException(Base):
    __tablename__ = "availability_exceptions"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    is_available = Column(Boolean, default=False, nullable=False)
    start_time = Column(String(10), nullable=True)
    end_time = Column(String(10), nullable=True)
    reason = Column(String(255), nullable=True)

class GoogleConnection(Base):
    __tablename__ = "google_connections"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    google_email = Column(String(150), nullable=False)
    access_token = Column(Text, nullable=True)
    encrypted_refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime, nullable=True)
    calendar_id = Column(String(150), default="primary", nullable=False)
    connection_status = Column(String(30), default="connected", nullable=False)  # "connected", "disconnected"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    admin = relationship("User", back_populates="google_connection")

class RazorpayConnection(Base):
    __tablename__ = "razorpay_connections"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    key_id = Column(String(100), nullable=False)
    encrypted_key_secret = Column(Text, nullable=False)
    connection_status = Column(String(30), default="connected", nullable=False)
    account_reference = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    admin = relationship("User", back_populates="razorpay_connection")

class SlotLock(Base):
    __tablename__ = "slot_locks"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(String(30), nullable=False)  # ISO string
    end_time = Column(String(30), nullable=False)    # ISO string
    locked_by_session = Column(String(100), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(20), default="active", nullable=False)  # "active", "released", "confirmed"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Booking(Base):
    __tablename__ = "bookings"

    # The double-booking guard, and the only one that actually holds.
    #
    # Every application-level check in payments.py is a SELECT followed by an INSERT, with no
    # locking and no isolation: two requests can both read "no conflict" before either
    # commits, and both then write a booking for the same slot. That window is the whole
    # length of a Razorpay checkout -- minutes, not milliseconds.
    #
    # A partial unique index makes the database the final authority, which is the only place
    # the race can actually be settled. It covers the two statuses that occupy a slot;
    # "cancelled" and "completed" rows are excluded so a slot can legitimately be rebooked
    # after a cancellation. admin_id is nullable for permanently deleted admins, and NULLs
    # compare as distinct in both PostgreSQL and SQLite, so anonymized historical bookings
    # never collide with each other.
    #
    # Declared here as well as in migrations/004 so a database created by create_all (which
    # is how production was built) gets the constraint without anyone remembering to run it.
    __table_args__ = (
        Index(
            "ux_bookings_admin_slot_active",
            "admin_id", "start_time",
            unique=True,
            postgresql_where=text("status IN ('confirmed', 'pending_payment')"),
            sqlite_where=text("status IN ('confirmed', 'pending_payment')"),
        ),
    )

    id = Column(String(36), primary_key=True, default=gen_uuid)
    public_id = Column(String(50), unique=True, nullable=False)
    # Nullable so a permanently deleted admin can be erased while the financial record
    # survives: admin_deletion.py scrubs the client PII and detaches these two references
    # rather than leaving a row pointing at a user that no longer exists.
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    meeting_type_id = Column(String(36), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    client_name = Column(String(100), nullable=False)
    client_email = Column(String(150), nullable=False)
    client_phone = Column(String(30), nullable=True)
    start_time = Column(String(30), nullable=False)  # ISO string
    end_time = Column(String(30), nullable=False)    # ISO string
    timezone = Column(String(50), default="Asia/Kolkata", nullable=False)
    status = Column(String(30), default="pending_payment", nullable=False)  # "pending_payment", "confirmed", "cancelled", "completed", "expired"
    payment_status = Column(String(30), default="pending", nullable=False)  # "pending", "completed", "failed"
    google_event_id = Column(String(255), nullable=True)
    google_meet_link = Column(String(255), nullable=True)
    cancellation_token = Column(String(64), unique=True, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    admin = relationship("User", back_populates="bookings", foreign_keys=[admin_id])
    meeting_type = relationship("Session", back_populates="bookings")
    payment = relationship("Payment", back_populates="booking", uselist=False)

class Payment(Base):
    __tablename__ = "payments"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    booking_id = Column(String(36), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, unique=True)
    # Detached (not deleted) when the admin is permanently removed -- the payment is a
    # financial record, but it must not keep pointing at a deleted user row.
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    provider = Column(String(30), default="razorpay", nullable=False)
    order_id = Column(String(100), nullable=False, index=True)
    payment_id = Column(String(100), nullable=True, index=True)
    amount = Column(Integer, nullable=False)  # in paise
    currency = Column(String(10), default="INR", nullable=False)
    status = Column(String(30), default="created", nullable=False)  # "created", "captured", "failed"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    booking = relationship("Booking", back_populates="payment")

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(50), nullable=False)
    title = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    booking_id = Column(String(36), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DeletedAdminIdentity(Base):
    """
    Minimal tombstone left behind when a Super Admin permanently deletes an admin.

    This is NOT a user account or a profile. It holds no name, no phone, no profile
    content -- only what is needed to enforce two rules after the account is gone:

      1. the same email address can never register again (email_hash), and
      2. the freed vanity URL can never be claimed by someone else (username).

    The email is stored as a keyed HMAC-SHA256 digest, never in plain text: signup can
    still test hash(normalized_email) for membership, but the table itself does not
    disclose who was deleted. The username is public information by nature (it was a
    public URL), so it is kept as-is to answer /{username} lookups.
    """
    __tablename__ = "deleted_admin_identities"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    email_hash = Column(String(64), unique=True, index=True, nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=True)
    deleted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    deleted_by = Column(String(36), nullable=True)  # super admin user id, kept for audit
    reason = Column(String(255), nullable=True)


class AdminOnboarding(Base):
    """
    Records that an admin finished first-time setup. One row per admin, written once.

    Whether each setup step is done is never stored: services/onboarding.py derives it from
    the rows that actually make a page bookable (profile, availability, sessions, Razorpay).
    This row answers the one question those rows cannot -- "has this admin already been
    through setup?" -- so that disconnecting Razorpay later shows the step as outstanding on
    the dashboard instead of locking an established admin back into the setup screen.

    A separate table rather than a column on admin_profiles on purpose: create_all adds a
    missing table by itself, but never a missing column, and a column the ORM selects before
    a hand-applied migration reaches production would break every profile query -- the
    public booking page included.
    """
    __tablename__ = "admin_onboarding"

    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    completed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class ProfileImport(Base):
    """
    One "Import from SuperProfile" attempt by one admin.

    Parsing writes here and nowhere else. The admin's real profile and session rows are only
    touched after they review the preview and confirm, which is what keeps a bad parse (or a
    page that changed shape) from silently overwriting a live booking page.

    `parsed_data` holds the sanitized extraction: plain text only, no HTML, no credentials.
    """
    __tablename__ = "profile_imports"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    admin_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_url = Column(String(1000), nullable=False)
    source_type = Column(String(30), default="superprofile", nullable=False)
    status = Column(String(20), default="preview", nullable=False)  # "preview", "applied", "cancelled"
    parsed_data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class MediaAsset(Base):
    """
    One admin-uploaded image or video: the metadata, and where the object actually lives.

    History matters here, because two storage locations came before this one and both lost
    data. Files were first written to `backend/uploads/` and referenced by a filesystem URL --
    a container host wipes that directory on every deploy, so the row kept pointing at a file
    that no longer existed. They were then held as bytes in `data`, which is durable but puts
    multi-megabyte blobs in the application's own table space.

    Now the object goes to Supabase Storage and this row holds the reference:
    `storage_path` is the key inside the `profile-media` bucket, and `public_url` is the
    stable URL a client's browser fetches. `data` remains nullable **only** so rows written by
    the previous implementation keep serving; nothing new writes to it.

    `owner_id` cascades, so a permanently deleted admin's media goes with them.
    """
    __tablename__ = "media_assets"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    owner_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    byte_size = Column(Integer, nullable=False)

    # Where the object lives now.
    storage_provider = Column(String(30), default="supabase", nullable=False)
    storage_path = Column(String(500), nullable=True)
    public_url = Column(Text, nullable=True)

    # Legacy only: rows created while bytes were held in the database. Never written now.
    data = Column(LargeBinary, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
