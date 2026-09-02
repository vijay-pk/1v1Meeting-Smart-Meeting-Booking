# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**BookMyMeet** — a multi-admin creator booking and 1-to-1 session engine (SuperProfile-style bio + monetization pages). Each admin gets a vanity page at `/:username`, sets their own session types and availability, connects **their own** Razorpay and Google Calendar accounts, and receives payments directly with no platform cut. A super admin can disable or delete staff admins.

`walkthrough.md` at the repo root is the feature-level narrative of the current architecture — read it for *why* things are shaped this way. This file covers *how to work in the code*.

The repo is not under git.

## Commands

No root-level task runner. Every command is run from `frontend/` or `backend/`.

**Frontend** (`cd frontend`):
```
npm install
npm run dev        # Vite dev server, port 5173, host: true
npm run build      # tsc -b && vite build
npm run preview
```
There is **no `lint` and no `test` script**, and no ESLint/Prettier/vitest config anywhere in `frontend/`. Do not invent them. Type errors surface only through `npm run build`.

**Backend** (`cd backend` — this must be the CWD, since `DATABASE_URL` defaults to the relative path `sqlite:///./bookmymeet.db`):
```
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Swagger at `http://127.0.0.1:8000/docs`, health at `/health`.

**Tests** (`cd backend`):
```
pytest -q                                                          # all 43
pytest test_api.py::test_slot_lock_double_booking_protection -v    # single test
```
Three test files:
- `test_api.py` — 6 `TestClient` integration tests against the seeded DB.
- `test_security.py` — 30 unit tests on password hashing and Razorpay signature verification. No DB, no app.
- `test_payment_flow.py` — 7 end-to-end tests on `POST /api/payments/verify`, building and tearing down their own rows.

The latter two encode fix-closed security guarantees. Do not relax an assertion in them to make a change pass.

**Full stack**: `docker compose up` from the root — postgres on 5432, backend on 8000, frontend (nginx) on 80.

## Architecture: three overlapping data paths

This is the thing to internalize first. The frontend reads from **three different sources simultaneously**, and a page can render perfectly with the backend down:

1. **`frontend/src/lib/api.ts`** — REST client for the FastAPI backend (`VITE_API_URL`, default `http://localhost:8000/api`). **This is the canonical path.**
2. **`frontend/src/lib/supabase.ts`** — a Supabase client used for auth *and* direct table access, imported straight into `TopBar.tsx`, most of `pages/admin/*`, and the token-based `pages/public/{BookingStatus,Cancel,Reschedule}*.tsx`.
3. **`frontend/src/stores/bookingStore.ts`** — a 1165-line Zustand store persisted to localStorage under `bookmymeet-platform-state-v3`, pre-seeded with demo admins (ameen/alex/priya/david), their sessions and bookings. It acts as an offline database.

Nearly every `api.ts` method swallows its error and returns a soft default (`null`, `[]`, `{available_slots: []}`), and callers then fall back to store seed data. `frontend/src/pages/public/SuperProfileHomePage.tsx:45-76` is the canonical merge pattern: fetch remote, keep the local admin on failure, merge remote over local when both exist.

**Consequence:** a feature can look like it works while the backend is broken or not running. When debugging "the data is wrong", first establish *which* of the three paths produced it.

**`supabase/` is a parallel implementation the Python backend does not use** — `supabase/schema.sql` (12 tables, RLS on all) plus 11 Deno Edge Functions under `supabase/functions/` that duplicate the FastAPI endpoints (hold-slot, create-order, verify-payment, google-auth, razorpay-webhook, …). Treat it as a second stack. Do not extend it without asking.

## Backend map (`backend/app/`)

| Path | Contents |
| :--- | :--- |
| `core/config.py` | Pydantic `BaseSettings` singleton `settings`; every env var lives here, `extra="allow"` |
| `core/database.py` | `engine`, `SessionLocal`, `Base`, `get_db()` dependency |
| `core/security.py` | bcrypt hashing, JWT create, Fernet `encrypt_secret`/`decrypt_secret` |
| `models/models.py` | **All 10 ORM tables in one file** — `User`, `AdminProfile`, `Session`, `AvailabilityRule`, `AvailabilityException`, `GoogleConnection`, `RazorpayConnection`, `SlotLock`, `Booking`, `Payment`, `Notification` |
| `schemas/schemas.py` | **All Pydantic models in one file** |
| `api/deps.py` | `get_current_user` / `get_current_admin` / `get_current_super_admin` |
| `api/*.py` | 10 routers |
| `services/` | `razorpay_service`, `google_calendar`, `email_service` (mock — only logs), `scraper_service` |
| `main.py` | App factory, CORS, static `/uploads` mount, `/health`, and `seed_initial_data()` (L17-238) |

Routers, all under the `/api` prefix set at `main.py:274`: `/auth`, `/profiles`, `/sessions`, `/availability`, `/bookings`, `/payments`, `/google`, `/super-admin`, `/notifications`, `/upload`.

