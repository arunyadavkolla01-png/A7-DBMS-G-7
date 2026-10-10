import math
from collections import Counter
from app.db import mongo_engine
from app.models_mongo import Destination, TravelPreference


def _tokenize(text: str):
    return [t.lower() for t in text.split() if t.strip()]


def _term_freq(tokens):
    counts = Counter(tokens)
    n = len(tokens) or 1
    return {term: c / n for term, c in counts.items()}


def _idf(docs_tokens):
    n = len(docs_tokens)
    df = Counter()
    for toks in docs_tokens:
        for term in set(toks):
            df[term] += 1
    return {term: math.log((1 + n) / (1 + d)) + 1 for term, d in df.items()}


def _tfidf(tokens, idf):
    tf = _term_freq(tokens)
    return {term: tf[term] * idf.get(term, 0.0) for term in tf}


def _cosine(a, b):
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


TRAVEL_TYPE_BOOST = {
    "solo":     {"solo": 1.30, "friends": 1.10, "couple": 0.90, "family": 0.85, "business": 0.80},
    "couple":   {"couple": 1.30, "solo": 0.95, "friends": 0.90, "family": 0.80, "business": 0.75},
    "family":   {"family": 1.35, "couple": 0.95, "friends": 0.85, "solo": 0.70, "business": 0.60},
    "friends":  {"friends": 1.30, "solo": 1.10, "couple": 0.90, "family": 0.85, "business": 0.75},
    "business": {"business": 1.30, "solo": 1.05, "couple": 0.85, "friends": 0.85, "family": 0.65},
}


async def get_recommendations(user_id: str, top_n: int = 5):
    pref = await mongo_engine.find_one(
        TravelPreference, TravelPreference.user_id == user_id
    )
    all_destinations = await mongo_engine.find(Destination)
    if not all_destinations:
        return []

    if not pref:
        return sorted(all_destinations, key=lambda d: d.rating, reverse=True)[:top_n]

    travel_type = (pref.travel_type or "solo").lower()
    user_profile = " ".join(pref.interests + [pref.travel_style or "balanced", travel_type])

    dest_texts = [
        f"{d.name} {d.country} {' '.join(d.tags)} {d.description or ''}"
        for d in all_destinations
    ]
    docs_tokens = [_tokenize(t) for t in dest_texts]
    user_tokens = _tokenize(user_profile)
    idf = _idf(docs_tokens + [user_tokens])
    user_vec = _tfidf(user_tokens, idf)
    doc_vecs = [_tfidf(toks, idf) for toks in docs_tokens]

    scored = []
    for vec, dest in zip(doc_vecs, all_destinations):
        base = _cosine(user_vec, vec)
        dest_types = [t.lower() for t in (dest.travel_types or [])]
        boost = 1.0
        if dest_types:
            boost = max(TRAVEL_TYPE_BOOST.get(travel_type, {}).get(dt, 0.70)
                        for dt in dest_types)
        score = base * boost + (dest.rating or 0) * 0.02
        scored.append((score, dest))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [dest for _, dest in scored[:top_n]]