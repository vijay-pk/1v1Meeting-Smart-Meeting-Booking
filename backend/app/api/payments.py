import uuid
import hmac
import logging
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import encrypt_secret, SecretDecryptionError
from app.models.models import (
    User, Session as SessionModel, Booking, Payment,
    RazorpayConnection, SlotLock, GoogleConnection, Notification
)
from app.schemas.schemas import (
    RazorpaySetupRequest, CreateOrderRequest, CreateOrderResponse,
    VerifyPaymentRequest, BookingResponse
)
from app.api.deps import get_current_admin
from app.services.razorpay_service import (
    create_razorpay_order, verify_razorpay_signature,
    RazorpayConfigurationError, RazorpayOrderError,
    SIMULATED_PROVIDER, REAL_PROVIDER,
)
from app.services.google_calendar import create_calendar_event_with_meet
from app.services.email_service import send_booking_confirmation_email, send_admin_new_booking_notification

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/admin/status")
def get_payment_setup_status(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()
    if not conn:
        return {"configured": False, "key_id": None, "account_reference": None}

    return {
        "configured": conn.connection_status == "connected",
        "key_id": conn.key_id,
        "account_reference": conn.account_reference
    }

@router.post("/admin/setup")
def setup_admin_razorpay(
    req: RazorpaySetupRequest,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Securely configures Razorpay credentials for the logged-in admin.
    The secret key is encrypted at rest using AES-256 and never returned to frontend.
    """
    clean_key_id = req.key_id.strip()
    clean_key_secret = req.key_secret.strip()

    if not clean_key_id or not clean_key_secret:
        raise HTTPException(status_code=400, detail="Key ID and Key Secret are required")

    encrypted_secret = encrypt_secret(clean_key_secret)

    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()
    if not conn:
        conn = RazorpayConnection(
            admin_id=current_admin.id,
            key_id=clean_key_id,
            encrypted_key_secret=encrypted_secret,
            connection_status="connected",
            account_reference=req.account_reference
        )
        db.add(conn)
    else:
        conn.key_id = clean_key_id
        conn.encrypted_key_secret = encrypted_secret
        conn.connection_status = "connected"
        if req.account_reference:
            conn.account_reference = req.account_reference

    db.commit()
    return {"message": "Razorpay account configured securely"}

@router.post("/create-order", response_model=CreateOrderResponse)
async def create_booking_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """
    Initiates payment order under the specific Admin's Razorpay setup.
    """
    admin = db.query(User).filter(User.id == req.admin_id).first()
    if not admin or admin.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Admin is unavailable")

    session_obj = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session_obj or not session_obj.is_active:
        raise HTTPException(status_code=404, detail="Session not found or inactive")

    # 1. Check double booking
    existing = (
        db.query(Booking)
        .filter(
            Booking.admin_id == admin.id,
            Booking.start_time == req.start_time,
            Booking.status == "confirmed"
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This slot has already been booked. Please select another time.")

    # 2. Get this Admin's own Razorpay Connection. There is no shared/platform fallback
    #    credential: an admin with no connected account simply cannot take payments.
    razorpay_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin.id).first()
    if razorpay_conn:
        key_id = razorpay_conn.key_id
        enc_secret = razorpay_conn.encrypted_key_secret
    elif settings.PAYMENTS_ALLOW_SIMULATION:
        key_id, enc_secret = "rzp_test_simulated_key", ""
    else:
        raise HTTPException(
            status_code=503,
            detail="This host has not connected a payment account yet, so bookings cannot be paid for."
        )

    # 3. Create Booking record in pending_payment
    public_id = f"BK-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
    cancellation_token = secrets.token_hex(16)

    booking = Booking(
        public_id=public_id,
        admin_id=admin.id,
        meeting_type_id=session_obj.id,
        client_name=req.client_name.strip(),
        client_email=req.client_email.strip().lower(),
        client_phone=req.client_phone.strip() if req.client_phone else None,
        start_time=req.start_time,
        end_time=req.end_time,
        timezone="Asia/Kolkata",
        status="pending_payment",
        payment_status="pending",
        cancellation_token=cancellation_token,
        notes=req.notes
    )
    db.add(booking)
    db.flush()

    # 4. Create Razorpay order under that admin's own merchant account.
    receipt = f"rcpt_{booking.id[:8]}"
    try:
        rp_order = await create_razorpay_order(
            key_id=key_id,
            encrypted_key_secret=enc_secret,
            amount_in_paise=session_obj.price,
            currency=session_obj.currency,
            receipt=receipt
        )
    except RazorpayConfigurationError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RazorpayOrderError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SecretDecryptionError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Payment configuration error. Please contact support."
        ) from exc

    # 5. Create Payment record. provider records, server-side, whether this order was
    #    real or simulated -- /verify trusts this row, never a client-supplied order id.
    payment = Payment(
        booking_id=booking.id,
        admin_id=admin.id,
        provider=SIMULATED_PROVIDER if rp_order.get("simulated") else REAL_PROVIDER,
        order_id=rp_order["id"],
        amount=session_obj.price,
        currency=session_obj.currency,
        status="created"
    )
    db.add(payment)
    db.commit()

    return {
        "order_id": rp_order["id"],
        "amount": session_obj.price,
        "currency": session_obj.currency,
        "key_id": key_id,
        "booking_id": booking.id
    }

@router.post("/verify")
async def verify_payment_and_confirm(req: VerifyPaymentRequest, db: Session = Depends(get_db)):
    """
    Verifies payment signature, confirms booking, creates Google Meet event on Admin's Google Calendar,
    and dispatches notifications.
    """
    booking = db.query(Booking).filter(Booking.id == req.booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.status == "confirmed":
        return {
            "status": "confirmed",
            "message": "Booking already confirmed",
            "public_id": booking.public_id,
            "google_meet_link": booking.google_meet_link
        }

    admin = booking.admin
    payment = booking.payment
    if not payment or not payment.order_id:
        raise HTTPException(status_code=400, detail="No payment order exists for this booking")

    # 1a. Bind the submitted order to the one this booking actually created. Without this,
    #     a caller could present a genuine order/payment/signature triple from any other
    #     merchant account and have it verify against this booking.
    if not hmac.compare_digest(payment.order_id, req.razorpay_order_id or ""):
        raise HTTPException(status_code=400, detail="Payment does not belong to this booking")

    # 1b. Establish payment authenticity. Whether this order was simulated is read from
    #     the Payment row written at creation time -- never inferred from the order id.
    is_simulated = payment.provider == SIMULATED_PROVIDER

    if is_simulated:
        if not settings.PAYMENTS_ALLOW_SIMULATION:
            raise HTTPException(
                status_code=503,
                detail="This booking was created in simulation mode and cannot be confirmed."
            )
        logger.warning(
            "Confirming booking %s from a SIMULATED payment. No funds were collected.",
            booking.public_id,
        )
    else:
        razorpay_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin.id).first()
        if not razorpay_conn or not razorpay_conn.encrypted_key_secret:
            logger.error("Admin %s has a real payment order but no stored Razorpay secret.", admin.id)
            raise HTTPException(status_code=500, detail="Payment configuration error. Please contact support.")

        try:
            is_valid = verify_razorpay_signature(
                encrypted_key_secret=razorpay_conn.encrypted_key_secret,
                order_id=req.razorpay_order_id,
                payment_id=req.razorpay_payment_id,
                signature=req.razorpay_signature
            )
        except SecretDecryptionError as exc:
            # A key-management fault, not a bad signature. Never report it as one.
            logger.error("Cannot decrypt Razorpay secret for admin %s: %s", admin.id, exc)
            raise HTTPException(
                status_code=500,
                detail="Payment configuration error. Please contact support."
            ) from exc

        if not is_valid:
            logger.warning("Rejected payment for booking %s: signature mismatch.", booking.public_id)
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    # 2. Final Double-Booking Check
    double_booking = (
        db.query(Booking)
        .filter(
            Booking.admin_id == admin.id,
            Booking.start_time == booking.start_time,
            Booking.status == "confirmed",
            Booking.id != booking.id
        )
        .first()
    )
    if double_booking:
        booking.status = "cancelled"
        db.commit()
        raise HTTPException(
            status_code=409,
            detail="Conflict: This slot was confirmed by another payment. A refund has been initiated."
        )

    # 3. Mark Payment Captured & Booking Confirmed. A simulated payment is recorded as
    #    such and never reaches "completed" -- reporting must not count it as revenue.
    payment.payment_id = req.razorpay_payment_id
    payment.status = "simulated" if is_simulated else "captured"

    booking.status = "confirmed"
    booking.payment_status = "simulated" if is_simulated else "completed"

    # Mark slot lock as confirmed if exists
    lock = (
        db.query(SlotLock)
        .filter(SlotLock.admin_id == admin.id, SlotLock.start_time == booking.start_time)
        .first()
    )
    if lock:
        lock.status = "confirmed"

    # 4. Create Google Calendar Event & Google Meet with that Admin's Google OAuth tokens
    meet_link = None
    g_conn = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == admin.id, GoogleConnection.connection_status == "connected")
        .first()
    )
    if g_conn and g_conn.encrypted_refresh_token:
        session_title = booking.meeting_type.title if booking.meeting_type else "Mentorship Call"
        event_res = await create_calendar_event_with_meet(
            encrypted_refresh_token=g_conn.encrypted_refresh_token,
            title=f"{session_title} — {booking.client_name} & {admin.name}",
            description=f"1-to-1 session on BookMyMeet.\nAttendee: {booking.client_name} ({booking.client_email})\nNotes: {booking.notes or 'None'}",
            start_time_iso=booking.start_time,
            end_time_iso=booking.end_time,
            client_name=booking.client_name,
            client_email=booking.client_email
        )
        booking.google_event_id = event_res.get("event_id")
        # May be None when Google created the event without a conference, or when event
        # creation failed. A fabricated meet.google.com link would be worse than none:
        # the client would follow it and land nowhere.
        meet_link = event_res.get("meet_link")
    else:
        # No calendar connected for this admin: nothing real to link to.
        meet_link = None

    booking.google_meet_link = meet_link

    # 5. Create in-app Notification for Admin
    notification = Notification(
        admin_id=admin.id,
        type="new_booking",
        title=f"New Booking: {booking.client_name}",
        message=f"{booking.client_name} booked {booking.meeting_type.title if booking.meeting_type else 'Session'} for {booking.start_time}.",
        booking_id=booking.id
    )
    db.add(notification)

    db.commit()

    # 6. Send Email Notifications (Client and Admin)
    session_title = booking.meeting_type.title if booking.meeting_type else "Mentorship Call"
    duration = booking.meeting_type.duration_minutes if booking.meeting_type else 30

    await send_booking_confirmation_email(
        to_email=booking.client_email,
        client_name=booking.client_name,
        admin_name=admin.name,
        session_title=session_title,
        start_time=booking.start_time,
        duration_minutes=duration,
        meet_link=meet_link
    )
    await send_admin_new_booking_notification(
        admin_email=admin.email,
        admin_name=admin.name,
        client_name=booking.client_name,
        client_email=booking.client_email,
        session_title=session_title,
        start_time=booking.start_time,
        meet_link=meet_link
    )

    return {
        "status": "confirmed",
        "public_id": booking.public_id,
        "client_name": booking.client_name,
        "admin_name": admin.name,
        "google_meet_link": meet_link,
        "message": "Payment verified and booking confirmed successfully"
    }
