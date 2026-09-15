"""
Tests for profile photo optimization (services/image_optimizer.py) through POST /api/upload.

Images are generated with Pillow so every case is real: large camera-sized JPEGs, PNGs with
transparency, WebP, portrait/landscape/square, EXIF with GPS, rotated phone photos, and files
that only pretend to be images. Supabase Storage is stubbed; what is asserted is what would be
handed to it.
"""
import io
import random
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.models.models import AdminProfile, MediaAsset, User
from app.services import supabase_storage
from app.services.image_optimizer import MAX_DIMENSION, optimize_profile_image

seed_initial_data()
client = TestClient(app)
PASSWORD = "TestPassw0rd!123"


@pytest.fixture(autouse=True)
def storage(monkeypatch):
    objects = {}

    async def fake_upload(object_path, data, content_type):
        objects[object_path] = (data, content_type)
        return supabase_storage.public_url(object_path)

    from app.api import upload as upload_api
    monkeypatch.setattr(upload_api, "upload_object", fake_upload)
    monkeypatch.setattr(upload_api, "is_configured", lambda: True)
    return objects


@pytest.fixture
def tracked():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for user_id in ids:
            db.query(MediaAsset).filter(MediaAsset.owner_id == user_id).delete(synchronize_session=False)
            db.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/auth/signup", json={
        "name": f"Photo {tag}", "email": f"img_{tag}_{uid}@testdomain.com", "password": PASSWORD, "username": f"img{tag}{uid}",
    })
    assert res.status_code == 200, res.text
    tracked.append(res.json()["user_id"])
    return {"id": res.json()["user_id"], "headers": {"Authorization": f"Bearer {res.json()['access_token']}"}}


@pytest.fixture
def admin(tracked):
    return _admin(tracked)


def _photo(width, height, fmt="JPEG", mode="RGB", quality=95, exif=None, noise=True):
    """A photo-like image: noise defeats compression the way real camera detail does."""
    rng = random.Random(width * 31 + height)
    image = Image.new(mode, (width, height))
    if noise:
        base = Image.effect_noise((width, height), 60).convert("L")
        gradient = Image.linear_gradient("L").resize((width, height))
        rgb = Image.merge("RGB", (base, gradient, Image.eval(base, lambda v: 255 - v)))
        image = rgb.convert(mode) if mode != "RGB" else rgb
    else:
        image.paste((rng.randint(0, 255), 120, 200) if mode == "RGB" else (10, 120, 200, 128), (0, 0, width, height))
    out = io.BytesIO()
    kwargs = {"format": fmt}
    if fmt in ("JPEG", "WEBP"):
        kwargs["quality"] = quality
    if exif is not None:
        kwargs["exif"] = exif
    image.save(out, **kwargs)
    return out.getvalue()


def _upload(admin, data, name="photo.jpg", mime="image/jpeg"):
    return client.post("/api/upload", headers=admin["headers"],
                       files={"file": (name, io.BytesIO(data), mime)}, data={"file_type": "photo"})


def _stored(storage):
    path, (data, content_type) = list(storage.items())[-1]
    return path, data, content_type, Image.open(io.BytesIO(data))


# --- formats and sizes -------------------------------------------------------------------

def test_large_jpeg_is_resized_and_shrinks_to_kilobytes(admin, storage):
    original = _photo(4000, 3000, quality=80)
    assert len(original) > 1_500_000
    res = _upload(admin, original)
    assert res.status_code == 200, res.text
    body = res.json()
    path, data, content_type, image = _stored(storage)
    assert content_type == "image/webp" and path.endswith(".webp")
    assert image.size == (1024, 768), "aspect ratio kept, longest side capped"
    assert body["optimized"] is True and body["original_size"] == len(original)
    assert body["size"] == len(data) < len(original) / 5


def test_portrait_and_square_keep_their_shape(admin, storage):
    _upload(admin, _photo(1500, 3000))
    assert _stored(storage)[3].size == (512, 1024)
    _upload(admin, _photo(2048, 2048))
    assert _stored(storage)[3].size == (1024, 1024)


def test_small_image_is_never_upscaled(admin, storage):
    _upload(admin, _photo(300, 200, fmt="PNG"), name="small.png", mime="image/png")
    assert _stored(storage)[3].size == (300, 200)


