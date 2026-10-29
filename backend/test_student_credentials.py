"""
Student credentials: the temporary password (Adways@123), the Resend email that delivers it, and
the guarantee that the password in the email is the one that signs the student in.

Email delivery is stubbed at email_service._send, so nothing is ever sent. The stub records the
real HTML, and the tests parse the password OUT OF THAT HTML and log in with it, so a mismatch
between the account and the email cannot pass by both reading the same constant.
"""
import asyncio
import html as html_lib
import json
import logging
import re
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.api import students as students_api
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash, verify_password
from app.models.models import (
    AdminProfile, AllowanceAdjustment, StudentAllowance, StudentCredentialEmail,
    StudentPolicyAcceptance, User, UserSecurityState,
)
from app.services import email_service, student_accounts
from app.services.student_accounts import TEMP_PASSWORD, issue_temp_password, temp_password_is_current

seed_initial_data()
client = TestClient(app)
PW = "OwnerPassw0rd!1"
PW_HASH = get_password_hash(PW)
LEGACY = "Admin@123"          # the previous temporary password, kept only to prove it is gone
NEW_OWN_PASSWORD = "MyOwnPass!77"


@pytest.fixture
def tracked():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for uid in ids:
            for model, col in (
                (StudentAllowance, StudentAllowance.student_id), (AllowanceAdjustment, AllowanceAdjustment.student_id),
                (StudentCredentialEmail, StudentCredentialEmail.student_id),
                (StudentPolicyAcceptance, StudentPolicyAcceptance.student_id),
                (UserSecurityState, UserSecurityState.user_id), (AdminProfile, AdminProfile.user_id),
            ):
                db.query(model).filter(col == uid).delete(synchronize_session=False)
            db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


class _Mail:
    def __init__(self):
        self.sent = []
        self.ok = True
        self.user_visible_at_send = []
        self.emailed_password_authenticates_at_send = []


def _emailed_password(html):
    m = re.search(r"Temporary password:</strong>\s*([^<]+)<", html)
    assert m, "the credentials email has no temporary password line"
    return html_lib.unescape(m.group(1)).strip()


@pytest.fixture
def mail(monkeypatch):
    box = _Mail()

    async def fake_send(to_email, subject, html, reply_to=None):
        # Look at the database from a fresh session AT THE MOMENT OF SENDING: the account must
        # already be committed, and the password in this very email must already authenticate.
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == to_email).first()
            box.user_visible_at_send.append(user is not None)
            box.emailed_password_authenticates_at_send.append(
                user is not None and verify_password(_emailed_password(html), user.password_hash)
            )
        finally:
            db.close()
        box.sent.append({"to": to_email, "subject": subject, "html": html})
        return box.ok

    monkeypatch.setattr(email_service, "_send", fake_send)
    return box


def _make_user(tracked, role, tag, password_hash=PW_HASH, must_change=False):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        u = User(name=f"{role} {tag}", email=f"{role}_{tag}_{uid}@testdomain.com", password_hash=password_hash,
                 role=role, status="ACTIVE", must_change_password=must_change)
        db.add(u)
        db.flush()
        if role in ("super_admin", "admin"):
            db.add(AdminProfile(user_id=u.id, username=f"{role[:2]}{tag}{uid}"))
        db.commit()
        tracked.append(u.id)
        return {"id": u.id, "email": u.email}
    finally:
        db.close()


def _login(email, password):
    return client.post("/api/auth/login", json={"username_or_email": email, "password": password})


def _headers(response):
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def boss(tracked):
    u = _make_user(tracked, "super_admin", "cred")
    return {"id": u["id"], "email": u["email"], "h": _headers(_login(u["email"], PW))}


def _create(boss, tracked, email=None, allocated=2):
    email = email or f"stud_{uuid.uuid4().hex[:8]}@testdomain.com"
    r = client.post("/api/super-admin/students", headers=boss["h"], json={"name": "Stud", "email": email, "allocated": allocated})
    if r.status_code == 200:
        tracked.append(r.json()["id"])
    return email, r


