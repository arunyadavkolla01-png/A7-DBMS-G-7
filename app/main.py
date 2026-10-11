from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import engine, Base, mongo_client
from app.routers import (
    auth, bookings, admin, search, reviews,
    payments, tours, recommendations, destinations,
)
from app.services.event_bus import shutdown as stop_bus
from app import models  # noqa: F401  (import so tables register)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await stop_bus()
    await engine.dispose()
    mongo_client.close()


app = FastAPI(title="TripWise API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(bookings.router)
app.include_router(admin.router)
app.include_router(search.router)
app.include_router(reviews.router)
app.include_router(payments.router)
app.include_router(tours.router)
app.include_router(recommendations.router)
app.include_router(destinations.router)


@app.get("/")
def root():
    return {"message": "TripWise API", "status": "running", "version": "2.0.0"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "tripwise", "port": 8000}