def test_png_with_transparency_keeps_alpha(admin, storage):
    _upload(admin, _photo(1600, 1600, fmt="PNG", mode="RGBA", noise=False), name="logo.png", mime="image/png")
    _, _, content_type, image = _stored(storage)
    assert content_type == "image/webp" and image.mode == "RGBA" and image.size == (1024, 1024)


def test_webp_upload_is_accepted(admin, storage):
    res = _upload(admin, _photo(2000, 1000, fmt="WEBP", quality=100), name="p.webp", mime="image/webp")
    assert res.status_code == 200
    assert _stored(storage)[3].size == (1024, 512)


def test_already_optimized_small_image_is_not_recompressed(admin, storage):
    original = _photo(400, 400, fmt="WEBP", quality=60, noise=False)
    res = _upload(admin, original, name="tiny.webp", mime="image/webp")
    _, data, _, _ = _stored(storage)
    assert data == original and res.json()["optimized"] is False


def test_quality_is_preserved(admin, storage):
    """Downscale the original and the stored result to the same size; they must look alike."""
    original = _photo(2400, 1600, noise=False)
    _upload(admin, original)
    stored = _stored(storage)[3].convert("RGB")
    reference = Image.open(io.BytesIO(original)).convert("RGB").resize(stored.size)
    diff = sum(abs(a - b) for pa, pb in zip(reference.getdata(), stored.getdata()) for a, b in zip(pa, pb))
    assert diff / (stored.size[0] * stored.size[1] * 3) < 4, "mean channel error over 4/255"


# --- metadata and orientation ------------------------------------------------------------

def _exif(orientation=None, gps=True):
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (12.0, 58.0, 0.0), 3: "E", 4: (77.0, 35.0, 0.0)}
        exif[0x010F] = "PhoneMaker"
    return exif


def test_exif_and_gps_are_stripped(admin, storage):
    original = _photo(800, 600, exif=_exif())
    assert Image.open(io.BytesIO(original)).getexif()
    _upload(admin, original)
    _, data, _, image = _stored(storage)
    assert not image.getexif() and b"PhoneMaker" not in data


def test_phone_orientation_is_applied_before_exif_is_dropped(admin, storage):
    # Stored landscape 1200x800 with "rotate 90" -- a portrait photo as a phone saves it.
    _upload(admin, _photo(1200, 800, exif=_exif(orientation=6, gps=False)))
    assert _stored(storage)[3].size == (683, 1024)


# --- rejection ---------------------------------------------------------------------------

def test_non_image_is_rejected(admin, storage):
    res = _upload(admin, b"%PDF-1.4 not an image at all", name="cv.png", mime="image/png")
    assert res.status_code == 400 and not storage


def test_truncated_image_is_rejected_and_nothing_is_stored(admin, storage):
    broken = _photo(1200, 900)[:2000]
    res = _upload(admin, broken)
    assert res.status_code == 400 and not storage


def test_file_over_the_limit_is_rejected(admin, storage):
    res = _upload(admin, b"\xff\xd8\xff" + b"\x00" * (8 * 1024 * 1024 + 10))
    assert res.status_code == 413 and not storage


def test_decompression_bomb_is_rejected():
    image = Image.new("L", (9000, 9000))  # 81 MP of nothing: tiny as a PNG
    out = io.BytesIO()
    image.save(out, format="PNG")
    with pytest.raises(ValueError):
        optimize_profile_image(out.getvalue(), "image/png", ".png")


# --- isolation ---------------------------------------------------------------------------

def test_each_admins_upload_lands_under_their_own_prefix(tracked, storage):
    a = _admin(tracked, "a")
    b = _admin(tracked, "b")
    _upload(a, _photo(900, 900))
    _upload(b, _photo(900, 900))
    paths = list(storage)
    assert paths[0].startswith(f"profile/{a['id']}/") and paths[1].startswith(f"profile/{b['id']}/")
    assert paths[0] != paths[1]


def test_upload_does_not_change_the_saved_profile_photo(admin, storage):
    client.put("/api/profiles/me", headers=admin["headers"], json={"profile_photo": "https://example.com/current.webp"})
    _upload(admin, _photo(900, 900))
    assert client.get("/api/profiles/me", headers=admin["headers"]).json()["profile_photo"] == "https://example.com/current.webp"
