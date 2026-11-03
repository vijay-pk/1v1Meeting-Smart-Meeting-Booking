"""
Custom sections on an admin's public booking page.

One place owns the rules, so the Settings editor (PUT /api/sections), the admin read, and the public
profile cannot disagree:

  * every row belongs to one admin; ids and media from another admin are refused;
  * text is stored as plain text (the page renders it as text, never HTML);
  * links are http(s) only; video is a YouTube/Vimeo LINK, normalised to a canonical form;
  * images are references to the admin's own MediaAsset rows (uploaded through POST /api/upload,
    which validates the bytes); nothing binary is stored here;
  * a media object is deleted only when this save removed the last reference to it.
"""
import logging
import re
from typing import Optional
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import AdminProfile, MediaAsset, ProfileSection, ProfileSectionItem

logger = logging.getLogger(__name__)

KINDS = ("info", "testimonials")
MAX_SECTIONS = 20
MAX_ITEMS_PER_SECTION = 30

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_VIMEO_ID = re.compile(r"^\d{6,12}$")


def normalize_video_url(raw: Optional[str]) -> Optional[str]:
    """
    Accepts YouTube and Vimeo links only and returns a canonical URL, or None for "no video".
    Anything else (another host, a file URL, javascript:, embed code, HTML) is refused: the page
    embeds these through the existing click-to-load player, so nothing arbitrary is ever rendered.
    """
    value = (raw or "").strip()
    if not value:
        return None
    if len(value) > 300 or any(c in value for c in "<>\"' \n\r\t"):
        raise HTTPException(status_code=400, detail="Enter a plain YouTube or Vimeo link.")
    parsed = urlparse(value if "://" in value else f"https://{value}")
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Video links must start with http:// or https://.")
    host = (parsed.hostname or "").lower()
    path = [p for p in parsed.path.split("/") if p]

    video_id = None
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"):
        if path[:1] == ["watch"]:
            video_id = (parse_qs(parsed.query).get("v") or [""])[0]
        elif path[:1] in (["embed"], ["shorts"], ["live"]) and len(path) > 1:
            video_id = path[1]
        if video_id and _YT_ID.match(video_id):
            return f"https://www.youtube.com/watch?v={video_id}"
    elif host == "youtu.be" and path:
        if _YT_ID.match(path[0]):
            return f"https://www.youtube.com/watch?v={path[0]}"
    elif host in ("vimeo.com", "www.vimeo.com", "player.vimeo.com"):
        # vimeo.com/123456789, vimeo.com/123456789/hash, vimeo.com/channels/x/123456789,
        # player.vimeo.com/video/123456789: the first all-digit segment is the id.
        candidate = next((seg for seg in path if _VIMEO_ID.match(seg)), "")
        if candidate:
            return f"https://vimeo.com/{candidate}"
    raise HTTPException(status_code=400, detail="Only YouTube and Vimeo video links are supported.")


def clean_text(value: Optional[str], limit: int, label: str, *, required: bool = False) -> Optional[str]:
    text = (value or "").strip()
    if required and not text:
        raise HTTPException(status_code=400, detail=f"{label} is required.")
    if len(text) > limit:
        raise HTTPException(status_code=400, detail=f"{label} must be {limit} characters or fewer.")
    return text or None


def clean_link(value: Optional[str], label: str) -> Optional[str]:
    text = (value or "").strip()
    if not text:
        return None
    if len(text) > 500 or any(c in text for c in "<>\"' \n\r\t"):
        raise HTTPException(status_code=400, detail=f"{label} must be a plain http(s) link.")
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail=f"{label} must start with http:// or https://.")
    return text


def _own_image_asset(db: Session, admin_id: str, asset_id: Optional[str]) -> Optional[str]:
    """The admin's own uploaded IMAGE, or a 400. Never another admin's file, never a non-image."""
    if not asset_id:
        return None
    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset or asset.owner_id != admin_id or not (asset.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="That image is not available. Please upload it again.")
    return asset.id


