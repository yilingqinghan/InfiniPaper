# backend/app/api/v1/folders.py
from __future__ import annotations
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select
from sqlalchemy import delete

from ..deps import SessionDep
from ...models import Tag, Paper, PaperTagLink

router = APIRouter()

class FolderCreate(BaseModel):
    name: str
    color: Optional[str] = None
    parent_id: Optional[int] = None
    priority: Optional[int] = None

class FolderUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None
    priority: Optional[int] = None

class AssignPayload(BaseModel):
    paper_ids: List[int]

def _to_payload(t: Tag) -> Dict[str, Any]:
    return {
        "id": getattr(t, "id", None),
        "name": getattr(t, "name", None),
        "color": getattr(t, "color", None) if hasattr(t, "color") else None,
        "parent_id": getattr(t, "parent_id", None) if hasattr(t, "parent_id") else None,
        "priority": getattr(t, "priority", None) if hasattr(t, "priority") else None,
    }

def _set_folder_flag(t: Tag):
    if hasattr(t, "is_folder"):
        setattr(t, "is_folder", True)
    elif hasattr(t, "type"):
        try:
            setattr(t, "type", "folder")
        except Exception:
            pass

@router.get("/", response_model=list[dict])
def list_folders(session: SessionDep):
    stmt = select(Tag)
    if hasattr(Tag, "is_folder"):
        stmt = stmt.where(getattr(Tag, "is_folder") == True)  # noqa: E712
    elif hasattr(Tag, "type"):
        stmt = stmt.where(getattr(Tag, "type") == "folder")
    return [_to_payload(t) for t in session.exec(stmt)]

@router.post("/", response_model=dict)
def create_folder(data: FolderCreate, session: SessionDep):
    kwargs: Dict[str, Any] = {"name": data.name}
    for f in ("color", "parent_id", "priority"):
        if getattr(data, f) is not None and hasattr(Tag, f):
            kwargs[f] = getattr(data, f)
    try:
        t = Tag(**kwargs)  # type: ignore[arg-type]
    except TypeError:
        t = Tag(name=data.name)  # type: ignore[call-arg]
    _set_folder_flag(t)
    session.add(t)
    session.commit()
    session.refresh(t)
    return _to_payload(t)

@router.patch("/{folder_id}", response_model=dict)
def update_folder(folder_id: int, data: FolderUpdate, session: SessionDep):
    t = session.get(Tag, folder_id)
    if not t:
        raise HTTPException(status_code=404, detail="Not Found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if hasattr(t, k):
            setattr(t, k, v)
    _set_folder_flag(t)
    session.add(t)
    session.commit()
    session.refresh(t)
    return _to_payload(t)

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, session: SessionDep):
    t = session.get(Tag, folder_id)
    if not t:
        raise HTTPException(status_code=404, detail="Not Found")
    # 正确做法：用 SQLAlchemy delete 表达式（不会触发绑定参数错误）
    session.exec(delete(PaperTagLink).where(PaperTagLink.tag_id == folder_id))
    session.delete(t)
    session.commit()
    return {"ok": True}

@router.post("/{folder_id}/assign")
def assign_papers(folder_id: int, payload: AssignPayload, session: SessionDep):
    folder = session.get(Tag, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder Not Found")
    ids = [pid for pid in payload.paper_ids if session.get(Paper, pid)]
    for pid in ids:
        exists = session.exec(
            select(PaperTagLink).where(
                (PaperTagLink.paper_id == pid) & (PaperTagLink.tag_id == folder_id)
            )
        ).first()
        if not exists:
            session.add(PaperTagLink(paper_id=pid, tag_id=folder_id))
    session.commit()
    return {"ok": True, "count": len(ids)}

@router.post("/{folder_id}/unassign")
def unassign_papers(folder_id: int, payload: AssignPayload, session: SessionDep):
    session.exec(
        delete(PaperTagLink).where(
            (PaperTagLink.tag_id == folder_id) & (PaperTagLink.paper_id.in_(payload.paper_ids))
        )
    )
    session.commit()
    return {"ok": True, "count": len(payload.paper_ids)}
