"""
Custom sections on the public booking page: saved on the server, shown to visitors, owned by one admin.

Root cause these guard against: sections used to live only in the browser. The Settings payload never
sent them, the backend had no table or schema field for them, the public profile never carried them,
and /profiles/me rebuilt the admin without them, so a "saved" section vanished on reload and never
reached a visitor. Images go through the real upload endpoint with storage faked (as the other
upload tests do); video is a YouTube/Vimeo link only.
"""
import io

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app, seed_initial_data
from app.models.models import MediaAsset, ProfileSection, ProfileSectionItem
from app.services import supabase_storage

# Shared fixtures/helpers from the profile tests: storage faked, admin signup, upload.
from test_public_profile import (  # noqa: F401
    PNG_BYTES, _login, _make_admin, _public, _set_profile, admin, db, fake_storage, tracked,
)

seed_initial_data()
client = TestClient(app)


@pytest.fixture(autouse=True)
def _cleanup(tracked):
    yield
    s = SessionLocal()
    try:
        for uid in tracked:
            s.query(ProfileSectionItem).filter(ProfileSectionItem.admin_id == uid).delete(synchronize_session=False)
            s.query(ProfileSection).filter(ProfileSection.admin_id == uid).delete(synchronize_session=False)
        s.commit()
    finally:
        s.close()


def _put(admin, sections, headers=None):
    return client.put("/api/sections", headers=headers or admin["headers"], json={"sections": sections})


def _get(admin):
    res = client.get("/api/sections", headers=_login(admin))     # a fresh sign-in, as after a reload
    assert res.status_code == 200, res.text
    return res.json()["sections"]


def _pub_sections(admin):
    return _public(admin["username"]).json()["sections"]


def _upload(admin, name="pic.png"):
    res = client.post("/api/upload", headers=admin["headers"],
                      files={"file": (name, io.BytesIO(PNG_BYTES), "image/png")}, data={"file_type": "photo"})
    assert res.status_code == 200, res.text
    j = res.json()
    return j["saved_as"], j["url"]


INFO = {"kind": "info", "title": "Free resources", "badge": "NEW", "description": "Templates I use with clients.",
        "button_text": "Download", "button_url": "https://example.com/pack"}


# --- the bug: saved -> persisted -> public ------------------------------------------------

def test_a_saved_section_survives_a_fresh_login_and_reaches_the_public_page(admin):
    res = _put(admin, [INFO])
    assert res.status_code == 200, res.text
    saved = _get(admin)
    assert len(saved) == 1 and saved[0]["title"] == "Free resources" and saved[0]["id"]
    pub = _pub_sections(admin)
    assert len(pub) == 1
    assert (pub[0]["title"], pub[0]["badge"], pub[0]["button_text"], pub[0]["button_url"]) == (
        "Free resources", "NEW", "Download", "https://example.com/pack")


def test_the_profile_endpoint_still_works_and_public_profile_is_otherwise_unchanged(admin):
    _put(admin, [INFO])
    pub = _public(admin["username"]).json()
    assert pub["username"] == admin["username"] and "sessions" in pub and "google_connected" in pub


def test_editing_and_deleting_a_section_updates_the_public_page(admin):
    sid = _put(admin, [INFO]).json()["sections"][0]["id"]
    _put(admin, [{**INFO, "id": sid, "title": "Renamed", "description": ""}])
    pub = _pub_sections(admin)
    assert pub[0]["title"] == "Renamed" and pub[0]["description"] is None and pub[0]["id"] == sid
    _put(admin, [])
    assert _pub_sections(admin) == [] and _get(admin) == []


def test_public_payload_leaks_no_internal_ids(admin):
    asset, _ = _upload(admin)
    _put(admin, [{**INFO, "image_asset_id": asset}])
    text = str(_pub_sections(admin))
    assert asset not in text and "admin_id" not in text and "image_asset_id" not in text and "is_published" not in text


# --- publishing, order ---------------------------------------------------------------------

