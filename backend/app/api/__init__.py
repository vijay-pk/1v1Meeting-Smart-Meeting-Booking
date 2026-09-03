from fastapi import APIRouter
from app.api import (
    profile_imports,
    auth, admin_profiles, sessions, availability,
    bookings, payments, google_calendar, super_admin, notifications, upload
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(admin_profiles.router, prefix="/profiles", tags=["Admin Profiles"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["Sessions"])
api_router.include_router(availability.router, prefix="/availability", tags=["Availability Engine"])
api_router.include_router(bookings.router, prefix="/bookings", tags=["Bookings"])
api_router.include_router(payments.router, prefix="/payments", tags=["Payments & Razorpay"])
api_router.include_router(google_calendar.router, prefix="/google", tags=["Google Calendar & Meet"])
api_router.include_router(super_admin.router, prefix="/super-admin", tags=["Super Admin"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(upload.router, prefix="/upload", tags=["Media Upload"])
api_router.include_router(profile_imports.router, prefix="/profile-import", tags=["Profile Import"])

