"""
Uploads for profile media.

Bytes go into the database (`media_assets`), not onto the server's disk. The previous
implementation wrote into `backend/uploads/` and handed back a filesystem URL: on a container
host that directory does not survive a deploy or a restart, so an admin's stored
`profile_photo` kept pointing at a file that no longer existed. Nothing had reset the profile
-- the row was fine, the bytes were gone -- but the effect was a photo that disappeared on its
own, which is exactly what must never happen.

`/uploads/...` is still mounted in main.py so URLs stored before this change keep resolving
for as long as those files exist; new uploads are addressed as `/api/media/{id}`.
"""
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.models import MediaAsset, User

router = APIRouter()
# Serving is its own router so it can be mounted at /api/media rather than under /api/upload.
media_router = APIRouter()

ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".avif"}
ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".ogv"}

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 25 * 1024 * 1024

# Read in chunks so an oversized file is refused while streaming rather than after the whole
# thing is already in memory.
CHUNK_BYTES = 256 * 1024

CONTENT_TYPE_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".ogv": "video/ogg",
}


def _public_base_url(request: Request) -> str:
    """The externally visible origin, respecting the proxy in front of us."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if "onrender.com" in host or "vercel.app" in host:
        proto = "https"
    return f"{proto}://{host}".rstrip("/")


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    file_type: str = Form("auto"),
    # Authenticated: this endpoint used to accept a file from anyone at all, which is an
    # open invitation to fill the host's storage.
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    original_name = file.filename or "media_file"
    ext = os.path.splitext(original_name)[1].lower()
    content_type = (file.content_type or "").lower()

    is_video = file_type == "video" or ext in ALLOWED_VIDEO_EXTS or "video" in content_type
    is_image = file_type == "photo" or ext in ALLOWED_IMAGE_EXTS or "image" in content_type

    if not is_video and not is_image:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported file format. Please choose an image "
                f"({', '.join(sorted(ALLOWED_IMAGE_EXTS))}) or video "
                f"({', '.join(sorted(ALLOWED_VIDEO_EXTS))})."
            ),
        )

    limit = MAX_VIDEO_BYTES if is_video else MAX_IMAGE_BYTES
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than {limit // (1024 * 1024)}MB.",
            )
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(status_code=400, detail="That file is empty.")

    resolved_type = (
        content_type
        if content_type.startswith(("image/", "video/"))
        else CONTENT_TYPE_BY_EXT.get(ext, "application/octet-stream")
    )

    clean_name = "".join(c for c in original_name if c.isalnum() or c in "._-").strip()
    asset = MediaAsset(
        owner_id=current_admin.id,
        filename=clean_name or f"upload{ext}",
        content_type=resolved_type,
        byte_size=total,
        data=b"".join(chunks),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    return {
        "success": True,
        "url": f"{_public_base_url(request)}/api/media/{asset.id}",
        "filename": original_name,
        "saved_as": asset.id,
        "type": "video" if is_video else "photo",
        "size": total,
    }


@media_router.get("/{asset_id}")
def get_media(asset_id: str, db: Session = Depends(get_db)):
    """
    Serves an uploaded file. Deliberately public and unauthenticated: a host's profile photo
    has to load for a client opening their booking link on any device, signed in or not.

    Only the stored bytes and their content type are returned -- never the owner, and nothing
    else about the account.
    """
    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    return Response(
        content=asset.data,
        media_type=asset.content_type,
        headers={
            # Ids are unique per upload and content never changes under one, so this is safe
            # to cache hard. Replacing a photo mints a new id and therefore a new URL.
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": str(asset.byte_size),
        },
    )
