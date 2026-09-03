"""
"Import from SuperProfile" — preview and apply.

The pipeline is deliberately two-step:

    source page -> parsed data (profile_imports row) -> admin reviews -> admin's own records

Parsing never writes to `admin_profiles` or `sessions`. That separation is what makes the
feature safe to run against a live booking page: a bad parse produces a preview the admin
rejects, not a wiped profile.

What an import can never carry across, no matter what the page contains: the admin's
username (their public URL stays their own), Razorpay keys or secrets, and Google OAuth
tokens or calendar ids. Payments keep settling into this admin's own connected Razorpay
account and events keep landing on their own calendar.
"""
import difflib
import os
import re
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_admin
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    ProfileImport,
)
from app.services.superprofile_import import (
    import_superprofile,
    fetch_public_image,
    clean_text,
    SuperProfileURLError,
    SuperProfileFetchError,
    MAX_TITLE_LEN,
)

router = APIRouter()

# Fields an admin may choose to import. `username` is deliberately absent: the imported
# content belongs to this admin, and their public URL stays /{their-username}.
IMPORTABLE_PROFILE_FIELDS = {
    "name",
    "headline",
    "bio",
    "intro_video",
    "social_links",
    "website",
    "profile_image",
}

IMPORT_MODES = {"add", "replace", "sessions_only", "profile_only"}

# Text the admin never wrote: AdminProfile column defaults (models.py:39,45,48) plus the
# bio/heading auth.provision_admin() generates at signup. In "add" mode these must not count
# as "already filled in" -- otherwise an import would silently skip the bio and headline of
# every admin who signed up normally, which is all of them.
PLACEHOLDER_PROFILE_VALUES = {
    "mentor & consultant",
    "mentor & growth consultant",
    "book a 1:1 mentorship session",
    "welcome to my booking portal",
    "choose your session and pick a convenient time.",
}

# Templates from auth.provision_admin(), matched with the admin's own name substituted.
GENERATED_PROFILE_TEMPLATES = (
    "hey! i am {name}. book a 1:1 session with me to accelerate your growth.",
    "book a 1:1 session with {name}",
)

DUPLICATE_SIMILARITY_THRESHOLD = 0.85

# Per-admin rate limit for the fetch endpoint. In-process and therefore per worker, which is
# honest for this deployment; it exists to stop an admin (or a stuck client) from hammering
# superprofile.bio through our server, not as a security boundary.
_PREVIEW_WINDOW_SECONDS = 600
_PREVIEW_MAX_IN_WINDOW = 10
_preview_calls: Dict[str, deque] = defaultdict(deque)

UPLOADS_PHOTOS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "uploads",
    "photos",
)

IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}


# ---------------------------------------------------------------------------------------
# Schemas (local to this router — they describe an import payload, not a stored entity)
# ---------------------------------------------------------------------------------------

class ImportPreviewRequest(BaseModel):
    source_url: str = Field(..., max_length=1000)
    # Optional: the page source, pasted by the admin when SuperProfile refuses an automated
    # request for their page. Parsed and sanitized by the same code path as a fetched page.
    page_html: Optional[str] = Field(None, max_length=2 * 1024 * 1024)


class SessionSelection(BaseModel):
    index: int
    action: str = "create"                      # "create" | "update" | "skip"
    target_session_id: Optional[str] = None     # required for "update"
    title: Optional[str] = None                 # admin's edits win over the parsed values
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    price: Optional[int] = None                 # paise
    currency: Optional[str] = None


class ImportApplyRequest(BaseModel):
    import_id: str
    mode: str = "add"
    profile_fields: List[str] = []
    sessions: List[SessionSelection] = []
    import_image: bool = False
    image_permission_confirmed: bool = False
    confirm_replace: bool = False


# ---------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------

def _rate_limit(admin_id: str) -> None:
    now = time.monotonic()
    calls = _preview_calls[admin_id]
    while calls and now - calls[0] > _PREVIEW_WINDOW_SECONDS:
        calls.popleft()
    if len(calls) >= _PREVIEW_MAX_IN_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many import attempts. Please wait a few minutes and try again.",
        )
    calls.append(now)


def _normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", (title or "").casefold()).strip()


