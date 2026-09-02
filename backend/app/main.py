import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine, SessionLocal
from app.core.security import get_password_hash, encrypt_secret
from app.models.models import (
    User, AdminProfile, Session as SessionModel, AvailabilityRule,
    GoogleConnection, RazorpayConnection
)
from app.api import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def seed_initial_data():
    """Initializes tables and seeds default Super Admin and initial staff admins if not already present."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Check Super Admin
        super_admin = db.query(User).filter(User.role == "super_admin").first()
        if not super_admin:
            logger.info("Seeding initial Super Admin (Ameen Ahsan)...")
            super_admin = User(
                name=settings.SUPER_ADMIN_NAME,
                email=settings.SUPER_ADMIN_EMAIL,
                password_hash=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
                phone="+919876543210",
                role="super_admin",
                status="ACTIVE"
            )
            db.add(super_admin)
            db.flush()

            # Super Admin profile
            profile = AdminProfile(
                user_id=super_admin.id,
                username=settings.SUPER_ADMIN_USERNAME,
                title="CEO of Adways Academy",
                bio="Upskilling Marketers into Top 1% Performers. Book a 1:1 strategy session with Ameen Ahsan.",
                description="CEO & Lead Strategist at Adways Academy. 10,000+ Students Mentored | ₹5 Cr+ Ad Spend Managed | 3.8x Avg ROAS Improvement.",
                profile_photo="/assets/mahir.png",
                cover_image="",
                intro_video="https://vimeo.com/1130419767",
                heading_text="Upskilling Marketers into Top 1% Performers",
                about_me_text="Ameen Ahsan has trained over 10,000 performance marketers, founders, and growth professionals.",
                custom_description="Personalized 1-on-1 Mentorship • Direct Video Call with Ameen Ahsan",
                welcome_message="Choose your session below to schedule your 1:1 call with Ameen Ahsan.",
                theme_settings={
                    "theme": "amber",
                    "bg_gradient": "from-[#873600] via-[#A04000] to-[#6E2C00]",
                    "button_color": "#D32F2F",
                    "button_text_color": "#FFFFFF",
                    "card_style": "rounded",
                    "show_video": True,
                    "show_stats": True,
                    "show_socials": True
                },
                social_links={
                    "instagram": "https://instagram.com/ameenahsan",
                    "whatsapp": "+919876543210",
                    "linkedin": "https://linkedin.com/in/ameenahsan",
                    "youtube": "https://youtube.com/@adwaysacademy",
                    "website": "https://adwaysacademy.com"
                }
            )
            db.add(profile)

            # Pre-configured SuperProfile Sessions
            sessions_data = [
                {
                    "title": "Get Clarity on Your Performance Marketing Journey: Talk to Your Mentor",
                    "description": "Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call",
                    "duration_minutes": 15,
                    "price": 149700,
                    "original_price": 499900,
                    "currency": "INR",
                    "sort_order": 1
                },
                {
                    "title": "Elite 1:1 Performance Marketing Advisory Session",
                    "description": "Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call",
                    "duration_minutes": 30,
                    "price": 599400,
                    "original_price": 999900,
                    "currency": "INR",
                    "sort_order": 2
                },
                {
                    "title": "Founder-Level 1:1 Revenue Scaling Intensive",
                    "description": "Earn more, work smarter, and grow faster in marketing with step-by-step guidance in a 1:1 mentorship call",
                    "duration_minutes": 60,
                    "price": 1975000,
                    "original_price": 2499900,
                    "currency": "INR",
                    "sort_order": 3
                },
                {
                    "title": "Comprehensive Meta Ads & Funnel Growth Audit",
                    "description": "Deep dive audit into your Facebook/Instagram ad accounts, tracking architecture, and funnel drop-offs with Ameen Ahsan.",
                    "duration_minutes": 45,
                    "price": 399900,
                    "original_price": 799900,
                    "currency": "INR",
                    "sort_order": 4
                },
                {
                    "title": "High-ROAS Creative Strategy & Hook Architecture",
                    "description": "Unlock viral performance hooks, ad creative scripting, and rapid iteration frameworks to scale past ₹10L/day.",
                    "duration_minutes": 30,
                    "price": 349900,
                    "original_price": 599900,
                    "currency": "INR",
                    "sort_order": 5
                }
            ]
            for s in sessions_data:
                db.add(SessionModel(admin_id=super_admin.id, **s))

            # Working Hours (Mon-Sat 09:00 - 18:00)
            for day in [1, 2, 3, 4, 5, 6]:
                db.add(AvailabilityRule(
                    admin_id=super_admin.id,
                    day_of_week=day,
                    start_time="09:00",
                    end_time="18:00",
                    is_active=True
                ))

            # Mock Razorpay and Google Connection for Ameen
            db.add(RazorpayConnection(
                admin_id=super_admin.id,
                key_id="rzp_test_ameen_123456",
                encrypted_key_secret=encrypt_secret("test_secret"),
                connection_status="connected",
                account_reference="acc_ameen_merchant"
            ))
            db.add(GoogleConnection(
                admin_id=super_admin.id,
                google_email=settings.SUPER_ADMIN_EMAIL,
                encrypted_refresh_token=encrypt_secret("mock_refresh_token_ameen"),
                connection_status="connected"
            ))

        # Seed initial staff admins (Alex, Priya, David) with individual Razorpay setups if missing
        staff_admins_data = [
            {
                "username": "alex",
                "name": "Alex Rivera",
                "email": "alex@adwaysacademy.com",
                "phone": "+919876500001",
                "title": "Senior Technical Consultant",
                "bio": "Senior Technical Consultant & Ad Tracking Architect with 8+ years resolving attribution drop-offs.",
                "heading_text": "Technical Architecture & Conversion Tracking Audit",
                "profile_photo": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&crop=face",
                "razorpay_key_id": "rzp_test_alex_987654",
                "sessions": [
                    {"title": "Quick Tech Sync", "description": "15-min technical review and tracking debugging with Alex.", "duration_minutes": 15, "price": 24900, "original_price": 49900, "currency": "INR", "sort_order": 1},
                    {"title": "Technical Architecture Audit", "description": "30-min conversion tracking review with Alex.", "duration_minutes": 30, "price": 49900, "original_price": 99900, "currency": "INR", "sort_order": 2}
                ]
            },
            {
                "username": "priya",
                "name": "Priya Sharma",
                "email": "priya@adwaysacademy.com",
                "phone": "+919876500002",
                "title": "Product & Growth Strategist",
                "bio": "Product & Growth Strategist specializing in retention loops and conversion rate optimization.",
                "heading_text": "1:1 Growth Architecture & Retention Strategy",
                "profile_photo": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&crop=face",
                "razorpay_key_id": "rzp_test_priya_555444",
                "sessions": [
                    {"title": "Quick Growth Sync", "description": "15-minute quick conversion rate check with Priya.", "duration_minutes": 15, "price": 29900, "original_price": 49900, "currency": "INR", "sort_order": 1},
                    {"title": "Growth Blueprint & Funnel Audit", "description": "30-minute full funnel audit with Priya.", "duration_minutes": 30, "price": 59900, "original_price": 119900, "currency": "INR", "sort_order": 2}
                ]
            },
            {
                "username": "david",
                "name": "David Chen",
                "email": "david@adwaysacademy.com",
                "phone": "+919876500003",
                "title": "Marketing & Automation Lead",
                "bio": "Marketing & Automation Lead focused on CRM integration and multi-channel drip automation.",
                "heading_text": "Automate & Scale Your Lead Funnels with David",
                "profile_photo": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face",
                "razorpay_key_id": "rzp_test_david_333222",
                "sessions": [
                    {"title": "Quick Automation Check", "description": "15-minute lead flow check with David.", "duration_minutes": 15, "price": 19900, "original_price": 39900, "currency": "INR", "sort_order": 1},
                    {"title": "Full Funnel Automation Blueprint", "description": "30-minute ad automation blueprint with David.", "duration_minutes": 30, "price": 39900, "original_price": 79900, "currency": "INR", "sort_order": 2}
                ]
            }
        ]

        # Demo staff admins ship with well-known logins, so they are seeded only when
        # explicitly enabled AND given a password from the environment. A deployment that
        # sets neither boots with the super admin only.
        if not settings.SEED_DEMO_ADMINS:
            staff_admins_data = []
        elif not settings.DEMO_ADMIN_PASSWORD:
            logger.warning(
                "SEED_DEMO_ADMINS is enabled but DEMO_ADMIN_PASSWORD is empty - "
                "skipping the demo staff admin seed."
            )
            staff_admins_data = []

        for s_admin in staff_admins_data:
            existing_staff = db.query(User).filter(User.email == s_admin["email"]).first()
            if not existing_staff:
                staff_user = User(
                    name=s_admin["name"],
                    email=s_admin["email"],
                    password_hash=get_password_hash(settings.DEMO_ADMIN_PASSWORD),
                    phone=s_admin["phone"],
                    role="admin",
                    status="ACTIVE"
                )
                db.add(staff_user)
                db.flush()

                db.add(AdminProfile(
                    user_id=staff_user.id,
                    username=s_admin["username"],
                    title=s_admin["title"],
                    bio=s_admin["bio"],
                    heading_text=s_admin["heading_text"],
                    profile_photo=s_admin["profile_photo"]
                ))

                for sess in s_admin["sessions"]:
                    db.add(SessionModel(admin_id=staff_user.id, **sess))

                db.add(RazorpayConnection(
                    admin_id=staff_user.id,
                    key_id=s_admin["razorpay_key_id"],
                    encrypted_key_secret=encrypt_secret(f"secret_{s_admin['username']}"),
                    connection_status="connected",
                    account_reference=f"acc_{s_admin['username']}_merchant"
                ))

        db.commit()
    except Exception as e:
        logger.error(f"Error seeding initial data: {e}")
        db.rollback()
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing BookMyMeet backend application...")
    seed_initial_data()
    yield
    # Shutdown
    logger.info("Shutting down backend...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
from starlette.staticfiles import StaticFiles

uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "photos"), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "videos"), exist_ok=True)

app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "BookMyMeet API", "version": settings.VERSION}

