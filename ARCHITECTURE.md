# BookMyMeet — Complete System Architecture Specification

## 1. Executive Summary & Domain Overview

**BookMyMeet** is an enterprise-ready, multi-tenant 1:1 appointment scheduling and creator monetization platform inspired by SuperProfile-style bio and scheduling engines. 

### Core Value Proposition
- **Multi-Admin Financial & Brand Autonomy**: Each creator/staff admin operates an isolated vanity booking portal (`/:username`) with personalized branding, video introductions (YouTube / Vimeo), custom theme gradients, and independent session offerings.
- **Direct Peer-to-Merchant Payment Flow**: Creators link their individual Razorpay merchant accounts. Client session fees flow **100% directly** into each creator's gateway with zero platform intermediary deductions or escrow holds.
- **Automated Calendar & Meet Synchronization**: Per-admin Google Calendar OAuth 2.0 integration performs real-time busy slot deductions and automatically generates Google Meet video conference rooms upon booking confirmation.
- **Strict Concurrency & Anti-Double-Booking Guarantees**: A two-tiered locking architecture combines a distributed temporary slot-hold mechanism (`SlotLock`) with an authoritative database-level partial unique index to eliminate race conditions during checkout.
- **Privacy-Preserving Lifecycle Management**: Permanent account deletion anonymizes historical booking and payment ledgers while establishing cryptographically hashed tombstones (`deleted_admin_identities`) to prevent identity spoofing or re-registration.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TB
    subgraph ClientLayer["Client & Public Layer"]
        PublicUser["Public Client / Invitee"]
        CreatorAdmin["Creator / Staff Admin"]
        PlatformSuperAdmin["Platform Super Admin"]
    end

    subgraph FrontendLayer["Frontend Application (React 19 + Vite + Tailwind)"]
        Router["React Router v7"]
        PublicPages["Public Funnel<br/>(/:username, /schedule, /payment)"]
        AdminDashboard["Admin Portal<br/>(/admin/*)"]
        SuperAdminConsole["Super Admin Console<br/>(/super-admin)"]
        ZustandStore["Zustand State Store<br/>(Persisted UI State)"]
        ApiClient["REST API Client<br/>(src/lib/api.ts)"]
        SupabaseClient["Supabase Client<br/>(Auth / Token Operations)"]
    end

    subgraph GatewayLayer["API Gateway & Reverse Proxy"]
        Nginx["Nginx Reverse Proxy / Static Host"]
        FastAPI["FastAPI REST Backend (:8000)<br/>Stateless JWT Auth, CORS, Pydantic"]
    end

    subgraph ServiceLayer["Core Backend Services (FastAPI)"]
        AuthEngine["Auth & RBAC Service<br/>(Bcrypt, HS256 JWT, Blocked Checks)"]
        SlotEngine["Availability & Slot Engine<br/>(Timezone Normalization, Windows)"]
        PaymentService["Razorpay Integration<br/>(Per-Admin Keys, HMAC SHA256)"]
        CalendarService["Google Calendar Service<br/>(OAuth2, FreeBusy, Meet Gen)"]
        EmailService["Email Dispatch Service<br/>(Resend API, HTML Receipts)"]
        AdminLifecycle["Lifecycle Service<br/>(Tombstoning, PII Anonymization)"]
        ImageOptimizer["Image Optimization<br/>(Pillow WebP, EXIF Scrubbing)"]
    end

    subgraph DataStorageLayer["Persistence & Storage Layer"]
        PostgreSQL[("PostgreSQL / SQLite Database<br/>SQLAlchemy ORM + Partial Indexes")]
        SupabaseStorage[("Supabase Object Storage<br/>(Avatars, Banners)")]
        LocalDisk[("Local Uploads Storage<br/>(/uploads static mount)")]
    end

    subgraph ExternalProviders["External Third-Party APIs"]
        GoogleAPI["Google OAuth 2.0 & Calendar API"]
        RazorpayGateway["Razorpay Payment Gateway API"]
        ResendAPI["Resend Email Delivery API"]
    end

    %% Client Connections
    PublicUser -->|Visits /:username & books| Router
    CreatorAdmin -->|Manages availability & pricing| Router
    PlatformSuperAdmin -->|System governance| Router

    Router --> PublicPages
    Router --> AdminDashboard
    Router --> SuperAdminConsole

    PublicPages --> ApiClient
    AdminDashboard --> ApiClient
    SuperAdminConsole --> ApiClient
    AdminDashboard -.-> SupabaseClient

    ApiClient --> Nginx
    Nginx --> FastAPI

    %% Backend Service Interactions
    FastAPI --> AuthEngine
    FastAPI --> SlotEngine
    FastAPI --> PaymentService
    FastAPI --> CalendarService
    FastAPI --> EmailService
    FastAPI --> AdminLifecycle
    FastAPI --> ImageOptimizer

    %% Persistence
    AuthEngine --> PostgreSQL
    SlotEngine --> PostgreSQL
    PaymentService --> PostgreSQL
    AdminLifecycle --> PostgreSQL
    ImageOptimizer --> SupabaseStorage
    ImageOptimizer --> LocalDisk

    %% External
    CalendarService --> GoogleAPI
    PaymentService --> RazorpayGateway
    EmailService --> ResendAPI
