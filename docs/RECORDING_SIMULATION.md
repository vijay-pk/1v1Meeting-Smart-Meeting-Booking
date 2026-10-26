# Student recordings: simulation vs. real Google Meet retrieval

This document separates what is **simulated** (built and tested, no Google involved), what is
**implemented against Google's documentation but not verified** (real retrieval), and what has
been **verified against Google** (nothing yet). It also lists the external steps only the account
owner can take.

## Status at a glance

| Area | Status |
| --- | --- |
| Recording states (Pending, Processing, Available, Failed) and transitions | Simulated, tested |
| `My Recordings` page, status badges, refresh, TEST labelling | Built, tested against simulated data |
| Student-specific access control (a student sees only their own recordings) | Real code path, tested |
| "Recording ready" email: send-once, retry on failure, no email unless available | Real code path, tested with a stubbed sender |
| Simulated entries never emailed, never playable, hidden when simulation is off | Real code path, tested |
| Meet `autoRecordingGeneration` on student spaces, with fallback | **Implemented from docs, mock-tested, not verified against Google** |
| Meet `conferenceRecords` / `recordings` lookup and state mapping | **Implemented from docs, mock-tested, not verified against Google** |
| Drive playback streamed through the backend with signed links | **Implemented from docs, mock-tested, not verified against Google** |
| Recording scopes in the Super Admin consent screen | **Implemented, off by default** (`RECORDING_SCOPES_ENABLED`) |
| Anything run against a live Google / Workspace account | **Not done** |

All of the real path is inert until its flags are turned on (see "Turning on real recording").
Nothing here changes production accounts, OAuth settings, DNS, Razorpay or Resend, and booking
behaviour is unchanged while the flags are off. The mock tests (`backend/test_real_recording.py`)
prove how our code handles the responses Google's documentation describes; they do not prove that
Google behaves that way for your account.

## The production guard

Simulation exists only for development, and the backend enforces that on every request
(`services/recording_sim.py: simulation_allowed()`). All three must hold:

1. `RECORDING_SIMULATION_ENABLED` is set (env, **default off**).
2. `APP_URL` points at `localhost`, `127.0.0.1`, `*.localhost` or `*.test`.
3. `RECORDING_RETRIEVAL_ENABLED` is **off**, so simulated and real rows are never mixed.

When any condition fails, every simulation endpoint answers `404`, and simulated rows are
removed from `GET /api/student/recordings` and the Super Admin list. A production deployment
(`APP_URL=https://meet.adwaysacademy.com`) therefore refuses simulation even if the flag is
set by mistake; startup logs an error in that case.

## How simulated entries are marked (no schema change)

- The space id starts with `spaces/SIMULATED-` (a real Meet id is a short alphanumeric code).
- The title starts with `[TEST] `, and `drive_file_id` is always empty. There is no video.
- The booking reference starts with `SIM-`; the student is `sim-<hex>@bookmymeet.test`, a
  reserved `.test` address that cannot receive mail.
- The API returns `simulated: true`, `test_label` and `playable: false`; the page shows a
  "TEST . simulated, no video" badge. `GET .../play` for a TEST entry returns
  `{simulated: true, playable: false, message}` and never a URL.

## Notification rule

`recording_providers.notify_if_ready` sends the email only when:

- the status is `available`, and
- the entry is not simulated, and the student's address is not a `.test` address.

Sending is claimed with a conditional `UPDATE email_sent_at ... WHERE email_sent_at IS NULL`, so
repeated calls and concurrent workers send exactly one email. A failed send releases the claim
so it can be retried. The email links to the authenticated dashboard (`/student/recordings`),
never to a Drive file.

## Using the simulation locally

Set `RECORDING_SIMULATION_ENABLED=true` with a local `APP_URL`, sign in as the Super Admin and
call (bearer token required):

```bash
# Create a TEST student, a past TEST booking and a pending TEST recording
curl -X POST http://localhost:8000/api/super-admin/dev/recording-sim/seed -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'

# Move it: pending -> processing -> available | unavailable (Failed)
curl -X POST http://localhost:8000/api/super-admin/dev/recording-sim/$BOOKING_ID/advance -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"processing"}'

# Remove the TEST booking and recording
curl -X DELETE http://localhost:8000/api/super-admin/dev/recording-sim/$BOOKING_ID -H "Authorization: Bearer $TOKEN"
```

The seeded student signs in with the standard temporary password and goes through the normal
first-login password change. Delete the TEST student from the Students section when finished.

Allowed transitions: `pending -> processing | unavailable`, `processing -> available | unavailable`,
`available -> unavailable`, `unavailable -> pending`. Anything else returns `400`.

## Turning on real recording (the account owner does steps 1 to 3)

The code is in place and switched off. Nothing below has been run against Google. Do these in
order, and treat the first live meeting as the verification:

1. **Use a Google account that can record.** Meet recording is not offered on free personal
   accounts; it needs Google Workspace with Meet recording enabled for the host, and Drive storage
   and organisation policy that allow it. The app's host account today is an individual Google
   account, so this is a real prerequisite. The host (or a co-host) must also join the meeting for
   recording to start. Eligibility has **not** been confirmed.
