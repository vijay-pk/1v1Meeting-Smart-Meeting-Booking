"""
/api/sections: an admin's custom booking-page sections.

GET returns the admin's own sections (published or not, with ids for the editor); PUT replaces the
whole list in one transaction. Both act only on the signed-in admin's rows. The public page does not
call these: it receives the published subset inside GET /api/profiles/public/{username}.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.models import User
from app.services import profile_sections

router = APIRouter()


class SectionItemIn(BaseModel):
    id: Optional[str] = None
    customer_name: Optional[str] = None
    designation: Optional[str] = None
    text: Optional[str] = None
    badge: Optional[str] = None
    image_asset_id: Optional[str] = None
    image_alt: Optional[str] = None
    video_url: Optional[str] = None
    is_published: bool = True


class SectionIn(BaseModel):
    id: Optional[str] = None
    kind: str = "info"
    title: Optional[str] = None
    badge: Optional[str] = None
    description: Optional[str] = None
    button_text: Optional[str] = None
    button_url: Optional[str] = None
    image_asset_id: Optional[str] = None
    image_alt: Optional[str] = None
    video_url: Optional[str] = None
    is_published: bool = True
    items: List[SectionItemIn] = []


class SectionsPayload(BaseModel):
    sections: List[SectionIn] = []


@router.get("")
def list_my_sections(current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return {"sections": profile_sections.serialize(db, current_admin.id, published_only=False)}


@router.put("")
def save_my_sections(
    payload: SectionsPayload,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return {"sections": profile_sections.replace_sections(db, current_admin.id, payload)}
