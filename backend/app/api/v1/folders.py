from __future__ import annotations
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select
from sqlalchemy import delete

from ..deps import SessionDep
from ...models import Folder, Paper, PaperFolderLink

router = APIRouter()

# ---------- Schemas ----------
class FolderCreate(BaseModel):
    name: str
    color: Optional[str] = None
    parent_id: Optional[int] = None

class FolderUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None

class AssignPayload(BaseModel):
    paper_ids: List[int]

# ---------- Helpers ----------
def _get_folder(session: SessionDep, folder_id: int) -> Folder:
    f = session.get(Folder, folder_id)
    if not f:
        raise HTTPException(status_code=404, detail="Folder Not Found")
    return f

# ---------- Routes ----------
@router.get("/", response_model=list[Folder])
def list_folders(session: SessionDep):
    return list(session.exec(select(Folder).order_by(Folder.name.asc())))

@router.post("/", response_model=Folder)
def create_folder(payload: FolderCreate, session: SessionDep):
    f = Folder(name=payload.name, color=payload.color, parent_id=payload.parent_id)
    session.add(f)
    session.commit()
    session.refresh(f)
    return f

@router.patch("/{folder_id}", response_model=Folder)
def update_folder(folder_id: int, payload: FolderUpdate, session: SessionDep):
    f = _get_folder(session, folder_id)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(f, k, v)
    session.add(f)
    session.commit()
    session.refresh(f)
    return f

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, session: SessionDep):
    # 仅删除目录及其与论文的关联，不动标签！
    f = _get_folder(session, folder_id)
    # 解除与论文的关系
    session.exec(delete(PaperFolderLink).where(PaperFolderLink.folder_id == folder_id))
    # 子目录提升到父级（或根）
    children = list(session.exec(select(Folder).where(Folder.parent_id == folder_id)))
    for ch in children:
        ch.parent_id = f.parent_id
        session.add(ch)
    session.delete(f)
    session.commit()
    return {"ok": True}

@router.post("/{folder_id}/assign")
def assign_papers(folder_id: int, payload: AssignPayload, session: SessionDep):
    _get_folder(session, folder_id)
    ids = list({int(x) for x in (payload.paper_ids or [])})
    if not ids:
        return {"ok": True}
    # 一篇论文只在一个目录：先清理旧的，再写新的
    session.exec(delete(PaperFolderLink).where(PaperFolderLink.paper_id.in_(ids)))
    for pid in ids:
        if session.get(Paper, pid):
            session.add(PaperFolderLink(paper_id=pid, folder_id=folder_id))
    session.commit()
    return {"ok": True}