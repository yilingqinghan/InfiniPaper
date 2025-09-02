from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Response
from sqlmodel import select
from ..deps import SessionDep
from ...models import MdNote, Paper
from ...schemas import MdNoteCreate, MdNoteRead, MdNoteUpdate

router = APIRouter()

@router.get("/", response_model=List[MdNoteRead])
def list_mdnotes(session: SessionDep, paper_id: int | None = None):
    stmt = select(MdNote)
    if paper_id:
        stmt = stmt.where(MdNote.paper_id == paper_id)
    return session.exec(stmt).all()

@router.get("/by-paper/{paper_id}", response_model=Optional[MdNoteRead])
def get_by_paper(paper_id: int, session: SessionDep):
    stmt = select(MdNote).where(MdNote.paper_id == paper_id).order_by(MdNote.id.asc())
    return session.exec(stmt).first()

@router.post("/", response_model=MdNoteRead)
def create_mdnote(data: MdNoteCreate, session: SessionDep):
    # 校验 paper 是否存在
    paper = session.get(Paper, data.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    note = MdNote(paper_id=data.paper_id, content=data.content or "")
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@router.put("/by-paper/{paper_id}", response_model=MdNoteRead)
def upsert_by_paper(paper_id: int, data: MdNoteUpdate, session: SessionDep):
    note = session.exec(select(MdNote).where(MdNote.paper_id == paper_id)).first()
    content = (data.content or "")
    if note:
        note.content = content
        note.updated_at = datetime.utcnow()
        session.add(note)
    else:
        # 确保 paper 存在
        paper = session.get(Paper, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        note = MdNote(paper_id=paper_id, content=content)
        session.add(note)
    session.commit()
    session.refresh(note)
    return note

@router.patch("/{note_id}", response_model=MdNoteRead)
def patch_mdnote(note_id: int, data: MdNoteUpdate, session: SessionDep):
    note = session.get(MdNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="MdNote not found")
    if data.content is not None:
        note.content = data.content
    note.updated_at = datetime.utcnow()
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@router.delete("/{note_id}")
def delete_mdnote(note_id: int, session: SessionDep):
    note = session.get(MdNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="MdNote not found")
    session.delete(note)
    session.commit()
    return {"ok": True}

@router.get("/by-paper/{paper_id}/export")
def export_md(paper_id: int, session: SessionDep):
    note = session.exec(select(MdNote).where(MdNote.paper_id == paper_id)).first()
    if not note:
        raise HTTPException(status_code=404, detail="MdNote not found")
    filename = f"paper-{paper_id}.md"
    return Response(
        note.content or "",
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )