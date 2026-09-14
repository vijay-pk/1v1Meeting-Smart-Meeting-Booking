  # 1v1Meeting-Smart-Meeting-Booking (BookMyMeet)

Multi-admin 1:1 booking platform with personalized creator bio pages, Google Calendar/Meet integration, per-admin Razorpay direct payments, automated slot locking, and flexible scheduling.

---

## 🚀 Overview

**BookMyMeet** is an appointment scheduling and 1-to-1 monetization platform (SuperProfile-style bio + scheduling pages). Each admin/creator gets a dedicated public page (`/:username`), configures custom session types and working hours, connects **their own** Razorpay and Google Calendar accounts, and receives payments directly without any platform middleman cuts.

---

## ✨ Key Features

- **Multi-Admin Isolation**:
  - Personalized vanity profiles at `/:username` with custom themes, branding, and video embeds (YouTube / Vimeo).
  - Independent session offerings and pricing per creator.
  - Per-admin Google Calendar sync & automatic Google Meet conference link generation.
  - Per-admin Razorpay account integration — payments route directly to each creator's gateway.
- **Robust Scheduling Engine**:
  - Real-time availability calculation factoring in working hours, calendar free/busy events, leave exceptions, and buffer times.
  - Redis/DB atomic slot-locking (`SlotLock`) with automatic expiry to prevent double-booking.
- **Multi-Source Frontend Architecture**:
  - REST client integration with FastAPI backend (`/api`).
  - Supabase integration for auth and direct table operations.
  - Zustand offline fallback store with persistent local storage support.
- **Super Admin Dashboard**:
  - Global oversight across all creators, bookings, revenue, and system statuses.
  - Ability to manage, disable, or delete staff admin accounts.
- **Enterprise-Ready Security**:
  - Bcrypt password hashing.
  - AES-256 (Fernet) encryption for OAuth tokens and API secrets at rest.
  - Razorpay HMAC SHA256 webhook & client signature verification.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS, Zustand, Lucide React, Radix UI, date-fns.
- **Backend**: FastAPI (Python 3.11+), SQLAlchemy, Pydantic, Uvicorn, Passlib (Bcrypt), Cryptography (Fernet).
- **Database**: SQLite (local development default) / PostgreSQL (Supabase).
- **Integrations**: Google Calendar API (OAuth 2.0, Meet), Razorpay Payment Gateway.
- **DevOps**: Docker, Docker Compose, Multi-stage Nginx.

---

## 📂 Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/          # 10 modular REST routers (auth, profiles, bookings, payments, etc.)
│   │   ├── core/         # Config, security (hashing, Fernet encryption), DB engine
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic request/response validation schemas
│   │   └── services/     # Razorpay, Google Calendar, and Email services
│   ├── tests/            # Integration, payment, and security test suites
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/   # UI components, layouts, modals, topbars
│   │   ├── lib/          # API REST client, Supabase client, utilities
│   │   ├── pages/        # Public creator pages, checkout, and admin dashboard views
│   │   └── stores/       # Zustand persistent state stores
│   ├── Dockerfile
│   └── package.json
├── supabase/
│   ├── schema.sql        # Supabase PostgreSQL schema with RLS policies
│   └── functions/        # Edge Functions
├── docker-compose.yml    # Full-stack container orchestration
└── walkthrough.md        # Comprehensive technical architecture & walkthrough
```

---

## ⚡ Quick Start

### 1. Prerequisites
- Python 3.11+
- Node.js 20+ & npm
- (Optional) Docker & Docker Compose

### 2. Environment Setup
Copy `.env.example` to create your local environment files:
```bash
# Backend
cp .env.example backend/.env

# Frontend
cp .env.example frontend/.env
```

### 3. Running the Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- API Base: `http://127.0.0.1:8000`
- Interactive API Docs (Swagger): `http://127.0.0.1:8000/docs`
- Health Check: `http://127.0.0.1:8000/health`

### 4. Running the Frontend
```bash
cd frontend
npm install
npm run dev
```
- App UI: `http://localhost:5173`

### 5. Running with Docker Compose
To spin up the entire stack with PostgreSQL, Backend, and Frontend:
```bash
docker compose up --build
```

---

## 🧪 Testing

Run backend tests from the `backend/` directory:
```bash
cd backend
pytest -q
```
Test suites include:
- `test_api.py`: Core endpoint integration tests.
- `test_security.py`: Password hashing and cryptographic signature verification.
- `test_payment_flow.py`: End-to-end payment creation and verification flows.

---

## 📄 License

This project is licensed under the MIT License.