def _find_duplicates(db: Session, admin_id: str, sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Flags imported sessions that look like ones the admin already has.

    A hint for the UI only — nothing is merged or skipped automatically, and the title is
    never used as a destructive identifier.
    """
    existing = db.query(SessionModel).filter(SessionModel.admin_id == admin_id).all()
    if not existing:
        return []

    hits: List[Dict[str, Any]] = []
    for index, parsed in enumerate(sessions):
        incoming = _normalize_title(parsed.get("title") or "")
        if not incoming:
            continue
        for row in existing:
            current = _normalize_title(row.title)
            if not current:
                continue
            ratio = difflib.SequenceMatcher(None, incoming, current).ratio()
            if current == incoming or ratio >= DUPLICATE_SIMILARITY_THRESHOLD:
                hits.append({
                    "session_index": index,
                    "existing_session_id": row.id,
                    "existing_title": row.title,
                    "similarity": round(ratio, 3),
                })
                break
    return hits


def _warnings_for(parsed: Dict[str, Any]) -> List[str]:
    notes: List[str] = []
    profile = parsed.get("profile", {})
    if not any(profile.get(k) for k in ("name", "headline", "bio")):
        notes.append("No public profile text could be read from that page.")
    if not parsed.get("sessions"):
        notes.append("No sessions were found on this page.")
    priceless = [s["title"] for s in parsed.get("sessions", []) if s.get("price") is None]
    if priceless:
        notes.append(
            "No price is shown publicly for: "
            + ", ".join(priceless[:5])
            + ". These will be created as drafts — set a price before publishing."
        )
    if profile.get("profile_image_url"):
        notes.append(
            "The profile image is shown as a preview only. Confirm you have permission to "
            "reuse it if you want it copied into your own media library."
        )
    return notes


async def _store_imported_image(request: Request, image_url: str) -> str:
    """
    Copies an image the admin has confirmed they may reuse into our own storage, and returns
    the local URL. Never hotlinks the third-party asset.
    """
    content, content_type = await fetch_public_image(image_url)
    extension = IMAGE_EXTENSIONS.get(content_type.split(";")[0].strip(), ".img")

    os.makedirs(UPLOADS_PHOTOS_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex[:8]}_imported{extension}"
    with open(os.path.join(UPLOADS_PHOTOS_DIR, filename), "wb") as handle:
        handle.write(content)

    # Same public-URL construction as api/upload.py, so imported and uploaded media resolve
    # identically behind a proxy.
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if "onrender.com" in host or "vercel.app" in host:
        proto = "https"
    return f"{proto}://{host}".rstrip("/") + f"/uploads/photos/{filename}"


# ---------------------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------------------

@router.post("/preview")
async def preview_import(
    req: ImportPreviewRequest,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Fetches and parses a public SuperProfile page, stores the result as a pending import, and
    returns it for review. Writes nothing to the admin's profile or sessions.
    """
    if not req.page_html:
        # Only outbound fetches are rate limited; pasted source makes no request.
        _rate_limit(current_admin.id)

    try:
        parsed = await import_superprofile(req.source_url, req.page_html)
    except SuperProfileURLError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except SuperProfileFetchError as exc:
        # A clean sentence, never an exception trace.
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    record = ProfileImport(
        admin_id=current_admin.id,
        source_url=parsed["source_url"],
        source_type="superprofile",
        status="preview",
        parsed_data=parsed,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "import_id": record.id,
        "source_url": record.source_url,
        "profile": parsed["profile"],
        "sessions": parsed["sessions"],
        "duplicates": _find_duplicates(db, current_admin.id, parsed["sessions"]),
        "warnings": _warnings_for(parsed),
    }


@router.get("/{import_id}")
def get_import(
    import_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    record = (
        db.query(ProfileImport)
        .filter(ProfileImport.id == import_id, ProfileImport.admin_id == current_admin.id)
        .first()
    )
    # 404 rather than 403 for someone else's import: an admin should not be able to probe
    # which import ids exist on other accounts.
    if not record:
        raise HTTPException(status_code=404, detail="Import not found")

    return {
        "import_id": record.id,
        "source_url": record.source_url,
        "status": record.status,
        "profile": (record.parsed_data or {}).get("profile", {}),
        "sessions": (record.parsed_data or {}).get("sessions", []),
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@router.post("/{import_id}/cancel")
def cancel_import(
    import_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    record = (
        db.query(ProfileImport)
        .filter(ProfileImport.id == import_id, ProfileImport.admin_id == current_admin.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Import not found")
    if record.status == "preview":
        record.status = "cancelled"
        db.commit()
    return {"import_id": record.id, "status": record.status}


@router.post("/apply")
async def apply_import(
    req: ImportApplyRequest,
    request: Request,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Applies the parts of a previewed import the admin selected, to their own records only.
    """
    if req.mode not in IMPORT_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown import mode: {req.mode}")

    record = (
        db.query(ProfileImport)
        .filter(ProfileImport.id == req.import_id, ProfileImport.admin_id == current_admin.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Import not found")
    if record.status == "applied":
        raise HTTPException(status_code=409, detail="This import has already been applied.")

    if req.mode == "replace" and not req.confirm_replace:
        raise HTTPException(
            status_code=400,
            detail="Replacing existing profile information requires explicit confirmation.",
        )

    parsed = record.parsed_data or {}
    parsed_profile = parsed.get("profile", {}) or {}
    parsed_sessions = parsed.get("sessions", []) or []

    profile = db.query(AdminProfile).filter(AdminProfile.user_id == current_admin.id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Your admin profile could not be found.")

    applied_profile_fields: List[str] = []
    created_sessions: List[str] = []
    updated_sessions: List[str] = []
    skipped_sessions = 0
    image_note: Optional[str] = None

    try:
        # ---------------- profile ----------------
        if req.mode != "sessions_only":
            selected = [f for f in req.profile_fields if f in IMPORTABLE_PROFILE_FIELDS]
            replace = req.mode == "replace"

            generated = {
                template.format(name=(current_admin.name or "").casefold())
                for template in GENERATED_PROFILE_TEMPLATES
            }

            def _is_blank(current: Optional[str]) -> bool:
                text = (current or "").strip().casefold()
                return not text or text in PLACEHOLDER_PROFILE_VALUES or text in generated

            def _set(attribute: str, value: Optional[str], field_name: str) -> None:
                """In "add" mode an imported value only fills a gap; it never overwrites."""
                if not value:
                    return
                if replace or _is_blank(getattr(profile, attribute, None)):
                    setattr(profile, attribute, value)
                    applied_profile_fields.append(field_name)

            if "name" in selected and parsed_profile.get("name"):
                if replace or not (current_admin.name or "").strip():
                    # The User row's name, not the profile's -- the display name lives there.
                    current_admin.name = parsed_profile["name"][:100]
                    applied_profile_fields.append("name")

            if "headline" in selected:
                _set("title", parsed_profile.get("headline"), "headline")
                _set("heading_text", parsed_profile.get("headline"), "heading_text")
            if "bio" in selected:
                _set("bio", parsed_profile.get("bio"), "bio")
                _set("about_me_text", parsed_profile.get("bio"), "about_me_text")
            if "intro_video" in selected:
                _set("intro_video", parsed_profile.get("intro_video"), "intro_video")

            if "social_links" in selected or "website" in selected:
                links = dict(profile.social_links or {})
                incoming = dict(parsed_profile.get("social_links") or {})
                if "website" in selected and parsed_profile.get("website"):
                    incoming["website"] = parsed_profile["website"]
                if "social_links" not in selected:
                    incoming = {k: v for k, v in incoming.items() if k == "website"}
                for key, value in incoming.items():
                    if replace or not (links.get(key) or "").strip():
                        links[key] = value
                if incoming:
                    profile.social_links = links
                    applied_profile_fields.append("social_links")

            if "profile_image" in selected and parsed_profile.get("profile_image_url"):
                if not req.image_permission_confirmed or not req.import_image:
                    # Preview-only until the admin asserts they may reuse the image.
                    image_note = (
                        "The profile image was not imported: confirm you have permission to "
                        "reuse it, or upload your own copy."
                    )
                else:
                    try:
                        stored_url = await _store_imported_image(
                            request, parsed_profile["profile_image_url"]
                        )
                        if replace or not (profile.profile_photo or "").strip():
                            profile.profile_photo = stored_url
                            applied_profile_fields.append("profile_image")
                    except SuperProfileFetchError as exc:
                        image_note = f"The profile image could not be imported: {exc}"

        # ---------------- sessions ----------------
        if req.mode != "profile_only":
            for selection in req.sessions:
                if selection.action == "skip":
                    skipped_sessions += 1
                    continue
                if not (0 <= selection.index < len(parsed_sessions)):
                    continue

                source = parsed_sessions[selection.index]
                title = clean_text(selection.title or source.get("title"), max_len=MAX_TITLE_LEN)
                if not title:
                    skipped_sessions += 1
                    continue

                description = clean_text(
                    selection.description if selection.description is not None else source.get("description")
                ) or ""
                duration = selection.duration_minutes or source.get("duration_minutes")
                price = selection.price if selection.price is not None else source.get("price")
                currency = (selection.currency or source.get("currency") or "INR").upper()[:10]

                # A session with no publicly displayed price is created as a draft rather than
                # given an invented one, so nothing can be sold at a price nobody set.
                is_draft = price is None or duration is None

                if selection.action == "update":
                    target = (
                        db.query(SessionModel)
                        .filter(
                            SessionModel.id == selection.target_session_id,
                            # Ownership re-checked here, not taken from the request.
                            SessionModel.admin_id == current_admin.id,
                        )
                        .first()
                    )
                    if not target:
                        skipped_sessions += 1
                        continue
                    target.title = title
                    target.description = description
                    if duration:
                        target.duration_minutes = duration
                    if price is not None:
                        target.price = price
                    target.currency = currency
                    updated_sessions.append(target.id)
                    continue

                new_session = SessionModel(
                    admin_id=current_admin.id,
                    title=title,
                    description=description,
                    duration_minutes=duration or 30,
                    price=price or 0,
                    original_price=source.get("original_price"),
                    currency=currency,
                    is_active=not is_draft,
                    sort_order=len(created_sessions) + 1,
                )
                db.add(new_session)
                db.flush()
                created_sessions.append(new_session.id)

        record.status = "applied"
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="The import could not be applied. Nothing was changed.",
        ) from exc

    return {
        "import_id": record.id,
        "mode": req.mode,
        "profile_fields_applied": sorted(set(applied_profile_fields)),
        "sessions_created": len(created_sessions),
        "sessions_updated": len(updated_sessions),
        "sessions_skipped": skipped_sessions,
        "drafts_created": sum(
            1 for s in db.query(SessionModel).filter(SessionModel.id.in_(created_sessions)).all()
            if not s.is_active
        ) if created_sessions else 0,
        "image_note": image_note,
        "message": "Imported into your profile. Review and publish when you are ready.",
    }
