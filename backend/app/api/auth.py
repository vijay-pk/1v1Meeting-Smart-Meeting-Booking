from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.models.models import User, AdminProfile, AvailabilityRule, Session as SessionModel
from app.schemas.schemas import UserLogin, UserSignup, Token, AdminProfileResponse
from app.api.deps import get_current_user

router = APIRouter()

@router.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    identifier = login_data.username_or_email.strip().lower()
    user = (
        db.query(User)
        .join(AdminProfile, isouter=True)
        .filter((User.email.ilike(identifier)) | (AdminProfile.username == identifier))
        .first()
    )

    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password"
        )

    if user.status == "TEMPORARILY_DISABLED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your admin account is temporarily disabled. Please contact the platform administrator."
        )

    if user.status == "PERMANENTLY_DELETED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been removed."
        )

    username = user.profile.username if user.profile else user.email.split("@")[0]
    access_token = create_access_token(subject=user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "user_id": user.id,
        "username": username,
        "name": user.name,
        "status": user.status
    }

@router.post("/signup", response_model=Token)
def signup(signup_data: UserSignup, db: Session = Depends(get_db)):
    clean_username = signup_data.username.strip().lower()
    clean_email = signup_data.email.strip().lower()

    # Validate reserved usernames
    reserved = ["admin", "super-admin", "login", "signup", "book", "api", "dashboard", "settings", "schedule"]
    if clean_username in reserved:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Username '{clean_username}' is reserved. Please choose another."
        )

    # Check unique username
    existing_username = db.query(AdminProfile).filter(AdminProfile.username == clean_username).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This username is already taken. Please choose another."
        )

    # Check unique email
    existing_email = db.query(User).filter(User.email.ilike(clean_email)).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists."
        )

    # Create User
    new_user = User(
        name=signup_data.name.strip(),
        email=clean_email,
        phone=signup_data.phone.strip() if signup_data.phone else None,
        password_hash=get_password_hash(signup_data.password),
        role="admin",
        status="ACTIVE"
    )
    db.add(new_user)
    db.flush()

    # Create AdminProfile
    profile = AdminProfile(
        user_id=new_user.id,
        username=clean_username,
        title="Mentor & Growth Consultant",
        bio=f"Hey! I'm {new_user.name}. Book a 1:1 session with me to accelerate your growth.",
        heading_text=f"Book a 1:1 Session with {new_user.name}",
        welcome_message="Choose your session and pick a convenient time."
    )
    db.add(profile)

    # Add default availability (Mon-Fri 09:00 - 18:00)
    for day in range(1, 6):
        db.add(AvailabilityRule(
            admin_id=new_user.id,
            day_of_week=day,
            start_time="09:00",
            end_time="18:00",
            is_active=True
        ))

    # Add default 1v1 session types
    default_sessions = [
        SessionModel(
            admin_id=new_user.id,
            title=f"1:1 Clarity Call with {new_user.name}",
            description=f"Get clarity and strategic direction in a 1-on-1 private advisory call with {new_user.name}.",
            duration_minutes=15,
            price=149700,
            original_price=499900,
            currency="INR",
            sort_order=1
        ),
        SessionModel(
            admin_id=new_user.id,
            title=f"30-Min Strategy Consultation with {new_user.name}",
            description=f"In-depth 30-minute private consultation session with {new_user.name}.",
            duration_minutes=30,
            price=599400,
            original_price=999900,
            currency="INR",
            sort_order=2
        ),
        SessionModel(
            admin_id=new_user.id,
            title=f"60-Min Intensive Growth Session with {new_user.name}",
            description=f"Comprehensive roadmap and high-impact revenue scaling intensive call with {new_user.name}.",
            duration_minutes=60,
            price=1975000,
            original_price=2499900,
            currency="INR",
            sort_order=3
        )
    ]
    for s in default_sessions:
        db.add(s)

    db.commit()
    db.refresh(new_user)

    access_token = create_access_token(subject=new_user.id)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": new_user.role,
        "user_id": new_user.id,
        "username": clean_username,
        "name": new_user.name,
        "status": new_user.status
    }

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = current_user.profile
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "phone": current_user.phone,
        "role": current_user.role,
        "status": current_user.status,
        "username": profile.username if profile else "",
        "title": profile.title if profile else "",
        "bio": profile.bio if profile else "",
        "profile_photo": profile.profile_photo if profile else "",
        "cover_image": profile.cover_image if profile else "",
        "intro_video": profile.intro_video if profile else "",
        "theme_settings": profile.theme_settings if profile else {},
        "social_links": profile.social_links if profile else {}
    }
