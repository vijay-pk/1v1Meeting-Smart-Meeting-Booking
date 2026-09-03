"""
Tests for "Import from SuperProfile".

The network is stubbed throughout: `fetch_public_page` is monkeypatched, so no test ever
reaches superprofile.bio. The fixtures reproduce the real page structure, verified against
the live site rather than assumed -- see the builders below. The URL-validation and SSRF tests deliberately do *not* stub it —
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


# ---------------------------------------------------------------------------------------
# Page builders
#
# These reproduce the *real* shape of a superprofile.bio page, checked against the live site
# in 2026-09 (https://superprofile.bio/bookings/mahir6787 and https://superprofile.bio/mahir6787):
#
#   * Next.js pages router, data under props.pageProps.prefetchedData.
#   * /bookings/{handle} puts name / tagline / bio / aboutMe / sessions at the top level;
#     /{handle} nests the creator under `superProfile` and has no sessions at all.
#   * A session carries duration as {"value": 15, "unit": "min"} and its long description as
#     HTML that may embed a Vimeo/YouTube iframe. It carries **no price**: the displayed
#     price is fetched in the browser and exists only in the rendered `.session-card` markup.
#
# The previous version of this file invented a schema (prefetchedData.creator.aboutMe,
# session.price, session.duration as an int). Every test passed and the importer returned an
# empty profile against the real site. Fixtures here mirror the real page instead.
# ---------------------------------------------------------------------------------------

REAL_SESSION_ID = "68f87b9addc5ad0013f91b62"

VIMEO_DESCRIPTION_HTML = (
    '<div class="se-component se-video-container"><figure>'
    '<iframe src="https://player.vimeo.com/video/1149115590?fl=ip&amp;fe=ec"></iframe>'
    "</figure></div>"
    "<p>This is a <strong>15-minute one-on-one consultation</strong>.</p>"
)


def _session_json(
    title,
    *,
    duration=None,
    unit="min",
    session_id=None,
    description=None,
    short=None,
    cover=None,
    category="1-on-1 session",
    status=1,
):
    """One entry of prefetchedData.sessions, in the shape the live page uses."""
    item = {
        "_id": session_id or uuid.uuid4().hex[:24],
        "status": status,
        "title": title,
        "shortDescription": short,
        "description": description,
        "sessionCategory": category,
        "priceType": 1,
        "creatorCurrency": None,
        "inputFields": [],
        "cover": cover if cover is not None else [],
    }
    if duration is not None:
        item["duration"] = {"value": duration, "unit": unit, "duration": duration}
    return item


def _card(title, *, price=None, original=None, duration_text=None, description=None):
    """One browser-rendered `.session-card`, which is the only place a price appears."""
    original_html = (
        f'<div class="session-discount"><div class="original-price">{original}</div></div>'
        if original else ""
    )
    price_html = (
        f'<button class="base-btn primary-btn session-final-price"><span>{price}</span></button>'
        if price else ""
    )
    return (
        '<div class="session-card"><div class="session-card-top">'
        f'<div class="session-card-title">{title}</div>'
        f'<div class="session-card-description">{description or ""}</div></div>'
        '<div class="session-card-details"><div class="session-card-details-left">'
        f'<div class="session-duration">{duration_text or ""}</div>'
        '<div class="session-type">Google Meet</div></div>'
        f'<div class="session-card-details-right">{original_html}{price_html}</div>'
        "</div></div>"
    )


def _page(prefetched: dict, *, meta: dict | None = None, cards: str = "") -> str:
    """
    Builds a SuperProfile-shaped HTML page around a __NEXT_DATA__ payload.

    "<" is escaped as \\u003c exactly as Next.js does when it serialises __NEXT_DATA__ --
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
        "</head><body>" + cards + "</body></html>"
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


def _preview(admin, url="https://superprofile.bio/bookings/testhandle"):
    return client.post("/api/profile-import/preview", headers=admin["headers"], json={"source_url": url})


# A booking page with one paid session, exactly as the live site lays it out.
ONE_SESSION_JSON = {
    "name": "Real Name",
    "tagline": "Growth consultant",
    "bio": "Public bio text.",
    "aboutMe": {"isEnabled": False, "socials": [], "name": "", "headline": "", "description": ""},
    "socialLinks": {"isEnabled": False, "items": []},
    "spotlight": {"isEnabled": False, "items": []},
    "sessions": [
        _session_json(
            "1:1 Digital Marketing Consultation",
            duration=30,
            session_id=REAL_SESSION_ID,
            description="The exact publicly displayed session description",
            short="Short blurb",
        )
    ],
}

