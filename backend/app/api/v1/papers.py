from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from ..deps import SessionDep
from ...models import Paper, Tag, Author
from ...schemas import PaperCreate, PaperRead, PaperUpdate

router = APIRouter()

@router.get("/", response_model=List[PaperRead])
def list_papers(session: SessionDep, q: Optional[str] = None, limit: int = 50, offset: int = 0):
    stmt = select(Paper)
    if q:
        stmt = stmt.where(Paper.title.ilike(f"%{q}%"))
    stmt = stmt.offset(offset).limit(limit)
    items = session.exec(stmt).all()
    return items

@router.post("/", response_model=PaperRead)
def create_paper(data: PaperCreate, session: SessionDep):
    # Basic dedup by DOI
    if data.doi:
        exists = session.exec(select(Paper).where(Paper.doi == data.doi)).first()
        if exists:
            raise HTTPException(status_code=409, detail="Paper with this DOI already exists")
    paper = Paper(**data.dict(exclude={"tag_ids", "author_ids"}))
    session.add(paper)
    session.commit()
    session.refresh(paper)

    # Relations
    if data.tag_ids:
        tags = session.exec(select(Tag).where(Tag.id.in_(data.tag_ids))).all()
        paper.tags = tags
    if data.author_ids:
        authors = session.exec(select(Author).where(Author.id.in_(data.author_ids))).all()
        paper.authors = authors
    session.add(paper)
    session.commit()
    session.refresh(paper)
    return paper

@router.get("/{paper_id}", response_model=PaperRead)
def get_paper(paper_id: int, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper

@router.patch("/{paper_id}", response_model=PaperRead)
def update_paper(paper_id: int, data: PaperUpdate, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    for k, v in data.dict(exclude_unset=True, exclude={"tag_ids", "author_ids"}).items():
        setattr(paper, k, v)

    # Relations
    if data.tag_ids is not None:
        tags = session.exec(select(Tag).where(Tag.id.in_(data.tag_ids))).all()
        paper.tags = tags
    if data.author_ids is not None:
        authors = session.exec(select(Author).where(Author.id.in_(data.author_ids))).all()
        paper.authors = authors

    session.add(paper)
    session.commit()
    session.refresh(paper)
    return paper

@router.delete("/{paper_id}")
def delete_paper(paper_id: int, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    session.delete(paper)
    session.commit()
    return {"ok": True}