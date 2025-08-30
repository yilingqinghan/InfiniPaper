# backend/app/api/v1/papers.py
from __future__ import annotations
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from loguru import logger

from sqlalchemy import delete, or_, and_
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
from ...services.doi_resolver import fetch_by_doi, DoiResolveError

router = APIRouter()

def _norm_title(s: Optional[str]) -> str:
    if not s:
        return ""
    import re
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s

# venue 缩写映射（与前端一致）
import re as _re
_VENUE_ABBR_PATTERNS: list[tuple[_re.Pattern[str], str]] = [
    (_re.compile(r"(international symposium on microarchitecture|(^|\W)micro(\W|$))", _re.I), "MICRO"),
    (_re.compile(r"programming language design and implementation|(^|\W)pldi(\W|$)", _re.I), "PLDI"),
    (_re.compile(r"international symposium on computer architecture|(^|\W)isca(\W|$)", _re.I), "ISCA"),
    (_re.compile(r"architectural support for programming languages|(^|\W)asplos?(\W|$)", _re.I), "ASPLOS"),
    (_re.compile(r"transactions on architecture and code optimization|(^|\W)taco(\W|$)", _re.I), "TACO"),
    (_re.compile(r"transactions on design automation of electronic systems|(^|\W)todaes(\W|$)", _re.I), "TODAES"),
    (_re.compile(r"design automation conference|(^|\W)dac(\W|$)", _re.I), "DAC"),
    (_re.compile(r"neurips|nips", _re.I), "NeurIPS"),
    (_re.compile(r"international conference on machine learning|(^|\W)icml(\W|$)", _re.I), "ICML"),
    (_re.compile(r"computer vision and pattern recognition|(^|\W)cvpr(\W|$)", _re.I), "CVPR"),
    (_re.compile(r"international conference on computer vision|(^|\W)iccv(\W|$)", _re.I), "ICCV"),
    (_re.compile(r"european conference on computer vision|(^|\W)eccv(\W|$)", _re.I), "ECCV"),
    (_re.compile(r"very large data bases|(^|\W)vldb(\W|$)", _re.I), "VLDB"),
    (_re.compile(r"sigmod", _re.I), "SIGMOD"),
    (_re.compile(r"the web conference|(^|\W)www(\W|$)", _re.I), "WWW"),
    (_re.compile(r"supercomputing|(^|\W)sc(\W|$)", _re.I), "SC"),
    (_re.compile(r"siggraph", _re.I), "SIGGRAPH"),
]
def _venue_abbr(name: str | None) -> str | None:
    if not name: return None
    for pat, abbr in _VENUE_ABBR_PATTERNS:
        if pat.search(name): return abbr
    return None    

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
    year_min: Optional[int] = None,   # ✅ 新增
    year_max: Optional[int] = None,   # ✅ 新增
    venue: Optional[str] = None,      # ✅ 新增
    venue_abbr: Optional[str] = None,   # 👈 新增
    dedup: bool = True,
):
    stmt = select(Paper)
    if q:
        qlike = f"%{q}%"
        stmt = stmt.where(or_(Paper.title.ilike(qlike), Paper.venue.ilike(qlike), Paper.doi.ilike(qlike)))
    if tag_id is not None:
        stmt = stmt.join(PaperTagLink, PaperTagLink.paper_id == Paper.id).where(PaperTagLink.tag_id == tag_id)
    if folder_id is not None:
        stmt = stmt.join(PaperFolderLink, PaperFolderLink.paper_id == Paper.id).where(PaperFolderLink.folder_id == folder_id)

    # 先收集要加的 where 条件
    conds = []

    if venue:
        conds.append(Paper.venue.ilike(f"%{venue}%"))

    # 只有当至少一个边界被提供时才筛年份
    if (year_min is not None) or (year_max is not None):
        rng = []
        if year_min is not None:
            rng.append(Paper.year >= year_min)
        if year_max is not None:
            rng.append(Paper.year <= year_max)

        # year 为 NULL 永远放行；否则必须落在给定范围（哪怕只给了一个边界）
        if rng:
            conds.append(or_(Paper.year.is_(None), and_(*rng)))

    # 统一落到 stmt
    for c in conds:
        stmt = stmt.where(c)

    stmt = stmt.order_by(Paper.created_at.desc())

    rows = list(session.exec(stmt))
    if venue_abbr:
        wanted = {x.strip().upper() for x in venue_abbr.split(",") if x.strip()}
        rows = [p for p in rows if (_venue_abbr(getattr(p, "venue", None)) or "").upper() in wanted]
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

from pydantic import BaseModel, Field

class PaperCreateSimple(BaseModel):
    title: Optional[str] = None
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    venue: Optional[str] = None
    tag_ids: Optional[list[int]] = None
    author_ids: Optional[list[int]] = None

