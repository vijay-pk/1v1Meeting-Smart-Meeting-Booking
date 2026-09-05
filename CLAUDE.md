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

**Backend** (`cd backend` — this must be the CWD, since `backend/.env` sets `DATABASE_URL` to the relative path `sqlite:///./bookmymeet.db`. `DATABASE_URL` has **no default**: it is required, and startup fails with an explanatory error without it. The old silent SQLite fallback is what erased every production profile on each Render restart — see "Profile persistence and the public URL"):
```
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Swagger at `http://127.0.0.1:8000/docs`, health at `/health`.

**Tests** (`cd backend`):
```
pytest -q                                                          # all 310
pytest test_api.py::test_slot_lock_double_booking_protection -v    # single test
```
Six test files. Every one of them now builds the rows it needs and tears them down, so the
suite is order-independent and leaves nothing behind in the development database:
- `test_api.py` — 6 `TestClient` integration tests; signs up its own admin per test.
- `test_security.py` — 30 unit tests on password hashing and Razorpay signature verification. No DB, no app.
- `test_payment_flow.py` — 7 end-to-end tests on `POST /api/payments/verify`.
- `test_google_auth.py` — 11 tests on Google sign-in with Supabase stubbed.
- `test_admin_deletion.py` — 28 tests on permanent admin deletion, authorization, and the
  re-registration block.
- `test_superprofile_import.py` — 51 tests on the SuperProfile import: URL/SSRF rejection,
  parsing without invented values, sanitization, duplicates, and the apply modes.

`test_security.py`, `test_payment_flow.py`, `test_admin_deletion.py` and
`test_superprofile_import.py` encode fail-closed
security guarantees. Do not relax an assertion in them to make a change pass.

**Full stack**: `docker compose up` from the root — postgres on 5432, backend on 8000, frontend (nginx) on 80.

## Architecture: three overlapping data paths

This is the thing to internalize first. The frontend reads from **three different sources simultaneously**, and a page can render perfectly with the backend down:

1. **`frontend/src/lib/api.ts`** — REST client for the FastAPI backend (`VITE_API_URL`, default `http://localhost:8000/api`). **This is the canonical path.**
2. **`frontend/src/lib/supabase.ts`** — a Supabase client used for auth *and* direct table access, imported straight into `TopBar.tsx`, most of `pages/admin/*`, and the token-based `pages/public/{BookingStatus,Cancel,Reschedule}*.tsx`.
3. **`frontend/src/stores/bookingStore.ts`** — a Zustand store persisted to localStorage under `bookmymeet-platform-state-v4`. It **no longer ships seed data**: `admins`, `meetingTypes`, `scheduleBlocks` and `bookings` all start empty, and `currentSuperAdmin` is an identity-free placeholder filled in at sign-in. It is UI state, not a database.

**The public funnel is API-only.** `SuperProfileHomePage`, `TimeAvailabilityPage` and `PaymentCheckoutPage` render the host from `GET /api/profiles/public/{username}` alone. A username the backend does not know (never existed, or permanently deleted) renders a not-found screen — it must never fall back to a cached or seeded admin, because that used to resolve deleted admins to a live bookable page and, on checkout, to somebody else's Razorpay key.

**Consequence:** if a page shows nothing, the backend is the place to look. That is intended.

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

## Admin deletion, blocked identities, and the no-fake-data rule

**FastAPI is the canonical backend for all of this.** Deletion, the re-registration block and
the public-profile 404 are enforced server-side; the frontend only presents them.

**No fake data, ever.** `main.seed_initial_data()` creates exactly one thing: the Super Admin,
from `SUPER_ADMIN_*` env vars, and only when no super admin exists. No demo staff admins, no
sample sessions, no placeholder availability, no connection rows holding placeholder
credentials. `auth.provision_admin()` likewise seeds **no sessions**: it used to create three
priced at 149700 / 599400 / 1975000 paise -- amounts copied from a demo SuperProfile account,
active and sellable on the page of every admin who had never set a price. Tests that need a
session create their own. `frontend/src/stores/bookingStore.ts` ships no seeded admins, sessions or
bookings. Do not reintroduce any of it: a fake "connected" Razorpay or Google row is worse
than none, because availability now fails closed on a calendar it cannot read.
`backend/scripts/cleanup_demo_data.py` lists (and, with `--delete`, removes) demo/test
residue in an existing database; it targets exact addresses and test-account patterns only.

