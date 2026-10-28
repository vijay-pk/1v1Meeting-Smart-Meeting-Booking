import uuid
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.config import settings
from app.services.booking_slots import expire_abandoned_bookings, as_utc
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
    check_razorpay_credentials,
    create_razorpay_order, verify_razorpay_signature,
    RazorpayConfigurationError, RazorpayOrderError,
    SIMULATED_PROVIDER, REAL_PROVIDER,
)
from app.services.google_calendar import create_calendar_event_with_meet
from app.services.email_service import (
    send_booking_confirmation_email,
    send_admin_new_booking_notification,
)
from app.services.booking_confirm import confirm_booking_side_effects

logger = logging.getLogger(__name__)


router = APIRouter()

@router.get("/admin/status")
async def get_payment_setup_status(
    probe: bool = Query(False, description="Ask Razorpay whether the stored keys still work"),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Reports the stored connection, and optionally whether it still works.

    `configured` reflects the database row and nothing else. `healthy` reflects a live,
    read-only check against Razorpay. They diverge when the admin regenerated their keys at
    Razorpay -- the row stays connected and the credentials stay stored, and the admin is
    shown a "needs attention" state so they can update the keys themselves.

    This endpoint never writes. A failing probe is a report, not a disconnect.
    """
    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()
    if not conn:
        return {
            "configured": False,
            "key_id": None,
            "account_reference": None,
            "healthy": False,
            "needs_attention": False,
            "last_error": None,
        }

    configured = conn.connection_status == "connected"
    payload = {
        "configured": configured,
        # Public half only. The secret is encrypted at rest and is never returned.
        "key_id": conn.key_id,
        "account_reference": conn.account_reference,
        "connected_at": conn.created_at.isoformat() if conn.created_at else None,
        "healthy": False,
        "needs_attention": False,
        "last_error": None,
    }

    if not configured or not probe:
        return payload

    status_result = await check_razorpay_credentials(conn.key_id, conn.encrypted_key_secret)
    payload["healthy"] = status_result.healthy
    payload["last_error"] = status_result.reason
    # Only a definitive rejection from Razorpay asks the admin to act. A network blip does not.
    payload["needs_attention"] = status_result.permanent
    return payload


@router.get("/my-payments")
def get_admin_payments(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    This admin's own payment records, for the Payments page.

    The canonical source is this table, written server-side at order creation and flipped to
    captured/simulated on verify. The page read a Supabase `payments` table directly through
    the browser client, which the app does not authenticate against (it uses its own JWT, not
    Supabase Auth), so RLS returned nothing and the page was always empty.
    """
    rows = (
        db.query(Payment)
        .filter(Payment.admin_id == current_admin.id)
        .order_by(Payment.created_at.desc())
        .all()
    )
    results = []
    for p in rows:
        b = p.booking
        results.append({
            "id": p.id,
            "amount": p.amount,
            "currency": p.currency,
            # "created" | "captured" | "failed" | "simulated". Only "captured" is real revenue.
            "status": p.status,
            "provider": p.provider,
            "order_id": p.order_id,
            "payment_id": p.payment_id,
            "created_at": (
                (p.created_at if p.created_at.tzinfo else p.created_at.replace(tzinfo=timezone.utc)).isoformat()
                if p.created_at else None
            ),
            "booking_public_id": b.public_id if b else None,
            "client_name": b.client_name if b else None,
            "client_email": b.client_email if b else None,
            "session_title": b.meeting_type.title if (b and b.meeting_type) else None,
        })
    return results


@router.post("/admin/disconnect")
def disconnect_admin_razorpay(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    The only path that ends a Razorpay connection.

    Nothing else in the codebase sets connection_status to anything but "connected": a
    failed payment, a rejected signature, a gateway outage, a re-login or a profile save all
    leave the stored credentials exactly as they were.

    The row itself is kept, so a payment whose order was created before the disconnect can
    still be verified against the secret it was created with. Sessions, prices, bookings and
    profile data are untouched.
    """
    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()
    if not conn:
        return {"message": "Razorpay disconnected", "configured": False}

    conn.connection_status = "disconnected"
    db.commit()
    return {"message": "Razorpay disconnected", "configured": False}

@router.post("/admin/setup")
def setup_admin_razorpay(
    req: RazorpaySetupRequest,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Securely configures Razorpay credentials for the logged-in admin (this admin only:
    the row is keyed on current_admin.id, so one admin can never write another's credentials).
    The secret is encrypted at rest and is never returned to the frontend.

    An empty secret is not a disconnect and never clears a stored one. When the admin is
    already connected they may save a Key ID or business-tag change with the secret field left
    blank; the stored secret is preserved. A first-time connection still requires a secret.
    """
    clean_key_id = req.key_id.strip()
    clean_key_secret = (req.key_secret or "").strip()

    if not clean_key_id:
        raise HTTPException(status_code=400, detail="Razorpay Key ID is required")

    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == current_admin.id).first()

    if clean_key_secret:
        # A real new secret was entered: encrypt it and replace the stored one.
        encrypted_secret = encrypt_secret(clean_key_secret)
    elif conn and conn.encrypted_key_secret:
        # No secret entered but one is already stored -> keep it. An empty password-style
        # field must never overwrite or delete the credential behind it.
        encrypted_secret = conn.encrypted_key_secret
    else:
        # Nothing to connect with: no secret entered and none on file.
        raise HTTPException(status_code=400, detail="Razorpay Key Secret is required")

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

    # 1a. Consume the hold created by POST /bookings/hold-slot.
    #
    # This used to be skipped entirely: lock_id was declared on the request and then never
    # referenced, so the hold was decorative and two clients could both reach checkout for
    # the same slot. The lock is what reserves the slot for the length of a Razorpay
    # checkout, so it has to be real, unexpired, and actually this client's.
    now_utc = datetime.now(timezone.utc)
    if not req.lock_id:
        raise HTTPException(
            status_code=409,
            detail="This time slot is no longer held. Please pick your time again."
        )
    lock = db.query(SlotLock).filter(SlotLock.id == req.lock_id).first()
    if (
        not lock
        or lock.status != "active"
        or as_utc(lock.expires_at) <= now_utc
        or lock.admin_id != admin.id
        or lock.start_time != req.start_time
    ):
        raise HTTPException(
            status_code=409,
            detail="Your hold on this time slot expired. Please pick your time again."
        )

    # Release slots held by abandoned checkouts before testing for a conflict.
    #
    # A "pending_payment" booking occupies its slot -- both here and in the availability
    # engine, which has always counted them. But a client who opens Razorpay and closes the
    # tab leaves that row behind forever, and nothing ever swept it, so the slot became
    # permanently unbookable. Anything older than the hold's own lifetime has been abandoned
    # by definition: the hold that authorised it expired long ago.
    expire_abandoned_bookings(db, admin_id=admin.id, start_time=req.start_time, now_utc=now_utc)

    # 1b. Check double booking.
    #
    # "pending_payment" counts: another client part-way through checkout occupies the slot
    # just as much as a confirmed one does. Matching only "confirmed" here is what let two
    # people pay for the same time. The database index added in migration 004 is the actual
    # guarantee -- this check exists to return a clean 409 before taking any money.
    existing = (
        db.query(Booking)
        .filter(
            Booking.admin_id == admin.id,
            Booking.start_time == req.start_time,
            Booking.status.in_(["confirmed", "pending_payment"])
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This slot has already been booked. Please select another time.")

    # 2. Get this Admin's own Razorpay Connection. There is no shared/platform fallback
    #    credential: an admin with no connected account simply cannot take payments.
    razorpay_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin.id).first()
    # A row the admin has explicitly disconnected must not take new payments, even though it
    # is kept so already-created orders can still be verified.
    if razorpay_conn and razorpay_conn.connection_status == "connected":
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
    reschedule_token = secrets.token_hex(16)

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
        reschedule_token=reschedule_token,
        notes=req.notes
    )
    # The hold has done its job: the booking below now holds the slot. Leaving the lock
    # "active" would keep the time blocked for the rest of its ten minutes even after the
    # booking was cancelled or abandoned, so the slot could not be resold.
    lock.status = "consumed"

    db.add(booking)
    try:
        db.flush()
    except IntegrityError:
        # migration 004's partial unique index fired: another request committed a booking for
        # this exact slot between our SELECT above and this INSERT. That window cannot be
        # closed in application code, which is the whole reason the index exists.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This slot has already been booked. Please select another time."
        )

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
            Booking.status.in_(["confirmed", "pending_payment"]),
            Booking.id != booking.id
        )
        .first()
    )
    if double_booking:
        booking.status = "cancelled"
        from app.services.meeting_termination import cancel_termination_job
        cancel_termination_job(booking)
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

    # 4-6. Calendar event + Meet link, host notification, reminder, and confirmation emails.
    #      Extracted into one helper so the free student-booking path runs identical
    #      confirmation side effects (services/booking_confirm.py). Never fatal: the booking is
    #      already confirmed, and a calendar/email outage must not turn it into a 500.
    meet_link = await confirm_booking_side_effects(db, booking, admin)

    return {
        "status": "confirmed",
        "public_id": booking.public_id,
        "client_name": booking.client_name,
        "admin_name": admin.name,
        "google_meet_link": meet_link,
        "meeting_link_pending": meet_link is None,
        "message": "Payment verified and booking confirmed successfully"
    }