ONE_SESSION_CARDS = _card(
    "1:1 Digital Marketing Consultation",
    price="₹999",
    duration_text="30 mins",
    description="Short blurb",
)


def _one_session_page():
    return _page(ONE_SESSION_JSON, cards=ONE_SESSION_CARDS)


# ---------------------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------------------

def test_preview_requires_authentication():
    res = client.post("/api/profile-import/preview", json={"source_url": "https://superprofile.bio/x"})
    assert res.status_code == 401


def test_client_role_cannot_import(tracked):
    """A signed-in client is authenticated but not an admin; the endpoint is admin-only."""
    non_admin = _make_admin(tracked, role="client")
    assert _preview(non_admin).status_code == 403


def test_admin_cannot_read_another_admins_import(tracked, stub_page, admin):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    other = _make_admin(tracked)
    res = client.get(f"/api/profile-import/{import_id}", headers=other["headers"])
    assert res.status_code == 404, "another admin's import id must not be probeable"


def test_admin_cannot_apply_another_admins_import(tracked, stub_page, admin):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    other = _make_admin(tracked)
    res = client.post("/api/profile-import/apply", headers=other["headers"], json={
        "import_id": import_id,
        "mode": "add",
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert res.status_code == 404


def test_update_action_cannot_target_another_admins_session(tracked, stub_page, admin, db):
    victim = _make_admin(tracked)
    victim_session = SessionModel(admin_id=victim["id"], title="Victim session", duration_minutes=30, price=5000)
    db.add(victim_session)
    db.commit()
    victim_session_id = victim_session.id

    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id,
        "mode": "add",
        "sessions": [{"index": 0, "action": "update", "target_session_id": victim_session_id}],
    })
    assert res.status_code == 200
    assert res.json()["sessions_updated"] == 0

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.id == victim_session_id).one().title == "Victim session"


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


def test_redirect_off_superprofile_is_not_followed():
    with pytest.raises(sp.SuperProfileFetchError):
        sp._validate_fetch_target("https://evil.example.com/x", allowed_hosts=sp.ALLOWED_HOSTS)


def test_redirect_to_plain_http_is_not_followed():
    with pytest.raises(sp.SuperProfileFetchError):
        sp._validate_fetch_target("http://superprofile.bio/x", allowed_hosts=sp.ALLOWED_HOSTS)


def test_fetch_failure_is_a_clean_message(monkeypatch, admin):
    async def failing(url: str, page_html: str | None = None):
        raise sp.SuperProfileFetchError("That page took too long to respond.")

    monkeypatch.setattr(import_api, "import_superprofile", failing)
    res = _preview(admin)
    assert res.status_code == 502
    assert res.json()["detail"] == "That page took too long to respond."
    assert "Traceback" not in res.text


def test_unreadable_page_is_reported_as_a_parsing_failure(monkeypatch, admin):
    """A page we reached but cannot read is 422, not the 502 we use for "cannot reach"."""
    async def unreadable(url: str, page_html: str | None = None):
        raise sp.SuperProfileParseError("That page could not be read as a SuperProfile page.")

    monkeypatch.setattr(import_api, "import_superprofile", unreadable)
    res = _preview(admin)
    assert res.status_code == 422
    assert "could not be read" in res.json()["detail"]


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


def test_bot_check_explains_the_paste_route_instead_of_defeating_it(monkeypatch):
    """
    superprofile.bio answers every non-browser request with 429 and Vercel's JavaScript
    challenge. Solving that challenge would be bypassing an anti-bot control, so the fetcher
    stops and tells the admin to paste their own page instead.
    """
    class FakeResponse:
        status_code = 429
        headers = {"content-type": "text/html"}

        async def aiter_bytes(self):
            yield b""

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
    original_client, original_resolver = httpx.AsyncClient, sp._host_resolves_to_public_ip
    httpx.AsyncClient = lambda *a, **k: FakeClient()
    sp._host_resolves_to_public_ip = lambda host: True
    try:
        with pytest.raises(sp.SuperProfileFetchError) as excinfo:
            asyncio.run(sp.fetch_public_page("https://superprofile.bio/bookings/handle"))
        message = str(excinfo.value)
        assert "blocks automated requests" in message
        assert "Copy outerHTML" in message
    finally:
        httpx.AsyncClient, sp._host_resolves_to_public_ip = original_client, original_resolver


# ---------------------------------------------------------------------------------------
# Parsing the real page shapes
# ---------------------------------------------------------------------------------------

def test_booking_page_profile_text_is_extracted(stub_page, admin):
    stub_page["html"] = _one_session_page()
    profile = _preview(admin).json()["profile"]
    assert profile["name"] == "Real Name"
    assert profile["headline"] == "Growth consultant"
    assert profile["bio"] == "Public bio text."


