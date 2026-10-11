import uuid
import base64
from io import BytesIO
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from app.db import get_db
from app.models import Booking, Payment, User
from app.routers.auth import get_current_user
from app.services.event_bus import publish

router = APIRouter(prefix="/payments", tags=["Payments"])

# ─── Available payment methods ───
PAYMENT_METHODS = [
    {"id": "upi",       "label": "UPI / QR Code",  "icon": "qr",     "fee_pct": 0.0},
    {"id": "card",      "label": "Credit / Debit Card", "icon": "card", "fee_pct": 1.5},
    {"id": "netbanking","label": "Net Banking",     "icon": "bank",   "fee_pct": 0.5},
    {"id": "wallet",    "label": "Wallet",          "icon": "wallet", "fee_pct": 0.0},
]

BANKS = [
    "State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank",
    "Punjab National Bank", "Kotak Mahindra", "Bank of Baroda", "Yes Bank",
]


def _make_qr_data_url(payload: str) -> str:
    qr = qrcode.QRCode(version=None, box_size=8, border=2, error_correction=ERROR_CORRECT_M)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _booking_ref(bid: int) -> str:
    return f"TW-BK-{bid:08d}"


# ─── List methods ───
@router.get("/methods")
async def list_methods():
    return {"methods": PAYMENT_METHODS, "banks": BANKS}


# ─── Create payment (multi-method) ───
class CreatePaymentReq(BaseModel):
    booking_id: int
    method: str = "upi"           # upi | card | netbanking | wallet
    origin_url: Optional[str] = None