**Permanent deletion** — `DELETE /api/super-admin/admins/{id}?confirm=true`, implemented in
`backend/app/services/admin_deletion.py`. It is a real deletion, not a status flag:
`PUT /admins/{id}/status` deliberately no longer accepts `PERMANENTLY_DELETED`.

| Data | What happens |
| :--- | :--- |
| user, admin profile, session types, availability rules and exceptions, slot locks, notifications | deleted |
| Google Calendar connection (with its encrypted refresh token) | deleted |
| Razorpay connection (with its encrypted key secret) | deleted |
| bookings | kept, but anonymized: client name/email/phone/notes/Meet link/event id cleared, `admin_id` and `meeting_type_id` set NULL, active bookings marked `cancelled` |
| payments | kept as a financial record, `admin_id` set NULL |

Bookings and payments survive because a payment records money that actually moved through a
merchant account and the platform analytics sum over it — but nothing personally identifying
about the admin or their clients remains, and no foreign key points at a deleted row. That is
why `bookings.admin_id`, `bookings.meeting_type_id` and `payments.admin_id` are nullable
(migration `backend/migrations/001_admin_deletion.sql`).

The whole thing runs in one transaction and rolls back on any failure — a half-deleted admin
is never left behind. Deleting twice is a clean 404, not a corruption.

**Blocked identities** — `deleted_admin_identities` holds one row per deleted admin: an
HMAC-SHA256 digest of the normalized email (keyed with `SECRET_KEY`, so a database dump alone
cannot be tested against a candidate list), plus the freed username. It is not an account and
carries no profile data; it exists only to enforce two rules:

- **The email can never register again.** `auth.reject_blocked_identity()` is called by
  `POST /auth/signup`, `POST /auth/google` and `POST /auth/google/complete` *before* anything
  is created, returning 403 with "no longer eligible to register as an Admin". Matching is on
  `normalize_email()` (strip + lowercase), so casing and whitespace cannot slip past it.
- **The username can never be claimed again.** `check_username()` rejects retired usernames,
  so old inbound links to `/{username}` cannot start resolving to a different person.

Google sign-in for a deleted admin therefore never creates an account, never restores one,
and never reaches the username step — the check is on the backend, not in the UI.

**Super Admin safety.** `get_current_super_admin` re-reads the role from the database on every
request; a role sent by the client is never trusted. The delete endpoint additionally refuses
any target whose `role != "admin"` (403), and refuses the caller's own id (403). A normal
admin or client calling it gets 403; an unauthenticated caller gets 401.

## Profile persistence and the public URL

`backend/test_public_profile.py` (49 tests) guards the host's page, which is the thing they
actually share with clients.

- **The database is the only thing that persists, and it has to be a real one.** `DATABASE_URL`
  has no default. It used to fall back to `sqlite:///./bookmymeet.db`, a path relative to the
  process, so a container host with the variable unset ran the whole platform on a file inside
  the container: admins signed up, saved their profile, shared their link, and the next
  restart / redeploy / idle spin-down deleted the file. `seed_initial_data()` then re-created
  the super admin from the environment and nothing else, so every other admin's public URL
  answered a genuine 404 and the page correctly — and uselessly — said the booking page had
  been permanently removed. A missing `DATABASE_URL` is now a startup failure, the backend logs
  which backend it is using (scheme only, never the URL), and `GET /health` returns
  `database` and `persistent_storage` so a misconfigured deploy is visible from outside.
