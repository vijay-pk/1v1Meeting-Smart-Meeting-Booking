import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "BookMyMeet API"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api"

    # Security & JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "bmm-super-secure-jwt-secret-key-32byteslong-2026!")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Encryption key for Google Refresh Tokens & Razorpay Secrets at rest
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "bmm_super_secret_encryption_key_32_bytes_!")

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./bookmymeet.db")

    # Super Admin initial seed credentials
    SUPER_ADMIN_USERNAME: str = os.getenv("SUPER_ADMIN_USERNAME", "ameen")
    SUPER_ADMIN_EMAIL: str = os.getenv("SUPER_ADMIN_EMAIL", "mahir@adwaysacademy.com")
    SUPER_ADMIN_PASSWORD: str = os.getenv("SUPER_ADMIN_PASSWORD", "admin123")
    SUPER_ADMIN_NAME: str = os.getenv("SUPER_ADMIN_NAME", "Ameen Ahsan")

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

    # App & CORS
    APP_URL: str = os.getenv("APP_URL", "http://localhost:5173")
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
