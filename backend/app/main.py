import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine, SessionLocal
from app.core.security import get_password_hash, normalize_email
from app.models.models import User, AdminProfile
from app.api import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def seed_initial_data():
    """
    Creates the database schema and bootstraps the Super Admin account, nothing else.

    Fake/demo data policy: this function must never create a demonstration admin, a
    sample profile, example session types, placeholder availability, or a connection row
    holding a placeholder credential. A fresh database starts with exactly one account --
    the Super Admin, built from environment variables -- and every other admin arrives
    through the real signup or Google registration flow.

    The Super Admin is created only when no super admin exists yet, so restarting the app
    never resurrects an account that was intentionally removed, and never overwrites the
    credentials of a live one.
    """
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        super_admin = db.query(User).filter(User.role == "super_admin").first()
        if super_admin:
            return

        logger.info("No super admin found - bootstrapping one from the environment.")
        super_admin = User(
            name=settings.SUPER_ADMIN_NAME,
            email=normalize_email(settings.SUPER_ADMIN_EMAIL),
            password_hash=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
            role="super_admin",
            status="ACTIVE",
        )
        db.add(super_admin)
        db.flush()

        # An empty profile: enough for the account to have a vanity URL and for the
        # settings page to load. All content is filled in by the person who owns it.
        db.add(AdminProfile(
            user_id=super_admin.id,
            username=settings.SUPER_ADMIN_USERNAME.strip().lower(),
            title="",
            bio="",
            heading_text=f"Book a 1:1 Session with {settings.SUPER_ADMIN_NAME}",
            welcome_message="Choose your session and pick a convenient time.",
        ))

        # No sessions, no availability, no Razorpay or Google connection are seeded.
        # A seeded connection row would claim a credential the account does not hold.

        db.commit()
        logger.info("Super admin bootstrapped.")
    except Exception as e:
        logger.error(f"Error bootstrapping the super admin: {e}")
        db.rollback()
    finally:
        db.close()

def log_database_target() -> None:
    """
    Says, in the first lines of the deploy log, which database this process is about to use.

    Never prints the URL: it carries the password. Only the scheme, and -- when the data is
    in a file next to the process rather than in a managed database -- a warning, because on
    a container host that means every restart begins with an empty database and every admin
    profile saved since the last one is gone.
    """
    logger.info("Database backend: %s", settings.DATABASE_BACKEND)
    if settings.DATABASE_IS_EPHEMERAL:
        logger.warning(
            "This process is using a local SQLite file (%s). That is fine for development. "
            "On a container host (Render, Docker, Fly) the file lives in the container's "
            "ephemeral filesystem and is DESTROYED on every restart, redeploy and idle "
            "spin-down, taking every admin profile, session and booking with it. Set "
            "DATABASE_URL to the managed Postgres connection string for any deployment.",
            settings.DATABASE_URL,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing BookMyMeet backend application...")
    log_database_target()
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
    """
    Liveness plus the one deployment fact that silently breaks profile persistence.

    "database" is the scheme only and "persistent_storage" is false when the data lives in a
    SQLite file inside the container -- enough to spot a misconfigured deploy from outside,
    with no credential, host or database name in the response.
    """
    return {
        "status": "ok",
        "service": "BookMyMeet API",
        "version": settings.VERSION,
        "database": settings.DATABASE_BACKEND,
        "persistent_storage": not settings.DATABASE_IS_EPHEMERAL,
    }

@app.get("/")
def root():
    return {"status": "ok", "service": "BookMyMeet Backend API", "frontend_url": "https://1v1-meeting-smart-meeting-booking.vercel.app", "docs": "/docs"}