@router.post("/create")
async def create_payment(
    payload: CreatePaymentReq,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = (await db.execute(
        select(Booking).where(Booking.booking_id == payload.booking_id)
    )).scalar_one_or_none()

    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.user_id:
        raise HTTPException(403, "Not your booking")
    if booking.payment_status == "paid":
        raise HTTPException(400, "Booking already paid")

    method = next((m for m in PAYMENT_METHODS if m["id"] == payload.method), None)
    if not method:
        raise HTTPException(400, f"Unknown method: {payload.method}")

    base_amount = float(booking.total_price)
    fee = round(base_amount * method["fee_pct"] / 100, 2)
    total = round(base_amount + fee, 2)

    # Reuse existing pending payment for this booking, or create new
    existing = (await db.execute(
        select(Payment).where(
            Payment.booking_id == booking.booking_id,
            Payment.status == "pending",
        )
    )).scalar_one_or_none()

    if existing:
        payment = existing
        payment.amount = total
        payment.method = payload.method
    else:
        pid = "PAY-" + uuid.uuid4().hex[:16].upper()
        base = (payload.origin_url or "http://localhost:5500").rstrip("/")
        pay_url = f"{base}/pay.html?token={pid}"
        payment = Payment(
            payment_id=pid,
            booking_id=booking.booking_id,
            user_id=current_user.user_id,
            amount=total,
            currency=booking.currency,
            status="pending",
            method=payload.method,
            qr_payload=pay_url,
        )
        db.add(payment)
        booking.payment_id = pid
    await db.commit()
    await db.refresh(payment)

    resp = {
        "payment_id":  payment.payment_id,
        "booking_id":  booking.booking_id,
        "booking_ref": _booking_ref(booking.booking_id),
        "amount":      float(payment.amount),
        "base_amount": base_amount,
        "fee":         fee,
        "currency":    payment.currency,
        "status":      payment.status,
        "method":      payment.method,
        "pay_url":     payment.qr_payload,
        "expires_in":  600,
    }

    if payload.method == "upi":
        resp["qr_data_url"] = _make_qr_data_url(payment.qr_payload or payment.payment_id)
    elif payload.method == "netbanking":
        resp["banks"] = BANKS

    return resp


# ─── Status ───
@router.get("/{payment_id}/status")
async def get_payment_status(payment_id: str, db: AsyncSession = Depends(get_db)):
    payment = (await db.execute(
        select(Payment).where(Payment.payment_id == payment_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")
    return {
        "payment_id":  payment.payment_id,
        "booking_id":  payment.booking_id,
        "booking_ref": _booking_ref(payment.booking_id),
        "amount":      float(payment.amount),
        "currency":    payment.currency,
        "method":      payment.method,
        "status":      payment.status,
        "paid_at":     payment.paid_at.isoformat() if payment.paid_at else None,
    }


# ─── Confirm / simulate ───
class ConfirmReq(BaseModel):
    method_detail: Optional[str] = None   # e.g., "user@upi", "4242", "SBI"


@router.post("/{payment_id}/confirm")
async def confirm_payment(payment_id: str, payload: ConfirmReq = ConfirmReq(), db: AsyncSession = Depends(get_db)):
    payment = (await db.execute(
        select(Payment).where(Payment.payment_id == payment_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status == "success":
        return {
            "ok": True, "status": "success", "already": True,
            "payment_id": payment.payment_id,
            "booking_ref": _booking_ref(payment.booking_id),
            "amount": float(payment.amount),
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
        }

    booking = (await db.execute(
        select(Booking).where(Booking.booking_id == payment.booking_id)
    )).scalar_one_or_none()

    payment.status = "success"
    payment.paid_at = datetime.utcnow()
    if payload.method_detail:
        payment.method = f"{payment.method}:{payload.method_detail[:40]}"

    if booking:
        booking.payment_status = "paid"
        booking.status = "confirmed"
        booking.payment_id = payment.payment_id

    await db.commit()

    await publish("payment.successful", {
        "payment_id":  payment.payment_id,
        "booking_id":  payment.booking_id,
        "booking_ref": _booking_ref(payment.booking_id),
        "user_id":     payment.user_id,
        "amount":      float(payment.amount),
        "currency":    payment.currency,
        "method":      payment.method,
        "status":      "success",
    })

    return {
        "ok": True, "status": "success",
        "payment_id": payment.payment_id,
        "booking_ref": _booking_ref(payment.booking_id),
        "amount": float(payment.amount),
        "method": payment.method,
        "paid_at": payment.paid_at.isoformat(),
    }


# Backwards-compatible alias
@router.post("/{payment_id}/simulate")
async def simulate_payment(payment_id: str, db: AsyncSession = Depends(get_db)):
    return await confirm_payment(payment_id, ConfirmReq(method_detail="simulated"), db)


# ─── Fail ───
class FailReq(BaseModel):
    reason: str = "user_cancelled"


@router.post("/{payment_id}/fail")
async def fail_payment(payment_id: str, payload: FailReq, db: AsyncSession = Depends(get_db)):
    payment = (await db.execute(
        select(Payment).where(Payment.payment_id == payment_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status == "success":
        raise HTTPException(400, "Cannot fail a successful payment")
    payment.status = "failed"
    await db.commit()
    return {"ok": True, "status": "failed", "reason": payload.reason}


# ─── Pay later ───
@router.post("/{payment_id}/pay-later")
async def pay_later(payment_id: str, db: AsyncSession = Depends(get_db)):
    payment = (await db.execute(
        select(Payment).where(Payment.payment_id == payment_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")
    return {"ok": True, "status": payment.status, "message": "Payment postponed"}


# ─── My payments ───
@router.get("/my-history")
async def my_payment_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Payment).where(Payment.user_id == current_user.user_id)
        .order_by(Payment.created_at.desc())
        .limit(100)
    )).scalars().all()
    return [{
        "payment_id": p.payment_id,
        "booking_id": p.booking_id,
        "booking_ref": _booking_ref(p.booking_id),
        "amount": float(p.amount),
        "currency": p.currency,
        "status": p.status,
        "method": p.method,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
    } for p in rows]


# ─── Receipt ───
@router.get("/{payment_id}/receipt")
async def receipt(payment_id: str, db: AsyncSession = Depends(get_db)):
    payment = (await db.execute(
        select(Payment).where(Payment.payment_id == payment_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "success":
        raise HTTPException(400, "Receipt only available for successful payments")

    # Fetch the user and booking
    user = (await db.execute(select(User).where(User.user_id == payment.user_id))).scalar_one_or_none()
    booking = (await db.execute(select(Booking).where(Booking.booking_id == payment.booking_id))).scalar_one_or_none()

    return {
        "receipt_no": f"RCPT-{payment.payment_id}",
        "issued_at": datetime.utcnow().isoformat(),
        "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
        "customer": {
            "name": user.name if user else "—",
            "email": user.email if user else "—",
        },
        "booking": {
            "ref": _booking_ref(payment.booking_id),
            "total": float(booking.total_price) if booking else float(payment.amount),
        },
        "payment": {
            "id": payment.payment_id,
            "amount": float(payment.amount),
            "currency": payment.currency,
            "method": payment.method,
            "status": payment.status,
        },
    }