def test_unpublished_sections_and_items_are_hidden_publicly_but_kept_for_the_admin(admin):
    _put(admin, [
        {**INFO, "title": "Visible"},
        {**INFO, "title": "Hidden", "is_published": False},
        {"kind": "testimonials", "title": "Reviews", "items": [
            {"customer_name": "Asha", "text": "Great", "is_published": True},
            {"customer_name": "Ben", "text": "Draft", "is_published": False}]},
    ])
    pub = _pub_sections(admin)
    assert [s["title"] for s in pub] == ["Visible", "Reviews"]
    assert [i["customer_name"] for i in pub[1]["items"]] == ["Asha"]
    mine = _get(admin)
    assert [s["title"] for s in mine] == ["Visible", "Hidden", "Reviews"]
    assert [i["customer_name"] for i in mine[2]["items"]] == ["Asha", "Ben"]
    assert mine[1]["is_published"] is False


def test_display_order_follows_the_saved_order_and_can_be_changed(admin):
    a, b, c = ({**INFO, "title": t} for t in ("A", "B", "C"))
    ids = {s["title"]: s["id"] for s in _put(admin, [a, b, c]).json()["sections"]}
    assert [s["title"] for s in _pub_sections(admin)] == ["A", "B", "C"]
    _put(admin, [{**c, "id": ids["C"]}, {**a, "id": ids["A"]}, {**b, "id": ids["B"]}])
    assert [s["title"] for s in _pub_sections(admin)] == ["C", "A", "B"]
    assert [s["title"] for s in _get(admin)] == ["C", "A", "B"]


# --- testimonials --------------------------------------------------------------------------

def test_a_testimonial_section_holds_several_items_with_their_own_media(admin):
    a1, u1 = _upload(admin, "a.png")
    a2, u2 = _upload(admin, "b.png")
    _put(admin, [{"kind": "testimonials", "title": "Success stories", "items": [
        {"customer_name": "Asha", "designation": "Product Manager", "text": "Changed my career.",
         "image_asset_id": a1, "image_alt": "Asha", "badge": "Success Story"},
        {"customer_name": "Ben", "video_url": "https://youtu.be/dQw4w9WgXcQ", "image_asset_id": a2},
        {"text": "Anonymous but useful."}]}])
    items = _pub_sections(admin)[0]["items"]
    assert [i["customer_name"] for i in items] == ["Asha", "Ben", None]
    assert items[0]["image_url"] == u1 and items[1]["image_url"] == u2 and items[2]["image_url"] is None
    assert items[1]["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert items[0]["badge"] == "Success Story" and items[1]["badge"] is None     # never invented


def test_testimonial_items_can_be_reordered_edited_and_removed(admin):
    saved = _put(admin, [{"kind": "testimonials", "title": "R", "items": [
        {"customer_name": "One", "text": "1"}, {"customer_name": "Two", "text": "2"}, {"customer_name": "Three", "text": "3"}]}]).json()["sections"][0]
    ids = {i["customer_name"]: i["id"] for i in saved["items"]}
    _put(admin, [{"id": saved["id"], "kind": "testimonials", "title": "R", "items": [
        {"id": ids["Three"], "customer_name": "Three", "text": "3"},
        {"id": ids["One"], "customer_name": "One edited", "text": "1"}]}])
    assert [i["customer_name"] for i in _pub_sections(admin)[0]["items"]] == ["Three", "One edited"]
    db = SessionLocal()
    try:
        assert db.query(ProfileSectionItem).filter(ProfileSectionItem.id == ids["Two"]).first() is None
    finally:
        db.close()


# --- images --------------------------------------------------------------------------------

def test_an_uploaded_image_appears_and_can_be_replaced_and_removed(admin, fake_storage, db):
    a1, u1 = _upload(admin, "one.png")
    sid = _put(admin, [{**INFO, "image_asset_id": a1, "image_alt": "Cover"}]).json()["sections"][0]["id"]
    sec = _pub_sections(admin)[0]
    assert sec["image_url"] == u1 and sec["image_alt"] == "Cover"
    first_path = db.query(MediaAsset).filter(MediaAsset.id == a1).one().storage_path
    assert first_path in fake_storage

    a2, u2 = _upload(admin, "two.png")                                  # replace
    _put(admin, [{**INFO, "id": sid, "image_asset_id": a2}])
    assert _pub_sections(admin)[0]["image_url"] == u2
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a1).first() is None     # old asset gone
    assert first_path not in fake_storage                                      # and its object

    _put(admin, [{**INFO, "id": sid, "image_asset_id": None}])                  # remove
    assert _pub_sections(admin)[0]["image_url"] is None
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a2).first() is None


