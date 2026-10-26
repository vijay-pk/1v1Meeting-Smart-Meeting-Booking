from fastapi import APIRouter
from app.api import (
    auth, admin_profiles, sessions, availability,
    bookings, payments, google_calendar, super_admin, notifications, upload,
    super_admin_settings, internal, students, student_portal, recording_simulation,
    student_recordings,
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
api_router.include_router(super_admin_settings.router, prefix="/super-admin", tags=["Super Admin"])
api_router.include_router(students.router, prefix="/super-admin", tags=["Super Admin — Students"])
api_router.include_router(student_portal.router, prefix="/student", tags=["Student Portal"])
# Signed-link recording playback (no bearer header: a <video> tag cannot send one).
api_router.include_router(student_recordings.router, prefix="/student", tags=["Student Recordings"])
# Dev-only recording simulation. Always registered, but every route 404s unless
# recording_sim.simulation_allowed() (flag + local APP_URL + retrieval off) is true.
api_router.include_router(recording_simulation.router, prefix="/super-admin", tags=["Dev Simulation"])
api_router.include_router(internal.router, prefix="/internal", tags=["Internal"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(upload.router, prefix="/upload", tags=["Media Upload"])
# Public: a host's profile photo has to load for a client on any device.
api_router.include_router(upload.media_router, prefix="/media", tags=["Media Upload"])

