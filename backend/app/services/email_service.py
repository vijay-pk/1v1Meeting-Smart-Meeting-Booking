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


async def _send(to_email: str, subject: str, html: str, reply_to: Optional[str] = None) -> bool:
    """
    Hands one message to Resend. Returns True only if Resend accepted it.

    Never raises: the call sites run after a booking is already committed, and an email
    outage must not turn a confirmed, paid booking into an error for the client.

    reply_to defaults to settings.EMAIL_REPLY_TO. The From address must be on a Resend-verified
    domain -- a gmail.com From is rejected 403 -- so replies are steered to the owner's inbox
    through Reply-To instead of by forging the sender.
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
    payload = {"from": sender, "to": [to_email], "subject": subject, "html": html}
    reply_to = reply_to or settings.EMAIL_REPLY_TO
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                RESEND_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
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


def _reschedule_block(reschedule_url: Optional[str], admin_name: str) -> str:
    """A reschedule link for the client, or the reply-to-change fallback when there is none."""
    if reschedule_url:
        return (
            f'<p style="color:#555;font-size:13px;margin:18px 0 4px;">Need a different time?</p>'
            f'<p style="margin:0 0 8px;">'
            f'<a href="{reschedule_url}" '
            f'style="color:#D32F2F;font-weight:bold;text-decoration:underline;">'
            f'Reschedule this session</a></p>'
            f'<p style="color:#888;font-size:12px;">Or reply to this email and {admin_name} will help.</p>'
        )
    return (
        f'<p style="color:#555;font-size:13px;">Need to change something? Reply to this email '
        f'and {admin_name} will help.</p>'
    )


async def send_booking_confirmation_email(
    to_email: str,
    client_name: str,
    admin_name: str,
    session_title: str,
    start_time: str,
    duration_minutes: int,
    meet_link: Optional[str],
    reschedule_url: Optional[str] = None,
) -> bool:
    """Confirms a booking to the client. Returns True only if the message was accepted."""
    html = _shell(
        f"Your session with {admin_name} is confirmed",
        f'<p>Hi {client_name},</p>'
        f'<p>Your <strong>{session_title}</strong> with {admin_name} is booked.</p>'
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f'<strong>{_format_when(start_time, duration_minutes)}</strong></p>'
        f'{_meeting_link_block(meet_link)}'
        f'{_reschedule_block(reschedule_url, admin_name)}'
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


async def send_student_credentials_email(
    to_email: str,
    student_name: str,
    temp_password: str,
    login_url: str,
) -> bool:
    """
    Sends a newly created student their login email + temporary password. The student is forced
    to change it on first sign-in. Returns True only if Resend accepted the message.
    """
    from html import escape

    html = _shell(
        "Your BookMyMeet student account is ready",
        f"<p>Hi {escape(student_name or 'there')},</p>"
        f"<p>An account has been created for you. Sign in and you'll be asked to set your own "
        f"password before you continue.</p>"
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f"<strong>Email:</strong> {escape(to_email)}<br>"
        f"<strong>Temporary password:</strong> {escape(temp_password)}</p>"
        f'<p style="margin:22px 0;">'
        f'<a href="{login_url}" style="background:#D32F2F;color:#fff;padding:12px 22px;'
        f'border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">'
        f"Sign in</a></p>"
        f'<p style="color:#555;font-size:13px;">Login page: {escape(login_url)}</p>'
        f'<p style="color:#555;font-size:13px;"><strong>Sign in and change this temporary '
        f"password immediately.</strong> You will be asked to choose your own password before "
        f"you can use your account.</p>"
    )
    return await _send(to_email, "Your BookMyMeet student account", html)


async def send_recording_ready_email(
    to_email: str,
    student_name: str,
    meeting_title: str,
    meeting_date: str,
    dashboard_url: str,
) -> bool:
    """Tells a student their session recording is ready. Link opens the authenticated dashboard."""
    from html import escape

    html = _shell(
        "Your session recording is ready",
        f"<p>Hello {escape(student_name or 'there')},</p>"
        f"<p>Your recording for <strong>{escape(meeting_title)}</strong> on "
        f"{escape(meeting_date)} is now available.</p>"
        f'<p style="margin:22px 0;">'
        f'<a href="{dashboard_url}" style="background:#D32F2F;color:#fff;padding:12px 22px;'
        f'border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">'
        f"Open My Recordings</a></p>"
        f'<p style="color:#555;font-size:13px;">Sign in to your student dashboard and open the '
        f"Meeting Recordings section to watch it.</p>"
    )
    return await _send(to_email, "Your BookMyMeet session recording is ready", html)


async def send_student_report_email(
    to_email: str,
    student_name: str,
    html_body: str,
) -> bool:
    """Delivers a Super-Admin-generated meeting report to the student."""
    html = _shell("Your BookMyMeet meeting report", html_body)
    return await _send(to_email, "Your BookMyMeet meeting report", html)


async def send_booking_rescheduled_email(
    to_email: str,
    recipient_name: str,
    other_party: str,
    session_title: str,
    new_start_time: str,
    duration_minutes: Optional[int],
    meet_link: Optional[str],
    is_host: bool = False,
) -> bool:
    """
    Tells one party a booking moved to a new time. Used for both client and host; the Meet
    link is unchanged by a reschedule, so it is included again for convenience.
    """
    from html import escape

    safe_name = escape(recipient_name or ("Host" if is_host else "there"))
    safe_other = escape(other_party or "")
    safe_title = escape(session_title or "1:1 Session")
    who = f"with {safe_other}" if safe_other else ""
    html = _shell(
        "Your session has been rescheduled",
        f"<p>Hi {safe_name},</p>"
        f"<p>The <strong>{safe_title}</strong> {who} has a new time.</p>"
        f'<p style="margin:18px 0;padding:14px 16px;background:#F5F7FA;border-radius:8px;">'
        f"<strong>{_format_when(new_start_time, duration_minutes)}</strong></p>"
        f"{_meeting_link_block(meet_link)}"
    )
    return await _send(to_email, f"Rescheduled: {session_title}", html)


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


async def send_grace_period_warning_email(
    admin_email: str,
    client_email: str,
    client_name: str,
    admin_name: str,
    session_title: str,
    termination_time_str: str,
) -> bool:
    """
    Notifies host and client that the scheduled booking time has ended and the wrap-up grace period has begun.
    """
    from html import escape
    from app.services.meeting_termination import GRACE_PERIOD_MINUTES

    safe_client = escape(client_name or "Client")
    safe_admin = escape(admin_name or "Host")
    safe_title = escape(session_title or "1:1 Session")
    safe_time = escape(termination_time_str)

    html = _shell(
        "Your booked meeting time has ended",
        f"<p>Hello,</p>"
        f"<p>Your scheduled <strong>{safe_title}</strong> with {safe_admin} has reached its booked end time.</p>"
        f'<div style="margin:18px 0;padding:16px;background:#FFF3CD;border:1px solid #FFEEBA;border-radius:8px;color:#856404;">'
        f'<p style="font-size:16px;font-weight:bold;margin:0 0 8px 0;">Your booked meeting time has ended</p>'
        f'<p style="margin:0;">Your scheduled session has ended. You have {GRACE_PERIOD_MINUTES} minutes to wrap up your conversation. '
        f'This Google Meet will end automatically at <strong>{safe_time}</strong>.</p>'
        f"</div>"
    )
    subject = "Your booked meeting time has ended"
    sent_any = False
    if client_email:
        res_c = await _send(client_email, subject, html)
        sent_any = sent_any or res_c
    if admin_email and admin_email != client_email:
        res_a = await _send(admin_email, subject, html)
        sent_any = sent_any or res_a
    return sent_any

