# backend/app/api/v1/papers.py
from __future__ import annotations
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from loguru import logger

from sqlalchemy import delete
from sqlmodel import select

from ..deps import SessionDep
from ...models import (
    Paper, Tag, Author,
    PaperTagLink, PaperAuthorLink, Note,
    PaperFolderLink,   # 需要有该模型（用于目录过滤/分配）
)
from ...schemas import PaperRead, PaperUpdate
from ...core.config import settings
from ...services.pdf_parser import parse_pdf_metadata

router = APIRouter()

def _norm_title(s: Optional[str]) -> str:
    if not s:
        return ""
    import re
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s

def _paper_payload(session: SessionDep, paper_id: int) -> Dict[str, Any]:
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")

    # tag ids
    tag_ids = [ln.tag_id for ln in session.exec(select(PaperTagLink).where(PaperTagLink.paper_id == paper_id))]
    # authors（展开）
    author_ids = [ln.author_id for ln in session.exec(select(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper_id))]
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

    # 仅用于日志友好
    tag_names = [t.name for t in session.exec(
        select(Tag).join(PaperTagLink, PaperTagLink.tag_id == Tag.id).where(PaperTagLink.paper_id == paper_id)
    )]
    logger.info(f"[payload] paper#{paper_id} -> tag_ids={tag_ids}, tag_names={tag_names}")

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
    }

@router.get("/", response_model=list[PaperRead])
def list_papers(
    session: SessionDep,
    q: Optional[str] = None,
    tag_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    dedup: bool = True,
):
    stmt = select(Paper)
    if q:
        from sqlalchemy import or_
        qlike = f"%{q}%"
        stmt = stmt.where(or_(Paper.title.ilike(qlike), Paper.venue.ilike(qlike), Paper.doi.ilike(qlike)))
    if tag_id is not None:
        stmt = stmt.join(PaperTagLink, PaperTagLink.paper_id == Paper.id).where(PaperTagLink.tag_id == tag_id)
    if folder_id is not None:
        stmt = stmt.join(PaperFolderLink, PaperFolderLink.paper_id == Paper.id).where(PaperFolderLink.folder_id == folder_id)
    stmt = stmt.order_by(Paper.created_at.desc())

    rows = list(session.exec(stmt))
    result = []
    seen = set()
    for p in rows:
        key = p.doi or _norm_title(p.title)
        if dedup and key in seen:
            continue
        seen.add(key)
        result.append(_paper_payload(session, p.id))
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
        if field in {"tag_ids", "author_ids"}:
            continue
        setattr(paper, field, value)
    session.add(paper)
    session.commit()
    session.refresh(paper)
    return _paper_payload(session, paper_id)

def _safe_write_upload(dest: Path, content: bytes) -> Path:
    i = 0
    final = dest
    while final.exists():
        i += 1
        final = dest.with_name(f"{dest.stem}_{i}{dest.suffix}")
    final.write_bytes(content)
    return final

def _merge_paper_fields(paper: Paper, data: Dict[str, Any]) -> None:
    for key in ["title", "abstract", "year", "doi", "venue", "pdf_url"]:
        val = data.get(key)
        if val is None or val == "":
            continue
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
):
    return await _upload_one(
        session=session, file=file,
        title=title, abstract=abstract, year=year, doi=doi, venue=venue,
        tag_ids=tag_ids, author_ids=author_ids,
    )


@router.post("/upload/batch", response_model=list[PaperRead])
async def upload_batch(session: SessionDep, files: list[UploadFile] = File(...)):
    out: list[PaperRead] = []
    for f in files:
        tmp = await _upload_one(
            session=session, file=f,
            title=None, abstract=None, year=None, doi=None, venue=None,
            tag_ids=None, author_ids=None,
        )
        out.append(tmp)
    return out

class TagNames(BaseModel):
    tags: list[str]

@router.put("/{paper_id}/tags", response_model=PaperRead)
def update_tags_by_names(paper_id: int, payload: TagNames, session: SessionDep):
    logger.info(f"[tags.put] paper={paper_id} incoming={payload.model_dump()}")
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")

    names = [t.strip() for t in (payload.tags or []) if t and t.strip()]
    # 去重，保持次序
    seen = set(); norm: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n); norm.append(n)
    logger.info(f"[tags.put] normalized={norm}")

    # 找已有
    existing = list(session.exec(select(Tag).where(Tag.name.in_(norm)))) if norm else []
    name2tag = {t.name: t for t in existing}

    # 新建缺失
    created_ids: list[int] = []
    for n in norm:
        if n not in name2tag:
            t = Tag(name=n)
            session.add(t); session.commit(); session.refresh(t)
            name2tag[n] = t
            created_ids.append(t.id)

    # 重新关联
    logger.info(f"[tags.put] unlink old links for paper={paper_id}")
    session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper_id))
    linked_ids: list[int] = []
    for n in norm:
        tid = name2tag[n].id
        session.add(PaperTagLink(paper_id=paper_id, tag_id=tid))
        linked_ids.append(tid)

    session.commit()
    logger.info(f"[tags.put] created={created_ids} linked_ids={linked_ids}")

    # 返回最新 payload
    payload_after = _paper_payload(session, paper_id)
    logger.info(f"[tags.put] after-commit tag_ids={payload_after['tag_ids']}")
    return payload_after

@router.delete("/{paper_id}")
def delete_paper(paper_id: int, session: SessionDep):
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Not Found")
    session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper_id))
    session.exec(delete(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper_id))
    session.exec(delete(Note).where(Note.paper_id == paper_id))
    # 解除目录关系
    session.exec(delete(PaperFolderLink).where(PaperFolderLink.paper_id == paper_id))
    try:
        if paper.pdf_url and paper.pdf_url.startswith("/files/"):
            rel = paper.pdf_url.replace("/files/", "")
            target = Path(settings.STORAGE_DIR) / rel
            if target.exists():
                target.unlink()
    except Exception:
        pass
    session.delete(paper); session.commit()
    logger.info(f"[delete] paper#{paper_id} removed")
    return {"ok": True}

# 放在 _merge_paper_fields 后面
async def _upload_one(
    session: SessionDep,
    file: UploadFile,
    title: Optional[str] = None,
    abstract: Optional[str] = None,
    year: Optional[int] = None,
    doi: Optional[str] = None,
    venue: Optional[str] = None,
    tag_ids: Optional[list[int]] = None,
    author_ids: Optional[list[int]] = None,
) -> PaperRead:
    pdf_dir = Path(settings.STORAGE_DIR) / "pdfs"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    raw = await file.read()
    dest = _safe_write_upload(pdf_dir / (file.filename or "upload.pdf"), raw)
    pdf_url = f"/files/pdfs/{dest.name}"

    meta: Dict[str, Any] = {}
    try:
        meta = await parse_pdf_metadata(str(dest))
    except Exception as e:
        logger.warning(f"pdf parse failed: {e}")
        meta = {}

    data = {
        "title": title or meta.get("title") or (file.filename or dest.name),
        "abstract": abstract or meta.get("abstract"),
        "year": year or meta.get("year"),
        "doi": (doi or meta.get("doi")),
        "venue": venue or meta.get("venue"),
        "pdf_url": pdf_url,
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

    # 解析作者
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

    if tag_ids:
        session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper.id))
        for tid in tag_ids:
            session.add(PaperTagLink(paper_id=paper.id, tag_id=tid))

    session.commit()
    logger.info(f"[upload] paper#{paper.id} saved file={dest.name} doi={paper.doi}")
    return _paper_payload(session, paper.id)