from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

from app.routers.auth import get_current_user
from app.models import User
from app.db import mongo_client
from app.config import settings

router = APIRouter(prefix="/reviews", tags=["Reviews"])


def _clean(doc: dict) -> dict:
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


def _coll():
    return mongo_client[settings.MONGODB_DB]["reviews"]


class ReviewIn(BaseModel):
    destination_name: str
    rating: int = Field(5, ge=1, le=5)
    title: Optional[str] = ""
    comment: str = ""
    booking_id: Optional[int] = None


@router.post("", status_code=201)
async def create_review(payload: ReviewIn,
                        current_user: User = Depends(get_current_user)):
    coll = _coll()
    existing = await coll.find_one({
        "user_id": str(current_user.user_id),
        "destination_name": payload.destination_name,
    })
    if existing:
        raise HTTPException(400, "You already reviewed this destination")

    doc = {
        "user_id": str(current_user.user_id),
        "user_name": current_user.name,
        "destination_name": payload.destination_name,
        "rating": payload.rating,
        "title": payload.title or "",
        "comment": payload.comment,
        "booking_id": payload.booking_id,
        "created_at": datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _clean(doc)


@router.get("/me/list")
async def my_reviews(current_user: User = Depends(get_current_user)):
    docs = await _coll().find({"user_id": str(current_user.user_id)}) \
        .sort("created_at", -1).to_list(length=200)
    return [_clean(d) for d in docs]


@router.get("/{destination_name}")
async def list_reviews(destination_name: str):
    docs = await _coll().find({"destination_name": destination_name}) \
        .sort("created_at", -1).to_list(length=500)
    return [_clean(d) for d in docs]


@router.delete("/{review_id}", status_code=204)
async def delete_review(review_id: str,
                        current_user: User = Depends(get_current_user)):
    from bson import ObjectId
    try:
        oid = ObjectId(review_id)
    except Exception:
        raise HTTPException(400, "Invalid review id")

    coll = _coll()
    existing = await coll.find_one({"_id": oid})
    if not existing:
        raise HTTPException(404, "Review not found")
    if existing.get("user_id") != str(current_user.user_id) and current_user.role != "admin":
        raise HTTPException(403, "Not your review")
    await coll.delete_one({"_id": oid})