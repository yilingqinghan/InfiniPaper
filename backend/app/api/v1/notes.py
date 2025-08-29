from typing import List
from fastapi import APIRouter, HTTPException
from sqlmodel import select
from ..deps import SessionDep
from ...models import Note, Paper
from ...schemas import NoteCreate, NoteRead, NoteUpdate

router = APIRouter()

@router.get("/", response_model=List[NoteRead])
def list_notes(session: SessionDep, paper_id: int | None = None):
    stmt = select(Note)
    if paper_id:
        stmt = stmt.where(Note.paper_id == paper_id)
    return session.exec(stmt).all()

@router.post("/", response_model=NoteRead)
def create_note(data: NoteCreate, session: SessionDep):
    paper = session.get(Paper, data.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    note = Note(**data.dict())
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@router.patch("/{note_id}", response_model=NoteRead)
def update_note(note_id: int, data: NoteUpdate, session: SessionDep):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(note, k, v)
    session.add(note)
    session.commit()
    session.refresh(note)
    return note

@router.delete("/{note_id}")
def delete_note(note_id: int, session: SessionDep):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    session.delete(note)
    session.commit()
    return {"ok": True}