def test_profile_page_shape_is_also_understood(stub_page, admin):
    """`/{handle}` nests everything under superProfile and carries no sessions."""
    stub_page["html"] = _page({
        "superProfile": {
            "firstname": "Ameen",
            "lastname": "Ahsan",
            "displayName": "Adways Academy",
            "bio": "Welcome to my SuperProfile!",
            "socialConnects": [
                {"enabled": True, "socialType": "Instagram", "socialURL": "adways.in"},
                {"enabled": False, "socialType": "Threads", "socialURL": ""},
            ],
            "blocks": [],
            "profilePicture": {"url": "https://cdn.cosmofeed.com/pp-5.svg"},
        }
    })
    body = _preview(admin).json()
    assert body["profile"]["name"] == "Adways Academy"
    assert body["profile"]["bio"] == "Welcome to my SuperProfile!"
    # A bare handle plus its stated type is rebuilt into the canonical URL...
    assert body["profile"]["social_links"]["instagram"] == "https://www.instagram.com/adways.in"
    # ...and a disabled social is not invented into a link.
    assert "threads" not in body["profile"]["social_links"]
    assert body["sessions"] == []


def test_session_is_parsed_from_json_and_priced_from_the_rendered_card(stub_page, admin):
    """
    The two halves of a real page: structure from __NEXT_DATA__, price from the DOM.

    This is the specific failure the feature had -- the parser read `session["price"]`, which
    does not exist on the live page, so every imported session was priceless.
    """
    stub_page["html"] = _one_session_page()
    body = _preview(admin).json()

    assert len(body["sessions"]) == 1
    session = body["sessions"][0]
    assert session["title"] == "1:1 Digital Marketing Consultation"
    assert session["description"] == "The exact publicly displayed session description"
    assert session["duration_minutes"] == 30
    assert session["price"] == 99900          # ₹999 in paise, read off the card
    assert session["currency"] == "INR"
    assert session["source_ref"] == REAL_SESSION_ID


def test_discounted_card_yields_both_prices(stub_page, admin):
    stub_page["html"] = _page(
        {"sessions": [_session_json("Clarity call", duration=15)]},
        cards=_card("Clarity call", price="₹1,497", original="₹4999", duration_text="15 mins"),
    )
    session = _preview(admin).json()["sessions"][0]
    assert session["price"] == 149700
    assert session["original_price"] == 499900


def test_duration_in_hours_is_converted_to_minutes(stub_page, admin):
    stub_page["html"] = _page(
        {"sessions": [_session_json("Deep dive", duration=1, unit="hour")]},
        cards=_card("Deep dive", price="₹19750", duration_text="1 hour"),
    )
    assert _preview(admin).json()["sessions"][0]["duration_minutes"] == 60


def test_session_input_fields_are_captured(stub_page, admin):
    item = _session_json("Consult", duration=30)
    item["inputFields"] = [
        {"mandatory": True, "fieldType": "name", "fieldName": "Name", "fieldDescription": "Please enter your Name"},
        {"mandatory": False, "fieldType": "text", "fieldName": "Company", "fieldDescription": ""},
    ]
    stub_page["html"] = _page({"sessions": [item]}, cards=_card("Consult", price="₹500"))
    fields = _preview(admin).json()["sessions"][0]["input_fields"]
    assert [f["label"] for f in fields] == ["Name", "Company"]
    assert fields[0]["required"] is True
    assert fields[1]["required"] is False


def test_hidden_session_is_not_imported(stub_page, admin):
    stub_page["html"] = _page({"sessions": [
        _session_json("Live one", duration=30),
        _session_json("Hidden one", duration=30, status=2),
    ]}, cards=_card("Live one", price="₹500"))
    titles = [s["title"] for s in _preview(admin).json()["sessions"]]
    assert titles == ["Live one"]


def test_multiple_sessions_are_all_returned(stub_page, admin):
    stub_page["html"] = _page(
        {"sessions": [
            _session_json("Session One", duration=15),
            _session_json("Session Two", duration=45),
        ]},
        cards=_card("Session One", price="₹500") + _card("Session Two", price="₹1500"),
    )
    sessions = _preview(admin).json()["sessions"]
    assert [s["title"] for s in sessions] == ["Session One", "Session Two"]
    assert [s["price"] for s in sessions] == [50000, 150000]


