import os
import uuid
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request

router = APIRouter()

# uploads directory located under backend/uploads
BASE_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_BACKEND_DIR, "uploads")
PHOTOS_DIR = os.path.join(UPLOAD_DIR, "photos")
VIDEOS_DIR = os.path.join(UPLOAD_DIR, "videos")

os.makedirs(PHOTOS_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)

ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".avif"}
ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".ogv"}

@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    file_type: str = Form("auto")
):
    original_name = file.filename or "media_file"
    ext = os.path.splitext(original_name)[1].lower()

    content_type = (file.content_type or "").lower()
    is_video = (
        file_type == "video" or
        ext in ALLOWED_VIDEO_EXTS or
        "video" in content_type
    )
    is_image = (
        file_type == "photo" or
        ext in ALLOWED_IMAGE_EXTS or
        "image" in content_type
    )

    if not is_video and not is_image:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format. Please choose an image ({', '.join(sorted(ALLOWED_IMAGE_EXTS))}) or video ({', '.join(sorted(ALLOWED_VIDEO_EXTS))})."
        )

    target_dir = VIDEOS_DIR if is_video else PHOTOS_DIR
    subfolder = "videos" if is_video else "photos"

    clean_name = "".join(c for c in original_name if c.isalnum() or c in "._-").strip()
    if not clean_name:
        clean_name = f"upload{ext}"
    unique_prefix = uuid.uuid4().hex[:8]
    saved_filename = f"{unique_prefix}_{clean_name}"
    dest_path = os.path.join(target_dir, saved_filename)

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Resolve public base URL respecting proxies (Render, Cloudflare, etc.)
    forwarded_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc

    if "onrender.com" in forwarded_host or "vercel.app" in forwarded_host:
        forwarded_proto = "https"

    base_url = f"{forwarded_proto}://{forwarded_host}".rstrip("/")
    file_url = f"{base_url}/uploads/{subfolder}/{saved_filename}"

    return {
        "success": True,
        "url": file_url,
        "filename": original_name,
        "saved_as": saved_filename,
        "type": "video" if is_video else "photo",
        "size": os.path.getsize(dest_path)
    }
