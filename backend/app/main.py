import asyncio
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

def reconcile_database_schema(bind_engine):
    """
    Detects and clears legacy pre-FastAPI table definitions from Supabase.

    If the database was previously initialized with an older schema (where availability_rules,
    availability_exceptions, bookings, payments, and notifications had foreign keys referencing
    the legacy 'profiles' table with UUID columns), Base.metadata.create_all would not alter them.
    This caused admin creation to crash with ForeignKeyViolation on availability_rules.
    """
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(bind_engine)
        tables = set(inspector.get_table_names())

        if "availability_rules" in tables:
            fks = inspector.get_foreign_keys("availability_rules")
            points_to_legacy_profiles = any(
                fk.get("referred_table") == "profiles" for fk in fks
            )
            cols = {c["name"]: str(c["type"]).lower() for c in inspector.get_columns("availability_rules")}
            is_uuid = "uuid" in cols.get("admin_id", "")

            if points_to_legacy_profiles or is_uuid:
                logger.warning("Detected legacy Supabase table definitions. Reconciling schema...")
                with bind_engine.begin() as conn:
                    for tbl in ["notifications", "payments", "bookings", "availability_exceptions", "availability_rules"]:
                        if tbl in tables:
                            conn.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
                logger.info("Legacy tables dropped successfully. create_all will rebuild them with correct foreign keys.")
    except Exception as exc:
        logger.error("Schema reconciliation check failed: %s", exc)

def seed_initial_data():
    reconcile_database_schema(engine)
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

    # Meeting reminders run on the server, never in a browser. See services/reminders.py.
    reminder_stop = asyncio.Event()
    reminder_task = None
    if settings.REMINDER_WORKER_ENABLED:
        from app.services.reminders import reminder_worker

        reminder_task = asyncio.create_task(reminder_worker(reminder_stop))
    yield
    # Shutdown
    logger.info("Shutting down backend...")
    reminder_stop.set()
    if reminder_task:
        try:
            await asyncio.wait_for(reminder_task, timeout=10)
        except Exception:  # noqa: BLE001
            reminder_task.cancel()

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
    # A custom response header is invisible to browser JavaScript unless it is named here --
    # allow_headers only covers the *request* direction. Without this the revocation marker
    # would be set by the server, stripped by the browser, and the client would never see it.
    expose_headers=["X-Auth-Revoked"],
)

from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled server error: %s", exc)
    origin = request.headers.get("origin", "")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {str(exc)}"},
        headers=headers,
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

