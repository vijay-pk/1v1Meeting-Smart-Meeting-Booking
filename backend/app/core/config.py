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

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./bookmymeet.db")

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db_scheme(cls, v: str) -> str:
        # Managed Postgres providers (Render, Heroku) hand out "postgres://" URLs, a scheme
        # SQLAlchemy 2.0 no longer recognises.
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    # Super Admin initial seed credentials
    SUPER_ADMIN_USERNAME: str = os.getenv("SUPER_ADMIN_USERNAME", "ameen")
    SUPER_ADMIN_EMAIL: str = os.getenv("SUPER_ADMIN_EMAIL", "mahir@adwaysacademy.com")
    SUPER_ADMIN_PASSWORD: str
    SUPER_ADMIN_NAME: str = os.getenv("SUPER_ADMIN_NAME", "Ameen Ahsan")

    # Demo staff admins (alex / priya / david) seeded by main.seed_initial_data().
    # Off by default so a deployment never boots with known demo logins; turn it on in
    # backend/.env for local development.
    SEED_DEMO_ADMINS: bool = os.getenv("SEED_DEMO_ADMINS", "false").lower() in ("1", "true", "yes")
    DEMO_ADMIN_PASSWORD: str = os.getenv("DEMO_ADMIN_PASSWORD", "")

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

    # Supabase Auth. Used only to verify the access token issued by the browser's
    # Google OAuth flow -- the Python backend stores no Supabase data of its own.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

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
        "panel (Render / Docker / CI) before starting the API. They have no defaults "
        "because a shipped default secret is a published secret."
    ) from exc