Auth is a stateless HS256 bearer token, 7-day expiry, payload `{exp, sub: user_id}` only — **no role claim**, so role is re-read from the DB on every request. Roles are plain strings on `User.role`: `super_admin` / `admin` / `client`. `User.status` (`ACTIVE`, `TEMPORARILY_DISABLED`, `PERMANENTLY_DELETED`) is checked both at login and on every authenticated request.

## The booking flow

The one cross-file path worth knowing by heart:

1. `POST /api/bookings/hold-slot` — creates a `SlotLock` with an expiry; returns 409 on conflict. This is the double-booking guard (`test_api.py::test_slot_lock_double_booking_protection`).
2. `POST /api/payments/create-order` — creates a `pending_payment` `Booking` and a Razorpay order **under that admin's own key** (`payments.py:103-105`).
3. `POST /api/payments/verify` — checks the HMAC signature, re-checks double-booking (`payments.py:193-209`), flips the booking to `confirmed`, creates the Google Meet event using the admin's encrypted refresh token (`payments.py:236-248`), writes a `Notification`, fires the mock emails.

**Slot engine**: `api/availability.py:58-230` computes working hours − Google FreeBusy − leave exceptions − confirmed bookings − buffers. Note the weekday remap at `availability.py:93`: `(weekday() + 1) % 7` converts Python's Mon=0 to the schema's Sun=0. Off-by-one bugs in availability almost always live here.

## Multi-admin isolation

This is what most of `walkthrough.md` is about, and the area most prone to regression.

- Each admin owns their own `RazorpayConnection` and `GoogleConnection` (both `unique=True` on `admin_id`), so funds settle into that admin's gateway and events land on that admin's calendar.
- `GET /api/profiles/public/{username}` exposes `razorpay_key_id` (public, browser-safe) but never `encrypted_key_secret`.
- `frontend/src/pages/public/PaymentCheckoutPage.tsx` picks `selectedAdmin.razorpay_key_id` and only falls back to `VITE_RAZORPAY_KEY_ID` when that is absent.
- `frontend/src/pages/public/TimeAvailabilityPage.tsx` resolves the host from search params, route params, or the store, then renders that admin's branding, video, theme and session list.
- `createBooking` in `bookingStore.ts` must assign `admin_id`, `assigned_admin_id`, `assigned_admin_name` and `assigned_admin_email` from the *target* admin. The historical bug was a hardcoded override to `ameen-ahsan`, which silently routed every booking into the super admin's dashboard. Check any change to booking assignment against that.

## Frontend map (`frontend/src/`)

- **Routing** — `App.tsx`, one flat `<Routes>`, no lazy loading. Several aliases point at the same three funnel pages (`/book/:username/schedule/:meetingId`, `/:username/schedule/:meetingId`, `/schedule/:meetingId` all render `TimeAvailabilityPage`). `/:username` is a catch-all that must stay last. Admin pages sit under a pathless `<Route element={<AdminLayout/>}>`.
- **Stores** — only two. `authStore.ts` (no persist; hydrates synchronously from localStorage, then races `supabase.auth.getSession()` against a 600ms timeout) and `bookingStore.ts` (persist, whole state, no `partialize`). There is no separate admin or super-admin store — super-admin state is `currentSuperAdmin` inside `bookingStore`.
- **Raw localStorage keys** used outside persist: `bmm_auth_token`, `bmm_current_user_role`, `bmm_logged_admin_id`, `bmm_logged_username`, `bmm_logged_admin_name`, `bmm_logged_role`, `bmm_auth_user`.
- **Tailwind v4**, wired as a Vite plugin. **There is no `tailwind.config.js` and no `postcss.config.js` — that is correct for v4; do not create them.** All theme config is CSS-first in the `@theme` block of `src/index.css` (the `--color-primary-*` ramp, sidebar and surface tokens).
- **UI components** in `components/ui/` follow the shadcn idiom (`cn()` = clsx + tailwind-merge, `class-variance-authority`) but were added by hand. There is no `components.json`, so the shadcn CLI will not work here.
- **No path proxy** in `vite.config.ts` — the frontend calls `localhost:8000` cross-origin and depends on the backend's CORS headers.

## Gotchas

Each of these costs a debugging cycle if rediscovered.

**Install / build**
- `@tanstack/react-query` and `@tanstack/react-table` are installed but never imported. Don't assume react-query is the data layer — it isn't; `api.ts` is plain `fetch`.

**Database**
- **There are no migrations.** Schema comes from `Base.metadata.create_all` at `main.py:19`, which only ever *adds* missing tables. Editing a column in `models.py` silently does nothing to an existing `backend/bookmymeet.db` — delete the file (losing seed state) or migrate by hand.
- `seed_initial_data()` catches, logs and rolls back without re-raising (`main.py:234-236`), so a seeding failure lets the app boot in a half-populated state.

**Tests**
- They run against the real dev `bookmymeet.db`, not a fixture DB, and are order-dependent and stateful.
- `test_admin_profile_customization` and `test_super_admin_management_and_disable` log in as the literal username `arun`, which the signup test (which creates a randomized `arun_<uid>`) never produces. They pass only against a DB carrying leftover rows from an earlier run, and fail on a fresh database.