def test_session_without_a_price_imports_as_null_not_an_invented_number(stub_page, admin):
    """Regression guard: an older parser substituted ₹1999 whenever no price was shown."""
    stub_page["html"] = _page({"sessions": [_session_json("Free intro chat", duration=20)]})
    body = _preview(admin).json()

    assert body["sessions"][0]["price"] is None
    assert body["sessions"][0]["duration_minutes"] == 20
    assert any("No price could be read" in w for w in body["warnings"])


def test_session_without_a_duration_imports_as_null(stub_page, admin):
    stub_page["html"] = _page(
        {"sessions": [_session_json("Open-ended call")]},
        cards=_card("Open-ended call", price="₹250"),
    )
    assert _preview(admin).json()["sessions"][0]["duration_minutes"] is None


def test_missing_profile_fields_stay_empty(stub_page, admin):
    stub_page["html"] = _page({"name": "Only a name", "sessions": []})
    profile = _preview(admin).json()["profile"]
    assert profile["bio"] is None
    assert profile["video_url"] is None
    assert profile["social_links"] == {}


def test_page_with_no_sessions_reports_that(stub_page, admin):
    stub_page["html"] = _page({"name": "Someone"})
    body = _preview(admin).json()
    assert body["sessions"] == []
    assert any("No sessions were found" in w for w in body["warnings"])


def test_page_without_next_data_falls_back_to_meta_tags(stub_page, admin):
    stub_page["html"] = (
        '<html><head><meta property="og:title" content="Fallback Name | SuperProfile">'
        '<meta property="og:description" content="Fallback headline">'
        "</head><body></body></html>"
    )
    profile = _preview(admin).json()["profile"]
    # The site name is not part of the creator's name.
    assert profile["name"] == "Fallback Name"
    assert profile["headline"] == "Fallback headline"


def test_completely_unreadable_page_is_refused_rather_than_previewed_empty(stub_page, admin):
    stub_page["html"] = "<html><body><h1>Nothing to see</h1></body></html>"
    res = _preview(admin)
    assert res.status_code == 422
    assert "could not be read" in res.json()["detail"]


def test_malicious_html_is_stripped_from_imported_text(stub_page, admin, db):
    stub_page["html"] = _page({
        "name": "<script>alert(1)</script>Real Name",
        "sessions": [_session_json(
            "<b>Bold</b> Session",
            duration=30,
            description='<img src=x onerror="alert(1)">Legitimate description',
        )],
    }, cards=_card("Bold Session", price="₹999"))
    body = _preview(admin).json()

    assert "<script" not in json.dumps(body)
    assert "onerror" not in json.dumps(body)
    assert body["profile"]["name"] == "Real Name"
    assert body["sessions"][0]["description"].endswith("Legitimate description")

    # And nothing survives into the database either.
    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": body["import_id"],
        "mode": "add",
        "sessions": [{"index": 0, "action": "create"}],
    })
    created = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).all()
    assert all("<script" not in (s.description or "") for s in created)


def test_javascript_url_is_not_imported_as_a_link(stub_page, admin):
    stub_page["html"] = _page({
        "name": "Someone",
        "links": {"items": [{"title": "Click me", "url": "javascript:alert(1)"}]},
    })
    assert _preview(admin).json()["profile"]["public_links"] == []


# ---------------------------------------------------------------------------------------
# Photos: never read, never applied
# ---------------------------------------------------------------------------------------

def test_no_photo_url_is_ever_returned_by_the_parser(stub_page, admin):
    """
    Every image the live page exposes, in one fixture: og:image, the booking page's `image`
    and `metaImage`, the profile page's `profilePicture`, a session `thumbnail` and an image
    `cover`. None of them may appear anywhere in the preview payload.
    """
    stub_page["html"] = _page(
        {
            "name": "Someone",
            "image": "https://media-cdn.cosmofeed.com/profile/my_image.png",
            "metaImage": "https://media-cdn.cosmofeed.com/profile/meta_card.png",
            "bgColor": "https://cdn.cosmofeed.com/spRevamp/backgrounds/flat-mountains.svg",
            "aboutMe": {"photo": "https://media-cdn.cosmofeed.com/about.png", "name": "Someone"},
            "superProfile": {"profilePicture": {"url": "https://cdn.cosmofeed.com/pp-5.svg"}},
            "sessions": [{
                **_session_json("Consult", duration=30),
                "thumbnail": {"url": "https://media-cdn.cosmofeed.com/thumb.png", "emoji": "x"},
                "cover": [{"url": "https://media-cdn.cosmofeed.com/cover.png", "type": "image"}],
            }],
        },
        meta={"og:image": "https://media-cdn.cosmofeed.com/og.png"},
        cards=_card("Consult", price="₹999"),
    )
    body = json.dumps(_preview(admin).json())

    for image in ("my_image.png", "meta_card.png", "about.png", "pp-5.svg",
                  "thumb.png", "cover.png", "og.png", "flat-mountains.svg"):
        assert image not in body, f"{image} leaked into the import preview"
    assert "profile_image" not in body
    assert "image_url" not in body


