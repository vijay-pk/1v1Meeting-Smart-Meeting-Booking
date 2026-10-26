# Student recordings: simulation vs. real Google Meet retrieval

This document separates what is **simulated** (built and tested, no Google involved) from what is
**verified against Google** (nothing yet) and lists the exact external requirements for real
automatic recording.

## Status at a glance

| Area | Status |
| --- | --- |
| Recording states (Pending, Processing, Available, Failed) and transitions | Simulated, tested |
| `My Recordings` page, status badges, refresh, TEST labelling | Built, tested against simulated data |
| Student-specific access control (a student sees only their own recordings) | Real code path, tested |
| "Recording ready" email: send-once, retry on failure, no email unless available | Real code path, tested with a stubbed sender |
| Simulated entries never emailed, never playable, hidden when simulation is off | Real code path, tested |
| Google Meet `autoRecordingGeneration`, `conferenceRecords`, Drive retrieval | **Not implemented, not verified** |
| OAuth scopes for recording | **Not requested, not changed** |

No Google API call related to recording has been made by this code. Nothing in this change
touches production accounts, OAuth settings, Calendar, Meet link creation, Razorpay or Resend.

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

## Requirements for REAL automatic recording (not done, needs approval)

These are not changed by this work and must be approved before any production change:

1. **A Google account that can record.** Meet recording is not offered on free personal accounts;
   it needs Google Workspace with recording enabled for the host. Organization policy and Drive
   storage must allow it. The app's host account is currently an individual Google account
   (OAuth, per-admin `GoogleConnection`); eligibility has **not** been confirmed.
2. **Space configuration.** Per the request, each student meeting's Meet space would be configured
   with `artifactConfig.recordingConfig.autoRecordingGeneration = ON` through the Meet REST API.
   This has **not** been called or verified. It also needs the host (or a co-host) to join for
   recording to start.
3. **OAuth scopes** (not requested today; current scopes are `calendar.events`,
   `calendar.readonly`, `userinfo.email`, `meetings.space.created`):
   `meetings.space.settings`, `meetings.space.readonly` and, to fetch the file,
   `drive.readonly`. The host must re-consent once.
4. **Consent.** The booking page now states that sessions may be recorded and that recordings
   are visible only to the student. Legal consent wording is for the owner to review.

## Swapping the simulation for the real thing

The seam is `services/recording_providers.py`:

- `RecordingProvider.fetch(db, row) -> RecordingResult` is the only thing that changes.
- `GoogleMeetProvider` is a stub that makes no network calls and never invents an `available`
  state. Implement `fetch` with Meet v2 `conferenceRecords.list` (filtered by the stored
  `booking.google_meet_space_id`) and `conferenceRecords.recordings.list`, store the Drive file
  id, and map Google's recording states to `processing` / `available` / `unavailable`.
- `process_due_recordings(db)` is the worker entry point; it does nothing until
  `RECORDING_RETRIEVAL_ENABLED` is on. Start it from the lifespan or a cron endpoint using the
  same pattern as the reminder and termination workers (server-side, never a browser timer).
- Implement playback in `GET /student/recordings/{booking_id}/play` by streaming through the
  backend or a short-lived signed URL. It currently returns `501` for a real available entry.
- `process_recording` already applies state transitions and calls `notify_if_ready`, so the
  email behaviour above carries over unchanged.

## Tests

`backend/test_recording_simulation.py` covers the guard (flag off, non-local `APP_URL`, real
retrieval on), Super Admin only access, refusal to touch real students or real recordings, the
full state cycle, student isolation (list and `/play`), TEST labelling, hidden-when-off,
the no-email-for-simulated rule, send-once, `.test` address suppression, retry after a failed
send, and that seeded bookings are ignored by the reminder and termination workers.
