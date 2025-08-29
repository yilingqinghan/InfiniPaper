from __future__ import annotations

from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Body
from pydantic import BaseModel
from sqlalchemy import delete, text
from sqlmodel import select

from ..deps import SessionDep
from ...models import Paper, Tag, Author, PaperTagLink, PaperAuthorLink, Note
from ...schemas import PaperCreate, PaperRead, PaperUpdate
from ...core.config import settings
from ...services.pdf_parser import parse_pdf_metadata

router = APIRouter()

# ---- folders 使用 TagExtra 扩展 ----
def _ensure_tagextra(session: SessionDep):
    session.exec(text("""
        CREATE TABLE IF NOT EXISTS tagextra(
          tag_id INTEGER PRIMARY KEY REFERENCES tag(id) ON DELETE CASCADE,
          is_folder BOOLEAN DEFAULT 0,
          color TEXT NULL,
          priority INTEGER DEFAULT 0,
          parent_tag_id INTEGER NULL REFERENCES tag(id)
        );
    """)); session.commit()

def _norm_title(s: Optional[str]) -> str:
    if not s:
        return ""
    import re
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s

def _get_folder_id_of_paper(session: SessionDep, paper_id: int) -> Optional[int]:
    _ensure_tagextra(session)
    row = session.exec(text("""
        SELECT ptl.tag_id
        FROM papertaglink ptl
        WHERE ptl.paper_id = :pid
          AND EXISTS (SELECT 1 FROM tagextra te WHERE te.tag_id = ptl.tag_id AND te.is_folder = 1)
        LIMIT 1
    """).params(pid=paper_id)).first()
    return int(row[0]) if row else None

def _paper_payload(session: SessionDep, paper_id: int) -> Dict[str, Any]:
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")

    # tag ids
    tag_links = list(session.exec(select(PaperTagLink).where(PaperTagLink.paper_id == paper_id)))
    tag_ids = [ln.tag_id for ln in tag_links]

    # authors
    author_links = list(session.exec(select(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper_id)))
    author_ids = [ln.author_id for ln in author_links]
    authors_payload: List[Dict[str, Any]] = []
    if author_ids:
        authors = list(session.exec(select(Author).where(Author.id.in_(author_ids))))
        for a in authors:
            authors_payload.append({
                "id": getattr(a, "id", None),
                "name": getattr(a, "name", None),
                "orcid": getattr(a, "orcid", None) if hasattr(a, "orcid") else None,
                "affiliation": getattr(a, "affiliation", None) if hasattr(a, "affiliation") else None,
            })

    folder_id = _get_folder_id_of_paper(session, paper_id)

    return {
        "id": paper.id,
        "title": paper.title,
        "abstract": paper.abstract,
        "year": paper.year,
        "doi": paper.doi,
        "venue": paper.venue,
        "pdf_url": paper.pdf_url,
        "tag_ids": tag_ids,
        "author_ids": author_ids,
        "authors": authors_payload,
        "folder_id": folder_id,
    }

@router.get("/", response_model=list[PaperRead])
def list_papers(
    session: SessionDep,
    q: Optional[str] = None,
    tag_id: Optional[int] = None,
    folder_id: Optional[int] = Query(None, description="目录ID（基于TagExtra.is_folder=1）"),
    dedup: bool = True
):
    stmt = select(Paper)

    if q:
        from sqlalchemy import or_
        qlike = f"%{q}%"
        stmt = stmt.where(or_(Paper.title.ilike(qlike), Paper.venue.ilike(qlike), Paper.doi.ilike(qlike)))
    if tag_id is not None:
        stmt = stmt.join(PaperTagLink, PaperTagLink.paper_id == Paper.id).where(PaperTagLink.tag_id == tag_id)
    if folder_id is not None:
        # 过滤属于该目录的论文
        stmt = stmt.join(PaperTagLink, PaperTagLink.paper_id == Paper.id).where(PaperTagLink.tag_id == folder_id)

    stmt = stmt.order_by(Paper.created_at.desc())
    rows = list(session.exec(stmt))
    result = []
    seen = set()
    for p in rows:
        payload = _paper_payload(session, p.id)
        key = p.doi or _norm_title(p.title)
        if dedup and key in seen:
            continue
        seen.add(key)
        result.append(payload)
    return result

@router.get("/{paper_id}", response_model=PaperRead)
def get_paper(paper_id: int, session: SessionDep):
    return _paper_payload(session, paper_id)

@router.patch("/{paper_id}", response_model=PaperRead)
def update_paper(paper_id: int, data: PaperUpdate, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")

    for field, value in data.model_dump(exclude_unset=True).items():
        if field in {"tag_ids", "author_ids", "folder_id"}:
            continue
        setattr(paper, field, value)

    if data.tag_ids is not None:
        session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper_id))
        for tid in data.tag_ids:
            session.add(PaperTagLink(paper_id=paper_id, tag_id=tid))

    if data.author_ids is not None:
        session.exec(delete(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper_id))
        for aid in data.author_ids:
            session.add(PaperAuthorLink(paper_id=paper_id, author_id=aid))

    # 目录处理：用 data.folder_id
    if data.folder_id is not None:
        _ensure_tagextra(session)
        session.exec(text("""
            DELETE FROM papertaglink
            WHERE paper_id = :pid
              AND tag_id IN (SELECT tag_id FROM tagextra WHERE is_folder = 1)
        """).params(pid=paper_id))
        if data.folder_id > 0:
            session.add(PaperTagLink(paper_id=paper_id, tag_id=int(data.folder_id)))

    session.add(paper)
    session.commit()
    session.refresh(paper)
    return _paper_payload(session, paper_id)

