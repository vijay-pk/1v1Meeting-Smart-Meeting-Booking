"""
Transactional email, sent through Resend.

What this replaced: two functions that logged "[EMAIL MOCK]" and returned True. Every booking
confirmation the product ever "sent" was a log line, and every caller was told it succeeded.
That is the one failure mode this module is built to avoid, so the rule here is absolute:

    a send that did not happen returns False.

Not configured returns False. A provider error returns False. There is no path that reports
success without Resend having accepted the message. The caller records the result, so an
unemailed client is visible instead of assumed.

Provider choice is not new: supabase/functions/_shared/email.ts already posts to
api.resend.com. Same provider, one account, one verified domain.
"""
import logging
from datetime import datetime
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10.0


def _format_when(start_time_iso: str, duration_minutes: Optional[int] = None) -> str:
    """
    Renders a stored booking time for a human, always naming the timezone.

    Booking times are business-timezone wall clock carrying a cosmetic trailing "Z" (see
    api/availability.py). Printing them raw would show a UTC marker on a time that is not
    UTC, so the false marker is dropped and the real zone is named. An email that says
    "3:00 PM" without saying which 3:00 PM is how someone misses their own session.
    """
    cleaned = start_time_iso.replace("Z", "").replace("+00:00", "")
    try:
        moment = datetime.fromisoformat(cleaned)
    except ValueError:
        # Never let a formatting problem block a send; the raw value is still informative.
        return f"{start_time_iso} ({settings.BUSINESS_TIMEZONE})"
    stamp = moment.strftime("%A, %d %B %Y at %I:%M %p").replace(" 0", " ")
    if duration_minutes:
        return f"{stamp} ({duration_minutes} min) &middot; {settings.BUSINESS_TIMEZONE}"
    return f"{stamp} &middot; {settings.BUSINESS_TIMEZONE}"


def _meeting_link_block(meet_link: Optional[str]) -> str:
    """
    The join link, or an honest statement that there isn't one yet.

    google_calendar.py returns None when it could not create a conference. It used to return
    "https://meet.google.com/new" instead -- a link that looks like an invitation and drops
    the client into an empty meeting they are alone in. Saying the link is coming is worse
    news and better information.
    """
    if meet_link:
        return (
            f'<p style="margin:24px 0;">'
            f'<a href="{meet_link}" '
            f'style="background:#D32F2F;color:#fff;padding:12px 22px;border-radius:8px;'
            f'text-decoration:none;font-weight:bold;display:inline-block;">Join the meeting</a>'
            f'</p>'
            f'<p style="color:#555;font-size:13px;">Or paste this link: {meet_link}</p>'
        )
    return (
        '<p style="margin:24px 0;padding:14px 16px;background:#FFF8E1;'
        'border:1px solid #FFE082;border-radius:8px;color:#5D4037;font-size:14px;">'
        'Your meeting link is still being generated. We will email it to you shortly &mdash; '
        'your booking itself is confirmed and your time is reserved.'
        '</p>'
    )


def _shell(heading: str, body_html: str) -> str:
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;'
        'margin:0 auto;padding:28px 24px;color:#1a1a1a;line-height:1.55;">'
        f'<h1 style="font-size:21px;margin:0 0 18px;">{heading}</h1>'
        f'{body_html}'
        '<hr style="border:none;border-top:1px solid #eee;margin:28px 0 14px;">'
        '<p style="color:#888;font-size:12px;margin:0;">Sent by BookMyMeet.</p>'
        '</div>'
    )


async def _send(to_email: str, subject: str, html: str) -> bool:
    """
    Hands one message to Resend. Returns True only if Resend accepted it.

    Never raises: the call sites run after a booking is already committed, and an email
    outage must not turn a confirmed, paid booking into an error for the client.
    """
    if not settings.EMAIL_ENABLED:
        # Deliberately False, not True. Reporting success for an email that was never sent is
        # exactly the behaviour this module exists to remove.
        logger.warning(
            "Email not sent to %s (%r): RESEND_API_KEY and EMAIL_FROM_ADDRESS are not both set.",
            to_email, subject,
        )
        return False

    sender = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM_ADDRESS}>"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                RESEND_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"from": sender, "to": [to_email], "subject": subject, "html": html},
                timeout=TIMEOUT_SECONDS,
            )
    except Exception as exc:
        logger.error("Email to %s failed to reach Resend: %s", to_email, exc)
        return False

    if response.status_code in (200, 201, 202):
        return True

    # Log the status and body, never the API key.
    logger.error(
        "Resend rejected the email to %s: HTTP %s %s",
        to_email, response.status_code, response.text[:400],
    )
    return False


async def send_booking_confirmation_email(
    to_email: str,
    client_name: str,
    admin_name: str,
    session_title: str,
    start_time: str,
    duration_minutes: int,
    meet_link: Optional[str]
) -> bool:
    """Confirms a booking to the client. Returns True only if the message was accepted."""
    html = _shell(
        f"Your session with {admin_name} is confirmed",
        f'<p>Hi {client_name},</p>'
        f'<p>Your <strong>{session_title}</strong> with {admin_name} is booked.</p>'
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f'<strong>{_format_when(start_time, duration_minutes)}</strong></p>'
        f'{_meeting_link_block(meet_link)}'
        f'<p style="color:#555;font-size:13px;">Need to change something? Reply to this email '
        f'and {admin_name} will help.</p>'
    )
    return await _send(to_email, f"Confirmed: {session_title} with {admin_name}", html)


async def send_admin_new_booking_notification(
    admin_email: str,
    admin_name: str,
    client_name: str,
    client_email: str,
    session_title: str,
    start_time: str,
    meet_link: Optional[str]
) -> bool:
    """Alerts the host to a new confirmed booking. Returns True only if accepted."""
    html = _shell(
        f"New booking: {client_name}",
        f'<p>Hi {admin_name},</p>'
        f'<p><strong>{client_name}</strong> booked your <strong>{session_title}</strong>.</p>'
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f'<strong>{_format_when(start_time)}</strong><br>'
        f'<span style="color:#555;font-size:13px;">{client_email}</span></p>'
        f'{_meeting_link_block(meet_link)}'
    )
    return await _send(admin_email, f"New booking: {client_name} — {session_title}", html)


async def send_meeting_reminder_email(
    admin_email: str,
    admin_name: str,
    client_name: str,
    session_title: str,
    start_time: str,
    meet_link: Optional[str],
) -> bool:
    """Reminds the host of a meeting about to start. Returns True only if accepted."""
    from html import escape

    safe_client = escape(client_name or "your client")
    safe_title = escape(session_title or "Meeting")
    html = _shell(
        "Upcoming meeting",
        f'<p>Hi {escape(admin_name or "")},</p>'
        f'<p>You have a meeting with <strong>{safe_client}</strong>.</p>'
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f'<strong>{safe_title}</strong><br>{_format_when(start_time)}</p>'
        + (
            _meeting_link_block(escape(meet_link, quote=True))
            if meet_link
            # The client-facing "link is still being generated" wording would be wrong here:
            # the host needs to know there is no link to join.
            else '<p style="color:#5D4037;">No Google Meet link was created for this booking. '
                 'Send your client a meeting link before the session.</p>'
        )
    )
    return await _send(admin_email, f"Upcoming meeting: {client_name} — {session_title}", html)