def test_editing_other_fields_keeps_the_existing_image(admin, db):
    a1, u1 = _upload(admin)
    sid = _put(admin, [{**INFO, "image_asset_id": a1}]).json()["sections"][0]["id"]
    saved = _get(admin)[0]
    _put(admin, [{**INFO, "id": sid, "title": "New title", "image_asset_id": saved["image_asset_id"]}])
    assert _pub_sections(admin)[0]["image_url"] == u1
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a1).first() is not None


def test_an_image_still_used_elsewhere_is_not_deleted(admin, db):
    a1, _ = _upload(admin)
    ids = [s["id"] for s in _put(admin, [{**INFO, "title": "X", "image_asset_id": a1},
                                          {**INFO, "title": "Y", "image_asset_id": a1}]).json()["sections"]]
    _put(admin, [{**INFO, "id": ids[0], "title": "X", "image_asset_id": a1}])        # Y removed, X still uses it
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a1).first() is not None


def test_removing_a_section_deletes_its_unreferenced_media(admin, fake_storage, db):
    a1, _ = _upload(admin)
    path = db.query(MediaAsset).filter(MediaAsset.id == a1).one().storage_path
    _put(admin, [{**INFO, "image_asset_id": a1}])
    _put(admin, [])
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a1).first() is None
    assert path not in fake_storage


def test_the_profile_photo_is_never_deleted_by_section_cleanup(admin, db):
    a1, url = _upload(admin)
    _set_profile(admin, profile_photo=url)
    sid = _put(admin, [{**INFO, "image_asset_id": a1}]).json()["sections"][0]["id"]
    _put(admin, [{**INFO, "id": sid, "image_asset_id": None}])
    db.expire_all()
    assert db.query(MediaAsset).filter(MediaAsset.id == a1).first() is not None        # same file is the photo


# --- ownership -----------------------------------------------------------------------------

def test_another_admin_cannot_use_my_image_or_edit_my_section(tracked):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    asset, _ = _upload(a)
    sid = _put(a, [{**INFO, "title": "Mine"}]).json()["sections"][0]["id"]
    assert _put(b, [{**INFO, "image_asset_id": asset}]).status_code == 400            # not B's file
    assert _put(b, [{**INFO, "id": sid, "title": "Hijack"}]).status_code == 404        # not B's section
    assert _get(a)[0]["title"] == "Mine"
    assert _get(b) == []


def test_each_admins_page_shows_only_their_own_sections(tracked):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    _put(a, [{**INFO, "title": "Alice section"}])
    _put(b, [{**INFO, "title": "Bob section"}])
    assert [s["title"] for s in _pub_sections(a)] == ["Alice section"]
    assert [s["title"] for s in _pub_sections(b)] == ["Bob section"]


def test_sections_require_a_signed_in_admin():
    assert client.get("/api/sections").status_code == 401
    assert client.put("/api/sections", json={"sections": []}).status_code == 401


def test_a_non_image_asset_cannot_be_attached(admin, db):
    asset, _ = _upload(admin)
    db.query(MediaAsset).filter(MediaAsset.id == asset).update({"content_type": "video/mp4"})
    db.commit()
    assert _put(admin, [{**INFO, "image_asset_id": asset}]).status_code == 400


# --- validation ----------------------------------------------------------------------------