- **`PUT /profiles/me` merges `theme_settings` and `social_links` instead of replacing them.**
  The settings form sends `theme_settings` as only `{button_color, bg_gradient}`; a wholesale
  replace dropped `show_video`, `show_stats`, `show_socials`, `card_style` and
  `button_text_color`. A key the caller does send still wins, including `""`.
- **The public lookup is case-insensitive** (`func.lower(username)`), so `/Ameen` and `/ameen`
  reach the same host rather than one of them 404ing.
- **The profile photo upload has no local fallback.** A failed upload used to fall back to
  `FileReader`, putting a base64 `data:` URI into `photo_url`, which was then saved into the
  profile row as the photo. A failed upload now leaves the saved photo untouched and says so.

- **Uploaded media lives in Supabase Storage**, in a public bucket named `profile-media` that
  `supabase_storage.ensure_bucket()` creates on the first upload. `media_assets` holds the
  reference (`storage_path`, `public_url`), not the image; its `data` column is nullable and
  serves only rows written by the previous bytes-in-Postgres implementation. Two earlier
  locations both lost files and must not come back: `backend/uploads/` on the server's disk
  (wiped by every deploy, leaving `profile_photo` pointing at nothing) and bytes in Postgres.
  **There is deliberately no local-filesystem fallback** — without
  `SUPABASE_SERVICE_ROLE_KEY` the upload returns 503 and says so, because a fallback that
  works in development and loses files in production is worse than a refusal.
  `GET /api/media/{id}` redirects (307) to the object URL for stored objects and still serves
  bytes for legacy rows. `POST /api/upload` requires an admin (it accepted a file from
  anyone), caps at 8MB, and decides the file type from its **own magic bytes** — never the
  filename or Content-Type. SVG is rejected: it can carry script and these objects are public.
  Paths are `profile/{admin_id}/avatar/{uuid}{ext}`, built server-side, so an uploader's
  filename cannot influence them. `permanently_delete_admin` removes the rows and then the
  objects, after the transaction commits.
- Objects are cached `public, max-age=86400` rather than the year an immutable,
  content-addressed URL would justify: **deleting an object does not purge Supabase's CDN**,
  and a photo outliving a permanently deleted account by a year is not "permanently deleted".
  `scripts/check_supabase_storage.py` verifies a whole environment (create bucket, upload,
  read back publicly, delete) and prints no secrets.
- Schema change: `backend/migrations/003_media_storage.sql`, applied with
  `python scripts/apply_media_storage_migration.py` (handles PostgreSQL and SQLite, idempotent,
  deletes nothing). `create_all` cannot add columns to a table that already exists.
- **`GET /api/profiles/me` used `GoogleConnection` without importing it** and raised
  `NameError` -> 500 for every admin. Nothing tested it, so the suite stayed green. Settings
  swallowed that failure, fell back to a placeholder identity (`username: 'admin'`, every text
  field `''`), and `handleSave` posted the whole placeholder back — blanking the real name,
  bio, photo and video, and able to rename the slug to `admin`, which is what took the shared
  link down. **The Settings form now refuses to save until the row has actually loaded**, and
  the local store and localStorage are only written after the server confirms.
- **`''` is not the same as absent.** `PUT /profiles/me` skips `None` fields, so an omitted
  field is never a clear — but an empty string *is* a real value (an admin must be able to
  clear a bio). That makes "never submit a form built from unloaded state" the actual
  protection, not a backend heuristic. `username` is separately guarded: it can never be
  blanked or taken from another admin.
- **A failed request is not a missing profile.** `getPublicProfile` marks only a genuine 404
  as `notFound`; anything else (500, CORS, unreachable) renders "Couldn't load this page" with
  a retry, never "has been permanently removed by the platform administrator". Telling a
  client a live host is gone, because of one blip, loses that client for good.
- The public payload is a fixed `PublicAdminProfile` schema. `razorpay_key_id` is browser-safe
  and needed for checkout; no secret, email or phone is in it.

## Connection and price persistence

Three things an admin configures once must survive everything except an explicit action of
theirs. `backend/test_persistence.py` (44 tests) is the guard.

