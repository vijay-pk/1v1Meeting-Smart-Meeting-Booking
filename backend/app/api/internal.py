"""
Endpoints for schedulers, not people.

POST /api/internal/reminders/run runs one reminder pass. It exists for hosts that sleep when
idle, where the in-process worker is not running: an external cron calls it every minute.
It is refused unless CRON_SECRET is configured and sent back in X-Cron-Secret, so it cannot be
used to trigger work anonymously. Running it more often than needed is harmless -- reminders
are claimed atomically and never sent twice.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.services.reminders import run_due_reminders

router = APIRouter()


@router.post("/reminders/run")
async def run_reminders(
    x_cron_secret: str = Header(default=""),
    db: Session = Depends(get_db),
):
    if not settings.CRON_SECRET:
        raise HTTPException(status_code=404, detail="Not found")
    if not hmac.compare_digest(x_cron_secret.encode(), settings.CRON_SECRET.encode()):
        raise HTTPException(status_code=403, detail="Forbidden")
    return await run_due_reminders(db)
