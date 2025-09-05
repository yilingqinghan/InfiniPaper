from typing import List, Optional
import datetime as dt
from fastapi import APIRouter, HTTPException, Response
from fastapi import UploadFile, File, Query
from pathlib import Path
import os, uuid
from sqlmodel import select
from ..deps import SessionDep
from ...models import MdNote, Paper
from ...schemas import MdNoteCreate, MdNoteRead, MdNoteUpdate

router = APIRouter()

# ---- Image upload config ----
from app.core.config import settings  # 按你的项目路径
BASE = Path(getattr(settings, "STORAGE_DIR", "uploads"))
UPLOAD_ROOT = str(BASE)    # 建议单独放到 images 子目录
PUBLIC_PREFIX = "/files"
Path(UPLOAD_ROOT).mkdir(parents=True, exist_ok=True)

def _guess_ext(content_type: str, filename: str | None) -> str:
    if filename and "." in filename:
        return "." + filename.split(".")[-1].lower()
    if content_type:
        # minimal mapping; extend as needed
        m = content_type.lower()
        if m == "image/jpeg" or m == "image/jpg":
            return ".jpg"
        if m == "image/png":
            return ".png"
        if m == "image/webp":
            return ".webp"
        if m == "image/gif":
            return ".gif"
        if m == "image/svg+xml":
            return ".svg"
    return ".bin"

async def _save_upload(file: UploadFile, dest: Path) -> int:
    # write in chunks to avoid memory spikes
    size = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)
    try:
        await file.seek(0)
    except Exception:
        pass
    return size

def _public_url_for(path: Path) -> str:
    # convert absolute/relative path to public URL under PUBLIC_PREFIX
    p = path.as_posix()
    if p.startswith("./"):
        p = p[2:]
    if p.startswith(UPLOAD_ROOT + "/"):
        rel = p[len(UPLOAD_ROOT):]
    else:
        rel = "/" + p
    return f"{PUBLIC_PREFIX}{rel}"

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
        note.updated_at = dt.datetime.utcnow()
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
    note.updated_at = dt.datetime.utcnow()
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


# ---- Image upload endpoint ----
@router.post("/by-paper/{paper_id}/images")
async def upload_image_for_paper(
    paper_id: int,
    file: UploadFile = File(...),
    session: SessionDep = None,
):
    # Ensure paper exists
    paper = session.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Validate content type (simple)
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Only image uploads are allowed, got {ctype or 'unknown'}")

    # Build destination: uploads/images/YYYY/MM/
    today = dt.date.today()
    folder = Path(UPLOAD_ROOT) / "images" / f"{today.year:04d}" / f"{today.month:02d}"
    ext = _guess_ext(ctype, file.filename)
    name = uuid.uuid4().hex + ext
    dest = folder / name

    size = await _save_upload(file, dest)

    internal_url = _public_url_for(dest)
    external_url = None

    return {
        "paper_id": paper_id,
        "url": internal_url,          # backward-compatible key
        "internal_url": internal_url, # explicit key
        "external_url": external_url, # always None
        "format": ext.lstrip("."),
        "size": size,
    }