- **Only `POST /api/payments/admin/disconnect` and `POST /api/google/admin/disconnect` end a
  connection.** Nothing else in the codebase writes a `connection_status` other than
  `"connected"`. A failed payment, a forged signature, a gateway outage, a revoked Google
  grant, a re-login, a profile save and a backend restart all leave both rows exactly as they
  were.
- **Health is reported, never acted on.** Both status endpoints take `probe`: `connected` /
  `configured` comes from the row, `healthy` from a live read-only check
  (`check_razorpay_credentials` lists one payment; Google does a 5-minute FreeBusy). When they
  diverge, the UI shows "needs attention" and the admin updates the credentials themselves.
  Only a definitive 401/403 from Razorpay sets `needs_attention` -- a network error does not.
- **Disconnect keeps the row.** Razorpay's key id and encrypted secret are retained so an
  order created before the disconnect can still be verified; `create-order` refuses while
  `connection_status != "connected"` (503). Sessions, prices, bookings and profile data are
  untouched by either disconnect.
- **Prices change only through `POST`/`PUT /api/sessions`.** `PUT /profiles/me` writes a fixed
  allowlist of profile columns and cannot reach a price; `PUT /sessions/{id}` uses
  `exclude_unset`, so toggling `is_active` leaves `price` alone.
- **The frontend must never decide connectedness or price from cached state.** The failure
  mode this replaced: `getRazorpayStatus` returned `{configured: false}` on any HTTP error, so
  a blip read as "not connected"; `SettingsPage` and `MeetingTypesPage` fell back to the
  persisted zustand store / the Supabase `meeting_types` table when the API call failed, and
  saving then wrote those stale prices over the real ones; and both pages swallowed save
  errors with `.catch(() => {})`, so a rejected price save looked like the price had reset
  itself. All three are gone -- the API is the only source, and load and save failures are
  shown.

## Import from SuperProfile

`Settings -> Profile Customization -> Import from SuperProfile`, backed by
`backend/app/api/profile_imports.py` + `backend/app/services/superprofile_import.py`.

**Two steps, never one.** `POST /api/profile-import/preview` fetches and parses the public
page into a `profile_imports` row and returns it; `POST /api/profile-import/apply` writes the
parts the admin ticked. Parsing never touches `admin_profiles` or `sessions` — that is what
makes the feature safe to run against a live booking page. `GET /{import_id}` and
`POST /{import_id}/cancel` are owner-scoped (404, not 403, for another admin's import id).

**Never invent a value.** A field the page does not expose parses as `None` and imports as
nothing. The predecessor (`scraper_service.py`, now deleted) substituted `price = 199900`
whenever no price was found and injected hardcoded social links for URLs containing
"mahir"/"ameen"; `test_superprofile_import.py` guards against that returning. A session with
no publicly displayed price is created **inactive**, so nothing can be sold at a price nobody
set.

**Never imported, whatever the page contains:** the admin's `username` (their public URL
stays `/{their-username}`), Razorpay keys or secrets, and Google OAuth tokens or calendar
ids. Imported sessions are sold through this admin's own connected Razorpay account and
scheduled on their own calendar.

**Fetch safety** (`fetch_public_page`): https only; host must be exactly `superprofile.bio`
or `www.superprofile.bio` (an exact hostname match — the old substring check passed
`evil.com/?q=superprofile.bio`); every hostname is DNS-resolved and rejected if any address
is private, loopback, link-local, reserved or multicast; redirects are not followed
automatically but re-validated per hop (max 3); 10s timeout; body streamed and aborted past
2 MB; `Content-Type` must be `text/html`. Previews are rate limited per admin (10 per 10
minutes, in-process). All imported text passes through `clean_text()`, which strips markup —
no HTML is stored, so nothing can be rendered as HTML later.

**Images are preview-only** until the admin ticks "I have permission to reuse this image".
Only then does the server download it (SSRF-guarded, `image/*`, ≤5 MB) into
`backend/uploads/photos/` and store the local URL. Third-party images are never hotlinked.