@pytest.mark.parametrize("bad", [
    {"title": "x" * 121},
    {"button_url": "javascript:alert(1)"}, {"button_url": "ftp://example.com/x"}, {"button_url": "not a url"},
    {"button_url": "https://ex.com/<script>"}, {"description": "x" * 2001}, {"badge": "x" * 41},
    {"kind": "carousel"}, {"video_url": "https://example.com/video.mp4"}, {"video_url": "https://evil.com/watch?v=dQw4w9WgXcQ"},
    {"video_url": "<iframe src='https://youtube.com/embed/dQw4w9WgXcQ'></iframe>"}, {"video_url": "javascript:alert(1)"},
    {"video_url": "https://www.youtube.com/watch?v=short"}, {"video_url": "https://vimeo.com/notanumber"},
])
def test_invalid_input_is_rejected_and_changes_nothing(admin, bad):
    _put(admin, [INFO])
    res = _put(admin, [{**INFO, **bad}])
    assert res.status_code == 400, (bad, res.text)
    assert [s["title"] for s in _get(admin)] == ["Free resources"]


@pytest.mark.parametrize("raw,canon", [
    ("https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("https://vimeo.com/123456789", "https://vimeo.com/123456789"),
    ("https://vimeo.com/123456789/abcdef1234", "https://vimeo.com/123456789"),
    ("https://player.vimeo.com/video/123456789?h=abc", "https://vimeo.com/123456789"),
    ("https://vimeo.com/channels/staffpicks/123456789", "https://vimeo.com/123456789"),
])
def test_youtube_and_vimeo_links_are_accepted_and_normalised(admin, raw, canon):
    res = _put(admin, [{**INFO, "video_url": raw}])
    assert res.status_code == 200, res.text
    assert _pub_sections(admin)[0]["video_url"] == canon


def test_a_button_label_without_a_link_shows_no_button_and_a_link_gets_a_default_label(admin):
    _put(admin, [{**INFO, "button_url": "", "button_text": "Download"}])
    pub = _pub_sections(admin)[0]
    assert pub["button_url"] is None and pub["button_text"] is None
    _put(admin, [{**INFO, "button_url": "https://example.com", "button_text": ""}])
    assert _pub_sections(admin)[0]["button_text"] == "Open resource"


def test_only_testimonial_sections_have_items_and_blank_items_are_skipped(admin):
    assert _put(admin, [{**INFO, "items": [{"customer_name": "X", "text": "y"}]}]).status_code == 400
    assert _put(admin, [{"kind": "testimonials", "title": "R", "items": [{"customer_name": "X" * 81, "text": "y"}]}]).status_code == 400
    saved = _put(admin, [{"kind": "testimonials", "title": "R", "items": [{}, {"text": "kept"}]}])
    assert saved.status_code == 200, saved.text
    assert [i["text"] for i in saved.json()["sections"][0]["items"]] == ["kept"]


# --- optional title ------------------------------------------------------------------------

def test_a_section_needs_no_title_and_media_only_sections_save_and_show(admin):
    (a1, u1), (a2, u2) = _upload(admin, "a.png"), _upload(admin, "b.png")
    res = _put(admin, [
        {"kind": "info", "image_asset_id": a1},                                         # image only, title omitted
        {"kind": "info", "title": "", "image_asset_id": a2},                            # image only, title empty
        {"kind": "info", "title": None, "video_url": "https://youtu.be/dQw4w9WgXcQ"},   # video only, title null
        {"kind": "testimonials", "items": [{"customer_name": "Asha", "text": "Great"}]},  # reviews only
    ])
    assert res.status_code == 200, res.text
    pub = _pub_sections(admin)
    assert len(pub) == 4 and all(s["title"] is None for s in pub)
    assert pub[0]["image_url"] == u1 and pub[1]["image_url"] == u2
    assert pub[2]["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert pub[3]["items"][0]["customer_name"] == "Asha"


def test_a_title_is_still_kept_when_given_and_title_free_sections_edit_without_losing_media(admin):
    asset, url = _upload(admin)
    sid = _put(admin, [{"kind": "info", "image_asset_id": asset}]).json()["sections"][0]["id"]
    assert _put(admin, [{"kind": "info", "id": sid, "image_asset_id": asset, "badge": "New"}]).status_code == 200
    got = _get(admin)[0]
    assert got["id"] == sid and got["image_url"] == url and got["badge"] == "New" and got["title"] is None
    assert _put(admin, [{**INFO, "id": sid, "image_asset_id": asset}]).json()["sections"][0]["title"] == "Free resources"


def test_a_completely_empty_section_is_skipped_and_never_blocks_the_rest(admin):
    res = _put(admin, [{"kind": "info", "title": "  "}, {**INFO, "title": "Real"}, {"kind": "testimonials", "items": [{}]}])
    assert res.status_code == 200, res.text
    assert [s["title"] for s in res.json()["sections"]] == ["Real"]


def test_unpublished_title_free_sections_stay_off_the_public_page(admin):
    _put(admin, [{"kind": "info", "badge": "Hidden", "is_published": False}, {"kind": "info", "badge": "Shown"}])
    assert [s["badge"] for s in _pub_sections(admin)] == ["Shown"]
    assert len(_get(admin)) == 2


def test_title_free_sections_are_isolated_between_admins(tracked):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    _put(a, [{"kind": "info", "badge": "A-only"}])
    _put(b, [{"kind": "info", "badge": "B-only"}])
    assert [s["badge"] for s in _pub_sections(a)] == ["A-only"]
    assert [s["badge"] for s in _pub_sections(b)] == ["B-only"]


def test_a_database_built_with_the_old_not_null_title_is_upgraded_in_place(tmp_path):
    """Existing databases keep every section and id; only the NOT NULL goes."""
    from sqlalchemy import create_engine, text, inspect
    from app.main import _make_section_title_nullable
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)"))
        c.execute(text("CREATE TABLE profile_sections (id VARCHAR(36) PRIMARY KEY, admin_id VARCHAR(36) NOT NULL REFERENCES users(id), "
                       "kind VARCHAR(20) NOT NULL, title VARCHAR(120) NOT NULL, badge VARCHAR(40), description TEXT, button_text VARCHAR(40), "
                       "button_url VARCHAR(500), image_asset_id VARCHAR(36), image_alt VARCHAR(200), video_url VARCHAR(300), "
                       "display_order INTEGER NOT NULL, is_published BOOLEAN NOT NULL, created_at DATETIME, updated_at DATETIME)"))
        c.execute(text("INSERT INTO users VALUES ('u1')"))
        c.execute(text("INSERT INTO profile_sections (id, admin_id, kind, title, display_order, is_published) VALUES ('s1','u1','info','Old title',0,1)"))
    _make_section_title_nullable(eng)
    col = next(c for c in inspect(eng).get_columns("profile_sections") if c["name"] == "title")
    assert col["nullable"] is True
    with eng.begin() as c:
        assert c.execute(text("SELECT id, title FROM profile_sections")).fetchall() == [("s1", "Old title")]
        c.execute(text("INSERT INTO profile_sections (id, admin_id, kind, title, display_order, is_published) VALUES ('s2','u1','info',NULL,1,1)"))


def test_limits_on_sections_and_items(admin):
    assert _put(admin, [{**INFO, "title": f"S{i}"} for i in range(21)]).status_code == 400
    many = [{"customer_name": f"C{i}", "text": "t"} for i in range(31)]
    assert _put(admin, [{"kind": "testimonials", "title": "R", "items": many}]).status_code == 400


def test_text_is_stored_as_plain_text_not_html(admin):
    _put(admin, [{**INFO, "description": "<script>alert(1)</script> hello"}])
    assert _pub_sections(admin)[0]["description"] == "<script>alert(1)</script> hello"    # the page renders it as text


# --- lifecycle -----------------------------------------------------------------------------

def test_permanently_deleting_an_admin_removes_their_sections(tracked, db):
    from app.services.admin_deletion import permanently_delete_admin
    a = _make_admin(tracked, "a")
    asset, _ = _upload(a)
    _put(a, [{"kind": "testimonials", "title": "R", "items": [{"customer_name": "X", "text": "y", "image_asset_id": asset}]}])
    from app.models.models import User
    permanently_delete_admin(db, db.query(User).filter(User.id == a["id"]).one(), deleted_by=None, reason="test")
    db.expire_all()
    assert db.query(ProfileSection).filter(ProfileSection.admin_id == a["id"]).count() == 0
    assert db.query(ProfileSectionItem).filter(ProfileSectionItem.admin_id == a["id"]).count() == 0
    assert db.query(MediaAsset).filter(MediaAsset.id == asset).first() is None
