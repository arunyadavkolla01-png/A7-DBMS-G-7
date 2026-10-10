from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime

from app.db import mongo_engine
from app.models_mongo import Destination

router = APIRouter(prefix="/destinations", tags=["Destinations & Nearby Places"])


class NearbyPlace(BaseModel):
    name: str
    distance_km: float = 0.0
    duration_hours: float = 0.0
    price_per_person: float = 0.0
    image_url: str = ""
    description: str = ""


class DestinationFull(BaseModel):
    name: str
    country: str
    description: str
    image_url: str
    tags: List[str]
    travel_types: List[str]
    avg_cost_per_day: float
    best_season: Optional[str] = None
    rating: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    nearby: List[NearbyPlace] = []


def _to_full(d: Destination) -> dict:
    return {
        "name": d.name,
        "country": d.country,
        "description": d.description or "",
        "image_url": d.image_url or "",
        "tags": d.tags or [],
        "travel_types": d.travel_types or [],
        "avg_cost_per_day": d.avg_cost_per_day,
        "best_season": d.best_season,
        "rating": d.rating,
        "lat": d.lat,
        "lng": d.lng,
        "nearby": d.nearby or [],
    }


def _rank_places(places: List[dict], interests: List[str]) -> List[dict]:
    """
    Rank places by:
      1. Interest match (higher priority)
      2. Distance (closer = earlier in trip)
      3. Duration (shorter = earlier)
    """
    interest_set = {i.lower() for i in interests}

    def score(p: dict):
        text = (p.get("name", "") + " " + p.get("description", "")).lower()
        interest_bonus = 0
        for i in interest_set:
            if i in text:
                interest_bonus -= 100  # negative => sorts first
        # Prefer closer & shorter
        return (
            interest_bonus,
            p.get("distance_km", 999),
            p.get("duration_hours", 999),
        )

    return sorted(places, key=score)


@router.get("", response_model=List[DestinationFull])
async def list_destinations():
    docs = await mongo_engine.find(Destination)
    return [_to_full(d) for d in docs]


@router.get("/{name}", response_model=DestinationFull)
async def get_destination(name: str):
    doc = await mongo_engine.find_one(Destination, Destination.name == name)
    if not doc:
        raise HTTPException(404, f"Destination '{name}' not found")
    return _to_full(doc)


@router.get("/{name}/nearby")
async def get_nearby(name: str, top_k: int = Query(8, ge=1, le=20)):
    doc = await mongo_engine.find_one(Destination, Destination.name == name)
    if not doc:
        raise HTTPException(404, "Destination not found")
    places = sorted(doc.nearby or [], key=lambda p: p.get("distance_km", 999))
    return {
        "destination": doc.name,
        "country": doc.country,
        "lat": doc.lat,
        "lng": doc.lng,
        "places": places[:top_k],
    }


class PlanRequest(BaseModel):
    destination: str
    days: int
    budget_per_day: Optional[float] = None
    interests: List[str] = []


@router.post("/plan")
async def build_plan(req: PlanRequest):
    """Generic plan builder: uses `days` count."""
    doc = await mongo_engine.find_one(Destination, Destination.name == req.destination)
    if not doc:
        raise HTTPException(404, "Destination not found")

    places = list(doc.nearby or [])
    if req.budget_per_day:
        places = [p for p in places if p.get("price_per_person", 0) <= req.budget_per_day]
    places = _rank_places(places, req.interests)

    days = max(1, min(req.days, 14))
    itinerary = _distribute(places, days)
    total = sum(day["estimated_cost"] for day in itinerary)
    return {
        "destination": doc.name,
        "country": doc.country,
        "days": days,
        "itinerary": itinerary,
        "total_activity_cost": total,
        "estimated_daily_cost": doc.avg_cost_per_day,
    }


class ItineraryQuery(BaseModel):
    destination: str
    start_date: date
    end_date: date
    interests: List[str] = []


@router.get("/{name}/itinerary")
async def build_itinerary(name: str,
                          start: str = Query(..., description="YYYY-MM-DD"),
                          end: str = Query(..., description="YYYY-MM-DD"),
                          interests: str = Query("", description="Comma-separated")):
    """
    Date-based itinerary.
    Given a start and end date, distributes nearby places day-by-day.
    Places are sorted by proximity to destination center, so the plan
    starts with the closest sights and ends with the farthest.
    """
    doc = await mongo_engine.find_one(Destination, Destination.name == name)
    if not doc:
        raise HTTPException(404, "Destination not found")

    try:
        start_d = datetime.strptime(start, "%Y-%m-%d").date()
        end_d = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Invalid date. Use YYYY-MM-DD")

    if end_d < start_d:
        raise HTTPException(400, "End date must be on or after start date")

    total_days = (end_d - start_d).days + 1
    total_days = max(1, min(total_days, 30))  # cap at 30

    interest_list = [i.strip().lower() for i in interests.split(",") if i.strip()]
    places = _rank_places(list(doc.nearby or []), interest_list)

    itinerary = _distribute(places, total_days, start_date=start_d)

    total = sum(day["estimated_cost"] for day in itinerary)
    return {
        "destination": doc.name,
        "country": doc.country,
        "start_date": start_d.isoformat(),
        "end_date": end_d.isoformat(),
        "days": total_days,
        "itinerary": itinerary,
        "total_activity_cost": total,
        "estimated_daily_cost": doc.avg_cost_per_day,
        "nearby_count": len(places),
    }


def _distribute(places: List[dict], days: int, start_date: Optional[date] = None) -> List[dict]:
    """
    Distribute places across days.
    - Day 1 always gets the closest place (arrival day).
    - Days are balanced; remaining places append to the last day.
    """
    if not places:
        out = []
        for d in range(1, days + 1):
            entry = {"day": d, "places": [], "estimated_cost": 0, "label": "Rest day"}
            if start_date:
                entry["date"] = (start_date.__class__.fromordinal(start_date.toordinal() + d - 1)).isoformat()
            out.append(entry)
        return out

    per_day = max(1, len(places) // days)
    itinerary = []
    idx = 0
    for d in range(1, days + 1):
        todays = places[idx: idx + per_day] if per_day else []
        idx += per_day
        cost = sum(p.get("price_per_person", 0) for p in todays)
        entry = {
            "day": d,
            "places": todays,
            "estimated_cost": cost,
            "label": _day_label(d, days, todays),
        }
        if start_date:
            entry["date"] = (start_date.__class__.fromordinal(start_date.toordinal() + d - 1)).isoformat()
        itinerary.append(entry)

    # Append leftovers to last day
    if idx < len(places):
        itinerary[-1]["places"].extend(places[idx:])
        itinerary[-1]["estimated_cost"] = sum(
            p.get("price_per_person", 0) for p in itinerary[-1]["places"]
        )
        itinerary[-1]["label"] = _day_label(days, days, itinerary[-1]["places"])
    return itinerary


def _day_label(day: int, total: int, places: List[dict]) -> str:
    if day == 1:
        return "Arrival & nearby"
    if day == total:
        return "Last day / departure"
    if not places:
        return "Rest day"
    return f"Explore day {day}"