@router.post("/create", response_model=PaperRead)
async def create_paper_simple(session: SessionDep, payload: PaperCreateSimple):
    data = payload.model_dump(exclude_unset=True)
    norm_doi = (data.get("doi") or "").strip()

    # 传了 DOI：必须先解析成功才允许入库
    resolved: Dict[str, Any] = {}
    if norm_doi:
        try:
            resolved = await fetch_by_doi(norm_doi)
        except Exception as e:
            # 解析失败：不入库，显式告诉前端
            raise HTTPException(status_code=424, detail=f"DOI 解析失败：{e}")  # 424 Failed Dependency

        # 基本完整性校验：至少要有标题
        if not resolved.get("title"):
            raise HTTPException(status_code=424, detail="DOI 解析不完整（缺少标题），已取消入库")

    # 合并“前端显式 > 解析值”
    title_final    = (data.get("title") or resolved.get("title"))
    abstract_final = (data.get("abstract") or None)   # Crossref 抽象很少，允许为空
    year_final     = (data.get("year") or resolved.get("year"))
    venue_final    = (data.get("venue") or resolved.get("venue"))

    # 没 DOI 的纯手填：至少得有 title
    if not norm_doi and not title_final:
        raise HTTPException(status_code=422, detail="缺少标题；无 DOI 的情况下必须提供标题")

    # 去重：同 DOI 合并，否则新建
    paper = session.exec(select(Paper).where(Paper.doi == norm_doi)).first() if norm_doi else None
    if paper:
        _merge_paper_fields(paper, {
            "title": title_final,
            "abstract": abstract_final,
            "year": year_final,
            "doi": norm_doi or None,
            "venue": venue_final,
        })
        session.add(paper); session.commit(); session.refresh(paper)
    else:
        paper = Paper(
            title=title_final or "Untitled",   # 理论上不会走到这里（上面已校验）
            abstract=abstract_final,
            year=year_final,
            doi=norm_doi or None,
            venue=venue_final,
            pdf_url=None,
        )
        session.add(paper); session.commit(); session.refresh(paper)

    # 解析到的作者 + 显式传入的 author_ids
    created_ids: list[int] = []
    for am in (resolved.get("authors") or []):
        name = (am or {}).get("name")
        if not name: continue
        aff = (am or {}).get("affiliation")
        a = session.exec(select(Author).where(Author.name == name)).first()
        if not a:
            try: a = Author(name=name, affiliation=aff)
            except TypeError: a = Author(name=name)
            session.add(a); session.commit(); session.refresh(a)
        else:
            if aff and hasattr(a, "affiliation") and not getattr(a, "affiliation"):
                a.affiliation = aff; session.add(a); session.commit()
        created_ids.append(a.id)

    explicit_ids = set(payload.author_ids or [])
    final_author_ids = list({*explicit_ids, *created_ids})
    if final_author_ids:
        session.exec(delete(PaperAuthorLink).where(PaperAuthorLink.paper_id == paper.id))
        for aid in final_author_ids:
            session.add(PaperAuthorLink(paper_id=paper.id, author_id=aid))

    if payload.tag_ids:
        session.exec(delete(PaperTagLink).where(PaperTagLink.paper_id == paper.id))
        for tid in payload.tag_ids:
            session.add(PaperTagLink(paper_id=paper.id, tag_id=tid))

    session.commit()
    return _paper_payload(session, paper.id)

    
class NotePayload(BaseModel):
    content: str = Field("", description="纯文本内容")

@router.get("/{paper_id}/note")
def get_note(paper_id: int, session: SessionDep):
    n = session.exec(select(Note).where(Note.paper_id == paper_id)).first()
    val = ""
    if n is not None:
        if hasattr(n, "content"): val = getattr(n, "content") or ""
        elif hasattr(n, "text"):  val = getattr(n, "text") or ""
    return {"paper_id": paper_id, "content": val}

@router.put("/{paper_id}/note")
def put_note(paper_id: int, payload: NotePayload, session: SessionDep):
    n = session.exec(select(Note).where(Note.paper_id == paper_id)).first()
    if n is None:
        # 兼容不同字段名（content/text）
        try:        n = Note(paper_id=paper_id, content=payload.content)
        except: 
            try:    n = Note(paper_id=paper_id, text=payload.content)
            except:
                    n = Note(paper_id=paper_id); 
                    if hasattr(n, "content"): setattr(n, "content", payload.content)
                    elif hasattr(n, "text"):  setattr(n, "text", payload.content)
        session.add(n)
    else:
        if hasattr(n, "content"): n.content = payload.content
        elif hasattr(n, "text"):  n.text = payload.content
        session.add(n)
    session.commit()
    return {"ok": True}

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