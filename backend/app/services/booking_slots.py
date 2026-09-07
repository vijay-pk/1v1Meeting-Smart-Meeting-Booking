"""
Slot-occupancy rules shared by the availability engine and the payment flow.

These two have to agree exactly. If the picker thinks a slot is free and create-order thinks
it is taken, the client gets a 409 on a slot they were just offered; if it is the other way
round, a slot silently disappears from the calendar. They previously disagreed about
abandoned checkouts, which is why this module exists rather than a helper inside either one.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.models import Booking

logger = logging.getLogger(__name__)

# How long a pending_payment booking may sit unpaid before its slot is released.
#
# The hold created by /bookings/hold-slot lives 10 minutes; this is that plus enough slack
# for a slow Razorpay callback, so a client who is genuinely still paying is never cut off.
ABANDONED_CHECKOUT_MINUTES = 30


def as_utc(value: datetime) -> datetime:
    """
    Reads a stored timestamp as UTC.

    Every DateTime column is declared without timezone=True, so SQLite hands back naive
    datetimes even though the application always writes aware UTC ones. Comparing a naive
    value against an aware "now" raises TypeError -- which is how an expiry check becomes a
    500 on one database backend while passing every test on another.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def is_occupying(booking: Booking, now_utc: datetime) -> bool:
    """
    True when this booking still holds its slot against everyone else.

    Confirmed bookings always do. A pending_payment booking does only while its checkout
    window is open: a client who opened Razorpay and closed the tab leaves that row behind
    forever, and nothing ever swept it, so one abandoned tab used to take a slot off the
    calendar permanently.
    """
    if booking.status == "confirmed":
        return True
    if booking.status != "pending_payment":
        return False
    cutoff = now_utc - timedelta(minutes=ABANDONED_CHECKOUT_MINUTES)
    return as_utc(booking.created_at) > cutoff


def expire_abandoned_bookings(
    db: Session, *, admin_id: str, start_time: str, now_utc: datetime
) -> int:
    """
    Marks unpaid bookings for one slot as "expired" once their checkout window has passed.

    Returns how many were released. Deliberately narrow: it touches only the exact slot being
    booked, so it can never disturb an unrelated booking, and it only moves rows that are
    still "pending_payment".
    """
    stale = (
        db.query(Booking)
        .filter(
            Booking.admin_id == admin_id,
            Booking.start_time == start_time,
            Booking.status == "pending_payment",
        )
        .all()
    )
    released = 0
    for booking in stale:
        if is_occupying(booking, now_utc):
            continue  # still inside its checkout window
        booking.status = "expired"
        released += 1
    if released:
        db.flush()
        logger.info(
            "Released %d abandoned booking(s) for admin %s at %s", released, admin_id, start_time
        )
    return released
