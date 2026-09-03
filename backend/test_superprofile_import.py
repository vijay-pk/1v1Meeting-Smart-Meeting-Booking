"""
Tests for "Import from SuperProfile".

The network is stubbed throughout: `fetch_public_page` is monkeypatched, so no test ever
reaches superprofile.bio. The URL-validation and SSRF tests deliberately do *not* stub it —
they assert the request is refused before any fetch is attempted.

Rows are created and torn down per test, in the manner of test_admin_deletion.py.
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    ProfileImport,
)
from app.api import profile_imports as import_api
from app.services import superprofile_import as sp

# Ensures the schema exists (including profile_imports) without booting the app's lifespan.
seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!"


# ---------------------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------------------

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def reset_rate_limit():
    """The preview limiter is process-global; a full run would otherwise trip it."""
    import_api._preview_calls.clear()
    yield
    import_api._preview_calls.clear()


@pytest.fixture
def tracked():
    ids = []
    yield ids

    session = SessionLocal()
    try:
        for user_id in ids:
            # Each table separately: one failure (a missing table on a half-migrated
            # database, say) must not strand the user row and pollute later runs.
            for model, column in [
                (ProfileImport, ProfileImport.admin_id),
                (SessionModel, SessionModel.admin_id),
                (AvailabilityRule, AvailabilityRule.admin_id),
                (AdminProfile, AdminProfile.user_id),
            ]:
                try:
                    session.query(model).filter(column == user_id).delete(synchronize_session=False)
                    session.commit()
                except Exception:
                    session.rollback()
            try:
                session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
                session.commit()
            except Exception:
                session.rollback()
    finally:
        session.close()


def _make_admin(tracked, *, role="admin"):
    uid = uuid.uuid4().hex[:8]
    email = f"imp_{uid}@testdomain.com"
    session = SessionLocal()
    try:
        user = User(
            name="Import Test Admin",
            email=email,
            password_hash=get_password_hash(PASSWORD),
            role=role,
            status="ACTIVE",
        )
        session.add(user)
        session.flush()
        username = f"imp{uid}"
        session.add(AdminProfile(user_id=user.id, username=username))
        session.commit()
        tracked.append(user.id)
        admin_id, admin_email = user.id, user.email
    finally:
        session.close()

    login = client.post("/api/auth/login", json={"username_or_email": admin_email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {
        "id": admin_id,
        "email": admin_email,
        "username": username,
        "headers": {"Authorization": f"Bearer {login.json()['access_token']}"},
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked)


def _page(prefetched: dict, *, meta: dict | None = None) -> str:
    """
    Builds a SuperProfile-shaped HTML page around a __NEXT_DATA__ payload.

    "<" is escaped as \u003c exactly as Next.js does when it serialises __NEXT_DATA__ --
    otherwise a "</script>" inside the JSON would terminate the script element early.
    """
    payload = {"props": {"pageProps": {"prefetchedData": prefetched}}}
    serialised = json.dumps(payload).replace(chr(60), chr(92) + "u003c")
    meta_tags = "".join(
        f'<meta property="{k}" content="{v}">' for k, v in (meta or {}).items()
    )
    return (
        "<html><head>" + meta_tags +
        '<script id="__NEXT_DATA__" type="application/json">' + serialised + "</script>"
        "</head><body></body></html>"
    )


@pytest.fixture
def stub_page(monkeypatch):
    """Serves a controllable page body in place of the real fetch."""
    state = {"html": _page({})}

    async def fake_fetch(url, **kwargs):
        return state["html"]

    monkeypatch.setattr(sp, "fetch_public_page", fake_fetch)
    monkeypatch.setattr(import_api, "import_superprofile", _rebuilt_import(fake_fetch))
    return state


def _rebuilt_import(fake_fetch):
    """import_superprofile with the stubbed fetch, keeping real validation and parsing."""
    async def _import(url: str, page_html: str | None = None):
        validated = sp.validate_superprofile_url(url)
        html = page_html or await fake_fetch(validated)
        return sp.parse_superprofile(html, validated)
    return _import


def _preview(admin, url="https://superprofile.bio/testhandle"):
    return client.post("/api/profile-import/preview", headers=admin["headers"], json={"source_url": url})


ONE_SESSION = {
    "creator": {"aboutMe": {"name": "Real Name", "title": "Growth consultant", "bio": "Public bio text."}},
    "sessions": [{
        "title": "1:1 Digital Marketing Consultation",
        "description": "The exact publicly displayed session description",
        "duration": 30,
        "price": 999,
        "currency": "INR",
    }],
}


# ---------------------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------------------

def test_preview_requires_authentication():
    res = client.post("/api/profile-import/preview", json={"source_url": "https://superprofile.bio/x"})
    assert res.status_code == 401


def test_client_role_cannot_import(tracked):
    customer = _make_admin(tracked, role="client")
    res = _preview(customer)
    assert res.status_code == 403


def test_admin_cannot_read_another_admins_import(tracked, stub_page, admin):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    other = _make_admin(tracked)
    # 404, not 403: import ids on other accounts must not be probeable.
    assert client.get(f"/api/profile-import/{import_id}", headers=other["headers"]).status_code == 404


def test_admin_cannot_apply_another_admins_import(tracked, stub_page, admin):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    other = _make_admin(tracked)
    res = client.post("/api/profile-import/apply", headers=other["headers"], json={
        "import_id": import_id,
        "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert res.status_code == 404


def test_update_action_cannot_target_another_admins_session(tracked, stub_page, admin, db):
    victim = _make_admin(tracked)
    victim_session = SessionModel(admin_id=victim["id"], title="Victim session", duration_minutes=30, price=5000)
    db.add(victim_session)
    db.commit()
    victim_session_id = victim_session.id

    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id,
        "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "update", "target_session_id": victim_session_id}],
    })
    assert res.status_code == 200
    assert res.json()["sessions_updated"] == 0
    assert res.json()["sessions_skipped"] == 1

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.id == victim_session_id).first().title == "Victim session"


# ---------------------------------------------------------------------------------------
# URL validation and SSRF (no fetch stub: these must be refused before any request)
# ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("bad_url", [
    "",
    "not a url",
    "http://superprofile.bio/handle",              # plain http
    "https://example.com/handle",                  # wrong host
    "https://evil.example.com/?q=superprofile.bio",  # substring, not host
    "https://superprofile.bio.evil.com/handle",    # suffix trick
    "https://localhost/handle",
    "https://127.0.0.1/handle",
    "https://169.254.169.254/latest/meta-data",    # cloud metadata
    "https://10.0.0.5/handle",
    "file:///etc/passwd",
])
def test_invalid_and_ssrf_urls_are_refused(admin, bad_url):
    res = _preview(admin, bad_url)
    assert res.status_code == 400, f"{bad_url} -> {res.status_code}"
    assert "detail" in res.json()
    assert "Traceback" not in res.text


def test_private_ip_resolution_is_blocked(monkeypatch):
    """Even for an allowed hostname, a private DNS answer must stop the fetch."""
    import socket as socket_module
    monkeypatch.setattr(
        socket_module, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    assert sp._host_resolves_to_public_ip("superprofile.bio") is False


def test_public_ip_resolution_is_allowed(monkeypatch):
    import socket as socket_module
    monkeypatch.setattr(
        socket_module, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    assert sp._host_resolves_to_public_ip("superprofile.bio") is True


def test_fetch_failure_is_a_clean_message(monkeypatch, admin):
    async def failing(url: str, page_html: str | None = None):
        raise sp.SuperProfileFetchError("That page took too long to respond.")

    monkeypatch.setattr(import_api, "import_superprofile", failing)
    res = _preview(admin)
    assert res.status_code == 502
    assert res.json()["detail"] == "That page took too long to respond."
    assert "Traceback" not in res.text


def test_oversized_response_is_refused(monkeypatch):
    """The body cap is enforced while streaming, not after the whole page is in memory."""
    from app.services.superprofile_import import MAX_RESPONSE_BYTES
    assert MAX_RESPONSE_BYTES == 2 * 1024 * 1024

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html"}

        async def aiter_bytes(self):
            for _ in range(3):
                yield b"x" * (1024 * 1024)

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, *args):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeStream()

    import asyncio
    import httpx
    original_client = httpx.AsyncClient
    original_resolver = sp._host_resolves_to_public_ip
    httpx.AsyncClient = lambda *a, **k: FakeClient()
    sp._host_resolves_to_public_ip = lambda host: True
    try:
        with pytest.raises(sp.SuperProfileFetchError) as excinfo:
            asyncio.run(sp.fetch_public_page("https://superprofile.bio/handle"))
        assert "too large" in str(excinfo.value)
    finally:
        httpx.AsyncClient = original_client
        sp._host_resolves_to_public_ip = original_resolver


# ---------------------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------------------

def test_single_session_is_parsed_verbatim(stub_page, admin):
    stub_page["html"] = _page(ONE_SESSION)
    body = _preview(admin).json()

    assert body["profile"]["name"] == "Real Name"
    assert body["profile"]["headline"] == "Growth consultant"
    assert body["profile"]["bio"] == "Public bio text."
    assert len(body["sessions"]) == 1

    session = body["sessions"][0]
    assert session["title"] == "1:1 Digital Marketing Consultation"
    # Description preserved exactly, not summarised or rewritten.
    assert session["description"] == "The exact publicly displayed session description"
    assert session["duration_minutes"] == 30
    assert session["price"] == 99900          # ₹999 in paise
    assert session["currency"] == "INR"


def test_multiple_sessions_are_all_returned(stub_page, admin):
    stub_page["html"] = _page({"sessions": [
        {"title": "Session One", "price": 500, "duration": 15},
        {"title": "Session Two", "price": 1500, "duration": 45},
        {"title": "Session Three"},
    ]})
    sessions = _preview(admin).json()["sessions"]
    assert [s["title"] for s in sessions] == ["Session One", "Session Two", "Session Three"]


def test_session_without_a_price_imports_as_null_not_an_invented_number(stub_page, admin):
    """Regression guard: the old parser substituted ₹1999 whenever no price was shown."""
    stub_page["html"] = _page({"sessions": [{"title": "Free intro chat", "duration": 20}]})
    body = _preview(admin).json()

    assert body["sessions"][0]["price"] is None
    assert body["sessions"][0]["duration_minutes"] == 20
    assert any("No price is shown publicly" in w for w in body["warnings"])


def test_session_without_a_duration_imports_as_null(stub_page, admin):
    stub_page["html"] = _page({"sessions": [{"title": "Open-ended call", "price": 250}]})
    assert _preview(admin).json()["sessions"][0]["duration_minutes"] is None


def test_missing_profile_fields_stay_empty(stub_page, admin):
    stub_page["html"] = _page({"sessions": []})
    profile = _preview(admin).json()["profile"]
    assert profile["name"] is None
    assert profile["bio"] is None
    assert profile["profile_image_url"] is None
    assert profile["intro_video"] is None
    assert profile["social_links"] == {}


def test_page_with_no_sessions_reports_that(stub_page, admin):
    stub_page["html"] = _page({"creator": {"aboutMe": {"name": "Someone"}}})
    body = _preview(admin).json()
    assert body["sessions"] == []
    assert "No sessions were found on this page." in body["warnings"]


def test_page_without_next_data_falls_back_to_meta_tags(stub_page, admin):
    stub_page["html"] = (
        '<html><head><meta property="og:title" content="Meta Name">'
        '<meta property="og:description" content="Meta headline"></head><body></body></html>'
    )
    profile = _preview(admin).json()["profile"]
    assert profile["name"] == "Meta Name"
    assert profile["headline"] == "Meta headline"


def test_malicious_html_is_stripped_from_imported_text(stub_page, admin, db):
    stub_page["html"] = _page({
        "creator": {"aboutMe": {"name": "<script>alert(1)</script>Real Name"}},
        "sessions": [{
            "title": "<img src=x onerror=alert(1)>Consultation",
            "description": "<script>fetch('//evil')</script>Legitimate description",
            "price": 999,
        }],
    })
    body = _preview(admin).json()

    assert "<script>" not in json.dumps(body)
    assert "onerror" not in json.dumps(body)
    assert body["sessions"][0]["description"].endswith("Legitimate description")

    apply_res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": body["import_id"],
        "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert apply_res.status_code == 200
    stored = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).all()
    assert all("<script" not in (s.title + (s.description or "")) for s in stored)


def test_javascript_url_is_not_imported_as_a_link(stub_page, admin):
    stub_page["html"] = _page({
        "socialLinks": {"items": [{"url": "javascript:alert(1)"}, {"url": "https://instagram.com/handle"}]},
    })
    profile = _preview(admin).json()["profile"]
    assert profile["social_links"].get("instagram") == "https://instagram.com/handle"
    assert "javascript" not in json.dumps(profile)


def test_pasted_page_source_is_parsed_without_any_fetch(admin, monkeypatch):
    """
    SuperProfile answers 429 to non-browser clients, so the supported route is for the page
    owner to paste their own page source. It must go through the same parser and sanitizer,
    and must not make an outbound request.
    """
    async def must_not_fetch(*args, **kwargs):
        raise AssertionError("pasted source must not trigger an outbound fetch")

    monkeypatch.setattr(sp, "fetch_public_page", must_not_fetch)

    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://superprofile.bio/testhandle",
        "page_html": _page(ONE_SESSION),
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["profile"]["name"] == "Real Name"
    assert body["sessions"][0]["price"] == 99900


def test_pasted_source_is_still_sanitized(admin, monkeypatch):
    async def must_not_fetch(*args, **kwargs):
        raise AssertionError("pasted source must not trigger an outbound fetch")

    monkeypatch.setattr(sp, "fetch_public_page", must_not_fetch)

    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://superprofile.bio/testhandle",
        "page_html": _page({"sessions": [{
            "title": "<script>alert(1)</script>Consult",
            "description": "<iframe src=//evil></iframe>Real text",
            "price": 500,
        }]}),
    })
    assert res.status_code == 200
    assert "<script" not in json.dumps(res.json())
    assert "<iframe" not in json.dumps(res.json())


def test_pasted_source_still_validates_the_url(admin):
    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://example.com/anything",
        "page_html": _page(ONE_SESSION),
    })
    assert res.status_code == 400


def test_a_declined_fetch_explains_the_paste_alternative(monkeypatch, admin):
    async def declined(url: str, page_html=None):
        raise sp.SuperProfileFetchError(
            "SuperProfile declined an automated request for this page. Open the page in "
            "your browser, copy its source, and paste it into the import instead."
        )

    monkeypatch.setattr(import_api, "import_superprofile", declined)
    res = _preview(admin)
    assert res.status_code == 502
    assert "paste" in res.json()["detail"].lower()


# ---------------------------------------------------------------------------------------
# Preview writes nothing
# ---------------------------------------------------------------------------------------

def test_preview_does_not_touch_the_profile_or_sessions(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    before_sessions = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count()

    res = _preview(admin)
    assert res.status_code == 200

    db.expire_all()
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == before_sessions
    assert not (profile.bio or "")

    record = db.query(ProfileImport).filter(ProfileImport.id == res.json()["import_id"]).first()
    assert record.status == "preview"
    assert record.admin_id == admin["id"]


def test_cancelled_import_changes_nothing(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    res = client.post(f"/api/profile-import/{import_id}/cancel", headers=admin["headers"])
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


# ---------------------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------------------

def test_add_mode_fills_empty_fields_and_creates_sessions(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id,
        "mode": "add",
        "profile_fields": ["name", "headline", "bio"],
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert res.status_code == 200, res.text
    assert res.json()["sessions_created"] == 1

    db.expire_all()
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert profile.bio == "Public bio text."
    assert profile.title == "Growth consultant"

    session = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    assert session.title == "1:1 Digital Marketing Consultation"
    assert session.price == 99900
    assert session.is_active is True


def test_add_mode_never_overwrites_existing_profile_text(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.bio = "My own carefully written bio"
    db.commit()

    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]
    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "profile_fields": ["bio"], "sessions": [],
    })

    db.expire_all()
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert profile.bio == "My own carefully written bio"


def test_replace_mode_requires_explicit_confirmation(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.bio = "My own carefully written bio"
    db.commit()

    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    refused = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace", "profile_fields": ["bio"], "sessions": [],
    })
    assert refused.status_code == 400

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "My own carefully written bio"

    confirmed = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace", "profile_fields": ["bio"],
        "sessions": [], "confirm_replace": True,
    })
    assert confirmed.status_code == 200

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "Public bio text."


def test_sessions_only_mode_leaves_the_profile_alone(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "profile_fields": ["bio", "name"],
        "sessions": [{"index": 0, "action": "create"}],
    })

    db.expire_all()
    assert not (db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio or "")
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 1


def test_profile_only_mode_creates_no_sessions(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "profile_only",
        "profile_fields": ["bio"],
        "sessions": [{"index": 0, "action": "create"}],
    })

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "Public bio text."


def test_admin_edits_win_over_parsed_values(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "sessions": [{
            "index": 0, "action": "create",
            "title": "My edited title",
            "description": "My edited description",
            "price": 250000,
            "duration_minutes": 45,
        }],
    })

    session = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    assert session.title == "My edited title"
    assert session.description == "My edited description"
    assert session.price == 250000
    assert session.duration_minutes == 45


def test_priceless_session_is_created_as_an_inactive_draft(stub_page, admin, db):
    stub_page["html"] = _page({"sessions": [{"title": "No price shown", "duration": 30}]})
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "create"}],
    })

    session = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    assert session.price == 0
    assert session.is_active is False, "a session with no known price must not be sellable"


def test_skip_action_creates_nothing(stub_page, admin, db):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "skip"}],
    })
    assert res.json()["sessions_created"] == 0
    assert res.json()["sessions_skipped"] == 1
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


def test_applying_twice_is_refused(stub_page, admin):
    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]
    payload = {"import_id": import_id, "mode": "sessions_only", "sessions": [{"index": 0, "action": "create"}]}

    assert client.post("/api/profile-import/apply", headers=admin["headers"], json=payload).status_code == 200
    assert client.post("/api/profile-import/apply", headers=admin["headers"], json=payload).status_code == 409


def test_username_is_never_changed_by_an_import(stub_page, admin, db):
    stub_page["html"] = _page({
        "creator": {"aboutMe": {"name": "Someone Else"}},
        "username": "someone-elses-handle",
        "sessions": [],
    })
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace", "confirm_replace": True,
        "profile_fields": ["name", "headline", "bio", "username", "slug"],
        "sessions": [],
    })

    db.expire_all()
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert profile.username == admin["username"], "the admin's public URL must stay their own"


def test_no_payment_or_calendar_credentials_are_imported(stub_page, admin, db):
    """Anything credential-shaped on the source page must be ignored, not stored."""
    stub_page["html"] = _page({
        "razorpayKeyId": "rzp_live_someoneelse",
        "razorpayKeySecret": "super-secret",
        "googleRefreshToken": "1//refresh-token",
        "calendarId": "someone@group.calendar.google.com",
        "sessions": [{"title": "Consult", "price": 999}],
    })
    body = _preview(admin).json()

    blob = json.dumps(body)
    for leak in ("rzp_live_someoneelse", "super-secret", "1//refresh-token", "group.calendar.google.com"):
        assert leak not in blob

    import_id = body["import_id"]
    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "sessions": [{"index": 0, "action": "create"}],
    })
    record = db.query(ProfileImport).filter(ProfileImport.id == import_id).first()
    assert "super-secret" not in json.dumps(record.parsed_data)


def test_image_is_not_imported_without_permission_confirmation(stub_page, admin, db):
    stub_page["html"] = _page(
        {"sessions": []},
        meta={"og:image": "https://cdn.example.com/photo.png"},
    )
    body = _preview(admin).json()
    assert body["profile"]["profile_image_url"] == "https://cdn.example.com/photo.png"

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": body["import_id"], "mode": "add",
        "profile_fields": ["profile_image"], "sessions": [],
        "import_image": True, "image_permission_confirmed": False,
    })
    assert res.status_code == 200
    assert "permission" in (res.json()["image_note"] or "")

    db.expire_all()
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    # Never hotlinked: the remote URL must not end up in the profile.
    assert not (profile.profile_photo or "")


# ---------------------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------------------

def test_similar_existing_session_is_flagged_not_duplicated(stub_page, admin, db):
    existing = SessionModel(
        admin_id=admin["id"],
        title="1:1 Digital Marketing Consultation",
        duration_minutes=30,
        price=99900,
    )
    db.add(existing)
    db.commit()
    existing_id = existing.id

    stub_page["html"] = _page(ONE_SESSION)
    body = _preview(admin).json()

    assert body["duplicates"], "an identical title must be reported as a duplicate"
    assert body["duplicates"][0]["existing_session_id"] == existing_id
    assert body["duplicates"][0]["session_index"] == 0

    # Nothing was created merely by detecting the duplicate.
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 1


def test_update_existing_replaces_that_session_only(stub_page, admin, db):
    existing = SessionModel(admin_id=admin["id"], title="1:1 Digital Marketing Consult", duration_minutes=15, price=50000)
    other = SessionModel(admin_id=admin["id"], title="Unrelated session", duration_minutes=60, price=120000)
    db.add_all([existing, other])
    db.commit()
    existing_id, other_id = existing.id, other.id

    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "update", "target_session_id": existing_id}],
    })
    assert res.json()["sessions_updated"] == 1
    assert res.json()["sessions_created"] == 0

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.id == existing_id).first().title == "1:1 Digital Marketing Consultation"
    assert db.query(SessionModel).filter(SessionModel.id == other_id).first().title == "Unrelated session"


def test_create_new_keeps_both_sessions(stub_page, admin, db):
    db.add(SessionModel(admin_id=admin["id"], title="1:1 Digital Marketing Consultation", duration_minutes=30, price=99900))
    db.commit()

    stub_page["html"] = _page(ONE_SESSION)
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "sessions": [{"index": 0, "action": "create"}],
    })

    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 2


# ---------------------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------------------

def test_preview_is_rate_limited(stub_page, admin):
    stub_page["html"] = _page({"sessions": []})
    codes = [_preview(admin).status_code for _ in range(12)]
    assert codes.count(200) == 10
    assert codes[-1] == 429
