from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, delete
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.db import get_db, mongo_client, mongo_engine
from app.models import User, Booking, FlightBooking, TourBooking, Payment
from app.models_mongo import Destination, Tour
from app.routers.auth import require_admin
from app.config import settings
from app.services.event_bus import publish

router = APIRouter(prefix="/admin", tags=["Admin Portal"])


def _clean_mongo(doc: dict) -> dict:
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for k, v in list(doc.items()):
        if hasattr(v, "isoformat"):
            doc[k] = v.isoformat()
    return doc


def _booking_ref(bid: int) -> str:
    return f"TW-BK-{bid:08d}"


# ═══════════════════════════════════════════════════════════════
#  USERS
# ═══════════════════════════════════════════════════════════════

@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_admin)):
    rows = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [{
        "user_id": u.user_id,
        "user_ref": f"TW-US-{u.user_id:08d}",
        "name": u.name,
        "email": u.email,
        "phone": u.phone,
        "role": u.role,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    } for u in rows]


@router.get("/users/{user_id}")
async def get_user(user_id: int, db: AsyncSession = Depends(get_db),
                   _: User = Depends(require_admin)):
    u = (await db.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")

    bookings = (await db.execute(
        select(Booking).where(Booking.user_id == user_id).order_by(Booking.created_at.desc()).limit(50)
    )).scalars().all()

    return {
        "user": {
            "user_id": u.user_id,
            "user_ref": f"TW-US-{u.user_id:08d}",
            "name": u.name,
            "email": u.email,
            "phone": u.phone,
            "role": u.role,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        },
        "bookings": [{
            "booking_id": b.booking_id,
            "booking_ref": _booking_ref(b.booking_id),
            "status": b.status,
            "payment_status": b.payment_status,
            "total_price": float(b.total_price),
            "created_at": b.created_at.isoformat() if b.created_at else None,
        } for b in bookings],
    }


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None


@router.patch("/users/{user_id}")
async def update_user(user_id: int, payload: UserUpdate,
                      db: AsyncSession = Depends(get_db),
                      current: User = Depends(require_admin)):
    u = (await db.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    if payload.role and payload.role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    if payload.role == "user" and u.user_id == current.user_id:
        raise HTTPException(400, "You cannot demote yourself")

    if payload.name is not None: u.name = payload.name
    if payload.email is not None: u.email = payload.email
    if payload.phone is not None: u.phone = payload.phone
    if payload.role is not None: u.role = payload.role

    await db.commit()
    return {"ok": True, "user_id": u.user_id}


@router.patch("/users/{user_id}/role")
async def update_role(user_id: int, payload: dict,
                      db: AsyncSession = Depends(get_db),
                      current: User = Depends(require_admin)):
    role = payload.get("role")
    if role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    if user_id == current.user_id and role == "user":
        raise HTTPException(400, "You cannot demote yourself")
    u = (await db.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    u.role = role
    await db.commit()
    return {"ok": True, "user_id": u.user_id, "role": u.role}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: int,
                      db: AsyncSession = Depends(get_db),
                      current: User = Depends(require_admin)):
    if current.user_id == user_id:
        raise HTTPException(400, "Cannot delete yourself")
    u = (await db.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    await db.delete(u)
    await db.commit()


# ═══════════════════════════════════════════════════════════════
#  BOOKINGS
# ═══════════════════════════════════════════════════════════════

@router.get("/bookings")
async def list_all_bookings(status: Optional[str] = Query(None),
                            db: AsyncSession = Depends(get_db),
                            _: User = Depends(require_admin)):
    sql = """
        SELECT b.booking_id, b.user_id, b.status, b.payment_status,
               b.total_price, b.created_at, u.name AS user_name, u.email
        FROM bookings b JOIN users u ON u.user_id = b.user_id
    """
    params = {}
    if status:
        sql += " WHERE b.status = :status"
        params["status"] = status
    sql += " ORDER BY b.created_at DESC LIMIT 500"
    rows = (await db.execute(text(sql), params)).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["booking_ref"] = _booking_ref(d["booking_id"])
        d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
        d["total_price"] = float(d["total_price"]) if d.get("total_price") is not None else 0
        out.append(d)
    return out


class StatusUpdate(BaseModel):
    status: str


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: int, payload: StatusUpdate,
                                db: AsyncSession = Depends(get_db),
                                _: User = Depends(require_admin)):
    if payload.status not in ("pending", "confirmed", "cancelled"):
        raise HTTPException(400, "invalid status")
    b = (await db.execute(select(Booking).where(Booking.booking_id == booking_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Booking not found")
    b.status = payload.status
    await db.commit()
    await publish("booking.status.changed", {
        "booking_id": booking_id,
        "booking_ref": _booking_ref(booking_id),
        "user_id": b.user_id,
        "new_status": payload.status,
    })
    return {"ok": True, "booking_id": booking_id,
            "booking_ref": _booking_ref(booking_id), "status": b.status}


class BookingUpdate(BaseModel):
    status: Optional[str] = None
    payment_status: Optional[str] = None
    total_price: Optional[float] = None


@router.patch("/bookings/{booking_id}")
async def update_booking(booking_id: int, payload: BookingUpdate,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_admin)):
    b = (await db.execute(select(Booking).where(Booking.booking_id == booking_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Booking not found")
    if payload.status is not None:
        if payload.status not in ("pending", "confirmed", "cancelled"):
            raise HTTPException(400, "invalid status")
        b.status = payload.status
    if payload.payment_status is not None:
        if payload.payment_status not in ("unpaid", "paid", "refunded"):
            raise HTTPException(400, "invalid payment_status")
        b.payment_status = payload.payment_status
    if payload.total_price is not None:
        b.total_price = payload.total_price
    await db.commit()
    return {"ok": True, "booking_ref": _booking_ref(booking_id)}


@router.delete("/bookings/{booking_id}", status_code=204)
async def delete_booking(booking_id: int,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_admin)):
    b = (await db.execute(select(Booking).where(Booking.booking_id == booking_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Booking not found")
    await db.delete(b)
    await db.commit()


# ═══════════════════════════════════════════════════════════════
#  PAYMENTS
# ═══════════════════════════════════════════════════════════════

@router.get("/payments")
async def list_payments(db: AsyncSession = Depends(get_db),
                        _: User = Depends(require_admin)):
    sql = """
        SELECT p.payment_id, p.booking_id, p.user_id, p.amount, p.currency,
               p.status, p.method, p.created_at, p.paid_at,
               u.name AS user_name, u.email
        FROM payments p JOIN users u ON u.user_id = p.user_id
        ORDER BY p.created_at DESC LIMIT 500
    """
    rows = (await db.execute(text(sql))).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["booking_ref"] = _booking_ref(d["booking_id"])
        d["amount"] = float(d["amount"])
        d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
        d["paid_at"] = d["paid_at"].isoformat() if d.get("paid_at") else None
        out.append(d)
    return out


class RefundReq(BaseModel):
    reason: str = "admin_refund"
    amount: Optional[float] = None    # partial refund if specified


@router.post("/payments/{payment_id}/refund")
async def refund_payment(payment_id: str, payload: RefundReq,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_admin)):
    p = (await db.execute(select(Payment).where(Payment.payment_id == payment_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Payment not found")
    if p.status != "success":
        raise HTTPException(400, "Only successful payments can be refunded")

    p.status = "refunded"

    # Also mark the booking as refunded
    b = (await db.execute(select(Booking).where(Booking.booking_id == p.booking_id))).scalar_one_or_none()
    if b:
        b.payment_status = "refunded"
        if b.status == "confirmed":
            b.status = "cancelled"

    await db.commit()

    await publish("payment.refunded", {
        "payment_id": payment_id,
        "booking_id": p.booking_id,
        "booking_ref": _booking_ref(p.booking_id),
        "user_id": p.user_id,
        "amount": float(p.amount),
        "reason": payload.reason,
    })

    return {
        "ok": True,
        "payment_id": payment_id,
        "status": "refunded",
        "refunded_amount": float(payload.amount or p.amount),
    }


# ═══════════════════════════════════════════════════════════════
#  DESTINATIONS (CRUD)
# ═══════════════════════════════════════════════════════════════

class DestinationIn(BaseModel):
    name: str
    country: str
    description: Optional[str] = ""
    image_url: Optional[str] = ""
    tags: List[str] = []
    travel_types: List[str] = []
    avg_cost_per_day: float = 0.0
    best_season: Optional[str] = None
    rating: float = 0.0
    lat: Optional[float] = None
    lng: Optional[float] = None
    nearby: List[dict] = []


@router.get("/destinations")
async def list_destinations(_: User = Depends(require_admin)):
    db = mongo_client[settings.MONGODB_DB]
    docs = await db["destinations"].find({}).sort("name", 1).to_list(length=2000)
    return [_clean_mongo(d) for d in docs]


@router.post("/destinations", status_code=201)
async def create_destination(payload: DestinationIn, _: User = Depends(require_admin)):
    db = mongo_client[settings.MONGODB_DB]
    existing = await db["destinations"].find_one({"name": payload.name})
    if existing:
        raise HTTPException(400, f"Destination '{payload.name}' already exists")
    doc = payload.model_dump()
    result = await db["destinations"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _clean_mongo(doc)


@router.put("/destinations/{name}")
async def update_destination(name: str, payload: DestinationIn,
                             _: User = Depends(require_admin)):
    db = mongo_client[settings.MONGODB_DB]
    existing = await db["destinations"].find_one({"name": name})
    if not existing:
        raise HTTPException(404, "Destination not found")
    await db["destinations"].update_one({"name": name}, {"$set": payload.model_dump()})
    updated = await db["destinations"].find_one({"name": payload.name})
    return _clean_mongo(updated)


@router.delete("/destinations/{name}", status_code=204)
async def delete_destination(name: str, _: User = Depends(require_admin)):
    db = mongo_client[settings.MONGODB_DB]
    existing = await db["destinations"].find_one({"name": name})
    if not existing:
        raise HTTPException(404, "Destination not found")
    await db["destinations"].delete_one({"name": name})


# ═══════════════════════════════════════════════════════════════
#  TOURS (CRUD)
# ═══════════════════════════════════════════════════════════════

class TourIn(BaseModel):
    name: str
    destination: str
    country: str
    description: Optional[str] = ""
    image_url: Optional[str] = ""
    duration_days: int = 3
    price_per_person: float = 0.0
    rating: float = 0.0
    tags: List[str] = []
    highlights: List[str] = []


@router.get("/tours")
async def admin_list_tours(_: User = Depends(require_admin)):
    docs = await mongo_engine.find(Tour)
    out = []
    for t in docs:
        d = t.model_dump()
        d["id"] = str(t.id)
        out.append(d)
    return out


@router.post("/tours", status_code=201)
async def admin_create_tour(payload: TourIn, _: User = Depends(require_admin)):
    t = Tour(**payload.model_dump())
    await mongo_engine.save(t)
    d = t.model_dump()
    d["id"] = str(t.id)
    return d


@router.put("/tours/{tour_id}")
async def admin_update_tour(tour_id: str, payload: TourIn,
                            _: User = Depends(require_admin)):
    t = await mongo_engine.find_one(Tour, Tour.id == tour_id)
    if not t:
        raise HTTPException(404, "Tour not found")
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    await mongo_engine.save(t)
    d = t.model_dump()
    d["id"] = str(t.id)
    return d


@router.delete("/tours/{tour_id}", status_code=204)
async def admin_delete_tour(tour_id: str, _: User = Depends(require_admin)):
    t = await mongo_engine.find_one(Tour, Tour.id == tour_id)
    if not t:
        raise HTTPException(404, "Tour not found")
    await mongo_engine.delete(t)


# ═══════════════════════════════════════════════════════════════
#  REVIEWS (CRUD)
# ═══════════════════════════════════════════════════════════════

@router.get("/reviews")
async def list_all_reviews(_: User = Depends(require_admin)):
    db = mongo_client[settings.MONGODB_DB]
    docs = await db["reviews"].find({}).sort("created_at", -1).to_list(length=2000)
    return [_clean_mongo(d) for d in docs]


class ReviewUpdate(BaseModel):
    rating: Optional[int] = None
    title: Optional[str] = None
    comment: Optional[str] = None


@router.patch("/reviews/{review_id}")
async def admin_update_review(review_id: str, payload: ReviewUpdate,
                              _: User = Depends(require_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(review_id)
    except Exception:
        raise HTTPException(400, "Invalid review id")
    db = mongo_client[settings.MONGODB_DB]
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    r = await db["reviews"].update_one({"_id": oid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Review not found")
    doc = await db["reviews"].find_one({"_id": oid})
    return _clean_mongo(doc)


@router.delete("/reviews/{review_id}", status_code=204)
async def admin_delete_review(review_id: str, _: User = Depends(require_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(review_id)
    except Exception:
        raise HTTPException(400, "Invalid review id")
    db = mongo_client[settings.MONGODB_DB]
    r = await db["reviews"].delete_one({"_id": oid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Review not found")


# ═══════════════════════════════════════════════════════════════
#  ANALYTICS
# ═══════════════════════════════════════════════════════════════

@router.get("/analytics")
async def analytics(db: AsyncSession = Depends(get_db),
                    _: User = Depends(require_admin)):
    totals = (await db.execute(text("""
        SELECT
          COUNT(*) AS total_bookings,
          COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
          COUNT(*) FILTER (WHERE status='pending') AS pending,
          COUNT(*) FILTER (WHERE status='cancelled') AS cancelled,
          COALESCE(SUM(total_price) FILTER (WHERE status='confirmed'), 0) AS revenue,
          COALESCE(SUM(total_price), 0) AS gross_volume
        FROM bookings;
    """))).mappings().first()

    pay = (await db.execute(text("""
        SELECT
          COUNT(*) FILTER (WHERE status='success') AS paid,
          COUNT(*) FILTER (WHERE status='refunded') AS refunded,
          COUNT(*) FILTER (WHERE status='failed') AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status='success'), 0) AS collected
        FROM payments;
    """))).mappings().first()

    top = (await db.execute(text("""
        SELECT u.email,
               COUNT(b.booking_id) FILTER (WHERE b.status='confirmed') AS total_bookings,
               COALESCE(SUM(b.total_price) FILTER (WHERE b.status='confirmed'), 0) AS total_spent,
               ROW_NUMBER() OVER (
                 ORDER BY COALESCE(SUM(b.total_price) FILTER (WHERE b.status='confirmed'), 0) DESC
               ) AS rank
        FROM users u
        LEFT JOIN bookings b ON b.user_id = u.user_id
        GROUP BY u.email
        ORDER BY rank LIMIT 10;
    """))).mappings().all()

    return {
        "totals": {
            "bookings":     int(totals["total_bookings"] or 0),
            "revenue":      float(totals["revenue"] or 0),
            "gross_volume": float(totals["gross_volume"] or 0),
            "confirmed":    int(totals["confirmed"] or 0),
            "pending":      int(totals["pending"] or 0),
            "cancelled":    int(totals["cancelled"] or 0),
        },
        "payments": {
            "paid":      int(pay["paid"] or 0),
            "refunded":  int(pay["refunded"] or 0),
            "failed":    int(pay["failed"] or 0),
            "collected": float(pay["collected"] or 0),
        },
        "top_users": [
            {"rank": int(r["rank"]), "email": r["email"],
             "total_bookings": int(r["total_bookings"] or 0),
             "total_spent": float(r["total_spent"] or 0)}
            for r in top
        ],
    }


@router.get("/db-stats")
async def db_stats(db: AsyncSession = Depends(get_db),
                   _: User = Depends(require_admin)):
    tables = ["users", "bookings", "flight_bookings", "payments", "destination_embeddings"]
    stats = {}
    for t in tables:
        try:
            n = (await db.execute(text(f"SELECT COUNT(*) FROM {t}"))).scalar()
            stats[t] = int(n or 0)
        except Exception:
            stats[t] = 0
    db_name = (await db.execute(text("SELECT current_database()"))).scalar()
    version = (await db.execute(text("SHOW server_version"))).scalar()
    return {"database": db_name, "version": version, "tables": stats}