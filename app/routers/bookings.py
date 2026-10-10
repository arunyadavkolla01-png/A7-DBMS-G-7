from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, date
from pydantic import BaseModel
from typing import List, Optional

from app.db import get_db
from app.models import Booking, FlightBooking, TourBooking, SeatInventory, User
from app.routers.auth import get_current_user
from app.services.event_bus import publish

router = APIRouter(prefix="/bookings", tags=["Bookings"])


def _booking_ref(bid: int) -> str:
    return f"TW-BK-{bid:08d}"


def _route_code(origin: str, destination: str) -> str:
    return f"{origin.upper()[:3]}-{destination.upper()[:3]}"


class Availability(BaseModel):
    route: str
    date: str
    total_seats: int
    booked_seats: int
    available_seats: int


@router.get("/availability", response_model=Availability)
async def get_availability(
    destination: str = Query(..., min_length=1),
    date_str: str = Query(..., alias="date"),
    origin: str = Query("DEL"),
    db: AsyncSession = Depends(get_db),
):
    try:
        depart = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")

    route = _route_code(origin, destination)
    inv = (await db.execute(
        select(SeatInventory).where(
            SeatInventory.route == route,
            SeatInventory.depart_date == depart,
        )
    )).scalar_one_or_none()

    if not inv:
        return Availability(route=route, date=date_str,
                            total_seats=50, booked_seats=0, available_seats=50)

    return Availability(
        route=route, date=date_str,
        total_seats=inv.total_seats,
        booked_seats=inv.booked_seats,
        available_seats=max(inv.total_seats - inv.booked_seats, 0),
    )


class FlightBookingRequest(BaseModel):
    origin: str
    destination: str
    depart_time: datetime
    return_time: datetime | None = None
    passengers: list
    price: float
    currency: str = "INR"
    provider: str = "TripWise Airlines"


@router.post("/flight")
async def create_flight_booking(
    data: FlightBookingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pax_count = len(data.passengers) or 1
    route = _route_code(data.origin, data.destination)
    depart_date = data.depart_time.date()

    inv = (await db.execute(
        select(SeatInventory).where(
            SeatInventory.route == route,
            SeatInventory.depart_date == depart_date,
        ).with_for_update()
    )).scalar_one_or_none()

    if not inv:
        inv = SeatInventory(route=route, depart_date=depart_date,
                            total_seats=50, booked_seats=0)
        db.add(inv)
        await db.flush()

    available = inv.total_seats - inv.booked_seats
    if available < pax_count:
        raise HTTPException(400,
            f"Only {available} seat(s) available on {depart_date} for route {route}")

    inv.booked_seats += pax_count

    booking = Booking(
        user_id=current_user.user_id,
        status="pending",
        payment_status="unpaid",
        total_price=data.price,
        currency=data.currency,
        plan=[],
    )
    db.add(booking)
    await db.flush()
    await db.refresh(booking)

    flight = FlightBooking(
        booking_id=booking.booking_id,
        provider=data.provider,
        origin=data.origin[:3].upper(),
        destination=data.destination[:3].upper(),
        depart_time=data.depart_time,
        return_time=data.return_time,
        passengers=data.passengers,
        price=data.price,
        currency=data.currency,
    )
    db.add(flight)
    await db.commit()

    ref = _booking_ref(booking.booking_id)

    await publish("booking.created", {
        "booking_id": booking.booking_id,
        "booking_ref": ref,
        "user_id": current_user.user_id,
        "user_name": current_user.name,
        "origin": data.origin,
        "destination": data.destination,
        "price": data.price,
    })

    return {
        "booking_id": booking.booking_id,
        "booking_ref": ref,
        "status": "pending",
        "payment_status": "unpaid",
        "total_price": float(data.price),
        "seats_remaining": inv.total_seats - inv.booked_seats,
    }


class TourBookingRequest(BaseModel):
    tour_name: str
    destination: str
    tour_date: date
    duration_days: int
    passengers: list
    price: float
    currency: str = "INR"


@router.post("/tour")
async def create_tour_booking(
    data: TourBookingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = Booking(
        user_id=current_user.user_id,
        status="pending",
        payment_status="unpaid",
        total_price=data.price,
        currency=data.currency,
        plan=[],
    )
    db.add(booking)
    await db.flush()
    await db.refresh(booking)

    tour = TourBooking(
        booking_id=booking.booking_id,
        tour_name=data.tour_name,
        destination=data.destination,
        tour_date=data.tour_date,
        duration_days=data.duration_days,
        passengers=data.passengers,
        price=data.price,
        currency=data.currency,
    )
    db.add(tour)
    await db.commit()

    ref = _booking_ref(booking.booking_id)

    await publish("booking.created", {
        "booking_id": booking.booking_id,
        "booking_ref": ref,
        "user_id": current_user.user_id,
        "user_name": current_user.name,
        "tour_name": data.tour_name,
        "destination": data.destination,
        "price": data.price,
    })

    return {
        "booking_id": booking.booking_id,
        "booking_ref": ref,
        "status": "pending",
        "payment_status": "unpaid",
        "total_price": float(data.price),
    }


@router.get("/my-bookings")
async def get_my_bookings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Booking)
        .where(Booking.user_id == current_user.user_id)
        .order_by(Booking.created_at.desc())
    )
    bookings = result.scalars().all()

    out = []
    for b in bookings:
        flight = (await db.execute(
            select(FlightBooking).where(FlightBooking.booking_id == b.booking_id)
        )).scalar_one_or_none()

        tour = (await db.execute(
            select(TourBooking).where(TourBooking.booking_id == b.booking_id)
        )).scalar_one_or_none()

        item = {
            "booking_id":     b.booking_id,
            "booking_ref":    _booking_ref(b.booking_id),
            "status":         b.status,
            "payment_status": b.payment_status,
            "payment_id":     b.payment_id,
            "total_price":    float(b.total_price),
            "currency":       b.currency,
            "created_at":     b.created_at.isoformat(),
            "kind":           "flight" if flight else ("tour" if tour else "other"),
            "plan":           b.plan or [],
        }

        if flight:
            item.update({
                "origin":      flight.origin,
                "destination": flight.destination,
                "depart_time": flight.depart_time.isoformat(),
                "return_time": flight.return_time.isoformat() if flight.return_time else None,
            })
        if tour:
            item.update({
                "tour_name":     tour.tour_name,
                "destination":   tour.destination,
                "tour_date":     tour.tour_date.isoformat(),
                "duration_days": tour.duration_days,
            })

        out.append(item)
    return out


