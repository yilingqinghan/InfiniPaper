from __future__ import annotations
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Body
from sqlmodel import SQLModel, Field, select
from sqlalchemy import text

from ..deps import SessionDep
from ...models import Tag, PaperTagLink, Paper

router = APIRouter()

# 用 Tag 的扩展表把 Tag 当“目录”用（不改原表）
class TagExtra(SQLModel, table=True):
    tag_id: int = Field(primary_key=True, foreign_key="tag.id")
    is_folder: bool = Field(default=False, index=True)
    color: Optional[str] = None
    priority: int = Field(default=0)
    parent_tag_id: Optional[int] = Field(default=None, foreign_key="tag.id")

def _ensure_tables(session: SessionDep):
    session.exec(text("""
        CREATE TABLE IF NOT EXISTS tagextra(
          tag_id INTEGER PRIMARY KEY REFERENCES tag(id) ON DELETE CASCADE,
          is_folder BOOLEAN DEFAULT 0,
          color TEXT NULL,
          priority INTEGER DEFAULT 0,
          parent_tag_id INTEGER NULL REFERENCES tag(id)
        );
    """))
    session.commit()

def _payload(t: Tag, e: TagExtra|None) -> Dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "color": e.color if e else None,
        "priority": int(e.priority) if e else 0,
        "parent_id": e.parent_tag_id if e else None,
    }

@router.get("/", response_model=list[dict])
def list_folders(session: SessionDep):
    _ensure_tables(session)
    rows = list(
        session.exec(
            select(Tag, TagExtra)
            .join(TagExtra, TagExtra.tag_id == Tag.id)
            .where(TagExtra.is_folder == True)
        )
    )
    out = [_payload(t, e) for (t, e) in rows]
    out.sort(key=lambda x: (-int(x.get("priority") or 0), x["name"]))
    return out

@router.post("/", response_model=dict)
def create_folder(
    session: SessionDep,
    name: str = Body(...),
    color: Optional[str] = Body(None),
    priority: int = Body(0),
    parent_id: Optional[int] = Body(None),
):
    _ensure_tables(session)
    if session.exec(select(Tag).where(Tag.name == name)).first():
        raise HTTPException(400, "Folder name already exists")
    t = Tag(name=name)
    session.add(t); session.commit(); session.refresh(t)
    e = TagExtra(tag_id=t.id, is_folder=True, color=color, priority=priority, parent_tag_id=parent_id)
    session.add(e); session.commit()
    return _payload(t, e)

@router.patch("/{folder_id}", response_model=dict)
def update_folder(
    folder_id: int,
    session: SessionDep,
    name: Optional[str] = Body(None),
    color: Optional[str] = Body(None),
    priority: Optional[int] = Body(None),
    parent_id: Optional[int] = Body(None),
):
    _ensure_tables(session)
    t = session.get(Tag, folder_id)
    e = session.get(TagExtra, folder_id)
    if not t or not e or not e.is_folder:
        raise HTTPException(404, "Not found")
    if name: t.name = name
    if color is not None: e.color = color
    if priority is not None: e.priority = int(priority)
    if parent_id is not None: e.parent_tag_id = parent_id
    session.add(t); session.add(e); session.commit()
    return _payload(t, e)

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, session: SessionDep):
    _ensure_tables(session)
    e = session.get(TagExtra, folder_id)
    if not e or not e.is_folder:
        raise HTTPException(404, "Not found")
    session.exec(text("DELETE FROM papertaglink WHERE tag_id = :tid")).params(tid=folder_id)
    session.delete(e)
    t = session.get(Tag, folder_id)
    if t: session.delete(t)
    session.commit()
    return {"ok": True}

class AssignBody(SQLModel):
    paper_ids: List[int]

@router.post("/{folder_id}/assign")
def assign_papers(folder_id: int, body: AssignBody, session: SessionDep):
    _ensure_tables(session)
    e = session.get(TagExtra, folder_id)
    if not e or not e.is_folder:
        raise HTTPException(400, "Not a folder")
    if not body.paper_ids:
        return {"ok": True, "count": 0}
    session.exec(text(f"""
        DELETE FROM papertaglink
        WHERE paper_id IN ({",".join(str(int(i)) for i in body.paper_ids)})
          AND tag_id IN (SELECT tag_id FROM tagextra WHERE is_folder = 1)
    """))
    for pid in body.paper_ids:
        session.add(PaperTagLink(paper_id=int(pid), tag_id=folder_id))
    session.commit()
    return {"ok": True, "count": len(body.paper_ids)}

@router.get("/{folder_id}/papers", response_model=list[dict])
def list_papers_in_folder(folder_id: int, session: SessionDep):
    _ensure_tables(session)
    rows = session.exec(
        select(Paper.id, Paper.title)
        .join(PaperTagLink, PaperTagLink.paper_id == Paper.id)
        .where(PaperTagLink.tag_id == folder_id)
    ).all()
    return [{"id": r[0], "title": r[1]} for r in rows]
