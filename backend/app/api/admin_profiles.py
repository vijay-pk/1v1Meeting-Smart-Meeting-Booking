from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.core.database import get_db
from app.models.models import (
    User, AdminProfile, Session as SessionModel, RazorpayConnection, GoogleConnection
)
from app.schemas.schemas import AdminProfileUpdate, PublicAdminProfile, SessionResponse
from app.api.deps import get_current_admin
from app.services.onboarding import get_onboarding_status

router = APIRouter()

def _ensure_profile(db: Session, current_admin: User) -> AdminProfile:
    """
    Returns this admin's profile row, creating one only if it genuinely has none.

    The username it falls back to used to be the raw local part of the email, which can
    already be taken by another admin, be a reserved route word ("admin", "settings") or be
    the retired slug of a permanently deleted admin. Any of those raised an IntegrityError or
    a 400 out of a plain GET, the settings page reported "could not load your profile", and
    the form then refused to save. suggest_username() picks a free, legal slug instead.

    The row is created but NOT committed here for the update path; the caller commits.
    """
    if current_admin.profile:
        return current_admin.profile

    # Imported inside the function: app.api.auth imports from this package too.
    from app.api.auth import suggest_username

    profile = AdminProfile(
        user_id=current_admin.id,
        username=suggest_username(db, current_admin.name, current_admin.email),
    )
    db.add(profile)
    return profile


@router.get("/public/{username}", response_model=PublicAdminProfile)
def get_public_admin_profile(username: str, db: Session = Depends(get_db)):
    clean_identifier = username.strip().lower()
    raw_identifier = username.strip()
    # Compared lowercased on both sides. Usernames are stored lowercase, but a row written
    # before that rule -- or by a direct database edit -- must still answer its own URL, and
    # a visitor typing /Ameen must reach the same page as /ameen.
    profile = (
        db.query(AdminProfile)
        .filter(
            or_(
                func.lower(AdminProfile.username) == clean_identifier,
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
        "status": user.status,
        "sessions": sessions_list,
        "razorpay_configured": rp_configured,
        "razorpay_key_id": rp_key_id
    }

@router.get("/me")
def get_my_profile(current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    profile = current_admin.profile
    if not profile:
        profile = _ensure_profile(db, current_admin)
        db.commit()
        db.refresh(profile)

    rp_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()
    rp_configured = bool(rp_conn and rp_conn.connection_status == "connected")
    rp_key_id = rp_conn.key_id if rp_configured else None

    g_conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    g_connected = bool(g_conn and g_conn.connection_status == "connected")
    g_email = g_conn.google_email if g_connected else None

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
        "razorpay_configured": rp_configured,
        "razorpay_key_id": rp_key_id,
        "google_connected": g_connected,
        "google_email": g_email
    }

@router.get("/me/onboarding")
def get_my_onboarding_status(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    First-time setup status for the signed-in admin, computed from persisted rows.

    The one source for the setup screen, the dashboard checklist, and the username the
    dashboard builds its public link from. Nothing here reads client-supplied state.
    """
    if not current_admin.profile:
        _ensure_profile(db, current_admin)
        db.commit()
        db.refresh(current_admin)
    return get_onboarding_status(db, current_admin)


@router.put("/me")
def update_my_profile(
    updates: AdminProfileUpdate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    profile = _ensure_profile(db, current_admin)

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

    # Scalar columns. An omitted field (None) is left alone; "" is a real value, because an
    # admin must be able to clear their bio.
    fields_to_update = [
        "title", "bio", "description", "profile_photo", "cover_image",
        "intro_video", "heading_text", "about_me_text", "custom_description",
        "welcome_message",
    ]
    for field in fields_to_update:
        val = getattr(updates, field, None)
        if val is not None:
            setattr(profile, field, val)

    # theme_settings is MERGED, not replaced. The settings form sends it as just
    # {button_color, bg_gradient}; replacing the column with that dropped every other key the
    # public page reads (show_video, show_stats, card_style, button_text_color), so changing a
    # colour quietly turned other parts of the page off. Merging means a caller that sends one
    # key changes one key, and a key it does send -- including to "" -- still wins.
    #
    # social_links is deliberately absent: the social and Super Chat links were removed from
    # the profile page, so nothing writes them any more. The column and whatever it already
    # holds are left alone rather than dropped.
    if updates.theme_settings is not None:
        if isinstance(updates.theme_settings, dict):
            existing = profile.theme_settings or {}
            # SQLAlchemy does not track in-place mutation of a JSON column, so assign a new
            # dict rather than updating the existing one.
            profile.theme_settings = {**existing, **updates.theme_settings}
        else:
            profile.theme_settings = updates.theme_settings

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
    }

# The old unauthenticated POST /scrape-superprofile endpoint has been removed. It fetched an
# arbitrary URL server-side with no authentication and no SSRF protection, and its parser
# invented prices and social links when the page did not supply them. Importing now lives in
# api/profile_imports.py behind get_current_admin, as a preview-then-apply flow.
