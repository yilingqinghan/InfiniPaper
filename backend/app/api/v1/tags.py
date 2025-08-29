from typing import List
from fastapi import APIRouter, HTTPException
from sqlmodel import select
from ..deps import SessionDep
from ...models import Tag, PaperTagLink
from ...schemas import TagCreate, TagRead
from sqlalchemy import delete

router = APIRouter()

@router.get("/", response_model=List[TagRead])
def list_tags(session: SessionDep):
    return session.exec(select(Tag)).all()

@router.post("/", response_model=TagRead)
def create_tag(data: TagCreate, session: SessionDep):
    exists = session.exec(select(Tag).where(Tag.name == data.name)).first()
    if exists:
        raise HTTPException(status_code=409, detail="Tag exists")
    tag = Tag(**data.dict())
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag

@router.delete("/{tag_id}")
def delete_tag(tag_id: int, session: SessionDep):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    session.delete(tag)
    session.commit()
    return {"ok": True}

@router.post("/suggest")
def suggest_tags(payload: dict, session: SessionDep):
    """
    Suggest tags from given text and existing tags.
    payload = {"text": "...", "top_k": 8}
    """
    text = (payload.get("text") or "").lower()
    top_k = int(payload.get("top_k") or 8)
    # naive keyword extraction
    stop = set("""a an the and or of for in on with by to from over under within across about among toward against as is are was were be been being
    this that these those it its into due via can could may might shall should will would do does did not no nor so than then thus very more less
    we you they i he she him her their our your""".split())
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{2,}", text)
    freq = {}
    for w in words:
        if w in stop: continue
        freq[w] = freq.get(w, 0) + 1
    candidates = sorted(freq.items(), key=lambda x: (-x[1], x[0]))[:top_k*2]
    # include existing tags with partial match boost
    existing = [t.name for t in session.exec(select(Tag)).all()]
    scored = []
    for w, c in candidates:
        score = c + (2 if any(w in t.lower() or t.lower() in w for t in existing) else 0)
        scored.append((score, w))
    scored.sort(reverse=True)
    return {"suggestions": [w for _, w in scored[:top_k]]}
