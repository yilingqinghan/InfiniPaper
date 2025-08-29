
from typing import List
from loguru import logger

_model = None

def _load_model():
    global _model
    if _model is not None:
        return _model
    try:
        from sentence_transformers import SentenceTransformer
        # lightweight, runs on Mac M-series; downloads on first run
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Loaded sentence-transformers model all-MiniLM-L6-v2")
    except Exception as e:
        logger.warning(f"Falling back to stub embeddings: {e}")
        _model = None
    return _model

def embed_texts(texts: List[str]) -> List[List[float]]:
    m = _load_model()
    if m is None:
        logger.warning("Embedding service is using stub; returning zero vectors.")
        return [[0.0]*384 for _ in texts]
    vecs = m.encode(texts, show_progress_bar=False, convert_to_numpy=True).tolist()
    return vecs
