from typing import List, Optional
from datetime import datetime
from odmantic import Model, Field


class TravelPreference(Model):
    user_id: str
    travel_type: Optional[str] = "solo"
    travel_style: Optional[str] = "balanced"
    interests: List[str] = []
    preferred_climate: Optional[str] = None
    dietary_restrictions: List[str] = []
    accessibility_needs: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = {"collection": "preferences"}


class TravelHistory(Model):
    user_id: str
    destinations: List[dict] = []
    total_trips: int = 0
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = {"collection": "travel_history"}


class Destination(Model):
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
    model_config = {"collection": "destinations"}


class Review(Model):
    user_id: str
    user_name: str
    destination_name: str
    booking_id: Optional[int] = None
    rating: int = 5
    title: Optional[str] = ""
    comment: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    model_config = {"collection": "reviews"}


class Tour(Model):
    name:             str
    destination:      str
    country:          str
    description:      Optional[str] = ""
    image_url:        Optional[str] = ""
    duration_days:    int = 3
    price_per_person: float = 0.0
    rating:           float = 0.0
    tags:             List[str] = []
    highlights:       List[str] = []
    created_at:       datetime = Field(default_factory=datetime.utcnow)
    model_config = {"collection": "tours"}