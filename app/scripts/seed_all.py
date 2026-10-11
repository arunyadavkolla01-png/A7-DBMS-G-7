import asyncio
from datetime import datetime, timedelta
from sqlalchemy import delete, select

from app.db import AsyncSessionLocal, mongo_engine, mongo_client
from app.models import User, DestinationEmbedding
from app.models_mongo import Destination, Tour, Review
from app.utils.security import hash_password
from app.services.embedding_service import embed_batch
from app.config import settings

from app.scripts._data_destinations import DESTINATIONS
from app.scripts._data_tours import TOURS
from app.scripts._data_reviews import FAKE_REVIEWS
from app.scripts._place_images import pick_place_image

ADMIN_EMAIL    = "admin@tripwise.com"
ADMIN_PASSWORD = "admin1234"
ADMIN_NAME     = "Admin"
ADMIN_PHONE    = "+91 90000 00000"


def build_content(d: dict) -> str:
    return (
        f"{d['name']} in {d['country']}. {d.get('description','')} "
        f"Tags: {', '.join(d.get('tags',[]))}. "
        f"Best for: {', '.join(d.get('travel_types',[]))} travellers. "
        f"Average cost per day: ${d.get('avg_cost_per_day',0)}. "
        f"Best season: {d.get('best_season','year-round')}. "
        f"Rating: {d.get('rating',0)}/5."
    )


async def seed_admin():
    async with AsyncSessionLocal() as db:
        existing = (await db.execute(
            select(User).where(User.email == ADMIN_EMAIL)
        )).scalar_one_or_none()
        if existing:
            existing.hashed_password = hash_password(ADMIN_PASSWORD)
            existing.role = "admin"
            print(f"[pg] updated admin {ADMIN_EMAIL}")
        else:
            db.add(User(
                name=ADMIN_NAME, email=ADMIN_EMAIL,
                hashed_password=hash_password(ADMIN_PASSWORD),
                phone=ADMIN_PHONE, role="admin",
            ))
            print(f"[pg] created admin {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        await db.commit()


async def seed_destinations():
    coll = mongo_client[settings.MONGODB_DB]["destinations"]
    await coll.delete_many({})
    print(f"[mongo] inserting {len(DESTINATIONS)} destinations")
    for row in DESTINATIONS:
        (name, country, image, tags, ttypes, cost, season, rating, desc,
         lat, lng, nearby) = row

        # Auto-assign a relevant image to every nearby place
        enriched_nearby = []
        for place in nearby:
            p = dict(place)
            p["image_url"] = pick_place_image(
                p.get("name", ""),
                p.get("description", ""),
            )
            enriched_nearby.append(p)

        await coll.insert_one({
            "name": name, "country": country, "description": desc,
            "image_url": image, "tags": tags, "travel_types": ttypes,
            "avg_cost_per_day": cost, "best_season": season, "rating": rating,
            "lat": lat, "lng": lng, "nearby": enriched_nearby,
        })
    print(f"[mongo] destinations = {await coll.count_documents({})}")

async def seed_tours():
    await mongo_engine.remove(Tour)
    for t in TOURS:
        await mongo_engine.save(Tour(**t))
    print(f"[mongo] tours = {await mongo_engine.count(Tour)}")


async def seed_reviews():
    await mongo_engine.remove(Review)
    for name, dest, rating, title, comment in FAKE_REVIEWS:
        await mongo_engine.save(Review(
            user_id=f"fake_{name.lower().replace(' ', '_')}",
            user_name=name, destination_name=dest,
            rating=rating, title=title, comment=comment,
            created_at=datetime.utcnow() - timedelta(days=len(FAKE_REVIEWS)),
        ))
    print(f"[mongo] reviews = {await mongo_engine.count(Review)}")


async def seed_embeddings():
    coll = mongo_client[settings.MONGODB_DB]["destinations"]
    docs = await coll.find({}).to_list(length=1000)
    print(f"[pg] embedding {len(docs)} destinations (first run downloads ~90 MB)")
    contents = [build_content(d) for d in docs]
    vectors = embed_batch(contents)
    async with AsyncSessionLocal() as db:
        await db.execute(delete(DestinationEmbedding))
        for d, txt, vec in zip(docs, contents, vectors):
            db.add(DestinationEmbedding(
                destination_name=d["name"], content=txt,
                image_url=d.get("image_url", ""),
                country=d.get("country", ""),
                embedding=vec,
            ))
        await db.commit()
    print(f"[pg] destination_embeddings = {len(docs)}")


async def main():
    await seed_admin()
    await seed_destinations()
    await seed_tours()
    await seed_reviews()
    await seed_embeddings()
    print("\n✅ All seeds complete.")


if __name__ == "__main__":
    asyncio.run(main())