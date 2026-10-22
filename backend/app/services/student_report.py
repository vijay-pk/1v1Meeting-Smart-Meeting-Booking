"""
Student meeting report. Built entirely from authoritative DB rows (bookings, payments,
allowance adjustments) -- never invented. A field with no record shows "Not recorded". Rendered
as HTML for preview and for the Resend email; no secrets (keys, tokens, other students) appear.
"""
from datetime import datetime, timezone
from html import escape

from sqlalchemy.orm import Session

from app.models.models import User, Booking, Payment, AllowanceAdjustment
from app.services import student_allowance


def _fmt_money(paise, currency="INR"):
    if paise is None:
        return "Not recorded"
    return f"{currency} {paise/100:,.2f}"


def _rows_html(db: Session, student: User) -> str:
    bookings = (
        db.query(Booking)
        .filter(Booking.student_id == student.id)
        .order_by(Booking.start_time.desc())
        .all()
    )
    if not bookings:
        return '<p style="color:#666;">No sessions recorded.</p>'
    cells = []
    for b in bookings:
        payment = db.query(Payment).filter(Payment.booking_id == b.id).first()
        title = escape(b.meeting_type.title if b.meeting_type else "Session")
        kind = {"student_free": "Free", "student_paid": "Paid"}.get(b.category, "—")
        paid = _fmt_money(payment.amount, payment.currency) if (b.category == "student_paid" and payment) else "—"
        pay_status = escape(payment.status) if (b.category == "student_paid" and payment) else "—"
        cells.append(
            "<tr>"
            f"<td>{escape(b.public_id or b.id)}</td>"
            f"<td>{title}</td>"
            f"<td>{escape(b.start_time)} ({escape(b.timezone or '')})</td>"
            f"<td>{kind}</td>"
            f"<td>{escape(b.status)}</td>"
            f"<td>{escape(b.attendance_status or 'Not recorded')}</td>"
            f"<td>{paid} / {pay_status}</td>"
            "</tr>"
        )
    return (
        '<table style="width:100%;border-collapse:collapse;font-size:13px;" border="1" cellpadding="6">'
        "<thead><tr style='background:#F5F7FA;'>"
        "<th>Ref</th><th>Meeting</th><th>When</th><th>Type</th><th>Status</th>"
        "<th>Attendance</th><th>Paid / Payment</th>"
        "</tr></thead><tbody>" + "".join(cells) + "</tbody></table>"
    )


def build_report_html(db: Session, student: User) -> str:
    summ = student_allowance.summary(db, student.id)
    adjustments = (
        db.query(AllowanceAdjustment)
        .filter(AllowanceAdjustment.student_id == student.id)
        .order_by(AllowanceAdjustment.created_at.asc())
        .all()
    )
    adj_html = "".join(
        f"<li>{a.old_value} → {a.new_value}"
        f"{(' (' + escape(a.reason) + ')') if a.reason else ''}"
        f" — {a.created_at.strftime('%d %b %Y') if a.created_at else ''}</li>"
        for a in adjustments
    ) or "<li>None</li>"

    generated = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    return (
        f'<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">'
        f"<h2 style='margin:0 0 4px;'>Meeting report — {escape(student.name)}</h2>"
        f"<p style='color:#666;margin:0 0 16px;'>{escape(student.email)} · generated {generated}</p>"
        f"<p><strong>Free meetings:</strong> {summ['allocated']} allocated · "
        f"{summ['completed']} completed · {summ['available']} remaining</p>"
        f"<h3 style='margin:18px 0 6px;'>Sessions</h3>{_rows_html(db, student)}"
        f"<h3 style='margin:18px 0 6px;'>Allowance adjustments</h3><ul>{adj_html}</ul>"
        f"</div>"
    )
