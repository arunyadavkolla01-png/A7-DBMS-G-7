from fastapi import APIRouter, Depends
from app.routers.auth import get_current_user
from app.models import User
from app.services.recommendation_service import get_recommendations

router = APIRouter(prefix="/recommendations", tags=["AI Recommendations"])


@router.get("")
async def recommendations(current_user: User = Depends(get_current_user)):
    recs = await get_recommendations(str(current_user.user_id), top_n=6)
    return [{
        "name": r.name, "country": r.country, "description": r.description,
        "image_url": r.image_url, "tags": r.tags,
        "travel_types": r.travel_types,
        "avg_cost_per_day": r.avg_cost_per_day,
        "best_season": r.best_season, "rating": r.rating,
    } for r in recs]


@router.get("/all")
async def all_destinations():
    from app.db import mongo_engine
    from app.models_mongo import Destination
    docs = await mongo_engine.find(Destination)
    return [{
        "name": d.name, "country": d.country, "description": d.description,
        "image_url": d.image_url, "tags": d.tags,
        "travel_types": d.travel_types,
        "avg_cost_per_day": d.avg_cost_per_day,
        "best_season": d.best_season, "rating": d.rating,
    } for d in docs]