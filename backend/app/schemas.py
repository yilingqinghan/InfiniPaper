from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel

class AuthorBase(BaseModel):
    name: str
    orcid: Optional[str] = None
    affiliation: Optional[str] = None

class AuthorCreate(AuthorBase): pass
class AuthorRead(AuthorBase):
    id: int

class TagBase(BaseModel):
    name: str

class TagCreate(TagBase): pass
class TagRead(TagBase):
    id: int

class PaperBase(BaseModel):
    title: str
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    venue: Optional[str] = None
    pdf_url: Optional[str] = None
    tag_ids: List[int] = []
    author_ids: List[int] = []

class PaperCreate(PaperBase): pass
class PaperUpdate(BaseModel):
    title: Optional[str] = None
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    venue: Optional[str] = None
    pdf_url: Optional[str] = None
    tag_ids: Optional[List[int]] = None
    author_ids: Optional[List[int]] = None

class PaperRead(PaperBase):
    id: int

class NoteBase(BaseModel):
    paper_id: int
    content: str

class NoteCreate(NoteBase): pass
class NoteUpdate(BaseModel):
    content: Optional[str] = None

class NoteRead(NoteBase):
    id: int