```

---

## 3. Technology Stack Decomposition

| Domain | Technology / Library | Architectural Responsibility |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19 + TypeScript | Component tree, hooks, high-performance DOM rendering |
| **Build & Bundling** | Vite 8 | Development HMR and optimized production bundling |
| **Styling & Design System** | Tailwind CSS 4 + Lucide Icons + Radix UI | Glassmorphism, creator theme CSS variables, accessible primitives |
| **State Management** | Zustand (`persist` middleware) | Client state, offline fallback, optimistic UI caching |
| **Frontend Routing** | React Router DOM v7 | Root vanity URLs (`/:username`), scoped scheduling, admin sub-routes |
| **Date & Time Utilities** | date-fns + date-fns-tz | Timezone calculations, slot formatting (`Asia/Kolkata` baseline) |
| **Backend Framework** | FastAPI (Python 3.11+) | Async REST API, OpenAPI docs generation, typed schemas |
| **Application Server** | Uvicorn ASGI | High-concurrency asynchronous HTTP request processing |
| **ORM & Database Layer** | SQLAlchemy 2.0 | Declarative schema models, transactions, partial unique constraints |
| **Database Engines** | PostgreSQL 15+ / SQLite | Persistent relational storage, index-backed conflict enforcement |
| **Security & Cryptography** | Passlib (Bcrypt) + Cryptography (Fernet) | Salted password hashing, AES-256 encrypted credential storage |
| **Token Verification** | PyJWT / python-jose | Stateless HS256 bearer tokens (7-day validity, live DB role check) |
| **Payment Gateway** | Razorpay Python SDK & Checkout JS | Dynamic creator checkout, order generation, HMAC verification |
| **Calendar & Video Conf** | Google Calendar API v3 | FreeBusy interval deduction, Google Meet room provisioning |
| **Email Delivery** | Resend API / SMTP Fallback | Transactional booking confirmations, ICS calendar attachments |
| **Image Processing** | Pillow (PIL) | Dynamic resizing, WebP conversion, GPS/EXIF metadata stripping |
| **Containerization** | Docker & Docker Compose | Multi-stage Nginx for frontend, Python-slim backend, PostgreSQL |
| **Alternative Stack** | Supabase (PostgreSQL RLS + Deno Edge) | Standalone mirror architecture for serverless/edge deployments |

---

## 4. Architectural Patterns & Core Subsystems

### 4.1. Three Overlapping Frontend Data Paths
The frontend application maintains resilience across heterogeneous deployment topologies by structuring data ingestion into three channels:
1. **Canonical REST Client (`src/lib/api.ts`)**: Direct HTTP interface to FastAPI (`/api/*`). Serves as the single source of truth for public profile resolution, slot calculation, booking creation, order generation, and admin settings.
2. **Supabase Client (`src/lib/supabase.ts`)**: Direct database and auth connection utilized for magic links, token-based public actions (cancel, reschedule, booking status), and direct admin dashboard subscriptions.
3. **Zustand Offline Store (`src/stores/bookingStore.ts`)**: Client-side persisted store (`bookmymeet-platform-state-v4`). Acts strictly as an ephemeral UI state container without fake seed data, hydrating from backend API responses upon authentication.

### 4.2. Concurrency Control & Double-Booking Protection
Preventing conflicting bookings across concurrent users is guaranteed through a defense-in-depth model:

```mermaid
sequenceDiagram
    autonumber
    actor ClientA as Invitee A
    actor ClientB as Invitee B
    participant API as FastAPI Backend
    participant DB as PostgreSQL / SQLite
    participant Razorpay as Creator Razorpay Gateway

    ClientA->>API: POST /api/bookings/hold-slot (Slot: 10:00 AM)
    API->>DB: Check conflicts & create SlotLock (10 min TTL)
    DB-->>API: Lock Granted (lock_id: L1, fingerprint: F1)
    API-->>ClientA: Hold Confirmed

    ClientB->>API: POST /api/bookings/hold-slot (Slot: 10:00 AM)
    API->>DB: Check conflicts (Active lock L1 exists)
    API-->>ClientB: 409 Conflict ("Slot currently held by another client")

    ClientA->>API: POST /api/payments/create-order (lock_id: L1)
    API->>DB: Consume L1 & INSERT Booking (status: 'pending_payment')
    API->>Razorpay: Create Order under Admin's Key
    Razorpay-->>API: order_id: rzp_ord_123
    API-->>ClientA: Order Created + Admin Key ID

    ClientA->>Razorpay: Completes Checkout via Modal
    Razorpay-->>ClientA: Payment Success (sig, payment_id)

    ClientA->>API: POST /api/payments/verify (sig, order_id, payment_id)
    API->>API: Verify Razorpay HMAC-SHA256 Signature
    API->>DB: UPDATE Booking SET status='confirmed'
    Note over DB: Guaranteed by Partial Unique Index:<br/>ux_bookings_admin_slot_active on (admin_id, start_time)<br/>WHERE status IN ('confirmed', 'pending_payment')
    API-->>ClientA: 200 OK + Meeting Link Generated
```

#### Key Concurrency Safeguards:
- **Distributed Slot Lock (`slot_locks`)**: Holds slots for 10 minutes during checkout. Requires matching `session_fingerprint` to release, eliminating cross-client lock hijacking.
- **Database Partial Unique Index**:
  ```sql
  CREATE UNIQUE INDEX ux_bookings_admin_slot_active
  ON bookings (admin_id, start_time)
  WHERE status IN ('confirmed', 'pending_payment');
  ```
  Even if concurrent requests bypass application logic, the database engine enforces atomicity and rejects collisions with an `IntegrityError` (mapped to HTTP 409).
- **Abandoned Booking Expiry Sweep**: Handled by `services/booking_slots.py`. Uncompleted checkouts older than `ABANDONED_CHECKOUT_MINUTES = 20` are released automatically to prevent artificial slot depletion.

---

### 4.3. Multi-Admin Financial Isolation
Each creator maintains an isolated payment channel to eliminate platform custodial liabilities:

```mermaid
flowchart TD
    subgraph CreatorSettings["Creator Admin Settings (/admin/settings)"]
        AdminInput["Admin enters Key ID & Key Secret"]
        EncryptSecret["AES-256 Fernet Encryption"]
        StoreConn["Save to razorpay_connections Table"]
        AdminInput --> EncryptSecret --> StoreConn
    end

    subgraph PublicFunnel["Client Booking Funnel"]
        VisitProfile["Client visits /:username"]
        FetchPublicProfile["GET /api/profiles/public/{username}"]
        ExposePublic["Returns public razorpay_key_id<br/>(Secret strictly suppressed)"]
        
        VisitProfile --> FetchPublicProfile --> ExposePublic
        
        CheckoutPage["PaymentCheckoutPage.tsx"]
        ExposePublic --> CheckoutPage
        
        DynamicInit["Init window.Razorpay({<br/>key: admin.razorpay_key_id,<br/>name: admin.full_name,<br/>theme: admin.theme_settings.button_color<br/>})"]
        CheckoutPage --> DynamicInit
    end

    subgraph VerificationBackend["Payment Verification (/api/payments/verify)"]
        ClientPayload["Client sends razorpay_payment_id, order_id, signature"]
        FetchSecret["Backend loads admin's encrypted_key_secret"]
        DecryptSecret["Fernet Decrypt Key Secret"]
        ComputeHMAC["Compute HMAC-SHA256(order_id + '|' + payment_id)"]
        VerifyMatch{"HMAC matches signature?"}

        ClientPayload --> FetchSecret --> DecryptSecret --> ComputeHMAC --> VerifyMatch
        VerifyMatch -->|Yes| ConfirmBooking["Status -> 'confirmed'<br/>Trigger Meet & Email"]
        VerifyMatch -->|No| Reject400["400 Bad Request (Invalid Signature)"]
    end
```

---

### 4.4. Availability Calculation Engine
Availability generation (`backend/app/api/availability.py`) combines working hours, Google Calendar events, and per-meeting constraints:

$$\text{Bookable Slots} = \Big(\text{Working Hours} \cap \text{Session Time Windows}\Big) \setminus \Big(\text{Google FreeBusy} \cup \text{Occupying Bookings} \cup \text{Active Slot Locks} \cup \text{Exceptions}\Big)$$

1. **Working Hours Evaluation**: Evaluates `availability_rules` for the target weekday. Uses modulo arithmetic `(weekday + 1) % 7` to bridge Python's ISO week (Monday=0) to DB schema (Sunday=0).
2. **Session Time Window Intersection**: If `session_time_windows` are specified for a session, bookable hours are restricted strictly to the intersection with general working hours.
3. **Google FreeBusy Subtraction**: Real-time query to Google Calendar API v3 using the creator's decrypted refresh token. If Google Calendar is disconnected or fails, availability fails closed to prevent double-booking.
4. **Buffer & Advance Notice Padding**: Pads bookings with `buffer_before_minutes` and `buffer_after_minutes`. Enforces `min_advance_hours` (minimum lead time) and `max_advance_days` (booking horizon).

---

### 4.5. Admin Deletion, Anonymization & Tombstoning
Permanent deletion (`DELETE /api/super-admin/admins/{id}?confirm=true`) executes in a single atomic transaction:

```mermaid
flowchart TD
    DeleteRequest["Super Admin confirms deletion of Admin X"]
    
    subgraph Transaction["Atomic Database Transaction"]
        ComputeHash["Compute HMAC-SHA256(normalized_email, SECRET_KEY)"]
        InsertTombstone["Insert into deleted_admin_identities<br/>(email_hash, username, deleted_at)"]
        
        AnonymizeBookings["Anonymize Bookings:<br/>- Clear client_name, email, phone, notes<br/>- Clear google_meet_link, event_id<br/>- Set admin_id = NULL<br/>- Set meeting_type_id = NULL<br/>- Cancel active bookings"]
        
        AnonymizePayments["Detach Payments:<br/>- Set admin_id = NULL<br/>- Preserve financial sum for platform audit"]
        
        DeleteCascades["Cascade Delete:<br/>- User & AdminProfile<br/>- Sessions & SessionTimeWindows<br/>- AvailabilityRules & Exceptions<br/>- GoogleConnection & tokens<br/>- RazorpayConnection & secrets<br/>- SlotLocks & Notifications"]
    end

    subgraph Enforcements["Perpetual Security Enforcements"]
        BlockSignup["POST /auth/signup:<br/>Reject email matching tombstone hash (403)"]
        BlockGoogle["POST /auth/google:<br/>Reject email matching tombstone hash (403)"]
        BlockVanity["Check Username:<br/>Reject claiming retired username (409/400)"]
        Public404["GET /api/profiles/public/{username}:<br/>Returns 404 Not Found"]
    end

    DeleteRequest --> Transaction
    Transaction --> ComputeHash --> InsertTombstone --> AnonymizeBookings --> AnonymizePayments --> DeleteCascades
    InsertTombstone -.-> Enforcements
```

---

## 5. Database Schema & Entity Relationship Model

```mermaid
erDiagram
    users ||--o| admin_profiles : "has one"
    users ||--o{ sessions : "configures"
    users ||--o{ availability_rules : "defines"
    users ||--o{ availability_exceptions : "specifies"
    users ||--o| google_connections : "authenticates"
    users ||--o| razorpay_connections : "integrates"
    users ||--o{ slot_locks : "locks for"
    users ||--o{ bookings : "hosts"
    users ||--o{ notifications : "receives"

    sessions ||--o{ session_time_windows : "restricts"
    sessions ||--o{ bookings : "categorizes"
    
    bookings ||--o| payments : "settles"
    bookings ||--o{ notifications : "triggers"

    users {
        string id PK "UUID"
        string name
        string email UK
        string password_hash
        string phone
        string role "super_admin | admin | client"
        string status "ACTIVE | TEMPORARILY_DISABLED | PERMANENTLY_DELETED"
        datetime created_at
        datetime updated_at
    }

    admin_profiles {
        string id PK "UUID"
        string user_id FK, UK
        string username UK
        string title
        text bio
        text profile_photo
        text cover_image
        text intro_video
        json theme_settings
        json social_links
    }

    sessions {
        string id PK "UUID"
        string admin_id FK
        string title
        int duration_minutes
        int price "in paise"
        int original_price
        string currency
        boolean is_active
        int buffer_before_minutes
        int buffer_after_minutes
        int min_advance_hours
        int max_advance_days
        int sort_order
    }

    session_time_windows {
        string id PK "UUID"
        string session_id FK
        string admin_id FK
        int day_of_week "0=Sun..6=Sat"
        string start_time "HH:MM"
        string end_time "HH:MM"
    }

    availability_rules {
        string id PK "UUID"
        string admin_id FK
        int day_of_week "0=Sun..6=Sat"
        string start_time "HH:MM"
        string end_time "HH:MM"
        boolean is_active
    }

    availability_exceptions {
        string id PK "UUID"
        string admin_id FK
        string exception_date "YYYY-MM-DD"
        boolean is_available
        string start_time
        string end_time
        string reason
    }

    google_connections {
        string id PK "UUID"
        string admin_id FK, UK
        string google_email
        text access_token
        text encrypted_refresh_token
        string calendar_id
        string connection_status
    }

    razorpay_connections {
        string id PK "UUID"
        string admin_id FK, UK
        string key_id
        text encrypted_key_secret
        string connection_status
        string account_reference
    }

    slot_locks {
        string id PK "UUID"
        string admin_id FK
        string session_id FK
        string start_time
        string end_time
        string locked_by_session
        datetime expires_at
        string status "active | released | confirmed"
    }

    bookings {
        string id PK "UUID"
        string public_id UK
        string admin_id FK "Nullable (Tombstoned)"
        string meeting_type_id FK "Nullable (Tombstoned)"
        string client_name
        string client_email
        string client_phone
        string start_time
        string end_time
        string timezone
        string status "pending_payment | confirmed | cancelled | completed"
        string payment_status
        string google_event_id
        string google_meet_link
        string cancellation_token UK
        text notes
    }

    payments {
        string id PK "UUID"
        string booking_id FK, UK
        string admin_id FK "Nullable (Tombstoned)"
        string provider "razorpay"
        string order_id
        string payment_id
        int amount "in paise"
        string currency
        string status "created | captured | failed"
    }

    deleted_admin_identities {
        string id PK "UUID"
        string email_hash UK "HMAC-SHA256"
        string username UK
        datetime deleted_at
    }
```

---

## 6. End-to-End Booking & Settlement Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Client as Invitee
    participant UI as Frontend App
    participant API as FastAPI Backend
    participant DB as Database
    participant RZP as Creator Razorpay Gateway
    participant GCal as Google Calendar API
    participant Mail as Resend API

    Client->>UI: Visits /:username
    UI->>API: GET /api/profiles/public/{username}
    API->>DB: Query AdminProfile & Razorpay Key ID
    DB-->>API: Profile + public key_id
    API-->>UI: Render Host Bio, Theme, Video, Sessions

    Client->>UI: Selects Session & Slot
    UI->>API: POST /api/bookings/hold-slot
    API->>DB: Insert active SlotLock (10 min expiry)
    DB-->>API: Slot Lock ID
    API-->>UI: Lock Acquired

    Client->>UI: Fills Details & Clicks Pay
    UI->>API: POST /api/payments/create-order (with lock_id)
    API->>DB: Verify Lock & Create Booking (pending_payment)
    API->>RZP: Create Order on Creator Gateway
    RZP-->>API: rzp_order_id
    API-->>UI: Return Order ID + Merchant Key ID

    UI->>RZP: Open Razorpay Checkout Modal
    Client->>RZP: Submits Payment (UPI/Card/NetBanking)
    RZP-->>UI: Payment Success (razorpay_payment_id, signature)

    UI->>API: POST /api/payments/verify
    API->>API: Verify HMAC-SHA256(order_id + '|' + payment_id, secret)
    API->>DB: UPDATE Booking status='confirmed', payment_status='completed'
    API->>DB: UPDATE SlotLock status='confirmed'
    
    par Async Calendar Sync
        API->>GCal: Create Event with ConferenceData (Google Meet)
        GCal-->>API: google_meet_link + event_id
        API->>DB: Save meet link & event id
    and Async Email Notifications
        API->>Mail: Send Invitee Confirmation (with Meet link, ICS)
        API->>Mail: Send Host Notification
    end

    API-->>UI: Booking Confirmed Payload
    UI-->>Client: Navigate to /booking/confirmation/:bookingId
```

---

## 7. Security Architecture & Threat Mitigation

### 7.1. Cryptographic Secrets Protection
- **Symmetric Encryption (AES-256 Fernet)**: Sensitive third-party credentials (`razorpay_connections.encrypted_key_secret` and `google_connections.encrypted_refresh_token`) are encrypted at rest using a dedicated 32-byte urlsafe base64 key (`ENCRYPTION_KEY`). Plaintext secrets are never stored in the database or serialized into logs.
- **HMAC Signatures**: Razorpay webhooks and client verification requests validate HMAC-SHA256 signatures before confirming payment or executing calendar provisioning.

### 7.2. Authentication & RBAC Integrity
- **Stateless JWT**: Standard HS256 tokens (`SECRET_KEY`), with a 7-day expiration.
- **Dynamic Role Verification**: Tokens carry only `{sub: user_id, exp}` and intentionally omit role claims. Role verification (`get_current_admin`, `get_current_super_admin`) performs a fresh database lookup on every request, ensuring instant revocation if an admin is disabled or deleted.

### 7.3. SSRF & Ingestion Hardening (SuperProfile Importer)
- SuperProfile profile imports validate URLs against strict hostname allowlists (`superprofile.bio`).
- Private, loopback, link-local, and reserved IP ranges (RFC 1918 / RFC 3927 / IPv6 equivalents) are rejected prior to DNS resolution to prevent Server-Side Request Forgery.

### 7.4. File Upload & Image Sanitization
- Uploaded avatars and cover images undergo strict server-side validation via Pillow.
- Formats are converted to modern WebP format with capped dimensions (max 1200px width/height).
- EXIF, GPS coordinates, camera metadata, and malicious embedded scripting tags are scrubbed upon ingestion.

---

## 8. Deployment & Operational Topology

```mermaid
graph LR
    subgraph Ingress["Public Ingress (Port 80 / 443)"]
        SSL["TLS Termination"]
    end

    subgraph DockerCompose["Docker Compose Stack"]
        NginxContainer["Nginx Web Server Container (:80)<br/>Static React Dist + Reverse Proxy"]
        FastAPIContainer["FastAPI Backend Container (:8000)<br/>Uvicorn Workers + Python 3.11"]
        PostgresContainer["PostgreSQL Container (:5432)<br/>Persistent Volume Mount"]
    end

    subgraph ExternalSaaS["Cloud Providers"]
        SupabaseCloud["Supabase (PostgreSQL / Storage)"]
        GoogleCloud["Google Cloud Console (OAuth & Meet)"]
        RazorpayCloud["Razorpay Merchant Dashboard"]
        ResendCloud["Resend Transactional Mail"]
    end

    SSL --> NginxContainer
    NginxContainer -->|Static Files / SPA Routing| NginxContainer
    NginxContainer -->|/api/* Proxy| FastAPIContainer
    FastAPIContainer --> PostgresContainer
    FastAPIContainer -.-> SupabaseCloud
    FastAPIContainer --> GoogleCloud
    FastAPIContainer --> RazorpayCloud
    FastAPIContainer --> ResendCloud
```

### Environment Configuration Matrix

| Variable | Scope | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | Backend | PostgreSQL / SQLite connection string (Required, no default) |
| `SECRET_KEY` | Backend | HS256 JWT signing secret & HMAC tombstone key |
| `ENCRYPTION_KEY` | Backend | AES-256 Fernet encryption key for OAuth tokens & API secrets |
| `SUPER_ADMIN_EMAIL` | Backend | Initial bootstrap Super Admin credentials |
| `SUPER_ADMIN_PASSWORD` | Backend | Initial bootstrap Super Admin password |
| `GOOGLE_CLIENT_ID` | Backend | Google OAuth 2.0 Client ID for Calendar & Meet |
| `GOOGLE_CLIENT_SECRET` | Backend | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Backend | OAuth callback endpoint (`/api/google/callback`) |
| `RESEND_API_KEY` | Backend | API Key for transactional email delivery |
| `VITE_API_URL` | Frontend | Target FastAPI base endpoint (`http://localhost:8000/api`) |
| `VITE_RAZORPAY_KEY_ID` | Frontend | Fallback global Razorpay key (overridden by admin keys) |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL for storage & edge auth |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anonymous public key |
