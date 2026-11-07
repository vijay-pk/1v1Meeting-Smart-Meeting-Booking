"""
The Students tab list is built by `_student_rows` in a constant number of queries. It must report
exactly what the per-student `_student_row` reports -- the same allocation, used, remaining,
upcoming and paid counts -- across every booking state, or the optimisation changed a number.
"""
import uuid

from sqlalchemy import event

from app.api.students import _student_row, _student_rows
from app.core.database import SessionLocal, engine
from app.models.models import Booking, StudentAllowance, StudentCredentialEmail, User
from test_student_system import tracked, _user, _headers, client  # noqa: F401


def _booking(db, host_id, student_id, *, category, status, attendance, start):
    db.add(Booking(
        public_id=f"BK-{uuid.uuid4().hex[:8]}", admin_id=host_id, student_id=student_id, category=category,
        client_name="x", client_email="x@y.com", start_time=start, end_time=start,
        status=status, payment_status="free" if category == "student_free" else "completed",
        attendance_status=attendance, cancellation_token=uuid.uuid4().hex,
    ))


def test_bulk_rows_match_the_per_student_rows(tracked):
    boss = _user(tracked, "super_admin", "bk")
    students = [_user(tracked, "student", f"s{i}") for i in range(4)]
    db = SessionLocal()
    try:
        for st in students[:3]:
            db.query(User).filter(User.id == st["id"]).update({"must_change_password": True})
            db.add(StudentAllowance(student_id=st["id"], allocated=3))
        # student 0: two completed, one no-show, one pending, one cancelled free, one paid, one upcoming
        s0 = students[0]["id"]
        _booking(db, boss["id"], s0, category="student_free", status="confirmed", attendance="completed", start="2026-01-01T10:00:00Z")
        _booking(db, boss["id"], s0, category="student_free", status="confirmed", attendance="completed", start="2026-01-02T10:00:00Z")
        _booking(db, boss["id"], s0, category="student_free", status="confirmed", attendance="no_show", start="2026-01-03T10:00:00Z")
        _booking(db, boss["id"], s0, category="student_free", status="confirmed", attendance="pending", start="2099-01-04T10:00:00Z")
        _booking(db, boss["id"], s0, category="student_free", status="cancelled", attendance="pending", start="2099-01-05T10:00:00Z")
        _booking(db, boss["id"], s0, category="student_paid", status="confirmed", attendance="pending", start="2099-01-06T10:00:00Z")
        # student 1: over-used (allocated 3, four completed) -> remaining must clamp at 0
        for d in range(4):
            _booking(db, boss["id"], students[1]["id"], category="student_free", status="confirmed",
                     attendance="completed", start=f"2026-02-0{d + 1}T10:00:00Z")
        # student 2: allowance but no bookings, a credential row; student 3: no allowance row at all
        db.add(StudentCredentialEmail(student_id=students[2]["id"], status="failed", attempts=2, last_error="boom"))
        db.commit()

        rows = db.query(User).filter(User.id.in_([s["id"] for s in students])).all()
        bulk = {r["id"]: r for r in _student_rows(db, rows)}
        for st in rows:
            assert bulk[st.id] == _student_row(db, st), st.email
        assert bulk[students[1]["id"]]["remaining"] == 0
        assert bulk[students[3]["id"]]["allocated"] == 0
        assert bulk[students[0]["id"]]["completed"] == 2
        assert bulk[students[0]["id"]]["remaining"] == 0  # 2 completed + 1 no-show consume 3 of 3
    finally:
        db.close()


def test_list_endpoint_uses_a_constant_number_of_queries(tracked):
    boss = _user(tracked, "super_admin", "bq")
    headers, _ = _headers(boss["email"])
    for i in range(6):
        _user(tracked, "student", f"q{i}")

    count = {"n": 0}

    def bump(*_a, **_k):
        count["n"] += 1

    event.listen(engine, "before_cursor_execute", bump)
    try:
        res = client.get("/api/super-admin/students", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", bump)
    assert res.status_code == 200
    assert len(res.json()) >= 6
    assert count["n"] <= 12, count["n"]  # auth + role + list + three bulk queries, however many students