class CancelRequest(BaseModel):
    reason: str = ""


@router.patch("/{booking_id}/cancel")
async def cancel_my_booking(
    booking_id: int,
    payload: CancelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = (await db.execute(
        select(Booking).where(Booking.booking_id == booking_id)
    )).scalar_one_or_none()

    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.user_id:
        raise HTTPException(403, "Not your booking")
    if booking.status == "cancelled":
        raise HTTPException(400, "Already cancelled")
    if booking.status == "confirmed":
        raise HTTPException(400, "Confirmed bookings cannot be cancelled online.")

    flight = (await db.execute(
        select(FlightBooking).where(FlightBooking.booking_id == booking_id)
    )).scalar_one_or_none()
    if flight:
        route = _route_code(flight.origin, flight.destination)
        d = flight.depart_time.date()
        inv = (await db.execute(
            select(SeatInventory).where(
                SeatInventory.route == route,
                SeatInventory.depart_date == d,
            )
        )).scalar_one_or_none()
        if inv:
            pax = len(flight.passengers or []) or 1
            inv.booked_seats = max(inv.booked_seats - pax, 0)

    booking.status = "cancelled"
    await db.commit()

    await publish("booking.status.changed", {
        "booking_id": booking_id,
        "booking_ref": _booking_ref(booking_id),
        "user_id": current_user.user_id,
        "user_name": current_user.name,
        "new_status": "cancelled",
        "reason": "user",
    })

    return {"ok": True, "booking_ref": _booking_ref(booking_id), "status": "cancelled"}


class UpdateBookingRequest(BaseModel):
    depart_time: datetime
    return_time: datetime | None = None
    passengers: list
    price: float
    currency: str = "INR"


@router.patch("/{booking_id}")
async def update_my_booking(
    booking_id: int,
    payload: UpdateBookingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = (await db.execute(
        select(Booking).where(Booking.booking_id == booking_id)
    )).scalar_one_or_none()

    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.user_id:
        raise HTTPException(403, "Not your booking")
    if booking.status != "pending":
        raise HTTPException(400, "Only pending bookings can be edited")

    flight = (await db.execute(
        select(FlightBooking).where(FlightBooking.booking_id == booking_id)
    )).scalar_one_or_none()
    if not flight:
        raise HTTPException(404, "Flight details not found")

    flight.depart_time = payload.depart_time
    flight.return_time = payload.return_time
    flight.passengers = payload.passengers
    flight.price = payload.price
    flight.currency = payload.currency
    booking.total_price = payload.price
    booking.currency = payload.currency
    await db.commit()

    await publish("booking.updated", {
        "booking_id": booking_id,
        "booking_ref": _booking_ref(booking_id),
        "user_id": current_user.user_id,
        "user_name": current_user.name,
        "price": payload.price,
    })

    return {"ok": True, "booking_ref": _booking_ref(booking_id), "status": "updated"}


# ─── PLAN-AWARE BOOKING ───
class PlanItem(BaseModel):
    place_name: str
    price_per_person: float = 0.0
    day: int = 1


class PlanAttachRequest(BaseModel):
    booking_id: int
    items: List[PlanItem]


@router.post("/{booking_id}/attach-plan")
async def attach_plan(
    booking_id: int,
    payload: PlanAttachRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = (await db.execute(
        select(Booking).where(Booking.booking_id == booking_id)
    )).scalar_one_or_none()
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.user_id:
        raise HTTPException(403, "Not your booking")
    if booking.status == "cancelled":
        raise HTTPException(400, "Cannot modify a cancelled booking")

    add_on = sum(i.price_per_person for i in payload.items)
    existing_plan = booking.plan or []
    booking.plan = existing_plan + [i.model_dump() for i in payload.items]
    booking.total_price = float(booking.total_price) + add_on
    await db.commit()

    await publish("booking.plan.attached", {
        "booking_id": booking_id,
        "user_id":    current_user.user_id,
        "items":      len(payload.items),
        "add_on":     add_on,
    })

    return {
        "ok":         True,
        "booking_id": booking_id,
        "add_on":     add_on,
        "new_total":  float(booking.total_price),
        "plan":       booking.plan,
    }