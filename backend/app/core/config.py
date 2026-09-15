import os
from typing import List
from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "BookMyMeet API"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api"

    # Security & JWT.
    # SECRET_KEY and ENCRYPTION_KEY have NO defaults on purpose: a shipped default is a
    # published default, and anyone holding it can mint valid tokens or read every stored
    # Google refresh token and Razorpay secret. Missing values fail startup (see below).
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Encryption key for Google Refresh Tokens & Razorpay Secrets at rest.
    # Rotating this makes every already-encrypted secret undecryptable — set it once.
    ENCRYPTION_KEY: str

    # Database.
    # NO DEFAULT, on purpose. This used to fall back to "sqlite:///./bookmymeet.db" -- a
    # relative path -- whenever DATABASE_URL was unset. On a container host (Render, Docker,
    # Fly) that silently puts the entire platform on a SQLite file inside the container's
    # ephemeral filesystem: everything works, admins sign up, save their profile and share
    # their link, and then the next restart, redeploy or idle spin-down throws the file away.
    # The app comes back up, seed_initial_data() re-creates the super admin from the
    # environment, and every other admin -- with their profile, sessions, availability and
    # connections -- is simply gone, so their public page answers a genuine 404 and the
    # visitor is told the booking page "has been permanently removed".
    #
    # A missing database URL is now a startup failure with a message that says what to set,
    # which is loud in the deploy log instead of silent until the first restart. Local
    # development sets DATABASE_URL=sqlite:///./bookmymeet.db explicitly in backend/.env.
    DATABASE_URL: str

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db_scheme(cls, v: str) -> str:
        # Managed Postgres providers (Render, Heroku) hand out "postgres://" URLs, a scheme
        # SQLAlchemy 2.0 no longer recognises.
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    @property
    def DATABASE_BACKEND(self) -> str:
        """"postgresql", "sqlite", ... -- the scheme only. Never carries credentials."""
        return self.DATABASE_URL.split("://", 1)[0].split("+", 1)[0].lower()

    @property
    def DATABASE_IS_EPHEMERAL(self) -> bool:
        """
        True when the data lives in a file next to the process rather than in a managed
        database. Fine for local development; on a container host it means every restart
        starts from an empty database. Surfaced at startup and on /health so a deployment
        that is quietly losing its data says so before an admin discovers it.
        """
        return self.DATABASE_BACKEND == "sqlite" and ":memory:" not in self.DATABASE_URL

    # Super Admin initial seed credentials
    # No real person's name or address as a default. The email is required for the same
    # reason the password is: a shipped default identity is a fake account waiting to be
    # created on someone's first boot.
    SUPER_ADMIN_USERNAME: str = os.getenv("SUPER_ADMIN_USERNAME", "owner")
    SUPER_ADMIN_EMAIL: str
    SUPER_ADMIN_PASSWORD: str
    SUPER_ADMIN_NAME: str = os.getenv("SUPER_ADMIN_NAME", "Platform Owner")

    # NOTE: demo/staff admin seeding has been removed entirely. The application never
    # creates sample admin accounts -- see main.seed_initial_data(), which bootstraps only
    # the Super Admin. SEED_DEMO_ADMINS / DEMO_ADMIN_PASSWORD are gone; leaving them set
    # in an .env file is harmless (Config.extra = "allow") but has no effect.

    # Payments.
    # Simulation lets the seeded demo admins complete a booking without real Razorpay
    # credentials. It MUST stay off in any deployment that handles real money: when on,
    # a payment is confirmed without a verified gateway signature. Simulated payments are
    # recorded as provider="razorpay_simulated" and never reach payment_status="completed".
    PAYMENTS_ALLOW_SIMULATION: bool = os.getenv("PAYMENTS_ALLOW_SIMULATION", "false").lower() in ("1", "true", "yes")

    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")

    # Fake Google Calendar connections for local demos (POST /api/google/admin/connect-mock).
    # Off by default: that endpoint overwrites whatever refresh token an admin already has,
    # so leaving it open lets a stray call destroy a working integration. A mock connection
    # can never read a real calendar, so availability fails closed for it.
    ALLOW_MOCK_GOOGLE: bool = os.getenv("ALLOW_MOCK_GOOGLE", "false").lower() in ("1", "true", "yes")

    # Timezone every admin's working hours and stored booking times are expressed in.
    # Availability rules are bare wall clock ("10:00"), so they need a zone to be compared
    # against the real UTC instants Google Calendar reports.
    BUSINESS_TIMEZONE: str = os.getenv("BUSINESS_TIMEZONE", "Asia/Kolkata")

    # Supabase Auth. Used only to verify the access token issued by the browser's
    # Google OAuth flow -- the Python backend stores no Supabase data of its own.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # Transactional email (Resend).
    #
    # email_service.py used to log "[EMAIL MOCK]" and return True unconditionally, so every
    # booking confirmation in the product's history was a no-op that reported success. The
    # replacement refuses rather than pretends: with no key set it logs and returns False,
    # and the caller records that the client was not emailed.
    #
    # Resend rather than SMTP because supabase/functions/_shared/email.ts already posts to
    # api.resend.com -- same provider, one account, no second thing to configure.
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    EMAIL_FROM_NAME: str = os.getenv("EMAIL_FROM_NAME", "BookMyMeet")
    # Must be an address on a domain verified in Resend, or sends are rejected.
    EMAIL_FROM_ADDRESS: str = os.getenv("EMAIL_FROM_ADDRESS", "")

    # Meeting reminders.
    # The in-process worker checks for due reminders every REMINDER_POLL_SECONDS while the
    # server is running. A host that sleeps when idle (Render's free tier) runs no code while
    # asleep, so there CRON_SECRET should also be set and an external scheduler should call
    # POST /api/internal/reminders/run with the X-Cron-Secret header every minute. Without a
    # CRON_SECRET that endpoint does not exist.
    REMINDER_WORKER_ENABLED: bool = os.getenv("REMINDER_WORKER_ENABLED", "true").lower() in ("1", "true", "yes")
    REMINDER_POLL_SECONDS: int = int(os.getenv("REMINDER_POLL_SECONDS", "60"))
    CRON_SECRET: str = os.getenv("CRON_SECRET", "")

    @property
    def EMAIL_ENABLED(self) -> bool:
        """Email is on only when it can actually be delivered."""
        return bool(self.RESEND_API_KEY and self.EMAIL_FROM_ADDRESS)

    # App & CORS.
    # Comma-separated origin list. "*" is deliberately unsupported: main.py registers the
    # CORS middleware with allow_credentials=True, and browsers reject a wildcard there.
    # Add the deployed frontend origin (e.g. https://<project>.vercel.app) via env.
    APP_URL: str = os.getenv("APP_URL", "http://localhost:5173")
    CORS_ALLOWED_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )

    @property
    def CORS_ORIGINS(self) -> List[str]:
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        extra = "allow"

try:
    settings = Settings()
except ValidationError as exc:
    missing = sorted({str(e["loc"][0]) for e in exc.errors() if e["type"] == "missing"})
    if not missing:
        raise
    raise RuntimeError(
        "Missing required configuration: " + ", ".join(missing) + ".\n"
        "Set these in backend/.env for local development, or in the host's environment "
        "panel (Render / Docker / CI) before starting the API. "
        "SECRET_KEY and ENCRYPTION_KEY have no defaults because a shipped default secret is "
        "a published secret. DATABASE_URL has no default because the old default put a "
        "deployment on an ephemeral SQLite file that is erased on every restart. In "
        "production set it to the Supabase Postgres connection string; locally use "
        "sqlite:///./bookmymeet.db."
    ) from exc
