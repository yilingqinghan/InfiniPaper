from typing import List
from fastapi import APIRouter, HTTPException
from sqlmodel import select
from ..deps import SessionDep
from ...models import Tag
from ...schemas import TagCreate, TagRead

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