2. **Approve the scopes.** Set `RECORDING_SCOPES_ENABLED=true` on the backend. The Super Admin
   (only) is then asked for `meetings.space.settings`, `meetings.space.readonly` and a Drive
   read scope the next time they connect Google. Regular admins' consent screens do not change.
   The Super Admin must **disconnect and reconnect Google** once and approve; existing scopes are
   kept (`include_granted_scopes=true`). The Drive scope defaults to
   `https://www.googleapis.com/auth/drive.meet.readonly` (`RECORDING_DRIVE_SCOPE`); confirm that
   exact name exists in the Google Cloud console and fall back to
   `https://www.googleapis.com/auth/drive.readonly` if it does not.
3. **Google Cloud verification.** `meetings.space.*` are sensitive scopes and Drive read scopes
   are restricted. While the OAuth app is in *Testing* with the host account added as a test user,
   no verification is needed. Publishing the app for other users would require Google's
   verification (and, for restricted scopes, a security assessment).
4. **Turn on retrieval.** Set `RECORDING_RETRIEVAL_ENABLED=true` (optionally
   `RECORDING_POLL_SECONDS`, default 120). From then on every new student booking asks Google to
   auto-record its Meet space, and the in-process worker polls for finished recordings. If the
   server sleeps when idle, also call `POST /api/internal/recordings/run` with `X-Cron-Secret`
   from a scheduler, as for reminders. Use `RECORDING_RETRIEVAL_ENABLED=false` to stop it again.

Retrieval and simulation are mutually exclusive: turning retrieval on disables the simulation
endpoints, so a TEST entry can never sit beside a real one.

## What the real path does (implemented from Google's documentation, not verified)

- **Booking time.** For `student_free` and `student_paid` bookings only, while retrieval is on,
  the Meet space is created with `config.artifactConfig.recordingConfig.autoRecordingGeneration
  = "ON"`. If Google rejects it, the space is created again without it so the booking and Meet
  link still work, and the recording row is marked `unsupported` with "Auto-recording could not be
  enabled for this meeting." If Google echoes the setting back as anything other than `ON`, that
  is believed. Regular client bookings never send the setting.
- **After the meeting.** The poll (`services/recording_providers.py: process_due_recordings`)
  only asks about bookings whose scheduled end has passed. `services/recording_google.py: lookup`
  calls Meet v2 `conferenceRecords.list` filtered by the stored space, then each record's
  `recordings.list`:

  | Google reports | We store |
  | --- | --- |
  | a recording in `FILE_GENERATED` with a Drive file | `available` + the Drive file id |
  | `STARTED`, `ENDED`, or `FILE_GENERATED` without a file | `processing` |
  | conference in progress, or ended under 15 minutes ago with no recording | `pending` |
  | ended 15+ minutes ago and no recording | `unavailable` ("recording may not have started") |
  | no conference 20+ minutes after the booked end | `unavailable` ("no meeting took place") |
  | 401 / 403 | status unchanged, detail "Google permission is missing..." |
  | 429, 5xx, timeout | nothing changes; retried on the next poll |

  Real rows may skip a step or recover (`services/recording_providers.py: REAL_TRANSITIONS`);
  simulated rows keep the strict table.
- **Notification.** When a real recording becomes `available`, the existing send-once email goes
  to the student with a link to their dashboard, never a Drive link.
- **Playback.** `GET /student/recordings/{id}/play` (login required, owner only) returns a signed
  link valid for one hour. `GET /student/recordings/{id}/stream?t=...` (`api/student_recordings.py`)
  re-checks the token, the student's active status, ownership, availability and the host's Google
  connection on every request, then streams the Drive file with the host's token, passing `Range`
  through so seeking works. No Google token or Drive URL is ever returned, every refusal is the
  same 404, and responses are `Cache-Control: private, no-store`. The signed token travels in the
  query string (a `<video>` tag cannot send a header), so it is time-limited and tied to one
  student and one booking.

## Known gaps and risks

- None of it has run against Google. Field names (`driveDestination.file`, recording states,
  `config.artifactConfig.recordingConfig`) follow Google's published reference and may need
  adjusting on first contact; the mock tests will not reveal that.
- A recording can only exist if the host actually joins and Google starts it. A booking where
  nobody joins ends as `unavailable` after the wait above, which is the honest outcome.
- Recordings live in the host's Drive. If the file is deleted there, the row stays `available`
  (only `pending` and `processing` rows are polled) and playback returns "no recording is
  available" when Drive answers 404. Nothing deletes recordings automatically.
- Super Admin has a recordings list per student but no playback link of their own yet.
- Consent wording on the booking page is a plain disclosure, not legal advice.

## Tests

`backend/test_real_recording.py` (mocked Google, no network) covers: lookup state mapping,
permission and temporary-error handling, signed token expiry/tampering/wrong-student, scopes only
for the Super Admin and only when flagged, the auto-record request and its fallback, booking
wiring (student only, only when retrieval is on), real and simulated transitions, the poll
(ended-only, not-connected, publish + email once, retry later, permission detail), the cron
endpoint, and the private stream (Range passthrough, header whitelist, owner-only, simulated and
non-available refusal, Drive failure mapping).

`backend/test_recording_simulation.py` covers the guard (flag off, non-local `APP_URL`, real
retrieval on), Super Admin only access, refusal to touch real students or real recordings, the
full state cycle, student isolation (list and `/play`), TEST labelling, hidden-when-off,
the no-email-for-simulated rule, send-once, `.test` address suppression, retry after a failed
send, and that seeded bookings are ignored by the reminder and termination workers.
