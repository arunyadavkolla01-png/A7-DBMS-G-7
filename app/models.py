from sqlalchemy import (
    Column, String, DateTime, BigInteger, Numeric, Date, Integer,
    ForeignKey, func, Text, Index,
)
from sqlalchemy.dialects.postgresql import JSONB, CHAR
from pgvector.sqlalchemy import Vector
from app.db import Base
from sqlalchemy import Column, BigInteger, String, Text, DateTime, Index, Computed
from sqlalchemy.dialects.postgresql import TSVECTOR
from pgvector.sqlalchemy import Vector
from app.db import Base

class User(Base):
    __tablename__ = "users"
    user_id         = Column(BigInteger, primary_key=True, autoincrement=True)
    name            = Column(String(100), nullable=False)
    email           = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    phone           = Column(String(20))
    role            = Column(String(20), nullable=False, default="user")
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())


class UserPreference(Base):
    __tablename__ = "user_preferences"
    pref_id                = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id                = Column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"))
    seat_class             = Column(String(50), default="Economy")
    hotel_rating           = Column(Integer)
    budget_min             = Column(Numeric(10, 2))
    budget_max             = Column(Numeric(10, 2))
    preferred_airlines     = Column(JSONB, default=list)
    preferred_destinations = Column(JSONB, default=list)
    travel_interests       = Column(JSONB, default=list)
    language               = Column(String(10), default="en")


class Booking(Base):
    __tablename__ = "bookings"
    booking_id     = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id        = Column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"))
    status         = Column(String(20), nullable=False, default="pending")
    payment_status = Column(String(20), nullable=False, default="unpaid")
    payment_id     = Column(String(64))
    total_price    = Column(Numeric(12, 2), nullable=False)
    currency       = Column(CHAR(3), default="INR")
    plan           = Column(JSONB, default=list)
    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())


class FlightBooking(Base):
    __tablename__ = "flight_bookings"
    flight_id    = Column(BigInteger, primary_key=True, autoincrement=True)
    booking_id   = Column(BigInteger, ForeignKey("bookings.booking_id", ondelete="CASCADE"))
    provider     = Column(String(50), nullable=False)
    origin       = Column(CHAR(3), nullable=False)
    destination  = Column(CHAR(3), nullable=False)
    depart_time  = Column(DateTime, nullable=False)
    return_time  = Column(DateTime)
    passengers   = Column(JSONB, nullable=False)
    price        = Column(Numeric(10, 2), nullable=False)
    currency     = Column(CHAR(3), nullable=False)


class HotelBooking(Base):
    __tablename__ = "hotel_bookings"
    hotel_booking_id = Column(BigInteger, primary_key=True, autoincrement=True)
    booking_id       = Column(BigInteger, ForeignKey("bookings.booking_id", ondelete="CASCADE"))
    provider         = Column(String(50), nullable=False)
    hotel_name       = Column(String(255), nullable=False)
    checkin_date     = Column(Date, nullable=False)
    checkout_date    = Column(Date, nullable=False)
    rooms            = Column(JSONB, nullable=False)
    price            = Column(Numeric(10, 2), nullable=False)
    currency         = Column(CHAR(3), default="INR")


class TourBooking(Base):
    __tablename__ = "tour_bookings"
    tour_id       = Column(BigInteger, primary_key=True, autoincrement=True)
    booking_id    = Column(BigInteger, ForeignKey("bookings.booking_id", ondelete="CASCADE"))
    tour_name     = Column(String(255), nullable=False)
    destination   = Column(String(100))
    tour_date     = Column(Date, nullable=False)
    duration_days = Column(Integer)
    passengers    = Column(JSONB, default=list)
    price         = Column(Numeric(10, 2), nullable=False)
    currency      = Column(CHAR(3), default="INR")


class SeatInventory(Base):
    __tablename__ = "seat_inventory"
    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    route        = Column(String(10), nullable=False)
    depart_date  = Column(Date, nullable=False)
    total_seats  = Column(Integer, nullable=False, default=50)
    booked_seats = Column(Integer, nullable=False, default=0)
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Payment(Base):
    __tablename__ = "payments"
    payment_id  = Column(String(64), primary_key=True)
    booking_id  = Column(BigInteger, ForeignKey("bookings.booking_id", ondelete="CASCADE"))
    user_id     = Column(BigInteger, ForeignKey("users.user_id", ondelete="CASCADE"))
    amount      = Column(Numeric(12, 2), nullable=False)
    currency    = Column(CHAR(3), nullable=False, default="INR")
    status      = Column(String(20), nullable=False, default="pending")
    method      = Column(String(30), nullable=False, default="qr_simulated")
    qr_payload  = Column(String)
    created_at  = Column(DateTime, server_default=func.now())
    paid_at     = Column(DateTime)


class DestinationEmbedding(Base):
    __tablename__ = "destination_embeddings"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    destination_name = Column(String(120), unique=True, nullable=False)
    content = Column(Text, nullable=False)
    image_url = Column(String(500), default="")
    country = Column(String(100), default="")
    embedding = Column(Vector(384))

    # ADD THIS LINE TO FIX HYBRID SEARCH
    content_tsv = Column(TSVECTOR, Computed("to_tsvector('english', content)", persisted=True))

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_dest_emb_hnsw", "embedding",
              postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
        Index("idx_dest_emb_tsv", "content_tsv", postgresql_using="gin"),
    )