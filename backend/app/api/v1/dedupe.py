
from __future__ import annotations
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from sqlmodel import select, SQLModel
from rapidfuzz import fuzz
from ..deps import SessionDep
from ...models import Paper, PaperAuthorLink, Author

router = APIRouter()

def _key_title_author_year(p: Paper) -> str:
    year = p.year or ""
    title = (p.title or "").lower()
    # Collect authors' names
    auth_links = []
    # we'll return a combined key
    return f"{title}|{year}"

@router.get("/preview")
def preview(session: SessionDep, threshold: int = 90):
    """Return groups of potential duplicates (without DOI)."""
    papers = session.exec(select(Paper)).all()
    no_doi = [p for p in papers if not p.doi]
    groups: List[List[int]] = []
    visited = set()
    for i, p in enumerate(no_doi):
        if p.id in visited:
            continue
        group = [p.id]
        visited.add(p.id)
        for j in range(i+1, len(no_doi)):
            q = no_doi[j]
            if q.id in visited:
                continue
            score = fuzz.token_set_ratio((p.title or "").lower(), (q.title or "").lower())
            if p.year and q.year and p.year != q.year:
                score -= 10
            if score >= threshold:
                group.append(q.id); visited.add(q.id)
        if len(group) > 1:
            groups.append(group)
    return {"groups": groups, "count": len(groups)}

@router.post("/merge")
def merge(session: SessionDep, group: List[int], keep: int):
    """Merge a group of ids into `keep` id; moves links and deletes others."""
    if keep not in group:
        raise HTTPException(status_code=400, detail="keep must be in group list")
    survivor = session.get(Paper, keep)
    if not survivor:
        raise HTTPException(status_code=404, detail="keep paper not found")
    for pid in group:
        if pid == keep: 
            continue
        victim = session.get(Paper, pid)
        if not victim: 
            continue
        # Move author links
        for ln in session.exec(select(PaperAuthorLink).where(PaperAuthorLink.paper_id == pid)).all():
            ln.paper_id = keep
            session.add(ln)
        # Update missing fields on survivor
        if not survivor.doi and victim.doi: survivor.doi = victim.doi
        if not survivor.abstract and victim.abstract: survivor.abstract = victim.abstract
        if not survivor.venue and victim.venue: survivor.venue = victim.venue
        if not survivor.year and victim.year: survivor.year = victim.year
        session.delete(victim)
    session.commit()
    return {"ok": True, "keep": keep}
