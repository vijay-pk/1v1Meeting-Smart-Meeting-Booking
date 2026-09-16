from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field

# Auth schemas
class UserLogin(BaseModel):
    username_or_email: str
    password: str

class UserSignup(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    username: str

class GoogleAuthRequest(BaseModel):
    """The Supabase access token from the browser's completed Google OAuth flow."""
    supabase_access_token: str


class GoogleAuthCompleteRequest(GoogleAuthRequest):
    """Second leg: the username a brand-new Google user picked for their page."""
    username: str
    phone: Optional[str] = None


class GoogleAuthResponse(BaseModel):
    """
    One of two outcomes.

    status == "authenticated"          -> the token fields are populated, sign the user in.
    status == "registration_required"  -> no account for this Google address yet; the
                                          client collects a username and calls /google/complete.
    """
    status: str
    account_status: Optional[str] = None
    access_token: Optional[str] = None
    token_type: str = "bearer"
    role: Optional[str] = None
    user_id: Optional[str] = None
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    suggested_username: Optional[str] = None


class UsernameAvailability(BaseModel):
    username: str
    available: bool
    reason: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    username: str
    name: str
    status: str

# Profile schemas
class ThemeSettings(BaseModel):
    theme: Optional[str] = "amber"
    bg_gradient: Optional[str] = "from-[#873600] via-[#A04000] to-[#6E2C00]"
    button_color: Optional[str] = "#D32F2F"
    button_text_color: Optional[str] = "#FFFFFF"
    card_style: Optional[str] = "rounded"
    show_video: Optional[bool] = True
    show_stats: Optional[bool] = True

class AdminProfileUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    title: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None
    profile_photo: Optional[str] = None
    cover_image: Optional[str] = None
    intro_video: Optional[str] = None
    heading_text: Optional[str] = None
    about_me_text: Optional[str] = None
    custom_description: Optional[str] = None
    welcome_message: Optional[str] = None
    theme_settings: Optional[Dict[str, Any]] = None

class AdminProfileResponse(BaseModel):
    id: str
    user_id: str
    username: str
    name: str
    email: str
    phone: Optional[str] = None
    role: str
    status: str
    title: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None
    profile_photo: Optional[str] = None
    cover_image: Optional[str] = None
    intro_video: Optional[str] = None
    heading_text: Optional[str] = None
    about_me_text: Optional[str] = None
    custom_description: Optional[str] = None
    welcome_message: Optional[str] = None
    theme_settings: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

# Session schemas
class SessionTimeWindowItem(BaseModel):
    day_of_week: int  # 0=Sunday ... 6=Saturday
    start_time: str   # HH:MM
    end_time: str     # HH:MM

class SessionCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    duration_minutes: int = 30
    price: int = 0  # in paise
    original_price: Optional[int] = None
    currency: str = "INR"
    is_active: bool = True
    buffer_before_minutes: int = 5
    buffer_after_minutes: int = 10
    min_advance_hours: int = 2
    max_advance_days: int = 30
    # None or [] = use the admin's general availability.
    available_hours: Optional[List[SessionTimeWindowItem]] = None

class SessionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    price: Optional[int] = None
    original_price: Optional[int] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None
    buffer_before_minutes: Optional[int] = None
    buffer_after_minutes: Optional[int] = None
    min_advance_hours: Optional[int] = None
    max_advance_days: Optional[int] = None
    # Omitted = unchanged. null or [] = back to the admin's general availability.
    available_hours: Optional[List[SessionTimeWindowItem]] = None

class SessionResponse(BaseModel):
    id: str
    admin_id: str
    title: str
    description: Optional[str]
    duration_minutes: int
    price: int
    original_price: Optional[int]
    currency: str
    is_active: bool
    buffer_before_minutes: int
    buffer_after_minutes: int
    min_advance_hours: int
    max_advance_days: int
    available_hours: Optional[List[SessionTimeWindowItem]] = None

    class Config:
        from_attributes = True

# Availability schemas
class AvailabilityRuleItem(BaseModel):
    day_of_week: int  # 0 to 6
    start_time: str
    end_time: str
    is_active: bool = True

class AvailabilitySaveRequest(BaseModel):
    rules: List[AvailabilityRuleItem]

class AvailabilityExceptionItem(BaseModel):
    """
    A date the admin is not working, optionally only for part of that day.

    start_time/end_time are None for a whole-day block. When both are set, only that
    window is removed from the day's working hours -- e.g. a 12:00-13:00 lunch inside
    09:00-17:00.
    """
    id: Optional[str] = None
    exception_date: str            # YYYY-MM-DD
    is_available: bool = False
    start_time: Optional[str] = None   # HH:MM
    end_time: Optional[str] = None     # HH:MM
    reason: Optional[str] = None

class AvailabilityExceptionCreate(BaseModel):
    exception_date: str
    is_available: bool = False
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    reason: Optional[str] = None

# Public Profile & Booking schemas
class PublicAdminProfile(BaseModel):
    id: str
    username: str
    name: str
    title: Optional[str]
    bio: Optional[str]
    description: Optional[str]
    profile_photo: Optional[str]
    cover_image: Optional[str]
    intro_video: Optional[str]
    heading_text: Optional[str]
    about_me_text: Optional[str]
    welcome_message: Optional[str]
    theme_settings: Optional[Dict[str, Any]]
    status: str
    sessions: List[SessionResponse]
    razorpay_configured: Optional[bool] = False
    razorpay_key_id: Optional[str] = None

# Slot & Lock schemas
class SlotLockRequest(BaseModel):
    admin_id: str
    session_id: str
    start_time: str
    end_time: str
    session_fingerprint: str

class SlotLockResponse(BaseModel):
    lock_id: str
    expires_at: str
    status: str

# Razorpay & Payment schemas
class RazorpaySetupRequest(BaseModel):
    key_id: str
    key_secret: str
    account_reference: Optional[str] = None

class CreateOrderRequest(BaseModel):
    admin_id: str
    session_id: str
    start_time: str
    end_time: str
    client_name: str
    client_email: EmailStr
    client_phone: Optional[str] = None
    notes: Optional[str] = None
    lock_id: Optional[str] = None

class CreateOrderResponse(BaseModel):
    order_id: str
    amount: int
    currency: str
    key_id: str
    booking_id: str

class VerifyPaymentRequest(BaseModel):
    booking_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

class BookingResponse(BaseModel):
    id: str
    public_id: str
    admin_id: str
    meeting_type_id: str
    client_name: str
    client_email: str
    client_phone: Optional[str]
    start_time: str
    end_time: str
    timezone: str
    status: str
    payment_status: str
    google_meet_link: Optional[str]
    created_at: Any

    class Config:
        from_attributes = True

# Super Admin schemas
class AdminStatusUpdate(BaseModel):
    status: str  # "ACTIVE", "TEMPORARILY_DISABLED", "PERMANENTLY_DELETED"

class SuperAdminAdminItem(BaseModel):
    id: str
    username: str
    name: str
    email: str
    phone: Optional[str]
    role: str
    status: str
    google_connected: bool
    google_email: Optional[str]
    razorpay_configured: bool
    razorpay_key_id: Optional[str]
    bookings_count: int
    total_revenue: int
    created_at: Any

class PlatformAnalytics(BaseModel):
    total_admins: int
    active_admins: int
    disabled_admins: int
    total_bookings: int
    confirmed_bookings: int
    total_revenue: int
