from __future__ import annotations
from typing import List
from fastapi import APIRouter, HTTPException
from sqlmodel import select
from sqlalchemy import delete
from loguru import logger

from ..deps import SessionDep
from ...models import Tag, PaperTagLink
from ...schemas import TagRead, TagCreate

router = APIRouter()

@router.get("/", response_model=list[TagRead])
def list_tags(session: SessionDep):
    rows = list(session.exec(select(Tag)))
    logger.info(f"[tags.list] total={len(rows)} -> {[t.name for t in rows]}")
    return rows

@router.post("/", response_model=TagRead)
def create_tag(payload: TagCreate, session: SessionDep):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="empty name")
    existing = session.exec(select(Tag).where(Tag.name == name)).first()
    if existing:
        return existing
    t = Tag(name=name)
    session.add(t)
    session.commit()
    session.refresh(t)
    logger.info(f"[tags.create] tag#{t.id} '{t.name}' created")
    return t

@router.delete("/{tag_id}")
def delete_tag(tag_id: int, session: SessionDep):
    t = session.get(Tag, tag_id)
    if not t:
        raise HTTPException(status_code=404, detail="Not Found")
    # 先删关联，再删标签，避免“孤儿 link”
    r1 = session.exec(delete(PaperTagLink).where(PaperTagLink.tag_id == tag_id))
    session.delete(t)
    session.commit()
    logger.info(f"[tags.delete] tag#{tag_id} '{t.name}' removed, links={getattr(r1, 'rowcount', None)}")
    return {"ok": True}