def _row(email):
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.email == email).first()
        return None if u is None else {"id": u.id, "hash": u.password_hash, "must": u.must_change_password}
    finally:
        db.close()


def _user_count(email):
    db = SessionLocal()
    try:
        return db.query(User).filter(User.email == email).count()
    finally:
        db.close()


def _resend(boss, student_id, body=None):
    return client.post(f"/api/super-admin/students/{student_id}/resend-credentials", headers=boss["h"], json=body)


# --- the temporary password and the email that delivers it ---------------------------------------

def test_the_temporary_password_is_adways_and_old_one_is_gone():
    assert TEMP_PASSWORD == "Adways@123"          # the literal, not just "whatever the constant says"
    user = User(name="x", email="x@y.com", password_hash="", role="student")
    assert issue_temp_password(user) == "Adways@123"
    assert user.must_change_password is True
    assert verify_password("Adways@123", user.password_hash) and not verify_password(LEGACY, user.password_hash)
    assert user.password_hash.startswith("$2")    # bcrypt, never plaintext
    assert temp_password_is_current(user)
    user.password_hash = get_password_hash("SomethingElse1!")
    assert not temp_password_is_current(user)
    user.password_hash = get_password_hash(TEMP_PASSWORD)
    user.role = "admin"
    assert not temp_password_is_current(user)     # only students


def test_a_new_student_is_created_with_adways_and_emailed_exactly_that(tracked, boss, mail):
    email, r = _create(boss, tracked)
    assert r.status_code == 200 and r.json()["credential_email_sent"] is True and r.json()["allocated"] == 2

    row = _row(email)
    assert verify_password("Adways@123", row["hash"]) and not verify_password(LEGACY, row["hash"])
    assert row["must"] is True

    assert len(mail.sent) == 1
    sent = mail.sent[0]
    assert sent["to"] == email and sent["subject"] == "Your BookMyMeet student account"
    assert _emailed_password(sent["html"]) == "Adways@123"
    assert LEGACY not in sent["html"]
    assert email in sent["html"]                                                        # the login email
    assert f"{settings.APP_URL.rstrip('/')}/admin/login" in sent["html"]                # the login URL
    assert "change this temporary password immediately" in sent["html"].lower()         # the instruction


def test_the_emailed_password_is_proven_by_logging_in_with_it(tracked, boss, mail):
    email, _ = _create(boss, tracked)
    emailed = _emailed_password(mail.sent[0]["html"])

    # The email was sent only after the account was committed, and the password in that very
    # email already authenticated at that moment.
    assert mail.user_visible_at_send == [True]
    assert mail.emailed_password_authenticates_at_send == [True]

    ok = _login(email, emailed)                                    # the parsed value, not the constant
    assert ok.status_code == 200 and ok.json()["role"] == "student" and ok.json()["must_change_password"] is True
    assert _login(email, LEGACY).status_code == 401


def test_first_login_forces_a_password_change_on_the_backend(tracked, boss, mail):
    email, _ = _create(boss, tracked)
    token = _headers(_login(email, _emailed_password(mail.sent[0]["html"])))

    # Navigating straight to any student API is refused until the password is changed.
    for path in ("/api/student/me", "/api/student/bookings", "/api/student/meeting-types", "/api/student/recordings"):
        r = client.get(path, headers=token)
        assert r.status_code == 403 and r.json()["detail"] == "password_change_required", path

    changed = client.post("/api/auth/change-password", headers=token, json={"new_password": NEW_OWN_PASSWORD})
    assert changed.status_code == 200 and changed.json()["must_change_password"] is False
    assert client.get("/api/student/me", headers=_headers(changed)).status_code == 200

    assert _login(email, NEW_OWN_PASSWORD).status_code == 200      # the new password works
    assert _login(email, "Adways@123").status_code == 401          # the temporary one no longer does


# --- delivery failures, duplicates and retries ---------------------------------------------------

