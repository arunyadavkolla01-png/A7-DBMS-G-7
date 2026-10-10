from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import re

from app.db import get_db
from app.models import DestinationEmbedding
from app.routers._chatbot_rules import rule_based_reply

router = APIRouter(prefix="/search", tags=["Search & RAG"])

# Common stop-words we don't want to OR against
STOPWORDS = {
    "a","an","the","is","are","was","were","be","been","being","to","of","in","on",
    "at","by","for","with","about","against","between","into","through","during",
    "before","after","above","below","from","up","down","out","off","over","under",
    "again","further","then","once","here","there","when","where","why","how","all",
    "any","both","each","few","more","most","other","some","such","no","nor","not",
    "only","own","same","so","than","too","very","can","will","just","should","now",
    "i","me","my","we","our","you","your","he","him","his","she","her","it","its",
    "they","them","their","what","which","who","whom","this","that","these","those",
    "am","do","does","did","doing","have","has","had","having","would","could",
    "place","places","visit","visiting","trip","travel","go","going","get","want",
}


def _build_or_query(q: str) -> str:
    """Convert a natural-language query into an OR tsquery string."""
    words = [w.lower() for w in re.split(r"[^\w]+", q) if w]
    words = [w for w in words if len(w) >= 3 and w not in STOPWORDS]
    if not words:
        return ""
    return " | ".join(words)


class Hit(BaseModel):
    destination_name: str
    content: str
    score: float
    image_url: str = ""
    country: str = ""


@router.get("/semantic", response_model=List[Hit])
async def semantic_search(q: str = Query(..., min_length=2),
                          top_k: int = Query(5, ge=1, le=20),
                          db: AsyncSession = Depends(get_db)):
    """Pure vector similarity search."""
    from app.services.embedding_service import embed
    qvec = embed(q)
    stmt = (
        select(
            DestinationEmbedding.destination_name,
            DestinationEmbedding.content,
            DestinationEmbedding.image_url,
            DestinationEmbedding.country,
            (1 - DestinationEmbedding.embedding.cosine_distance(qvec)).label("score"),
        )
        .order_by(DestinationEmbedding.embedding.cosine_distance(qvec))
        .limit(top_k)
    )
    rows = (await db.execute(stmt)).all()
    return [
        Hit(destination_name=r[0], content=r[1], image_url=r[2] or "",
            country=r[3] or "", score=float(r[4]))
        for r in rows
    ]


@router.get("/hybrid", response_model=List[Hit])
async def hybrid_search(q: str = Query(..., min_length=2),
                        top_k: int = Query(5, ge=1, le=20),
                        alpha: float = Query(0.6, ge=0, le=1),
                        db: AsyncSession = Depends(get_db)):
    """
    Hybrid search: vector similarity + OR-based full-text keyword match.
    Falls back to pure vector search if no keywords survive stop-word filtering.
    """
    from app.services.embedding_service import embed
    qvec = embed(q)
    kw_or = _build_or_query(q)

    # Pure vector search if no usable keywords
    if not kw_or:
        sql = text("""
            SELECT destination_name, content, image_url, country,
                   1 - (embedding <=> CAST(:qvec AS vector)) AS score
            FROM destination_embeddings
            ORDER BY embedding <=> CAST(:qvec AS vector)
            LIMIT :top_k
        """)
        rows = (await db.execute(sql, {"qvec": str(qvec), "top_k": top_k})).all()
    else:
        sql = text("""
            WITH vec AS (
                SELECT id,
                       1 - (embedding <=> CAST(:qvec AS vector)) AS sem_score,
                       ROW_NUMBER() OVER (ORDER BY embedding <=> CAST(:qvec AS vector)) AS sem_rank
                FROM destination_embeddings
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT 50
            ),
            kw AS (
                SELECT id,
                       ts_rank(content_tsv, to_tsquery('english', :kw_or)) AS kw_score,
                       ROW_NUMBER() OVER (
                           ORDER BY ts_rank(content_tsv, to_tsquery('english', :kw_or)) DESC
                       ) AS kw_rank
                FROM destination_embeddings
                WHERE content_tsv @@ to_tsquery('english', :kw_or)
                LIMIT 50
            )
            SELECT e.destination_name, e.content, e.image_url, e.country,
                   COALESCE(:alpha * (1.0 / (60 + v.sem_rank)), 0)
                 + COALESCE((1 - :alpha) * (1.0 / (60 + k.kw_rank)), 0) AS score
            FROM destination_embeddings e
            LEFT JOIN vec v ON v.id = e.id
            LEFT JOIN kw  k ON k.id = e.id
            WHERE v.id IS NOT NULL OR k.id IS NOT NULL
            ORDER BY score DESC
            LIMIT :top_k
        """)
        rows = (await db.execute(sql, {
            "qvec": str(qvec), "kw_or": kw_or, "alpha": alpha, "top_k": top_k,
        })).all()

    return [
        Hit(destination_name=r[0], content=r[1], image_url=r[2] or "",
            country=r[3] or "", score=float(r[4]))
        for r in rows
    ]


class ChatRequest(BaseModel):
    message: str
    history: List[dict] = []


class ChatResponse(BaseModel):
    reply: str
    sources: List[str] = []


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    return ChatResponse(reply=rule_based_reply(payload.message), sources=[])