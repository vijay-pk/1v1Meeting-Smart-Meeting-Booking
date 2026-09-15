"""
Uploads for profile media.

The object goes to Supabase Storage; the database keeps the reference. Two earlier locations
both lost data and are worth naming so neither comes back:

* `backend/uploads/` on the server's own filesystem — wiped by every deploy on a container
  host, leaving `admin_profiles.profile_photo` pointing at a file that no longer existed.
* a bytes column in Postgres — durable, but multi-megabyte blobs in the application's own
  table space, and every read went through the API process.

There is deliberately **no local-filesystem fallback**. If Storage is not configured the
upload fails with a clear message rather than quietly writing somewhere that will not survive:
a fallback that works in development and loses files in production is worse than an honest
refusal, because nobody finds out until the photos are gone.

`/uploads` stays mounted in main.py, and `/api/media/{id}` still serves rows written by the
bytes implementation, so nothing already stored breaks.
"""
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.models import MediaAsset, User
from app.services.image_optimizer import ImageOptimizationError, optimize_profile_image
from app.services.supabase_storage import (
    build_object_path,
    is_configured,
    sniff_image_type,
    upload_object,
    SupabaseStorageError,
    SupabaseStorageNotConfigured,
)

logger = logging.getLogger(__name__)

router = APIRouter()
# Serving is its own router so it can be mounted at /api/media rather than under /api/upload.
media_router = APIRouter()

MAX_IMAGE_BYTES = 8 * 1024 * 1024
CHUNK_BYTES = 256 * 1024

STORAGE_UNAVAILABLE = (
    "Photo storage is not configured on this server, so the upload was not saved. "
    "Set SUPABASE_URL and a valid SUPABASE_SERVICE_ROLE_KEY and try again."
)


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    file_type: str = Form("auto"),
    # Authenticated: this endpoint used to accept a file from anyone at all.
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not is_configured():
        raise HTTPException(status_code=503, detail=STORAGE_UNAVAILABLE)

    # Read with a hard cap, so an oversized upload is refused while streaming rather than
    # after the whole thing is already in memory.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than {MAX_IMAGE_BYTES // (1024 * 1024)}MB.",
            )
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(status_code=400, detail="That file is empty.")

    content = b"".join(chunks)

    # What the file *is*, decided by its own bytes. The filename and the browser-supplied
    # Content-Type are both attacker-controlled and neither is trusted: a .png called
    # payload.exe is rejected, and so is an executable called avatar.png.
    sniffed = sniff_image_type(content[:32])
    if not sniffed:
        raise HTTPException(
            status_code=400,
            detail="That file is not a supported image. Please upload a JPEG, PNG, WebP, GIF or AVIF.",
        )
    content_type, extension = sniffed

    # Decode, orient, strip metadata, scale to profile size and re-encode as WebP. CPU work,
    # so it runs off the event loop. Nothing is stored if the image cannot be decoded.
    try:
        from starlette.concurrency import run_in_threadpool

        optimized = await run_in_threadpool(optimize_profile_image, content, content_type, extension)
    except ImageOptimizationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stored = optimized.content
    content_type, extension = optimized.content_type, optimized.extension

    object_path = build_object_path(current_admin.id, extension)
    try:
        url = await upload_object(object_path, stored, content_type)
    except SupabaseStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail=STORAGE_UNAVAILABLE) from exc
    except SupabaseStorageError as exc:
        # The stored profile is untouched: nothing is written to the database until the
        # object is safely in the bucket, so a failed upload cannot lose the current photo.
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    asset = MediaAsset(
        owner_id=current_admin.id,
        filename=(file.filename or f"upload{extension}")[:255],
        content_type=content_type,
        byte_size=len(stored),
        storage_provider="supabase",
        storage_path=object_path,
        public_url=url,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    return {
        "success": True,
        # The public bucket URL, served by Supabase's CDN rather than by this process.
        "url": url,
        "filename": file.filename,
        "saved_as": asset.id,
        "type": "photo",
        "size": len(stored),
        "original_size": total,
        "optimized": optimized.optimized,
    }


@media_router.get("/{asset_id}")
def get_media(asset_id: str, db: Session = Depends(get_db)):
    """
    Resolves an uploaded file. Public and unauthenticated: a host's profile photo has to load
    for a client opening their booking link on any device, signed in or not.

    For anything stored in Supabase this redirects to the object's public URL rather than
    proxying the bytes -- the row holds a reference, and pretending otherwise would mean
    streaming every image through the API process for no reason. Rows written by the previous
    bytes-in-Postgres implementation are still served directly, so old links keep working.
    """
    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")

    if asset.public_url:
        return RedirectResponse(asset.public_url, status_code=307)

    if asset.data is not None:
        return Response(
            content=asset.data,
            media_type=asset.content_type,
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Length": str(asset.byte_size),
            },
        )

    logger.error("Media asset %s has neither a public URL nor stored bytes.", asset_id)
    raise HTTPException(status_code=404, detail="File not found")
