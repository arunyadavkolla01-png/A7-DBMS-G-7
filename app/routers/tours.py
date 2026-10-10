from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel

from app.db import mongo_engine
from app.models_mongo import Tour

router = APIRouter(prefix="/tours", tags=["Tours"])


class TourOut(BaseModel):
    id:               str
    name:             str
    destination:      str
    country:          str
    description:      str
    image_url:        str
    duration_days:    int
    price_per_person: float
    rating:           float
    tags:             List[str]
    highlights:       List[str]


def _to_out(t: Tour) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "destination": t.destination,
        "country": t.country,
        "description": t.description or "",
        "image_url": t.image_url or "",
        "duration_days": t.duration_days,
        "price_per_person": t.price_per_person,
        "rating": t.rating,
        "tags": t.tags or [],
        "highlights": t.highlights or [],
    }


@router.get("", response_model=List[TourOut])
async def list_tours(
    destination: Optional[str] = Query(None),
    max_days:    Optional[int] = Query(None),
):
    docs = await mongo_engine.find(Tour)
    out = [_to_out(t) for t in docs]
    if destination:
        d = destination.lower()
        out = [t for t in out if d in t["destination"].lower()]
    if max_days:
        out = [t for t in out if t["duration_days"] <= max_days]
    return out


@router.get("/{tour_id}", response_model=TourOut)
async def get_tour(tour_id: str):
    doc = await mongo_engine.find_one(Tour, Tour.id == tour_id)
    if not doc:
        raise HTTPException(404, "Tour not found")
    return _to_out(doc)