**Blocked pages are a first-class outcome, not an error string.** `fetch_public_page` raises
`SuperProfileBlockedError` for 401/403/429/503 *and* for a 200 whose body matches
`CHALLENGE_MARKERS` (Vercel's checkpoint, Cloudflare's, a CAPTCHA wall) — a challenge served
with a 200 would otherwise be parsed and misreported as "no importable content". The API turns
it into a structured `502` body, `{"status": "blocked", "reason": "automated_access_blocked",
"fallback": "html_paste", "message": …}`, which is the only detail that is an object rather
than a sentence. The modal has a dedicated calm screen for it: "SuperProfile blocked automated
access", with **Try URL again** and **Advanced: paste page HTML**. URL import is always the
front door; the paste textarea and the desktop Inspect/outerHTML steps are two levels down and
never shown by default. Never make the paste flow primary, and never add a browser
User-Agent retry or any other challenge workaround.

**Known limitation — superprofile.bio declines our fetches.** The importer identifies itself
honestly as `BookMyMeet-ProfileImporter/1.0`, and superprofile.bio answers **429** to it
while serving 200 to a browser User-Agent. Spoofing a browser would be working around an
anti-bot control, so the importer does not do it. The supported route is the `page_html`
field: the page's owner opens their own page, copies the source, and pastes it in — same
parser, same sanitizer, no outbound request, URL still validated. **Consequence: the parser
is verified against `__NEXT_DATA__`-shaped fixtures in `test_superprofile_import.py`, not
against a live fetch of superprofile.bio.** Do not claim otherwise without re-testing.

## Frontend map (`frontend/src/`)

- **Routing** — `App.tsx`, one flat `<Routes>`, no lazy loading. Several aliases point at the same three funnel pages (`/book/:username/schedule/:meetingId`, `/:username/schedule/:meetingId`, `/schedule/:meetingId` all render `TimeAvailabilityPage`). `/:username` is a catch-all that must stay last. Admin pages sit under a pathless `<Route element={<AdminLayout/>}>`.
- **Stores** — only two. `authStore.ts` (no persist; hydrates synchronously from localStorage, then races `supabase.auth.getSession()` against a 600ms timeout) and `bookingStore.ts` (persist, whole state, no `partialize`). There is no separate admin or super-admin store — super-admin state is `currentSuperAdmin` inside `bookingStore`.
- **Raw localStorage keys** used outside persist: `bmm_auth_token`, `bmm_current_user_role`, `bmm_logged_admin_id`, `bmm_logged_username`, `bmm_logged_admin_name`, `bmm_logged_role`, `bmm_auth_user`.
- **Intro video** — `src/lib/video.ts` is the single normalizer (`getVideoEmbedUrl`), used by
  `SuperProfileHomePage`, `TimeAvailabilityPage` and the Settings preview so all three render
  the same stored URL identically. It maps YouTube to `youtube-nocookie.com/embed/{id}` with
  `rel=0&modestbranding=1` and Vimeo to `player.vimeo.com/video/{id}` with title/byline/portrait
  off, and returns `null` for anything else (rendered in a plain `<video>`). **Our UI adds no
  provider branding**: no YouTube/Vimeo logo, icon, badge or name in the video card, and the
  label is the generic `INTRO_VIDEO_LABEL` / `INTRO_VIDEO_ARIA_LABEL`. Whatever each provider
  draws inside its own iframe is theirs and is left alone. The video is embedded by reference
  only — never downloaded, re-hosted, or turned into a thumbnail (a video thumbnail must never
  become a profile photo).
- **Tailwind v4**, wired as a Vite plugin. **There is no `tailwind.config.js` and no `postcss.config.js` — that is correct for v4; do not create them.** All theme config is CSS-first in the `@theme` block of `src/index.css` (the `--color-primary-*` ramp, sidebar and surface tokens).
- **UI components** in `components/ui/` follow the shadcn idiom (`cn()` = clsx + tailwind-merge, `class-variance-authority`) but were added by hand. There is no `components.json`, so the shadcn CLI will not work here.
- **No path proxy** in `vite.config.ts` — the frontend calls `localhost:8000` cross-origin and depends on the backend's CORS headers.