def test_a_failed_email_makes_no_duplicate_and_the_retry_is_safe(tracked, boss, mail):
    mail.ok = False
    email, r = _create(boss, tracked)
    assert r.status_code == 200 and r.json()["credential_email_sent"] is False
    assert r.json()["credential_email"]["status"] == "failed"
    assert _user_count(email) == 1
    first_hash = _row(email)["hash"]

    # Creating the same student again is refused and does not even try to email.
    again = client.post("/api/super-admin/students", headers=boss["h"], json={"name": "Dup", "email": email, "allocated": 1})
    assert again.status_code == 400 and len(mail.sent) == 1 and _user_count(email) == 1

    # Retry through "Send credentials": same account, same password, not re-hashed.
    mail.ok = True
    retry = _resend(boss, r.json()["id"])
    assert retry.status_code == 200 and retry.json()["sent"] is True and retry.json()["password_reset"] is False
    assert _user_count(email) == 1 and _row(email)["hash"] == first_hash
    assert retry.json()["credential_email"]["attempts"] == 2 and retry.json()["credential_email"]["status"] == "sent"
    assert _emailed_password(mail.sent[-1]["html"]) == "Adways@123"


def test_an_admin_email_is_refused_and_nothing_is_sent(tracked, boss, mail):
    admin = _make_user(tracked, "admin", "dupmail")
    r = client.post("/api/super-admin/students", headers=boss["h"], json={"name": "X", "email": admin["email"], "allocated": 1})
    assert r.status_code == 400 and mail.sent == []


def test_the_send_guard_refuses_when_the_account_does_not_have_that_password(tracked, boss, mail):
    email, r = _create(boss, tracked)
    db = SessionLocal()
    try:
        student = db.query(User).filter(User.email == email).first()
        student.password_hash = get_password_hash("NotTheTempOne1!")      # simulated drift
        db.commit()
        sent = asyncio.run(students_api._deliver_credentials(db, student))
        row = db.query(StudentCredentialEmail).filter(StudentCredentialEmail.student_id == student.id).first()
        assert sent is False and len(mail.sent) == 1                      # only the original creation email
        assert row.status == "failed" and "not set" in row.last_error
    finally:
        db.close()


# --- existing students are never silently reset --------------------------------------------------

def test_resend_never_silently_replaces_a_password_the_student_chose(tracked, boss, mail):
    email, r = _create(boss, tracked)
    sid = r.json()["id"]
    first = _headers(_login(email, _emailed_password(mail.sent[0]["html"])))
    own = client.post("/api/auth/change-password", headers=first, json={"new_password": NEW_OWN_PASSWORD})
    old_session = _headers(own)

    for body in (None, {}, {"reset_password": False}):
        refused = _resend(boss, sid, body)
        assert refused.status_code == 409
        assert refused.json()["detail"] == {"code": "reset_confirmation_required", "reason": "student_set_own_password"}
    assert len(mail.sent) == 1                                            # nothing was emailed
    assert _login(email, NEW_OWN_PASSWORD).status_code == 200             # their password is untouched
    assert _login(email, "Adways@123").status_code == 401

    time.sleep(1.1)                                                       # token revocation is per second
    done = _resend(boss, sid, {"reset_password": True})
    assert done.status_code == 200 and done.json()["password_reset"] is True and done.json()["sent"] is True
    assert _login(email, NEW_OWN_PASSWORD).status_code == 401
    assert _login(email, "Adways@123").json()["must_change_password"] is True
    assert client.get("/api/auth/me", headers=old_session).status_code == 401     # old sessions revoked
    assert _emailed_password(mail.sent[-1]["html"]) == "Adways@123"
    assert mail.emailed_password_authenticates_at_send[-1] is True        # reset committed BEFORE the send


