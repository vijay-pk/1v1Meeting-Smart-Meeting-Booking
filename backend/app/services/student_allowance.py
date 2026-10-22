"""
Free-meeting allowance accounting.

The only stored number is `StudentAllowance.allocated`. Everything else is derived from the
booking table, so the "available" count can never drift from what the student actually did:

    consumed  = free bookings in a terminal "used" state (completed, or a policy no-show)
    available = allocated - consumed

Because consumed is counted from rows, completion is inherently idempotent -- marking a booking
`completed` a second time changes no count, and there is no separate counter to double-decrement.
Booking a free session does NOT consume (the booking is only `pending`/`confirmed`); a valid
cancellation leaves no `completed` row, so it never consumes; paid bookings are a different
category and are never counted here.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Booking, StudentAllowance

# A free booking consumes the allowance only once it reaches one of these terminal states.
CONSUMING_ATTENDANCE = ("completed", "no_show")


def allocated(db: Session, student_id: str) -> int:
    row = db.query(StudentAllowance).filter(StudentAllowance.student_id == student_id).first()
    return int(row.allocated) if row else 0


def consumed(db: Session, student_id: str) -> int:
    """Free bookings this student has actually used (completed or policy no-show)."""
    return int(
        db.query(func.count(Booking.id))
        .filter(
            Booking.student_id == student_id,
            Booking.category == "student_free",
            Booking.attendance_status.in_(CONSUMING_ATTENDANCE),
        )
        .scalar()
        or 0
    )


def available(db: Session, student_id: str) -> int:
    """Remaining free meetings. Never negative."""
    return max(0, allocated(db, student_id) - consumed(db, student_id))


def completed_count(db: Session, student_id: str) -> int:
    return int(
        db.query(func.count(Booking.id))
        .filter(
            Booking.student_id == student_id,
            Booking.category == "student_free",
            Booking.attendance_status == "completed",
        )
        .scalar()
        or 0
    )


def summary(db: Session, student_id: str) -> dict:
    alloc = allocated(db, student_id)
    used = consumed(db, student_id)
    return {
        "allocated": alloc,
        "consumed": used,
        "available": max(0, alloc - used),
        "completed": completed_count(db, student_id),
    }


def set_allocation(db: Session, student_id: str, new_value: int) -> StudentAllowance:
    """Create or update the allocation. Caller writes the AllowanceAdjustment audit row."""
    row = db.query(StudentAllowance).filter(StudentAllowance.student_id == student_id).first()
    if row is None:
        row = StudentAllowance(student_id=student_id, allocated=max(0, new_value))
        db.add(row)
    else:
        row.allocated = max(0, new_value)
    return row
