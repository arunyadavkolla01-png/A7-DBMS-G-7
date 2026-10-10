from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional

from app.db import get_db, mongo_engine
from app.models import User
from app.models_mongo import TravelPreference
from app.utils.security import (
    UserRegister, TokenResponse, UserResponse,
    hash_password, verify_password, create_access_token, decode_access_token,
)
from app.services.event_bus import publish

router = APIRouter(tags=["Auth & Profile"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

ADMIN_EMAIL = "admin@tripwise.com"


def _is_admin_email(email: str) -> bool:
    return (email or "").strip().lower() == ADMIN_EMAIL


@router.post("/auth/register", response_model=UserResponse)
async def register(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    if _is_admin_email(user_data.email):
        raise HTTPException(403, "This email is reserved.")
    existing = await db.execute(select(User).where(User.email == user_data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    new_user = User(
        name=user_data.name,
        email=user_data.email,
        hashed_password=hash_password(user_data.password),
        phone=user_data.phone,
        role="user",
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    await publish("user.registered", {
        "user_id": new_user.user_id,
        "email": new_user.email,
        "name": new_user.name,
    })

    return UserResponse(
        user_id=str(new_user.user_id),
        name=new_user.name,
        email=new_user.email,
        role=new_user.role,
    )


@router.post("/auth/login", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends(),
                db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if _is_admin_email(user.email):
        if user.role != "admin":
            user.role = "admin"
            await db.commit()
        effective_role = "admin"
    else:
        if user.role == "admin":
            user.role = "user"
            await db.commit()
        effective_role = "user"

    token = create_access_token({
        "sub": str(user.user_id),
        "email": user.email,
        "role": effective_role,
    })
    return TokenResponse(access_token=token, token_type="bearer")


async def get_current_user(token: str = Depends(oauth2_scheme),
                           db: AsyncSession = Depends(get_db)) -> User:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    try:
        uid = int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(401, "Invalid token payload")
    result = await db.execute(select(User).where(User.user_id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not _is_admin_email(current_user.email) or current_user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return current_user


class PreferenceRequest(BaseModel):
    seat_class: Optional[str] = "Economy"
    hotel_rating: Optional[int] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    travel_interests: List[str] = []
    travel_type: Optional[str] = "solo"


@router.get("/profile/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "user_id": current_user.user_id,
        "user_ref": f"TW-US-{current_user.user_id:08d}",
        "name": current_user.name,
        "email": current_user.email,
        "phone": current_user.phone,
        "role": current_user.role,
    }


@router.post("/profile/preferences")
async def save_preferences(prefs: PreferenceRequest,
                           current_user: User = Depends(get_current_user)):
    user_id = str(current_user.user_id)
    existing = await mongo_engine.find_one(
        TravelPreference, TravelPreference.user_id == user_id
    )
    if existing:
        existing.interests = prefs.travel_interests
        existing.travel_style = prefs.seat_class.lower()
        existing.travel_type = prefs.travel_type or "solo"
        await mongo_engine.save(existing)
    else:
        new_pref = TravelPreference(
            user_id=user_id,
            interests=prefs.travel_interests,
            travel_style=prefs.seat_class.lower(),
            travel_type=prefs.travel_type or "solo",
        )
        await mongo_engine.save(new_pref)
    return {"status": "saved", "user_id": user_id, "travel_type": prefs.travel_type}


@router.get("/profile/preferences")
async def get_preferences(current_user: User = Depends(get_current_user)):
    user_id = str(current_user.user_id)
    pref = await mongo_engine.find_one(
        TravelPreference, TravelPreference.user_id == user_id
    )
    if not pref:
        return {"travel_type": "solo", "interests": [], "travel_style": "balanced"}
    return {
        "travel_type": pref.travel_type or "solo",
        "interests": pref.interests,
        "travel_style": pref.travel_style,
    }