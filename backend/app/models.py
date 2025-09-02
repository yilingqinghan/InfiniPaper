from __future__ import annotations
from typing import Optional, List
from datetime import datetime
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column
from sqlalchemy import JSON as SAJSON
from pgvector.sqlalchemy import Vector
from .core.config import settings

class PaperTagLink(SQLModel, table=True):
    paper_id: int | None = Field(default=None, foreign_key="paper.id", primary_key=True)
    tag_id: int | None = Field(default=None, foreign_key="tag.id", primary_key=True)

class PaperAuthorLink(SQLModel, table=True):
    paper_id: int | None = Field(default=None, foreign_key="paper.id", primary_key=True)
    author_id: int | None = Field(default=None, foreign_key="author.id", primary_key=True)
    order: Optional[int] = Field(default=None)

class Paper(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    abstract: str | None = None
    year: int | None = None
    doi: str | None = Field(default=None, index=True, unique=True)
    venue: str | None = None
    pdf_url: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)

    # Embedding storage: Postgres uses pgvector; SQLite (and others) fallback to JSON
    if settings.is_postgres:
        embedding: list[float] | None = Field(sa_column=Column(Vector(768), nullable=True))
    else:
        embedding: list[float] | None = Field(default=None, sa_column=Column(SAJSON, nullable=True))

class Author(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    orcid: str | None = Field(default=None, index=True, unique=False)
    affiliation: str | None = None

class Tag(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)

class Note(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    paper_id: int = Field(foreign_key="paper.id", index=True)
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)

class Folder(SQLModel, table=True):
    __tablename__ = "folder"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    color: Optional[str] = None
    parent_id: Optional[int] = Field(default=None, foreign_key="folder.id")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)

class PaperFolderLink(SQLModel, table=True):
    """
    一篇论文只允许在一个目录里：以 paper_id 作为主键即可保证唯一。
    """
    __tablename__ = "paperfolderlink"
    paper_id: int = Field(foreign_key="paper.id", primary_key=True, index=True)
    folder_id: int = Field(foreign_key="folder.id", index=True)
# --- add this model (独立于 Note，不互相影响) ---
class MdNote(SQLModel, table=True):
    __tablename__ = "mdnote"
    id: int | None = Field(default=None, primary_key=True)
    paper_id: int = Field(foreign_key="paper.id", index=True)
    content: str = ""  # Markdown 文本
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)