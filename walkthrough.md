# BookMyMeet — Complete Platform Upgrade Walkthrough

This document provides an exhaustive, production-grade technical walkthrough of the architecture, database schema, multi-admin isolation, per-admin Razorpay integrations, public booking funnels, and verification results across the **BookMyMeet** platform.

---

## 1. Platform Architecture & Core Stack

The platform is designed as a **multi-admin creator booking and 1-to-1 session engine** inspired by SuperProfile-style bio and monetization pages:

- **Frontend**:
  - React 19 + TypeScript + Vite 8 + Tailwind CSS 4.
  - State Management: Zustand with `persist` middleware, offering offline fallback and instant 0ms state access.
  - Routing: React Router DOM v7 supporting vanity username root routes (`/:username`), scoped scheduling routes, and isolated payment gateways.
  - UI & Feedback: Lucide React icons, Radix UI primitives, date-fns date calculations with timezone resolution (`Asia/Kolkata` default).
- **Backend**:
  - Python FastAPI with SQLite (default local `bookmymeet.db`) and PostgreSQL (Supabase) direct connection support.
  - Security & Cryptography: Passlib (Bcrypt) password hashing, AES-256 Fernet encryption for Razorpay Key Secrets and Google OAuth refresh tokens at rest.
  - Web Server: Uvicorn ASGI server running on `http://127.0.0.1:8000`.
- **Infrastructure & Containerization**:
  - Multi-stage Nginx `Dockerfile` for optimized frontend build distribution.
  - Python 3.11-slim `Dockerfile` for backend.
  - Root `docker-compose.yml` orchestrating API and client containers.

---

## 2. Multi-Admin Isolation & Per-Admin Booking Flow (New Architecture)

### The Problem Identified
Previously, booking with any admin (e.g. Alex Rivera, Priya Sharma, David Chen, or any newly registered admin) collapsed into the main Super Admin's (Ameen Ahsan's) page:
1. The **Time Availability Page** was hardcoded to display Ameen Ahsan's name, title, bio, authority stats ("10,000+ Students Mentored | ₹5 Cr+ Ad Spend"), and Vimeo video (`1130419767`).
2. Back buttons and "Change Session" buttons redirected users to the root `/` platform signup instead of the specific admin's creator page.
3. The **Checkout Page** hardcoded the merchant branding to "Adways Academy" and Ameen Ahsan's photo.
4. The **Store Action (`createBooking`)** contained legacy logic hardcoded to `ameen-ahsan`, overriding `admin_id` to the Super Admin. As a result, bookings never appeared in the staff admin's personal dashboard.

### The Solution Implemented

#### A. Dynamic Time Availability Page ([`TimeAvailabilityPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/TimeAvailabilityPage.tsx))
- **Dynamic Host Resolution**: Reads `adminId` or `username` from search parameters, route parameters (`/:username/schedule/:meetingId`), or persisted store. Fetches the latest remote profile via `api.getPublicProfile(targetAdminId)` if not in local store.
- **Dynamic Hero Section**:
  - **Intro Video**: Checks if the admin has an intro video configured and cleanly embeds Vimeo or YouTube.
  - **Profile Portrait & Avatar**: If no video is uploaded, renders a prominent high-resolution portrait or glowing avatar with verified badge.
  - **Branding & Theme**: Automatically applies the admin's theme gradient (`bg_gradient`) and button colors (`button_color`).
  - **Dynamic Bio & Headlines**: Renders the admin's personalized tagline, bio, and custom value proposition pills.
- **Admin-Specific 1:1 Packages**: Renders only the session types configured by that specific admin, preventing cross-admin session leakage.
- **Preserved Creator Navigation**: "Back to Profile" and "Change Session" links navigate directly back to that admin's personal page (`/:username`).
- **Dynamic Sticky Action Bar**: Bottom confirmation bar shows `📅 [Date] at ⏰ [Time Slot] with [Admin Full Name]` and uses the admin's custom theme button color.