## Gotchas

Each of these costs a debugging cycle if rediscovered.

**Install / build**
- `@tanstack/react-query` and `@tanstack/react-table` are installed but never imported. Don't assume react-query is the data layer — it isn't; `api.ts` is plain `fetch`.

**Database**
- **There is no migration framework.** Schema comes from `Base.metadata.create_all`, which only ever *adds* missing tables — a new table appears by itself, an altered column does not. Column changes ship as hand-written SQL under `backend/migrations/`, applied with `python scripts/apply_migration.py` (`--check` to report only; handles both PostgreSQL and SQLite).
- `seed_initial_data()` catches, logs and rolls back without re-raising, so a bootstrap failure lets the app boot without a super admin.

**Tests**
- They run against the real dev `bookmymeet.db`, not a fixture DB, but every suite now creates and removes its own rows, so order does not matter and nothing is left behind. Keep it that way: a test that depends on data another test left behind will pass on your machine and fail on a fresh database.

**Payments — fail-closed rules (do not regress these)**
- `verify_razorpay_signature` is HMAC-only: Razorpay's documented `HMAC-SHA256(order_id|payment_id)` keyed with **that admin's own** secret, compared via `hmac.compare_digest`. It has no simulation bypass and no path returning `True` without a matching HMAC. Never reintroduce one keyed on a client-supplied string.
- Whether an order was simulated is read from `Payment.provider` (`razorpay_simulated`), written server-side at creation. Never infer it from the order id.
- `/verify` binds `req.razorpay_order_id` to the stored `Payment.order_id` before checking the signature — otherwise a genuine triple from any other merchant account would verify.
- Simulation requires `PAYMENTS_ALLOW_SIMULATION=true` (default false). Simulated bookings settle to `payment_status="simulated"`, never `"completed"`, so they aren't counted as revenue.
- There is no platform-wide Razorpay credential by design. An admin with no connected account gets 503 from `/create-order`; gateway failures raise (502) rather than degrading into a fake order.
- `decrypt_secret` raises `SecretDecryptionError` rather than returning ciphertext. In `/verify` that maps to 500 ("configuration error"), never 400 — a key-management fault must not be reported as a customer's bad signature.
- `verify_password` fails closed on any exception; there is deliberately no plaintext fallback.

**Still-simulated (lower stakes, but be aware)**
- `google_calendar.py` returns `"simulated-access-token"` when Google creds are absent — the FreeBusy path treats that as unavailable and fails closed, so availability is hidden rather than shown as free.
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

**Fixed since (do not reintroduce)**
- `SuperAdminLoginPage` used to authenticate nobody: it waited 400 ms, wrote `bmm_current_user_role='super_admin'` to localStorage and opened the dashboard, with the owner's credentials pre-filled. It now signs in through `POST /api/auth/login` and verifies the returned role.
- `AdminLoginPage` had a client-side password fallback against the store's plaintext passwords; `SignupPage` created a browser-only "account" whenever the API was unreachable. Both are gone.
- `api.scrapeSuperProfile` returned a fabricated profile (name, photo, priced sessions) when the backend was down and the URL mentioned the seeded owner; `RescheduleBookingPage` generated availability from a fixed hour list. Both now use the real endpoints.

**Credentials in the tree** — `.env` is now gitignored at the root and in `frontend/`, so `backend/.env` and `frontend/.env` will not be picked up by a future `git init` + `git add .`. Still uncovered, because they are tracked source rather than env files: `docker-compose.yml` carries inline default `postgres123` / `JWT_SECRET` / `ENCRYPTION_KEY` values, and the super-admin username/email defaults sit in `config.py` (the password has no default and fails startup if unset). The demo staff-admin seed and the plaintext passwords that used to live in `bookingStore.ts` are gone. Replace the compose defaults with env lookups before any real deployment.

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
