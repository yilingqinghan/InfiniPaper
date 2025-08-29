from typing import List
from loguru import logger

def recommend_similar(paper_id: int) -> List[int]:
    logger.info(f"Recommender stub invoked for paper_id={paper_id}")
    return []