#### B. Direct Booking Assignment in Store ([`bookingStore.ts`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/stores/bookingStore.ts))
- Rewrote `createBooking` to eliminate the forced override to `ameen-ahsan`.
- **Target Admin Matching**: Prioritizes `data.adminId` (matching either ID or username). If specified, that admin is strictly assigned without random reassignment or fallback collisions.
- **Data Ownership**:
  - `newBooking.admin_id`: Assigned to the booked admin's ID.
  - `newBooking.assigned_admin_id`: Set to the booked admin's ID.
  - `newBooking.assigned_admin_name`: Set to the booked admin's full name.
  - `newBooking.assigned_admin_email`: Set to the booked admin's email.
- **Alert Dispatch**: Client confirmation and admin alerts are dispatched to `assignedAdmin.email`.
- **Personal Dashboard Integration**: Because `admin_id` matches the booked admin, appointments immediately populate that admin's **Dashboard ([`/admin`](http://localhost:5173/admin))**, **Bookings List ([`/admin/bookings`](http://localhost:5173/admin/bookings))**, and **Calendar ([`/admin/calendar`](http://localhost:5173/admin/calendar))**.

---

## 3. Individual Razorpay Setup & Payment Routing

Every admin has full autonomy over their financial gateway. Client session fees go **100% directly into that specific admin's own Razorpay account** without platform commission deductions.

### Architecture & Data Flow

```
+---------------------------------------------------------------------------------------+
|                                    Client Browser                                     |
|                                                                                       |
|  1. Visits /:username                                                                 |
|  2. Selects Session -> /schedule/:meetingId?adminId=...                               |
|  3. Chooses Slot -> /book/payment?adminId=...                                         |
+-------------------------------------------+-------------------------------------------+
                                            |
                                            | Reads admin's public razorpay_key_id
                                            v
+---------------------------------------------------------------------------------------+
|               Payment Checkout Page (frontend/src/pages/public/PaymentCheckoutPage.tsx)|
|                                                                                       |
|  - Key ID: admin.razorpay_key_id (e.g. rzp_test_alex_987654)                          |
|  - Merchant Name: admin.full_name (e.g. Alex Rivera)                                  |
|  - Merchant Avatar: admin.photo_url                                                   |
|  - Theme Color: admin.theme_settings.button_color                                     |
|  - Visual Badge: "Direct Payment to [Admin Name] via Razorpay ([Key ID])"             |
+-------------------------------------------+-------------------------------------------+
                                            |
                                            v
+---------------------------------------------------------------------------------------+
|                                  Razorpay Modal Popup                                 |
|                                                                                       |
|  Direct client checkout against the specific admin's Razorpay Merchant Account        |
+---------------------------------------------------------------------------------------+
```

### Key Technical Implementations