def _safe_write_upload(dest: Path, content: bytes) -> Path:
    i = 0; final = dest
    while final.exists():
        i += 1
        final = dest.with_name(f"{dest.stem}_{i}{dest.suffix}")
    final.write_bytes(content)
    return final

def _merge_paper_fields(paper: Paper, data: Dict[str, Any]) -> None:
    for key in ["title", "abstract", "year", "doi", "venue", "pdf_url"]:
        val = data.get(key)
        if val is None or val == "": continue
        if getattr(paper, key, None) in (None, "", 0):
            setattr(paper, key, val)

@router.post("/upload", response_model=PaperRead)
async def upload_paper(
    session: SessionDep,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    abstract: Optional[str] = Form(None),
    year: Optional[int] = Form(None),
    doi: Optional[str] = Form(None),
    venue: Optional[str] = Form(None),
    tag_ids: Optional[list[int]] = Form(None),
    author_ids: Optional[list[int]] = Form(None),
    folder_id: Optional[int] = Form(None),   # ← 新增：导入目标目录
):
    pdf_dir = Path(settings.STORAGE_DIR) / "pdfs"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    dest = _safe_write_upload(pdf_dir / (file.filename or "upload.pdf"), raw)
    pdf_url = f"/files/pdfs/{dest.name}"

    meta: Dict[str, Any] = {}
    try:
        meta = await parse_pdf_metadata(str(dest))
    except Exception:
        meta = {}
    pdf_url_final = meta.get("oa_pdf_url") or pdf_url

    data = {
        "title": title or meta.get("title") or (file.filename or dest.name),
        "abstract": abstract or meta.get("abstract"),
        "year": year or meta.get("year"),
        "doi": (doi or meta.get("doi")),
        "venue": venue or meta.get("venue"),
        "pdf_url": pdf_url_final,
    }

    existing = None
    if data.get("doi"):
        existing = session.exec(select(Paper).where(Paper.doi == data["doi"])).first()
    if existing:
        _merge_paper_fields(existing, data)
        session.add(existing); session.commit()
        paper = existing
    else:
        paper = Paper(**data)
        session.add(paper); session.commit(); session.refresh(paper)

    # 作者
    authors_meta = meta.get("authors") or []
    explicit_ids = set(author_ids or [])
    created_ids: List[int] = []
    for am in authors_meta:
        name = (am or {}).get("name")
        if not name: continue
        aff = (am or {}).get("affiliation")
        a = session.exec(select(Author).where(Author.name == name)).first()
        if not a:
            try:
                a = Author(name=name, affiliation=aff)
            except TypeError:
                a = Author(name=name)
            session.add(a); session.commit(); session.refresh(a)
        else:
            if aff and hasattr(a, "affiliation") and not getattr(a, "affiliation"):
                a.affiliation = aff; session.add(a); session.commit()
        created_ids.append(a.id)
    final_author_ids = list({*explicit_ids, *created_ids})
    if final_author_ids:
        session.exec(delete(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper.id))
        for aid in final_author_ids:
            session.add(PaperAuthorLink(paper_id=paper.id, author_id=aid))

    # 标签
    if tag_ids:
        session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper.id))
        for tid in tag_ids:
            session.add(PaperTagLink(paper_id=paper.id, tag_id=tid))

    # 目录
    if folder_id:
        _ensure_tagextra(session)
        session.exec(text("""
            DELETE FROM papertaglink
            WHERE paper_id = :pid
              AND tag_id IN (SELECT tag_id FROM tagextra WHERE is_folder = 1)
        """).params(pid=paper.id))
        session.add(PaperTagLink(paper_id=paper.id, tag_id=int(folder_id)))

    session.commit()
    return _paper_payload(session, paper.id)

@router.post("/upload/batch", response_model=list[PaperRead])
async def upload_batch(
    session: SessionDep,
    files: list[UploadFile] = File(...),
    folder_id: Optional[int] = Form(None),
):
    created: list[PaperRead] = []
    for f in files:
        tmp = await upload_paper(session=session, file=f, title=None, abstract=None, year=None, doi=None, venue=None, tag_ids=None, author_ids=None, folder_id=folder_id)  # type: ignore
        created.append(tmp)
    return created

class TagNames(BaseModel):
    tags: list[str]

@router.put("/{paper_id}/tags", response_model=PaperRead)
def update_tags_by_names(paper_id: int, payload: TagNames, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")
    session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper_id))
    for name in [t.strip() for t in payload.tags if t.strip()]:
        existing = session.exec(select(Tag).where(Tag.name == name)).first()
        if not existing:
            t = Tag(name=name)
            session.add(t); session.commit(); session.refresh(t)
            existing = t
        session.add(PaperTagLink(paper_id=paper_id, tag_id=existing.id))
    session.commit()
    return _paper_payload(session, paper_id)

@router.delete("/{paper_id}")
def delete_paper(paper_id: int, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")
    session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper_id))
    session.exec(delete(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper_id))
    session.exec(delete(Note).where(Note.paper_id == paper_id))
    try:
        if paper.pdf_url and paper.pdf_url.startswith("/files/"):
            rel = paper.pdf_url.replace("/files/", "")
            target = Path(settings.STORAGE_DIR) / rel
            if target.exists():
                target.unlink()
    except Exception:
        pass
    session.delete(paper); session.commit()
    return {"ok": True}
