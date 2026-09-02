from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.database import get_db
from app.models.models import User, AdminProfile, Session as SessionModel, RazorpayConnection
from app.schemas.schemas import AdminProfileUpdate, PublicAdminProfile, SessionResponse
from app.api.deps import get_current_admin

router = APIRouter()

@router.get("/public/{username}", response_model=PublicAdminProfile)
def get_public_admin_profile(username: str, db: Session = Depends(get_db)):
    clean_identifier = username.strip().lower()
    raw_identifier = username.strip()
    profile = (
        db.query(AdminProfile)
        .filter(
            or_(
                AdminProfile.username == clean_identifier,
                AdminProfile.user_id == raw_identifier
            )
        )
        .first()
    )

    if not profile or not profile.user:
        raise HTTPException(status_code=404, detail="Admin booking profile not found")

    user = profile.user
    if user.status == "PERMANENTLY_DELETED":
        raise HTTPException(status_code=404, detail="This profile is no longer accessible")

    # If temporarily disabled, return profile marked as disabled so frontend renders inactive notice
    sessions_list = []
    if user.status == "ACTIVE":
        active_sessions = (
            db.query(SessionModel)
            .filter(SessionModel.admin_id == user.id, SessionModel.is_active == True)
            .order_by(SessionModel.sort_order.asc(), SessionModel.price.asc())
            .all()
        )
        sessions_list = [SessionResponse.model_validate(s) for s in active_sessions]

    # Query this admin's own Razorpay connection
    rp_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == user.id).first()
    rp_configured = bool(rp_conn and rp_conn.connection_status == "connected")
    rp_key_id = rp_conn.key_id if rp_configured else None

    return {
        "id": user.id,
        "username": profile.username,
        "name": user.name,
        "title": profile.title,
        "bio": profile.bio,
        "description": profile.description,
        "profile_photo": profile.profile_photo,
        "cover_image": profile.cover_image,
        "intro_video": profile.intro_video,
        "heading_text": profile.heading_text,
        "about_me_text": profile.about_me_text,
        "welcome_message": profile.welcome_message,
        "theme_settings": profile.theme_settings or {},
        "social_links": profile.social_links or {},
        "status": user.status,
        "sessions": sessions_list,
        "razorpay_configured": rp_configured,
        "razorpay_key_id": rp_key_id
    }

@router.get("/me")
def get_my_profile(current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    profile = current_admin.profile
    if not profile:
        profile = AdminProfile(user_id=current_admin.id, username=current_admin.email.split("@")[0])
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return {
        "id": profile.id,
        "user_id": current_admin.id,
        "username": profile.username,
        "name": current_admin.name,
        "email": current_admin.email,
        "phone": current_admin.phone,
        "role": current_admin.role,
        "status": current_admin.status,
        "title": profile.title,
        "bio": profile.bio,
        "description": profile.description,
        "profile_photo": profile.profile_photo,
        "cover_image": profile.cover_image,
        "intro_video": profile.intro_video,
        "heading_text": profile.heading_text,
        "about_me_text": profile.about_me_text,
        "custom_description": profile.custom_description,
        "welcome_message": profile.welcome_message,
        "theme_settings": profile.theme_settings or {},
        "social_links": profile.social_links or {}
    }

@router.put("/me")
def update_my_profile(
    updates: AdminProfileUpdate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    profile = current_admin.profile
    if not profile:
        profile = AdminProfile(user_id=current_admin.id, username=current_admin.email.split("@")[0])
        db.add(profile)

    if updates.name is not None:
        current_admin.name = updates.name.strip()

    if updates.username is not None:
        clean_user = updates.username.strip().lower().replace(" ", "-")
        if clean_user:
            # Check if taken by another admin profile
            existing = db.query(AdminProfile).filter(AdminProfile.username == clean_user, AdminProfile.user_id != current_admin.id).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"Username '{clean_user}' is already taken by another admin.")
            profile.username = clean_user

    fields_to_update = [
        "title", "bio", "description", "profile_photo", "cover_image",
        "intro_video", "heading_text", "about_me_text", "custom_description",
        "welcome_message", "theme_settings", "social_links"
    ]
    for field in fields_to_update:
        val = getattr(updates, field, None)
        if val is not None:
            setattr(profile, field, val)

    db.commit()
    db.refresh(profile)
    db.refresh(current_admin)

    return {
        "message": "Profile updated successfully",
        "name": current_admin.name,
        "username": profile.username,
        "title": profile.title,
        "bio": profile.bio,
        "profile_photo": profile.profile_photo,
        "cover_image": profile.cover_image,
        "intro_video": profile.intro_video,
        "theme_settings": profile.theme_settings,
        "social_links": profile.social_links
    }

from pydantic import BaseModel
from app.services.scraper_service import scrape_superprofile_url

class ScrapeRequest(BaseModel):
    url: str

@router.post("/scrape-superprofile")
async def scrape_superprofile_endpoint(req: ScrapeRequest):
    try:
        data = await scrape_superprofile_url(req.url)
        return {"success": True, "data": data}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scrape SuperProfile: {str(e)}")

