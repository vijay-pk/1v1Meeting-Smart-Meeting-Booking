"""
Tests for the admin profile as persistent, publicly readable data.

The reported bug was a client opening a shared booking link and being told "Profile Not
Available", and an admin's photo vanishing on its own. Neither was a lookup that could not
find the row: the profile was written over with empty strings by the admin's own Settings
page, and the photo bytes were on an ephemeral disk while the row still pointed at them.

So these tests assert the two halves separately -- what the public endpoint returns for a
given username, and what survives an unrelated write -- and they check the public payload
carries no secrets.
"""
import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.core.security import encrypt_secret
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    Booking,
    Payment,
    RazorpayConnection,
    GoogleConnection,
    MediaAsset,
    ProfileImport,
)

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tracked():
    ids = []
    yield ids

    session = SessionLocal()
    try:
        for user_id in ids:
            booking_ids = [
                b.id for b in session.query(Booking).filter(Booking.admin_id == user_id).all()
            ]
            if booking_ids:
                session.query(Payment).filter(
                    Payment.booking_id.in_(booking_ids)
                ).delete(synchronize_session=False)
            for model, column in (
                (Booking, Booking.admin_id),
                (RazorpayConnection, RazorpayConnection.admin_id),
                (GoogleConnection, GoogleConnection.admin_id),
                (AvailabilityRule, AvailabilityRule.admin_id),
                (SessionModel, SessionModel.admin_id),
                (ProfileImport, ProfileImport.admin_id),
                (MediaAsset, MediaAsset.owner_id),
            ):
                session.query(model).filter(column == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"pub_{tag}_{uid}@testdomain.com"
    username = f"pub{tag}{uid}"
    res = client.post("/api/auth/signup", json={
        "name": f"Public {tag}", "email": email, "password": PASSWORD, "username": username,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    tracked.append(data["user_id"])
    return {
        "id": data["user_id"],
        "email": email,
        "username": username,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked, "a")


def _login(admin):
    res = client.post("/api/auth/login", json={
        "username_or_email": admin["email"], "password": PASSWORD,
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _public(username):
    return client.get(f"/api/profiles/public/{username}")


def _upload_photo(admin, name="me.png"):
    res = client.post(
        "/api/upload",
        headers=admin["headers"],
        files={"file": (name, io.BytesIO(PNG_BYTES), "image/png")},
        data={"file_type": "photo"},
    )
    assert res.status_code == 200, res.text
    return res.json()["url"]


def _set_profile(admin, **fields):
    res = client.put("/api/profiles/me", headers=admin["headers"], json=fields)
    assert res.status_code == 200, res.text
    return res.json()


def _stored(admin, db):
    db.expire_all()
    return db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).one()


# =======================================================================================
# The admin's own profile endpoint
#
# This is the one the Settings page loads before it renders the form, and it was raising
# NameError -> 500 for every admin because `GoogleConnection` was used but never imported.
# Nothing covered it, so the suite stayed green while the page fell back to a placeholder
# identity and saved that back over the real profile.
# =======================================================================================

def test_my_profile_returns_the_stored_row(admin):
    res = client.get("/api/profiles/me", headers=admin["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["username"] == admin["username"]
    assert body["user_id"] == admin["id"]
    assert body["email"] == admin["email"]


def test_my_profile_reports_both_connection_states(admin, db):
    """The field whose missing import broke the whole endpoint."""
    db.add(GoogleConnection(
        admin_id=admin["id"],
        google_email="host@example.com",
        encrypted_refresh_token=encrypt_secret("1//refresh"),
        connection_status="connected",
    ))
    db.add(RazorpayConnection(
        admin_id=admin["id"],
        key_id="rzp_live_meprofile",
        encrypted_key_secret=encrypt_secret("secret-value"),
        connection_status="connected",
    ))
    db.commit()

    body = client.get("/api/profiles/me", headers=admin["headers"]).json()
    assert body["google_connected"] is True
    assert body["google_email"] == "host@example.com"
    assert body["razorpay_configured"] is True
    assert body["razorpay_key_id"] == "rzp_live_meprofile"


def test_my_profile_requires_authentication():
    assert client.get("/api/profiles/me").status_code == 401


def test_my_profile_never_returns_secrets(admin, db):
    db.add(GoogleConnection(
        admin_id=admin["id"],
        google_email="host@example.com",
        access_token="ya29.private",
        encrypted_refresh_token=encrypt_secret("1//private-refresh"),
        connection_status="connected",
    ))
    db.add(RazorpayConnection(
        admin_id=admin["id"],
        key_id="rzp_live_meprofile",
        encrypted_key_secret=encrypt_secret("razorpay-secret-value"),
        connection_status="connected",
    ))
    db.commit()

    res = client.get("/api/profiles/me", headers=admin["headers"])
    for secret in ("razorpay-secret-value", "1//private-refresh", "ya29.private"):
        assert secret not in res.text


# =======================================================================================
# The public URL a host shares with their clients
# =======================================================================================

def test_public_profile_loads_by_username_without_authentication(admin):
    _set_profile(admin, title="Growth mentor", bio="My public bio")

    # No Authorization header at all: this is a client on their own phone.
    res = _public(admin["username"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["username"] == admin["username"]
    assert body["title"] == "Growth mentor"
    assert body["bio"] == "My public bio"


def test_public_profile_lookup_is_case_insensitive(admin):
    """A link typed or auto-capitalised in a different case still resolves."""
    assert _public(admin["username"].upper()).status_code == 200
    assert _public(f"  {admin['username']}  ".strip()).status_code == 200


def test_public_profile_survives_a_fresh_login_and_a_restart(admin, db):
    photo = _upload_photo(admin)
    _set_profile(admin, profile_photo=photo, bio="Persisted bio")

    # A new token, as a different device would get.
    _login(admin)

    # And a rebuilt app object, the closest in-process equivalent of a restart.
    from app.main import app as rebuilt_app
    body = TestClient(rebuilt_app).get(f"/api/profiles/public/{admin['username']}").json()
    assert body["bio"] == "Persisted bio"
    assert body["profile_photo"] == photo
    assert _stored(admin, db).profile_photo == photo


def test_an_unknown_username_is_a_genuine_404(admin):
    res = _public("nobody-has-this-handle-12345")
    assert res.status_code == 404


def test_a_permanently_deleted_admin_is_no_longer_public(tracked, db):
    """The one case where a profile legitimately stops resolving."""
    from app.services.admin_deletion import permanently_delete_admin

    victim = _make_admin(tracked, "d")
    assert _public(victim["username"]).status_code == 200

    permanently_delete_admin(db, db.query(User).filter(User.id == victim["id"]).one())

    assert _public(victim["username"]).status_code == 404


def test_a_disabled_admin_still_resolves_and_reports_its_status(admin, db):
    """Disabling is not deletion: the page must still resolve so it can say so."""
    user = db.query(User).filter(User.id == admin["id"]).one()
    user.status = "TEMPORARILY_DISABLED"
    db.commit()

    res = _public(admin["username"])
    assert res.status_code == 200
    assert res.json()["status"] == "TEMPORARILY_DISABLED"

    user.status = "ACTIVE"
    db.commit()


def test_each_username_resolves_to_its_own_admin(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    _set_profile(a, bio="A's bio", title="A's headline")
    _set_profile(b, bio="B's bio", title="B's headline")

    assert _public(a["username"]).json()["bio"] == "A's bio"
    assert _public(b["username"]).json()["bio"] == "B's bio"
    assert _public(a["username"]).json()["id"] != _public(b["username"]).json()["id"]


def test_public_profile_exposes_no_secrets(admin, db):
    """Everything private an admin has, in one fixture, and none of it may be in the payload."""
    db.add(RazorpayConnection(
        admin_id=admin["id"],
        key_id="rzp_live_PUBLICTEST",
        encrypted_key_secret=encrypt_secret("razorpay-secret-value"),
        connection_status="connected",
    ))
    db.add(GoogleConnection(
        admin_id=admin["id"],
        google_email="host@example.com",
        access_token="ya29.private-access",
        encrypted_refresh_token=encrypt_secret("1//private-refresh"),
        connection_status="connected",
    ))
    db.commit()

    res = _public(admin["username"])
    body = res.json()

    for secret in ("razorpay-secret-value", "1//private-refresh", "ya29.private-access"):
        assert secret not in res.text
    for field in ("password", "password_hash", "encrypted_key_secret",
                  "encrypted_refresh_token", "access_token", "email", "phone"):
        assert field not in body, f"{field} must not be in the public payload"

    # The publishable key id is browser-safe by design and is needed for checkout.
    assert body["razorpay_key_id"] == "rzp_live_PUBLICTEST"


# =======================================================================================
# Partial updates: changing one field must not blank the others
# =======================================================================================

def test_changing_only_the_bio_leaves_everything_else_alone(admin, db):
    photo = _upload_photo(admin)
    _set_profile(
        admin,
        profile_photo=photo,
        intro_video="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title="Growth mentor",
        social_links={"instagram": "https://instagram.com/me"},
    )

    _set_profile(admin, bio="Only the bio changed")

    row = _stored(admin, db)
    assert row.bio == "Only the bio changed"
    assert row.profile_photo == photo
    assert row.intro_video == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert row.title == "Growth mentor"
    assert row.social_links == {"instagram": "https://instagram.com/me"}


def test_an_omitted_field_is_never_treated_as_a_clear(admin, db):
    photo = _upload_photo(admin)
    _set_profile(admin, profile_photo=photo)

    # Explicit nulls for everything the form might not have loaded yet.
    client.put("/api/profiles/me", headers=admin["headers"], json={
        "bio": "New bio",
        "profile_photo": None,
        "intro_video": None,
        "title": None,
        "social_links": None,
    })

    assert _stored(admin, db).profile_photo == photo


def test_the_username_cannot_be_blanked(admin, db):
    """An empty slug would take the host's shared link down; it is refused outright."""
    original = _stored(admin, db).username

    client.put("/api/profiles/me", headers=admin["headers"], json={"username": ""})
    client.put("/api/profiles/me", headers=admin["headers"], json={"username": "   "})

    assert _stored(admin, db).username == original
    assert _public(original).status_code == 200


def test_a_username_already_taken_is_refused(tracked, admin, db):
    other = _make_admin(tracked, "b")
    res = client.put("/api/profiles/me", headers=admin["headers"],
                     json={"username": other["username"]})
    assert res.status_code == 400
    assert _stored(admin, db).username == admin["username"]


@pytest.mark.parametrize("action", [
    "login_again", "connect_razorpay", "disconnect_razorpay",
    "connect_google", "change_availability", "create_session",
])
def test_unrelated_actions_never_change_the_photo_or_profile(tracked, admin, db, action):
    photo = _upload_photo(admin)
    _set_profile(admin, profile_photo=photo, bio="Stable bio",
                 intro_video="https://vimeo.com/1130419767")

    if action == "login_again":
        _login(admin)
    elif action == "connect_razorpay":
        client.post("/api/payments/admin/setup", headers=admin["headers"], json={
            "key_id": "rzp_live_photo", "key_secret": "secretvalue1234567890",
        })
    elif action == "disconnect_razorpay":
        client.post("/api/payments/admin/setup", headers=admin["headers"], json={
            "key_id": "rzp_live_photo", "key_secret": "secretvalue1234567890",
        })
        client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    elif action == "connect_google":
        db.add(GoogleConnection(
            admin_id=admin["id"],
            google_email="host@example.com",
            encrypted_refresh_token=encrypt_secret("1//refresh"),
            connection_status="connected",
        ))
        db.commit()
    elif action == "change_availability":
        client.post("/api/availability/rules", headers=admin["headers"], json={
            "rules": [{"day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "is_active": True}],
        })
    elif action == "create_session":
        client.post("/api/sessions/", headers=admin["headers"], json={
            "title": "Consult", "description": "", "duration_minutes": 30,
            "price": 99900, "currency": "INR", "is_active": True,
        })

    row = _stored(admin, db)
    assert row.profile_photo == photo
    assert row.bio == "Stable bio"
    assert row.intro_video == "https://vimeo.com/1130419767"
    assert _public(admin["username"]).json()["profile_photo"] == photo


# =======================================================================================
# Photo storage
# =======================================================================================

def test_an_uploaded_photo_is_stored_in_the_database(admin, db):
    url = _upload_photo(admin)
    asset_id = url.rsplit("/", 1)[-1]

    row = db.query(MediaAsset).filter(MediaAsset.id == asset_id).one()
    assert row.owner_id == admin["id"]
    assert row.data == PNG_BYTES
    assert row.content_type == "image/png"


def test_an_uploaded_photo_is_readable_by_an_unauthenticated_client(admin):
    url = _upload_photo(admin)
    asset_id = url.rsplit("/", 1)[-1]

    res = client.get(f"/api/media/{asset_id}")
    assert res.status_code == 200
    assert res.content == PNG_BYTES
    assert res.headers["content-type"].startswith("image/png")


def test_a_photo_survives_a_restart(admin):
    """
    The point of moving the bytes into the database. On the old filesystem storage this is
    where the photo disappeared: the row still held the URL, the file did not exist.
    """
    url = _upload_photo(admin)
    asset_id = url.rsplit("/", 1)[-1]

    from app.main import app as rebuilt_app
    assert TestClient(rebuilt_app).get(f"/api/media/{asset_id}").content == PNG_BYTES


def test_uploading_requires_authentication():
    res = client.post("/api/upload", files={"file": ("x.png", io.BytesIO(PNG_BYTES), "image/png")})
    assert res.status_code == 401


def test_replacing_a_photo_keeps_the_old_one_readable_until_the_new_one_is_stored(admin, db):
    first = _upload_photo(admin, "old.png")
    _set_profile(admin, profile_photo=first)

    second = _upload_photo(admin, "new.png")
    assert second != first
    # The new file exists before anything points at it, and the old one is still readable --
    # a failed save can never leave the profile pointing at nothing.
    assert client.get(f"/api/media/{first.rsplit('/', 1)[-1]}").status_code == 200
    assert client.get(f"/api/media/{second.rsplit('/', 1)[-1]}").status_code == 200

    _set_profile(admin, profile_photo=second)
    assert _stored(admin, db).profile_photo == second
    assert _public(admin["username"]).json()["profile_photo"] == second


def test_an_oversized_image_is_refused(admin):
    big = b"\x00" * (9 * 1024 * 1024)
    res = client.post(
        "/api/upload",
        headers=admin["headers"],
        files={"file": ("huge.png", io.BytesIO(big), "image/png")},
        data={"file_type": "photo"},
    )
    assert res.status_code == 413


def test_an_unsupported_file_type_is_refused(admin):
    res = client.post(
        "/api/upload",
        headers=admin["headers"],
        files={"file": ("payload.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
        data={"file_type": "auto"},
    )
    assert res.status_code == 400


def test_deleting_an_admin_removes_their_media(tracked, db):
    from app.services.admin_deletion import permanently_delete_admin

    victim = _make_admin(tracked, "m")
    url = _upload_photo(victim)
    asset_id = url.rsplit("/", 1)[-1]
    assert client.get(f"/api/media/{asset_id}").status_code == 200

    permanently_delete_admin(db, db.query(User).filter(User.id == victim["id"]).one())

    assert client.get(f"/api/media/{asset_id}").status_code == 404


# =======================================================================================
# Changes reach the public page
# =======================================================================================

def test_a_saved_change_is_visible_publicly_straight_away(admin):
    _set_profile(admin, bio="First version")
    assert _public(admin["username"]).json()["bio"] == "First version"

    _set_profile(admin, bio="Second version")
    assert _public(admin["username"]).json()["bio"] == "Second version"


def test_a_renamed_slug_moves_the_public_page(admin, db):
    old = admin["username"]
    new = f"{old}x"

    _set_profile(admin, username=new)

    assert _public(new).status_code == 200
    assert _public(old).status_code == 404, "the old slug must not keep resolving"
    assert _stored(admin, db).username == new


def test_the_video_persists_until_the_admin_changes_it(admin, db):
    _set_profile(admin, intro_video="https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    _set_profile(admin, bio="unrelated change")
    assert _stored(admin, db).intro_video == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    _set_profile(admin, intro_video="https://vimeo.com/1130419767")
    assert _stored(admin, db).intro_video == "https://vimeo.com/1130419767"
