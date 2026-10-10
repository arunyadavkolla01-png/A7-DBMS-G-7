from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from motor.motor_asyncio import AsyncIOMotorClient
from odmantic import AIOEngine
from app.config import settings

# ── Postgres ──
engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# ── MongoDB ──
mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
mongo_engine = AIOEngine(client=mongo_client, database=settings.MONGODB_DB)


def get_mongo_engine() -> AIOEngine:
    return mongo_engine