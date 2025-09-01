# app/api/v1/annotations.py
from __future__ import annotations
import json, os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

router = APIRouter()

ROOT = Path(os.getenv("ANNOTATION_ROOT", "storage/annotations"))
ROOT.mkdir(parents=True, exist_ok=True)

class Anchor(BaseModel):
    # 文本锚点：以 markdown 容器内的“纯文本流偏移”定位（start/end）
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    quote: str

class Annotation(BaseModel):
    id: str                # 前端生成的 uuid
    paper_id: int
    anchor: Anchor
    note: str              # 备注内容（可空字符串）
    color: str = "#FFE58F" # 高亮色
    created_at: str
    updated_at: str

def file_of(paper_id: int) -> Path:
    return ROOT / f"{paper_id}.json"

def load_all(paper_id: int) -> list[dict]:
    p = file_of(paper_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return []

def save_all(paper_id: int, items: list[dict]) -> None:
    p = file_of(paper_id)
    p.write_text(json.dumps(items, ensure_ascii=False, indent=2), "utf-8")

@router.get("/{paper_id}", response_model=List[Annotation])
def list_annotations(paper_id: int):
    return load_all(paper_id)

class UpsertReq(BaseModel):
    id: str
    paper_id: int
    anchor: Anchor
    note: str = ""
    color: str = "#FFE58F"

@router.post("/{paper_id}", response_model=Annotation)
def upsert_annotation(paper_id: int, req: UpsertReq):
    if paper_id != req.paper_id:
        raise HTTPException(400, "paper_id mismatch")
    items = load_all(paper_id)
    now = datetime.utcnow().isoformat()

    # upsert by id
    found = None
    for it in items:
        if it.get("id") == req.id:
            found = it
            break
    if found:
        found.update({
            "anchor": req.anchor.dict(),
            "note": req.note,
            "color": req.color,
            "updated_at": now,
        })
    else:
        items.append({
            "id": req.id,
            "paper_id": paper_id,
            "anchor": req.anchor.dict(),
            "note": req.note,
            "color": req.color,
            "created_at": now,
            "updated_at": now,
        })
    save_all(paper_id, items)
    return [x for x in items if x["id"] == req.id][0]

@router.delete("/{paper_id}/{ann_id}")
def delete_annotation(paper_id: int, ann_id: str):
    items = load_all(paper_id)
    items = [x for x in items if x.get("id") != ann_id]
    save_all(paper_id, items)
    return {"ok": True, "count": len(items)}