def _asset_urls(db: Session, ids: set) -> dict:
    if not ids:
        return {}
    rows = db.query(MediaAsset).filter(MediaAsset.id.in_(ids)).all()
    return {a.id: a.public_url for a in rows if a.public_url}


def serialize(db: Session, admin_id: str, *, published_only: bool) -> list:
    """Sections (and their items) for one admin, in display order. Public callers get published only."""
    sq = db.query(ProfileSection).filter(ProfileSection.admin_id == admin_id)
    if published_only:
        sq = sq.filter(ProfileSection.is_published.is_(True))
    sections = sq.order_by(ProfileSection.display_order.asc(), ProfileSection.created_at.asc()).all()
    if not sections:
        return []
    ids = [s.id for s in sections]
    iq = db.query(ProfileSectionItem).filter(
        ProfileSectionItem.admin_id == admin_id, ProfileSectionItem.section_id.in_(ids))
    if published_only:
        iq = iq.filter(ProfileSectionItem.is_published.is_(True))
    items = iq.order_by(ProfileSectionItem.display_order.asc(), ProfileSectionItem.created_at.asc()).all()

    asset_ids = {s.image_asset_id for s in sections if s.image_asset_id} | {i.image_asset_id for i in items if i.image_asset_id}
    urls = _asset_urls(db, asset_ids)

    by_section: dict = {}
    for it in items:
        row = {
            "customer_name": it.customer_name, "designation": it.designation, "text": it.text, "badge": it.badge,
            "image_url": urls.get(it.image_asset_id), "image_alt": it.image_alt, "video_url": it.video_url,
        }
        if not published_only:
            row.update({"id": it.id, "image_asset_id": it.image_asset_id, "is_published": it.is_published,
                        "display_order": it.display_order})
        else:
            row["id"] = it.id
        by_section.setdefault(it.section_id, []).append(row)

    out = []
    for s in sections:
        row = {
            "id": s.id, "kind": s.kind, "title": s.title, "badge": s.badge, "description": s.description,
            "button_text": s.button_text, "button_url": s.button_url,
            "image_url": urls.get(s.image_asset_id), "image_alt": s.image_alt, "video_url": s.video_url,
            "items": by_section.get(s.id, []),
        }
        if not published_only:
            row.update({"image_asset_id": s.image_asset_id, "is_published": s.is_published,
                        "display_order": s.display_order})
        out.append(row)
    return out


def _referenced_assets(db: Session, admin_id: str) -> set:
    ids = {r[0] for r in db.query(ProfileSection.image_asset_id).filter(ProfileSection.admin_id == admin_id).all() if r[0]}
    ids |= {r[0] for r in db.query(ProfileSectionItem.image_asset_id).filter(ProfileSectionItem.admin_id == admin_id).all() if r[0]}
    return ids