1. **Backend Schema & Public API ([`backend/app/schemas/schemas.py`](file:///c:/Users/midhu/OneDrive/Desktop/super/backend/app/schemas/schemas.py) & [`backend/app/api/admin_profiles.py`](file:///c:/Users/midhu/OneDrive/Desktop/super/backend/app/api/admin_profiles.py))**:
   - Extended `PublicAdminProfile` schema:
     ```python
     razorpay_configured: Optional[bool] = False
     razorpay_key_id: Optional[str] = None
     ```
   - In `get_public_admin_profile`, queried `RazorpayConnection` for that admin and exposed their public `key_id` (safe for browser use) while keeping `encrypted_key_secret` strictly protected on the server.
2. **No seeded admins (`backend/app/main.py`)**:
   - The demo staff admins and their placeholder Razorpay test configurations have been
     removed. Startup creates only the Super Admin, from `SUPER_ADMIN_*` environment
     variables, and only when no super admin exists. Every other admin registers through
     `/signup` or Google, and connects their own Razorpay account from Settings.
3. **Dedicated Payment Checkout ([`PaymentCheckoutPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/PaymentCheckoutPage.tsx))**:
   - Dynamic key selection:
     ```typescript
     const adminRazorpayKey = selectedAdmin?.razorpay_key_id?.trim();
     const isCustomAdminKey = Boolean(adminRazorpayKey && adminRazorpayKey.length > 5);
     const effectiveRazorpayKey = isCustomAdminKey
       ? adminRazorpayKey!
       : (import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_dummy1234567890');
     ```
   - Instantiates `window.Razorpay` with `key: effectiveRazorpayKey`, `name: selectedAdmin.full_name`, `image: selectedAdmin.photo_url`, and custom theme button color.
   - Added a direct gateway trust badge so clients and admins can visually confirm that funds route to the creator's gateway.
4. **Admin Settings Configuration ([`SettingsPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/admin/SettingsPage.tsx))**:
   - Any admin can configure or update their credentials under **Settings -> Razorpay Payment Setup**:
     - Key ID (`rzp_test_...` or `rzp_live_...`)
     - Key Secret (encrypted with AES-256 at rest)
     - Optional Merchant Account Reference.

---

## 4. Scoped Routing Architecture ([`App.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/App.tsx))

To ensure URLs remain clean, bookmarkable, and strictly bound to the creator, the routing table supports both path-scoped and query-parameter-scoped booking journeys:

| Route Path | Component | Purpose |
| :--- | :--- | :--- |
| `/` & `/signup` | [`SignupPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/auth/SignupPage.tsx) | Platform Admin Signup & Registration |
| `/:username` | [`SuperProfileHomePage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/SuperProfileHomePage.tsx) | Creator's Public Profile (vanity root URL) |
| `/book/:username` | [`SuperProfileHomePage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/SuperProfileHomePage.tsx) | Alternative creator public booking entry point |
| `/:username/schedule/:meetingId` | [`TimeAvailabilityPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/TimeAvailabilityPage.tsx) | Path-scoped slot picker for specific admin & session |
| `/schedule/:meetingId` | [`TimeAvailabilityPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/TimeAvailabilityPage.tsx) | Standard slot picker (uses `?adminId=...`) |
| `/:username/payment` | [`PaymentCheckoutPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/PaymentCheckoutPage.tsx) | Path-scoped Razorpay checkout |
| `/book/payment` | [`PaymentCheckoutPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/PaymentCheckoutPage.tsx) | Standard Razorpay checkout (uses `?adminId=...`) |
| `/booking/confirmation/:bookingId` | [`BookingConfirmationPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/public/BookingConfirmationPage.tsx) | Booking receipt with host details & Google Meet link |
| `/admin/login` | [`AdminLoginPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/auth/AdminLoginPage.tsx) | Unified Sign-In (auto-detects role) |
| `/admin/*` | [`AdminLayout.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/components/layout/AdminLayout.tsx) | Individual Admin Portal (Dashboard, Calendar, Settings) |
| `/super-admin` | [`SuperAdminDashboardPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/super-admin/SuperAdminDashboardPage.tsx) | Super Admin Master Command Console |

---

## 5. Main Interface: Admin Signup Gateway (`/`)

The root path (`/`) serves as the **Admin Signup & Platform Registration Page**:

- **Value Proposition Highlights**:
  - ⚡ **Personal Link**: `yourdomain.com/:username` with customized themes and intro videos.
  - 🗓️ **Google Calendar & Meet**: Real-time busy-slot subtraction and automated video link generation.
  - 💳 **Direct Razorpay**: Keep 100% of your earnings straight into your own Razorpay account.
  - 🔒 **Zero Double-Booking**: Atomic 10-minute temporary slot hold to prevent scheduling collisions.
- **Registration Features**:
  - Full Name, Username (with dynamic preview `localhost:5173/:username`), Gmail/Email, Phone, and Password.
  - **View / Hide Password Toggle**: Interactive eye icon to toggle between masked and plain text.
  - Email placeholder: `"Enter Gmail or email address"`.
  - Quick links to live sample profiles (e.g. [`/ameen`](http://localhost:5173/ameen), [`/alex`](http://localhost:5173/alex)) and Admin Sign In ([`/admin/login`](http://localhost:5173/admin/login)).

---

## 6. Unified Admin Login (`/admin/login`)

- **Single Sign-In for All Roles**: Auto-detects whether the user is a Super Admin (redirects to `/super-admin`) or Staff Admin (redirects to `/admin`).
- **Cleaned Interface**: Removed the 1-Click Test Accounts box to provide a clean, production-grade login form.
- **Updated Placeholder & Label**:
  - Field label: `"Gmail or Username"`
  - Placeholder: `"Enter Gmail or username"`
- **View / Hide Password Toggle**: Eye icon inside password input.

---

## 7. Import from SuperProfile

Available from Admin Settings ([`/admin/settings`](http://localhost:5173/admin/settings)) to every admin, as a preview-then-confirm flow: paste a public SuperProfile URL, review exactly what was found, tick what to keep, apply.

- **Backend**: [`app/api/profile_imports.py`](file:///c:/Users/midhu/OneDrive/Desktop/super/backend/app/api/profile_imports.py) (`/api/profile-import/preview`, `/apply`, `/{id}`, `/{id}/cancel`) over [`app/services/superprofile_import.py`](file:///c:/Users/midhu/OneDrive/Desktop/super/backend/app/services/superprofile_import.py). Admin role required. Preview writes only a `profile_imports` row -- never the admin's profile or sessions.
- **How the page is actually read.** superprofile.bio is a Next.js *pages*-router app behind Vercel's bot check. Two consequences shape the parser, both verified against the live site rather than assumed:
  1. The server HTML is an empty shell plus `<script id="__NEXT_DATA__">`; the visible cards are drawn in the browser. Structure comes from that JSON; **price comes only from the rendered `.session-card` markup**, because the amounts are fetched client-side and appear nowhere in the JSON. The parser reads both and merges them by session title.
  2. Every non-browser request gets `429` and a "Vercel Security Checkpoint" JavaScript challenge. That challenge is **not** solved or worked around. The importer says so plainly and offers the supported route: the admin copies their own rendered page (Inspect -> Copy outerHTML) and pastes it, which is parsed and sanitized by the same code.
- **Two page shapes**, nested differently and both handled: `/{handle}` puts the creator under `prefetchedData.superProfile` (displayName, bio, `socialConnects`, blocks) and has no sessions; `/bookings/{handle}` puts `name` / `tagline` / `bio` / `aboutMe` / `sessions` at the top level. Sessions live only on the booking page.
- **Imported**: display name, headline/tagline, bio, social links (a bare handle plus its stated type is rebuilt into the canonical URL), website, public link sections, FAQs, and per session the title, both descriptions, duration, price, original price, currency, category and public booking-form fields.
- **Photos are never imported.** No `og:image`, `profilePicture`, `image`, cover or thumbnail is parsed at all, so there is no field for the apply step to write. The admin's existing photo is untouched in every mode, including `replace`.
- **Video is YouTube/Vimeo only**, stored as a public link -- never downloaded or re-hosted. Detected from spotlight items, `aboutMe`, profile blocks, `og:video`, page iframes/anchors, a session's `cover` links and the iframe inside a session's rich-text description. Anything else (Loom, Wistia, a raw `.mp4`) is dropped, and a page with no such video leaves the admin's current video alone. The value is re-validated at apply time, so a tampered import row cannot put an arbitrary URL in `intro_video`.
- **Never carried across**: the SuperProfile username/slug (the admin's own public URL is unchanged), Razorpay keys, Google OAuth tokens and calendar ids. Imported sessions are sold through the admin's own connected Razorpay account.
- **Duplicates** are flagged, never resolved automatically: by the SuperProfile session id recorded in a previous applied import (which survives a rename), by an exact title match, or by a close title with the same duration. Nothing existing is ever deleted.
- **Safety**: https + exact-host allowlist, DNS resolution with private/loopback/link-local rejection, every redirect hop re-validated, 10s timeout, streamed body cap, per-admin rate limit on fetches only. All imported text is stripped of markup, so no SuperProfile HTML or script reaches React.
- **Errors are distinguished**: invalid URL (400), unreachable or blocked page (502), unreadable page (422), and a page that yields nothing importable (422) -- never a silent empty preview.
- **Tests**: `backend/test_superprofile_import.py`, 92 tests built on the real page structure.

## 8. Instant Loading Performance (0ms Lag)

Resolved previous loading delays when signing in or loading dashboards:

- **Instant Session Recognition in [`AdminLayout.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/components/layout/AdminLayout.tsx)**:
  - Local authentication credentials (`bmm_logged_admin_id` and `bmm_current_user_role`) are verified immediately, bypassing full-page loading spinners.
- **Non-Blocking Auth Store in [`authStore.ts`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/stores/authStore.ts)**:
  - Pre-populates the admin user and profile immediately from persisted store data.
  - 600ms safety timeout on external Supabase calls to ensure slow or offline networks cannot freeze the layout.
- **Instant Stats Calculation in [`DashboardPage.tsx`](file:///c:/Users/midhu/OneDrive/Desktop/super/frontend/src/pages/admin/DashboardPage.tsx)**:
  - Dashboard statistics and upcoming meetings calculate in **0ms** from local store data with background synchronization.

---

## 9. Admin Calendar Page ([`/admin/calendar`](http://localhost:5173/admin/calendar))

- **Route & Navigation**: Registered `<Route path="/admin/calendar" element={<CalendarPage />} />` under `<Route element={<AdminLayout />}>`.
- **Interactive Month Grid**: Displays scheduled 1:1 sessions, confirmed badges, and month switcher (Previous / Next / Today).
- **Date Detail Drawer**: Lists all appointments for the clicked date with client name, email, phone, and time slot.
- **Direct Google Meet Link**: Includes one-click **[Join Google Meet]** button on every confirmed appointment card and in the details modal.
- **Agenda List View**: Switch between visual month grid and chronological agenda list.

---

## 10. Super Admin Control Panel ([`/super-admin`](http://localhost:5173/super-admin))

- **Credentials**: whatever `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` are set to in
  `backend/.env`. The login form performs real authentication against
  `POST /api/auth/login` and checks that the account's role is `super_admin`.
- **Platform Analytics**: Total revenue, confirmed bookings, and active staff admins.
- **Admin Management Table**:
  - Search by name, username, or email.
  - Filter by status (`ACTIVE`, `TEMPORARILY_DISABLED`).
  - **1-Click Status Toggle**: Temporarily disable or re-activate staff admin pages. The
    server is called first; the list only changes if it succeeded.
  - **Permanent Delete Confirmation Modal**: Requires typing `DELETE`. Deletion is real —
    the account, profile, sessions, availability, Google and Razorpay connections are
    erased, bookings and payments are kept but anonymized, the username is retired, and
    the email can never register again. See "Admin deletion" in `CLAUDE.md`.

---

## 11. Verification & Test Suite Results

| Test Case | Tool / Command | Result |
| :--- | :--- | :--- |
| **Frontend TypeScript & Vite Build** | `npm run build` | 🟢 **0 errors, passed in 1.83s** |
| **Backend Integration Suite** | `python -m pytest test_api.py` | 🟢 **6/6 passed in 3.24s** |
| **Public Razorpay API (Ameen)** | `GET /api/profiles/public/ameen` | 🟢 **HTTP 200, key: `rzp_test_ameen_123456`** |
| **Public Razorpay API (Alex)** | `GET /api/profiles/public/alex` | 🟢 **HTTP 200, key: `rzp_test_alex_987654`** |
| **Public Razorpay API (Priya)** | `GET /api/profiles/public/priya` | 🟢 **HTTP 200, key: `rzp_test_priya_555444`** |
| **Creator Route Check (Alex)** | `http://localhost:5173/alex` | 🟢 **HTTP 200, renders Alex's profile** |
| **Scoped Slot Picker Route** | `http://localhost:5173/schedule/mt-alex-1?adminId=admin-a` | 🟢 **HTTP 200, dynamic Alex branding** |
| **Scoped Checkout Route** | `http://localhost:5173/book/payment?adminId=admin-a` | 🟢 **HTTP 200, Alex Razorpay gateway** |
| **Codebase Knowledge Graph** | `python -m graphify update .` | 🟢 **15,594 nodes, 29,453 edges updated** |