def test_existing_profile_photo_is_untouched_by_an_import(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.profile_photo = "https://my-own-storage.example.com/me.jpg"
    db.commit()

    stub_page["html"] = _page(
        {"name": "Someone Else", "bio": "Imported bio", "sessions": []},
        meta={"og:image": "https://media-cdn.cosmofeed.com/og.png"},
    )
    import_id = _preview(admin).json()["import_id"]

    # Every mode, including "replace", and asking for a photo field that no longer exists.
    for mode, extra in (("add", {}), ("replace", {"confirm_replace": True}), ("profile_only", {})):
        res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
            "import_id": import_id,
            "mode": mode,
            "profile_fields": ["name", "bio", "profile_image"],
            "sessions": [],
            **extra,
        })
        # The first apply succeeds; later ones are refused as already applied. Either way the
        # photo must be the admin's own.
        assert res.status_code in (200, 409)
        db.expire_all()
        current = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
        assert current.profile_photo == "https://my-own-storage.example.com/me.jpg"


def test_profile_image_is_not_an_importable_field():
    assert "profile_image" not in import_api.IMPORTABLE_PROFILE_FIELDS
    assert "username" not in import_api.IMPORTABLE_PROFILE_FIELDS


# ---------------------------------------------------------------------------------------
# Video: YouTube and Vimeo only
# ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected_id", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_youtube_urls_are_normalised(raw, expected_id):
    found = sp.normalize_video_url(raw)
    assert found["provider"] == "youtube"
    assert found["video_id"] == expected_id
    assert found["url"] == f"https://www.youtube.com/watch?v={expected_id}"
    assert found["embed_url"] == f"https://www.youtube.com/embed/{expected_id}"


@pytest.mark.parametrize("raw,expected_id", [
    ("https://vimeo.com/1130419767", "1130419767"),
    ("https://vimeo.com/1130419767?share=copy&fl=sv", "1130419767"),
    ("https://player.vimeo.com/video/1149115590?fl=ip", "1149115590"),
    ("https://vimeo.com/channels/staffpicks/1130419767", "1130419767"),
])
def test_vimeo_urls_are_normalised(raw, expected_id):
    found = sp.normalize_video_url(raw)
    assert found["provider"] == "vimeo"
    assert found["video_id"] == expected_id
    assert found["url"] == f"https://vimeo.com/{expected_id}"
    assert found["embed_url"] == f"https://player.vimeo.com/video/{expected_id}"


@pytest.mark.parametrize("raw", [
    "https://www.loom.com/share/abc123",
    "https://fast.wistia.net/embed/iframe/abc",
    "https://media-cdn.cosmofeed.com/video/clip.mp4",
    "https://example.com/watch?v=dQw4w9WgXcQ",     # right query, wrong host
    "https://www.youtube.com/",                    # no video id
    "https://vimeo.com/channels/staffpicks",       # no numeric id
    "javascript:alert(1)",
    "",
    None,
])
def test_unsupported_video_sources_are_ignored(raw):
    assert sp.normalize_video_url(raw) is None