def replace_sections(db: Session, admin_id: str, payload) -> list:
    """
    Makes the admin's saved sections equal to `payload` (the Settings screen sends the whole list on
    Save): rows with a known id are updated, new ones created, rows no longer sent are removed, and
    array position becomes display_order. Everything is validated first; a rejected payload changes
    nothing. Returns the admin's sections afterwards.
    """
    sections_in = list(payload.sections or [])
    if len(sections_in) > MAX_SECTIONS:
        raise HTTPException(status_code=400, detail=f"You can have at most {MAX_SECTIONS} sections.")

    existing = {s.id: s for s in db.query(ProfileSection).filter(ProfileSection.admin_id == admin_id).all()}
    existing_items = {i.id: i for i in db.query(ProfileSectionItem).filter(ProfileSectionItem.admin_id == admin_id).all()}
    before_assets = _referenced_assets(db, admin_id)

    # ---- validate everything before touching a row ------------------------------------------
    prepared = []
    for sec in sections_in:
        if sec.id and sec.id not in existing:
            raise HTTPException(status_code=404, detail="Section not found.")
        kind = sec.kind if sec.kind in KINDS else None
        if kind is None:
            raise HTTPException(status_code=400, detail="Unknown section type.")
        title = clean_text(sec.title, 120, "Section title")      # optional
        link = clean_link(sec.button_url, "Button link")
        btn_text = clean_text(sec.button_text, 40, "Button label")
        items_in = list(sec.items or [])
        if len(items_in) > MAX_ITEMS_PER_SECTION:
            raise HTTPException(status_code=400, detail=f"A section can have at most {MAX_ITEMS_PER_SECTION} items.")
        if items_in and kind != "testimonials":
            raise HTTPException(status_code=400, detail="Only testimonial sections can have items.")
        items = []
        for it in items_in:
            if it.id and it.id not in existing_items:
                raise HTTPException(status_code=404, detail="Testimonial not found.")
            fields = {
                "customer_name": clean_text(it.customer_name, 80, "Customer name"),
                "designation": clean_text(it.designation, 120, "Designation"),
                "text": clean_text(it.text, 1000, "Review text"),
                "badge": clean_text(it.badge, 40, "Badge"),
                "image_asset_id": _own_image_asset(db, admin_id, it.image_asset_id),
                "image_alt": clean_text(it.image_alt, 200, "Image description"),
                "video_url": normalize_video_url(it.video_url),
            }
            if not (fields["customer_name"] or fields["text"] or fields["image_asset_id"] or fields["video_url"]):
                continue                    # a blank card has nothing to show: skipped, never blocks the save
            items.append((it, fields))
        fields = {
            "kind": kind, "title": title, "badge": clean_text(sec.badge, 40, "Badge"),
            "description": clean_text(sec.description, 2000, "Description"),
            "button_url": link, "button_text": (btn_text or "Open resource") if link else None,
            "image_asset_id": _own_image_asset(db, admin_id, sec.image_asset_id),
            "image_alt": clean_text(sec.image_alt, 200, "Image description"),
            "video_url": normalize_video_url(sec.video_url),
        }
        # A section with nothing at all to show is skipped, not rejected, so it can never block the
        # rest of the save. Anything that already exists on the server is always kept as sent.
        has_content = any(fields[k] for k in ("title", "badge", "description", "button_url", "image_asset_id", "video_url")) or items
        if not has_content:
            continue
        prepared.append((sec, fields, items))

    # ---- write ------------------------------------------------------------------------------
    keep_sections, keep_items = set(), set()
    for position, (sec, fields, items) in enumerate(prepared):
        row = existing.get(sec.id) if sec.id else None
        if row is None:
            row = ProfileSection(admin_id=admin_id)
            db.add(row)
        for k, v in fields.items():
            setattr(row, k, v)
        row.display_order = position
        row.is_published = bool(sec.is_published)
        db.flush()
        keep_sections.add(row.id)
        for item_pos, (it, ifields) in enumerate(items):
            irow = existing_items.get(it.id) if it.id else None
            if irow is None:
                irow = ProfileSectionItem(admin_id=admin_id, section_id=row.id)
                db.add(irow)
            irow.section_id = row.id
            for k, v in ifields.items():
                setattr(irow, k, v)
            irow.display_order = item_pos
            irow.is_published = bool(it.is_published)
            db.flush()
            keep_items.add(irow.id)

    for iid, irow in existing_items.items():
        if iid not in keep_items:
            db.delete(irow)
    for sid, srow in existing.items():
        if sid not in keep_sections:
            db.delete(srow)
    db.flush()

    # ---- media this save orphaned: delete only if nothing else still points at it -------------
    removed = before_assets - _referenced_assets(db, admin_id)
    objects = []
    if removed:
        profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).first()
        in_use_urls = {u for u in ((profile.profile_photo if profile else None), (profile.cover_image if profile else None)) if u}
        for asset in db.query(MediaAsset).filter(MediaAsset.id.in_(removed), MediaAsset.owner_id == admin_id).all():
            if asset.public_url and asset.public_url in in_use_urls:
                continue                                        # the same file is the profile photo
            if asset.storage_path:
                objects.append(asset.storage_path)
            db.delete(asset)
    db.commit()

    if objects:
        from app.services.admin_deletion import _delete_storage_objects
        _delete_storage_objects(objects)                         # after the commit, best effort
    return serialize(db, admin_id, published_only=False)
