
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, and_
from ..deps import SessionDep
from ...models import Paper, Tag, PaperTagLink
from ...schemas import PaperRead
from ...services.embedding import embed_texts

router = APIRouter()

@router.get("/", response_model=List[PaperRead])
def search(session: SessionDep, q: str = "", tags: Optional[str] = None, venue: Optional[str] = None,
           year_from: Optional[int] = None, year_to: Optional[int] = None,
           limit: int = 20, offset: int = 0):
    stmt = select(Paper)
    if q:
        stmt = stmt.where(Paper.title.ilike(f"%{q}%") | Paper.abstract.ilike(f"%{q}%"))
    if venue:
        stmt = stmt.where(Paper.venue.ilike(f"%{venue}%"))
    if year_from:
        stmt = stmt.where(Paper.year >= year_from)
    if year_to:
        stmt = stmt.where(Paper.year <= year_to)
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        for t in tag_list:
            stmt = stmt.where(Paper.id.in_(select(PaperTagLink.paper_id).join(Tag, Tag.id==PaperTagLink.tag_id).where(Tag.name==t)))
    stmt = stmt.offset(offset).limit(limit)
    return session.exec(stmt).all()

@router.get("/semantic", response_model=List[PaperRead])
def semantic(session: SessionDep, q: str, limit: int = 20, offset: int = 0):
    # simple semantic search using embeddings if available, otherwise fallback to keyword
    query_vec = embed_texts([q])[0]
    if sum(abs(x) for x in query_vec) < 1e-6:
        # fallback
        stmt = select(Paper).where(Paper.title.ilike(f"%{q}%") | Paper.abstract.ilike(f"%{q}%")).offset(offset).limit(limit)
        return session.exec(stmt).all()
    # naive linear search in Python for SQLite (no pgvector)
    papers = session.exec(select(Paper)).all()
    scored = []
    for p in papers:
        vec = getattr(p, "embedding", None) or getattr(p, "embedding_json", None)
        if not vec:
            continue
        # cosine similarity
        import math
        dot = sum(a*b for a,b in zip(vec, query_vec))
        na = math.sqrt(sum(a*a for a in vec))
        nb = math.sqrt(sum(b*b for b in query_vec))
        if na*nb == 0: 
            continue
        scored.append((dot/(na*nb), p))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[offset:offset+limit]]
