"""
Private playback of a student's recording, streamed through the backend.

A <video> element cannot send an Authorization header, so GET /student/recordings/{id}/play (which
needs the student's login) returns a short-lived HMAC-signed link to this endpoint. The link
carries no Google credential and no Drive URL: this handler re-checks everything against the
database on every request (the token's student still owns this booking, the recording is
available and real, the host's Google connection exists) and then proxies the Drive file with the
HOST's token, passing the browser's Range header through so seeking works.

Every refusal is the same 404, so a student cannot learn whether someone else's recording exists.
NOT verified against a live Google account; see docs/RECORDING_SIMULATION.md.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Booking, GoogleConnection, MeetingRecording, User
from app.services import recording_google
from app.services.google_calendar import refresh_google_token
from app.services.recording_sim import is_simulated

logger = logging.getLogger(__name__)
router = APIRouter()

NOT_AVAILABLE = "No recording is available for this meeting."
# Upstream headers worth forwarding so the browser can size and seek the video.
PASS_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")


@router.get("/recordings/{booking_id}/stream")
async def stream_recording(
    booking_id: str,
    t: str = Query("", description="Signed stream token from /play"),
    range_header: Optional[str] = Header(default=None, alias="Range"),
    db: Session = Depends(get_db),
):
    student_id = recording_google.verify_stream_token(t, booking_id)
    if not student_id:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)

    # The token proves who it was issued to; the account must still be a live student.
    student = db.query(User).filter(User.id == student_id, User.role == "student", User.status == "ACTIVE").first()
    if student is None or student.must_change_password:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)

    row = (
        db.query(MeetingRecording)
        .join(Booking, Booking.id == MeetingRecording.booking_id)
        .filter(MeetingRecording.booking_id == booking_id, Booking.student_id == student.id)
        .first()
    )
    if row is None or row.status != "available" or is_simulated(row) or not row.drive_file_id:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)

    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    conn = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == booking.admin_id, GoogleConnection.connection_status == "connected")
        .first()
    ) if booking else None
    if conn is None or not conn.encrypted_refresh_token:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)

    try:
        access_token = await refresh_google_token(conn.encrypted_refresh_token)
        client, upstream = await recording_google.open_drive_media(access_token, row.drive_file_id, range_header)
    except recording_google.RecordingTemporaryError as exc:
        logger.warning("Recording stream for %s: temporary failure (%s)", booking_id, exc)
        raise HTTPException(status_code=502, detail="The recording could not be read right now. Please try again.")
    except Exception:  # noqa: BLE001 -- never leak a Google error body to the student
        logger.exception("Recording stream for %s failed to start", booking_id)
        raise HTTPException(status_code=502, detail="The recording could not be read right now. Please try again.")

    if upstream.status_code not in (200, 206):
        status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        if status == 416:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable.")
        if status == 404:
            raise HTTPException(status_code=404, detail=NOT_AVAILABLE)
        logger.warning("Drive returned HTTP %s for recording %s", status, booking_id)
        raise HTTPException(status_code=502, detail="The recording could not be read right now. Please try again.")

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    headers = {k: v for k, v in upstream.headers.items() if k.lower() in PASS_HEADERS}
    headers["Cache-Control"] = "private, no-store"
    headers["Referrer-Policy"] = "no-referrer"
    headers["X-Content-Type-Options"] = "nosniff"
    return StreamingResponse(body(), status_code=upstream.status_code, headers=headers)
