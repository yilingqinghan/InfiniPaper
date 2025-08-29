from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from ..deps import SessionDep
from ...models import Paper
from ...schemas import PaperRead

router = APIRouter()

@router.get("/", response_model=List[PaperRead])
def search(session: SessionDep, q: str, limit: int = 20, offset: int = 0):
    stmt = select(Paper).where(Paper.title.ilike(f"%{q}%")).offset(offset).limit(limit)
    return session.exec(stmt).all()