def test_youtube_video_in_spotlight_is_detected(stub_page, admin):
    stub_page["html"] = _page({
        "name": "Someone",
        "spotlight": {"isEnabled": True, "items": [
            {"url": "https://youtu.be/dQw4w9WgXcQ", "type": "video"},
        ]},
        "sessions": [],
    })
    profile = _preview(admin).json()["profile"]
    assert profile["video_provider"] == "youtube"
    assert profile["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert profile["video_source"] == "profile"


def test_vimeo_video_embedded_in_a_session_description_is_detected(stub_page, admin):
    """The live page hides its video inside the session's rich-text HTML, as an iframe."""
    stub_page["html"] = _page(
        {"name": "Someone", "sessions": [
            _session_json("Consult", duration=15, description=VIMEO_DESCRIPTION_HTML),
        ]},
        cards=_card("Consult", price="₹999"),
    )
    body = _preview(admin).json()
    assert body["sessions"][0]["video_url"] == "https://vimeo.com/1149115590"
    # Nothing profile-level, so it is offered as the intro video -- clearly labelled.
    assert body["profile"]["video_url"] == "https://vimeo.com/1149115590"
    assert body["profile"]["video_source"] == "session"
    # And the iframe itself never reaches the client.
    assert "<iframe" not in json.dumps(body)


def test_vimeo_cover_link_on_a_session_is_detected(stub_page, admin):
    stub_page["html"] = _page(
        {"sessions": [_session_json(
            "Consult", duration=15,
            cover=[{"name": "https://vimeo.com/1130419767?share=copy",
                    "url": "https://vimeo.com/1130419767?share=copy", "type": "link"}],
        )]},
        cards=_card("Consult", price="₹999"),
    )
    assert _preview(admin).json()["sessions"][0]["video_url"] == "https://vimeo.com/1130419767"


def test_unsupported_video_on_the_page_is_not_imported(stub_page, admin):
    stub_page["html"] = _page({
        "name": "Someone",
        "spotlight": {"isEnabled": True, "items": [{"url": "https://www.loom.com/share/abc123"}]},
        "sessions": [],
    })
    body = _preview(admin).json()
    assert body["profile"]["video_url"] is None
    assert "loom.com" not in json.dumps(body)


def test_no_video_on_the_page_leaves_the_existing_video_unchanged(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.intro_video = "https://www.youtube.com/watch?v=myOwnVideo"
    db.commit()

    stub_page["html"] = _page({"name": "Someone", "bio": "New bio", "sessions": []})
    body = _preview(admin).json()
    assert body["profile"]["video_url"] is None
    assert any("No YouTube or Vimeo video was found" in w for w in body["warnings"])

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": body["import_id"],
        "mode": "replace",
        "profile_fields": ["intro_video", "bio"],
        "sessions": [],
        "confirm_replace": True,
    })
    assert res.status_code == 200
    assert "intro_video" not in res.json()["profile_fields_applied"]

    db.expire_all()
    current = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert current.intro_video == "https://www.youtube.com/watch?v=myOwnVideo"


def test_selected_video_is_applied_as_a_link_only(stub_page, admin, db):
    stub_page["html"] = _page({
        "name": "Someone",
        "spotlight": {"isEnabled": True, "items": [{"url": "https://youtu.be/dQw4w9WgXcQ"}]},
        "sessions": [],
    })
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id,
        "mode": "add",
        "profile_fields": ["intro_video"],
        "sessions": [],
    })
    assert res.status_code == 200
    assert "intro_video" in res.json()["profile_fields_applied"]

    db.expire_all()
    current = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert current.intro_video == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_video_field_cannot_be_poisoned_by_a_tampered_import_row(stub_page, admin, db):
    """
    Apply re-validates the stored video rather than trusting the preview row, so a value that
    is not a YouTube/Vimeo link can never reach `intro_video`.
    """
    stub_page["html"] = _page({"name": "Someone", "sessions": []})
    import_id = _preview(admin).json()["import_id"]

    record = db.query(ProfileImport).filter(ProfileImport.id == import_id).one()
    parsed = dict(record.parsed_data)
    parsed["profile"] = {**parsed["profile"], "video_url": "https://evil.example.com/payload.mp4"}
    record.parsed_data = parsed
    db.commit()

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "profile_fields": ["intro_video"], "sessions": [],
    })
    assert res.status_code == 200
    db.expire_all()
    current = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert current.intro_video in (None, "")


# ---------------------------------------------------------------------------------------
# Pasted page source (the supported route when the bot check refuses us)
# ---------------------------------------------------------------------------------------

def test_pasted_page_source_is_parsed_without_any_fetch(admin, monkeypatch):
    async def must_not_be_called(*args, **kwargs):
        raise AssertionError("pasted source must not trigger an outbound request")

    monkeypatch.setattr(sp, "fetch_public_page", must_not_be_called)

    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://superprofile.bio/bookings/testhandle",
        "page_html": _one_session_page(),
    })
    assert res.status_code == 200
    body = res.json()
    assert body["profile"]["name"] == "Real Name"
    assert body["sessions"][0]["price"] == 99900


def test_pasted_source_is_still_sanitized(admin, monkeypatch):
    async def must_not_be_called(*args, **kwargs):
        raise AssertionError("pasted source must not trigger an outbound request")

    monkeypatch.setattr(sp, "fetch_public_page", must_not_be_called)

    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://superprofile.bio/bookings/testhandle",
        "page_html": _page(
            {"sessions": [_session_json(
                "Session", duration=30,
                description='<script>steal()</script>Clean text',
            )]},
            cards=_card("Session", price="₹500"),
        ),
    })
    assert res.status_code == 200
    assert "<script" not in res.text
    assert "steal()" not in res.text


