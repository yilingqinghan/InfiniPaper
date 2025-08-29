from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel

# ----- Author -----
class AuthorBase(BaseModel):
    name: str
    orcid: Optional[str] = None
    affiliation: Optional[str] = None

class AuthorCreate(AuthorBase):
    pass

class AuthorRead(AuthorBase):
    id: int

# ----- Tag -----
class TagBase(BaseModel):
    name: str
    # 给彩色标签用；如果模型里暂时没这个字段，值会是 None，不影响序列化
    color: Optional[str] = None

class TagCreate(TagBase):
    pass

class TagRead(TagBase):
    id: int

# ----- Paper -----
class PaperBase(BaseModel):
    title: str
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    venue: Optional[str] = None
    pdf_url: Optional[str] = None
    tag_ids: Optional[List[int]] = None
    author_ids: Optional[List[int]] = None

class PaperCreate(PaperBase):
    pass

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
    # ↓↓↓ 关键补充：让后端返回的这些字段不再被丢弃 ↓↓↓
    authors: Optional[List[AuthorRead]] = None
    tags: Optional[List[TagRead]] = None
    folder_ids: Optional[List[int]] = None

# ----- Note -----
class NoteBase(BaseModel):
    paper_id: int
    content: str

class NoteCreate(NoteBase):
    pass

class NoteUpdate(BaseModel):
    content: Optional[str] = None

class NoteRead(NoteBase):
    id: int