def test_a_legacy_temporary_password_student_is_not_touched_until_confirmed(tracked, boss, mail):
    legacy = _make_user(tracked, "student", "legacy", password_hash=get_password_hash(LEGACY), must_change=True)
    before = _row(legacy["email"])["hash"]

    # Creating new students does not rehash anyone else.
    _create(boss, tracked)
    assert _row(legacy["email"])["hash"] == before
    assert _login(legacy["email"], LEGACY).status_code == 200
    assert _login(legacy["email"], "Adways@123").status_code == 401

    mails_before = len(mail.sent)
    refused = _resend(boss, legacy["id"])
    assert refused.status_code == 409 and refused.json()["detail"]["reason"] == "legacy_temporary_password"
    assert len(mail.sent) == mails_before and _row(legacy["email"])["hash"] == before

    done = _resend(boss, legacy["id"], {"reset_password": True})
    assert done.status_code == 200 and done.json()["password_reset"] is True
    assert _login(legacy["email"], "Adways@123").status_code == 200
    assert _login(legacy["email"], LEGACY).status_code == 401
    assert _emailed_password(mail.sent[-1]["html"]) == "Adways@123"


def test_a_student_still_on_the_temporary_password_can_be_re_sent_without_a_reset(tracked, boss, mail):
    email, r = _create(boss, tracked)
    before = _row(email)["hash"]
    again = _resend(boss, r.json()["id"])
    assert again.status_code == 200 and again.json()["password_reset"] is False and again.json()["sent"] is True
    assert _row(email)["hash"] == before and len(mail.sent) == 2


def test_a_disabled_student_is_not_sent_credentials(tracked, boss, mail):
    email, r = _create(boss, tracked)
    db = SessionLocal()
    try:
        db.query(User).filter(User.email == email).update({User.status: "TEMPORARILY_DISABLED"})
        db.commit()
    finally:
        db.close()
    refused = _resend(boss, r.json()["id"])
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "student_disabled"
    assert len(mail.sent) == 1


def test_other_roles_are_unaffected(tracked, boss, mail):
    admin = _make_user(tracked, "admin", "keep")
    admin_hash = _row(admin["email"])["hash"]
    boss_hash = _row(boss["email"])["hash"]

    email, r = _create(boss, tracked)
    _resend(boss, r.json()["id"])
    assert _resend(boss, admin["id"], {"reset_password": True}).status_code == 404     # not a student

    for who, original in ((admin, admin_hash), (boss, boss_hash)):
        row = _row(who["email"])
        assert row["hash"] == original and not row["must"]
        assert _login(who["email"], PW).status_code == 200
        assert _login(who["email"], "Adways@123").status_code == 401


# --- nothing leaks -------------------------------------------------------------------------------

def test_the_password_never_appears_in_logs_responses_or_stored_columns(tracked, boss, mail, caplog):
    caplog.set_level(logging.DEBUG)
    bodies = []

    mail.ok = False
    email, created = _create(boss, tracked)
    bodies.append(created.text)
    mail.ok = True
    sid = created.json()["id"]
    bodies.append(_resend(boss, sid).text)
    token = _headers(_login(email, "Adways@123"))
    bodies.append(client.get("/api/student/me", headers=token).text)
    bodies.append(client.post("/api/auth/change-password", headers=token, json={"new_password": NEW_OWN_PASSWORD}).text)
    time.sleep(1.1)
    bodies.append(_resend(boss, sid).text)                                  # 409 refusal body
    bodies.append(_resend(boss, sid, {"reset_password": True}).text)
    bodies.append(client.get("/api/super-admin/students", headers=boss["h"]).text)
    bodies.append(client.get(f"/api/super-admin/students/{sid}", headers=boss["h"]).text)

    for secret in ("Adways@123", LEGACY, NEW_OWN_PASSWORD):
        assert not any(secret in b for b in bodies), f"{secret} appeared in an API response"
        assert not any(secret in rec.getMessage() or secret in str(rec.args) for rec in caplog.records), f"{secret} was logged"

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user.password_hash.startswith("$2") and user.password_hash not in ("Adways@123", LEGACY)
        columns = " ".join(
            str(getattr(r, c.name)) for r in db.query(StudentCredentialEmail).filter(StudentCredentialEmail.student_id == sid)
            for c in StudentCredentialEmail.__table__.columns
        )
        assert "Adways@123" not in columns and LEGACY not in columns
        stored = " ".join(str(getattr(user, c.name)) for c in User.__table__.columns if c.name != "password_hash")
        assert "Adways@123" not in stored
    finally:
        db.close()
    assert "Adways" not in json.dumps([b for b in bodies])