def test_pasted_source_still_validates_the_url(admin):
    res = client.post("/api/profile-import/preview", headers=admin["headers"], json={
        "source_url": "https://example.com/not-superprofile",
        "page_html": _one_session_page(),
    })
    assert res.status_code == 400


# ---------------------------------------------------------------------------------------
# Preview changes nothing
# ---------------------------------------------------------------------------------------

def test_preview_does_not_touch_the_profile_or_sessions(stub_page, admin, db):
    before = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    before_bio, before_title = before.bio, before.title

    stub_page["html"] = _one_session_page()
    assert _preview(admin).status_code == 200

    db.expire_all()
    after = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    assert (after.bio, after.title) == (before_bio, before_title)
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


def test_cancelled_import_changes_nothing(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post(f"/api/profile-import/{import_id}/cancel", headers=admin["headers"])
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


# ---------------------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------------------

def test_add_mode_fills_empty_fields_and_creates_sessions(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id,
        "mode": "add",
        "profile_fields": ["bio", "headline"],
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
    assert session.duration_minutes == 30
    assert session.price == 99900
    assert session.is_active is True


def test_add_mode_never_overwrites_existing_profile_text(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.bio = "My own carefully written bio"
    db.commit()

    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]
    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "profile_fields": ["bio"], "sessions": [],
    })

    db.expire_all()
    assert db.query(AdminProfile).filter(
        AdminProfile.user_id == admin["id"]
    ).first().bio == "My own carefully written bio"


def test_replace_mode_requires_explicit_confirmation(stub_page, admin, db):
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.bio = "Existing bio"
    db.commit()

    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    refused = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace", "profile_fields": ["bio"], "sessions": [],
    })
    assert refused.status_code == 400

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "Existing bio"

    accepted = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace", "profile_fields": ["bio"],
        "sessions": [], "confirm_replace": True,
    })
    assert accepted.status_code == 200

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "Public bio text."


def test_sessions_only_mode_leaves_the_profile_alone(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]
    before = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "sessions_only",
        "profile_fields": ["bio", "headline", "name"],
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert res.json()["profile_fields_applied"] == []

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == before
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 1


def test_profile_only_mode_creates_no_sessions(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "profile_only",
        "profile_fields": ["bio"],
        "sessions": [{"index": 0, "action": "create"}],
    })
    assert res.json()["sessions_created"] == 0
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


def test_admin_edits_win_over_parsed_values(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "sessions": [{
            "index": 0,
            "action": "create",
            "title": "My Renamed Session",
            "price": 250000,
            "duration_minutes": 45,
        }],
    })

    session = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    assert session.title == "My Renamed Session"
    assert session.price == 250000
    assert session.duration_minutes == 45


def test_priceless_session_is_created_as_an_inactive_draft(stub_page, admin, db):
    stub_page["html"] = _page({"sessions": [_session_json("No price shown", duration=30)]})
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add",
        "sessions": [{"index": 0, "action": "create"}],
    })
    session = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    assert session.price == 0
    assert session.is_active is False, "a session with no known price must not be sellable"


def test_skip_action_creates_nothing(stub_page, admin, db):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add",
        "sessions": [{"index": 0, "action": "skip"}],
    })
    assert res.json()["sessions_skipped"] == 1
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 0


def test_applying_twice_is_refused(stub_page, admin):
    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]
    payload = {"import_id": import_id, "mode": "sessions_only", "sessions": [{"index": 0, "action": "create"}]}

    assert client.post("/api/profile-import/apply", headers=admin["headers"], json=payload).status_code == 200
    assert client.post("/api/profile-import/apply", headers=admin["headers"], json=payload).status_code == 409


# ---------------------------------------------------------------------------------------
# What an import must never touch
# ---------------------------------------------------------------------------------------

def test_username_is_never_changed_by_an_import(stub_page, admin, db):
    stub_page["html"] = _page({
        "name": "Someone Else",
        "username": "their-superprofile-handle",
        "superProfile": {"username": "their-superprofile-handle"},
        "sessions": [],
    })
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "replace",
        "profile_fields": ["name", "headline", "bio", "username"],
        "sessions": [], "confirm_replace": True,
    })

    db.expire_all()
    assert db.query(AdminProfile).filter(
        AdminProfile.user_id == admin["id"]
    ).first().username == admin["username"]


