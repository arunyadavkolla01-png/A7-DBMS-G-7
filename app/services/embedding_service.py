import logging
from typing import List
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)
_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info("Loading embedding model %s …", _MODEL_NAME)
        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def embed(text: str) -> List[float]:
    vec = get_model().encode([text], normalize_embeddings=True)[0]
    return vec.tolist()


def embed_batch(texts: List[str]) -> List[List[float]]:
    vecs = get_model().encode(texts, normalize_embeddings=True, batch_size=32)
    return [v.tolist() for v in vecs]