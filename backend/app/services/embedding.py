from typing import List
from loguru import logger

# Placeholder: load real model (e.g., SPECTER2 via HF Transformers) in the future
def embed_texts(texts: List[str]) -> List[List[float]]:
    logger.warning("Embedding service is a stub; returning zero vectors.")
    return [[0.0]*768 for _ in texts]