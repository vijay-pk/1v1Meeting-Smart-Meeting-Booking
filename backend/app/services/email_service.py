import logging
from typing import Optional

logger = logging.getLogger(__name__)

async def send_booking_confirmation_email(
    to_email: str,
    client_name: str,
    admin_name: str,
    session_title: str,
    start_time: str,
    duration_minutes: int,
    meet_link: Optional[str]
) -> bool:
    """Sends client booking confirmation email with meeting details and Google Meet link."""
    logger.info(
        f"[EMAIL MOCK] To: {to_email} | Subject: Booking Confirmed with {admin_name} | "
        f"Session: {session_title} at {start_time} ({duration_minutes}m) | Meet: {meet_link}"
    )
    # If a real email provider like Resend is configured via env, send it here
    return True

async def send_admin_new_booking_notification(
    admin_email: str,
    admin_name: str,
    client_name: str,
    client_email: str,
    session_title: str,
    start_time: str,
    meet_link: Optional[str]
) -> bool:
    """Sends Admin alert notification for new confirmed booking."""
    logger.info(
        f"[EMAIL MOCK] To Admin: {admin_email} | Subject: New Booking: {client_name} - {session_title} | "
        f"Time: {start_time} | Meet: {meet_link}"
    )
    return True