**Payments — fail-closed rules (do not regress these)**
- `verify_razorpay_signature` is HMAC-only: Razorpay's documented `HMAC-SHA256(order_id|payment_id)` keyed with **that admin's own** secret, compared via `hmac.compare_digest`. It has no simulation bypass and no path returning `True` without a matching HMAC. Never reintroduce one keyed on a client-supplied string.
- Whether an order was simulated is read from `Payment.provider` (`razorpay_simulated`), written server-side at creation. Never infer it from the order id.
- `/verify` binds `req.razorpay_order_id` to the stored `Payment.order_id` before checking the signature — otherwise a genuine triple from any other merchant account would verify.
- Simulation requires `PAYMENTS_ALLOW_SIMULATION=true` (default false). Simulated bookings settle to `payment_status="simulated"`, never `"completed"`, so they aren't counted as revenue.
- There is no platform-wide Razorpay credential by design. An admin with no connected account gets 503 from `/create-order`; gateway failures raise (502) rather than degrading into a fake order.
- `decrypt_secret` raises `SecretDecryptionError` rather than returning ciphertext. In `/verify` that maps to 500 ("configuration error"), never 400 — a key-management fault must not be reported as a customer's bad signature.
- `verify_password` fails closed on any exception; there is deliberately no plaintext fallback.

**Still-simulated (lower stakes, but be aware)**
- `google_calendar.py` returns `"simulated-access-token"` when Google creds are absent, and event-creation failures fall back to a generated Meet link.
- `services/email_service.py` is a mock — it only logs `[EMAIL MOCK]`, it never sends.

**Config drift**
- `CORS_ORIGINS` is a hardcoded list (not env-driven) containing `"*"`, combined with `allow_credentials=True` (`core/config.py:39`, `main.py:259`).
- `docker-compose.yml` passes `JWT_SECRET` and `FRONTEND_ORIGIN` to the backend, but **no Python code reads either** — the code wants `SECRET_KEY`, and CORS is hardcoded. A compose deploy silently runs on the default JWT secret.
- Root `.env.example` now documents the FastAPI backend's vars in its first block, then the Supabase stack separately. `backend/.env` is the live file and is gitignored.
- `backend/.env` sets `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, which no Python code reads — they survive only because `config.py` sets `extra = "allow"`.

**Frontend traps**
- `authStore.ts:43` reads persisted state from `bmm_booking_store_v1`, but `bookingStore` persists under `bookmymeet-platform-state-v3`. That lookup always misses — a stale-key bug, not intended behavior.
- `/super-admin` is rendered with no auth wrapper on the route, and `AdminLayout` admits anyone with `bmm_logged_admin_id` or `bmm_current_user_role` present in localStorage.
- Dead files that mislead grep: `src/main.ts`, `src/counter.ts`, `src/style.css` (Vite template leftovers), `pages/auth/LoginPage.tsx` and `components/layout/PublicLayout.tsx` (never routed). The live entry is `src/main.tsx`.
- `/signup` is declared twice in `App.tsx`.

**Credentials in the tree** — `.env` is now gitignored at the root and in `frontend/`, so `backend/.env` and `frontend/.env` will not be picked up by a future `git init` + `git add .`. Still uncovered, because they are tracked source rather than env files: `docker-compose.yml` carries inline default `postgres123` / `JWT_SECRET` / `ENCRYPTION_KEY` values, staff-admin seed passwords are hardcoded in plaintext in `main.py` (alex/priya/david), and super-admin defaults sit in `config.py:22-25`. Replace these with env lookups before any real deployment.

## Graphify (optional aid)

`graphify/` is a **nested clone of an unrelated PyPI tool** (`graphifyy` — a tree-sitter knowledge-graph builder). It is not application code. **Exclude it when searching, counting, or reasoning about this project** — it is roughly 500 files and will dominate any naive scan.

`graphify-out/` is its generated output over this folder: `wiki/` (685 markdown articles + `index.md`), `GRAPH_REPORT.md`, `graph.html`, `GRAPH_TREE.html`, `super-callflow.html`, plus a 19MB `graph.json`. Useful when you want relationships rather than text matches:

```
graphify query "<question>"
graphify path "A" "B"
graphify explain "<concept>"
graphify update .          # AST-only incremental refresh, no API cost
```

**Caveat worth remembering:** the graph was built over the *whole* folder, so all ten god nodes in `GRAPH_REPORT.md` (`extract()`, `build_from_json()`, `_make_id()`, …) are graphify's own internals, and many "surprising connections" are cross-contamination between the app and the vendored tool. Its rankings are unreliable for BookMyMeet questions — the hand-written "Platform Architecture & Recent Upgrades" section at the top of the report is more useful than the generated stats.

`.agents/rules/graphify.md` (Antigravity format, `trigger: always_on`) asks agents to query the graph before answering. Treat that as an available tool, not a required first step.