def test_no_payment_or_calendar_credentials_are_imported(stub_page, admin, db):
    """Even when the page hands us keys, nothing in the import can carry them across."""
    stub_page["html"] = _page({
        "name": "Someone",
        "razorpayKeyId": "rzp_live_THEIRS",
        "razorpayKeySecret": "their-secret",
        "googleRefreshToken": "1//their-refresh-token",
        "googleCalendarId": "theirs@group.calendar.google.com",
        "sessions": [_session_json("Consult", duration=30)],
    }, cards=_card("Consult", price="₹999"))
    body = _preview(admin).json()
    import_id = body["import_id"]

    payload = json.dumps(body)
    for secret in ("rzp_live_THEIRS", "their-secret", "1//their-refresh-token",
                   "theirs@group.calendar.google.com"):
        assert secret not in payload

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add", "sessions": [{"index": 0, "action": "create"}],
    })

    from app.models.models import RazorpayConnection, GoogleConnection
    assert db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin["id"]).count() == 0
    assert db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin["id"]).count() == 0


# ---------------------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------------------

def test_similar_existing_session_is_flagged_not_duplicated(stub_page, admin, db):
    db.add(SessionModel(
        admin_id=admin["id"],
        title="1:1 Digital Marketing Consultation",
        duration_minutes=30,
        price=99900,
    ))
    db.commit()

    stub_page["html"] = _one_session_page()
    body = _preview(admin).json()

    assert len(body["duplicates"]) == 1
    assert body["duplicates"][0]["session_index"] == 0
    # Flagged only. Nothing is merged, skipped or deleted without the admin saying so.
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 1


def test_a_close_title_with_a_different_duration_is_not_called_a_duplicate(stub_page, admin, db):
    db.add(SessionModel(
        admin_id=admin["id"],
        title="1:1 Digital Marketing Consultations",   # one character apart
        duration_minutes=90,                            # but a different session
        price=99900,
    ))
    db.commit()

    stub_page["html"] = _one_session_page()
    assert _preview(admin).json()["duplicates"] == []


def test_reimporting_the_same_superprofile_session_is_flagged(stub_page, admin, db):
    """The SuperProfile session id survives the admin renaming their copy afterwards."""
    stub_page["html"] = _one_session_page()
    first = _preview(admin).json()
    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": first["import_id"], "mode": "add",
        "sessions": [{"index": 0, "action": "create"}],
    })

    created = db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).one()
    created.title = "Renamed after import"
    db.commit()

    second = _preview(admin).json()
    assert [d["reason"] for d in second["duplicates"]] == ["source_ref"]


def test_update_existing_replaces_that_session_only(stub_page, admin, db):
    existing = SessionModel(admin_id=admin["id"], title="1:1 Digital Marketing Consult", duration_minutes=15, price=50000)
    other = SessionModel(admin_id=admin["id"], title="Unrelated session", duration_minutes=60, price=120000)
    db.add_all([existing, other])
    db.commit()
    existing_id, other_id = existing.id, other.id

    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    res = client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add",
        "sessions": [{"index": 0, "action": "update", "target_session_id": existing_id}],
    })
    assert res.json()["sessions_updated"] == 1

    db.expire_all()
    assert db.query(SessionModel).filter(SessionModel.id == existing_id).one().title == "1:1 Digital Marketing Consultation"
    assert db.query(SessionModel).filter(SessionModel.id == other_id).one().title == "Unrelated session"
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 2


def test_create_new_keeps_both_sessions(stub_page, admin, db):
    db.add(SessionModel(admin_id=admin["id"], title="1:1 Digital Marketing Consultation", duration_minutes=30, price=99900))
    db.commit()

    stub_page["html"] = _one_session_page()
    import_id = _preview(admin).json()["import_id"]

    client.post("/api/profile-import/apply", headers=admin["headers"], json={
        "import_id": import_id, "mode": "add",
        "sessions": [{"index": 0, "action": "create"}],
    })
    # Two rows: importing never deletes what the admin already had.
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin["id"]).count() == 2


# ---------------------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------------------

def test_preview_is_rate_limited(stub_page, admin):
    stub_page["html"] = _page({"name": "Someone", "sessions": []})
    for _ in range(import_api._PREVIEW_MAX_IN_WINDOW):
        assert _preview(admin).status_code == 200
    assert _preview(admin).status_code == 429


def test_pasted_source_is_not_rate_limited(admin, monkeypatch):
    """The limiter exists to protect superprofile.bio; a paste makes no request at all."""
    async def must_not_be_called(*args, **kwargs):
        raise AssertionError("pasted source must not trigger an outbound request")

    monkeypatch.setattr(sp, "fetch_public_page", must_not_be_called)
    payload = {
        "source_url": "https://superprofile.bio/bookings/testhandle",
        "page_html": _one_session_page(),
    }
    for _ in range(import_api._PREVIEW_MAX_IN_WINDOW + 2):
        assert client.post(
            "/api/profile-import/preview", headers=admin["headers"], json=payload
        ).status_code == 200
