# routers/ideas.py
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, validator

router = APIRouter(prefix="/ideas", tags=["ideas"])

# ----------------------- Pydantic Schemas -----------------------

class IdeaBase(BaseModel):
    title: str = Field(..., max_length=120)
    description: str = Field("", max_length=4000)
    priority: int = Field(..., ge=1, le=5)
    feasibility_proved: bool = False
    estimated_minutes: int = Field(..., ge=0)
    planned_conferences: List[str] = Field(default_factory=list)

    @validator("title")
    def _one_line_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        if "\n" in v or "\r" in v:
            raise ValueError("title must be one line")
        return v

    @validator("planned_conferences", pre=True)
    def _normalize_planned_conferences(cls, v):
        # Accept None, list of strings, or a comma-separated string; trim and drop empties
        if v is None:
            return []
        if isinstance(v, str):
            parts = [p.strip() for p in v.split(",")]
            return [p for p in parts if p]
        if isinstance(v, list):
            out: List[str] = []
            for x in v:
                if x is None:
                    continue
                s = str(x).strip()
                if s:
                    out.append(s)
            return out
        return []

class IdeaCreate(IdeaBase):
    pass

class IdeaUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=4000)
    priority: Optional[int] = Field(None, ge=1, le=5)
    feasibility_proved: Optional[bool] = None
    estimated_minutes: Optional[int] = Field(None, ge=0)
    planned_conferences: Optional[List[str]] = None

    @validator("title")
    def _one_line_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("title cannot be empty")
        if "\n" in v or "\r" in v:
            raise ValueError("title must be one line")
        return v

    @validator("planned_conferences", pre=True)
    def _normalize_planned_conferences_update(cls, v):
        # For PATCH: None means "no change"; otherwise normalize like in IdeaBase
        if v is None:
            return v
        if isinstance(v, str):
            parts = [p.strip() for p in v.split(",")]
            return [p for p in parts if p]
        if isinstance(v, list):
            out: List[str] = []
            for x in v:
                if x is None:
                    continue
                s = str(x).strip()
                if s:
                    out.append(s)
            return out
        return []

class IdeaOut(IdeaBase):
    id: int
    created_at: datetime
    updated_at: datetime
    planned_conferences: List[str]

    class Config:
        orm_mode = True

class IdeaListOut(BaseModel):
    items: List[IdeaOut]
    total: int
    page: int
    page_size: int

# ----------------------- Local Store (encapsulated) -----------------------

_DB_PATH = Path(os.environ.get("IDEAS_DB_PATH", "./ideas_db.json"))
_LOCK = threading.Lock()

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

def _load() -> Dict[str, Any]:
    if not _DB_PATH.exists():
        return {"last_id": 0, "items": []}
    try:
        with _DB_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"last_id": 0, "items": []}

def _save(data: Dict[str, Any]) -> None:
    tmp = _DB_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    tmp.replace(_DB_PATH)

def _create(payload: Dict[str, Any]) -> Dict[str, Any]:
    with _LOCK:
        db = _load()
        db["last_id"] = int(db.get("last_id", 0)) + 1
        now = _utcnow()
        item = {
            "id": db["last_id"],
            "title": payload["title"],
            "description": payload.get("description", ""),
            "priority": int(payload["priority"]),
            "feasibility_proved": bool(payload.get("feasibility_proved", False)),
            "estimated_minutes": int(payload.get("estimated_minutes", 0)),
            "planned_conferences": payload.get("planned_conferences", []),
            "created_at": now,
            "updated_at": now,
        }
        db["items"].append(item)
        _save(db)
        return item

def _list() -> List[Dict[str, Any]]:
    with _LOCK:
        return list(_load().get("items", []))

def _get(item_id: int) -> Optional[Dict[str, Any]]:
    with _LOCK:
        db = _load()
        for it in db.get("items", []):
            if it["id"] == item_id:
                return it
    return None

def _update(item_id: int, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with _LOCK:
        db = _load()
        items = db.get("items", [])
        for i, it in enumerate(items):
            if it["id"] == item_id:
                it = {**it, **patch, "updated_at": _utcnow()}
                items[i] = it
                _save(db)
                return it
    return None

def _delete(item_id: int) -> bool:
    with _LOCK:
        db = _load()
        items = db.get("items", [])
        n2 = [it for it in items if it["id"] != item_id]
        if len(n2) == len(items):
            return False
        db["items"] = n2
        _save(db)
        return True

# ----------------------- Helpers: filtering / sorting / paging -----------------------

def _parse_priority_csv(s: Optional[str]) -> Optional[List[int]]:
    if not s:
        return None
    out: List[int] = []
    for part in s.split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out or None

def _apply_filters(
    items: List[Dict[str, Any]],
    q: Optional[str],
    priorities: Optional[List[int]],
    feasible: Optional[bool],
    time_min: Optional[int],
    time_max: Optional[int],
) -> List[Dict[str, Any]]:
    res = items
    if q:
        ql = q.lower()
        res = [it for it in res if ql in it["title"].lower() or ql in it.get("description", "").lower()]
    if priorities:
        res = [it for it in res if int(it.get("priority", 0)) in priorities]
    if feasible is not None:
        res = [it for it in res if bool(it.get("feasibility_proved", False)) is feasible]
    if time_min is not None:
        res = [it for it in res if int(it.get("estimated_minutes", 0)) >= time_min]
    if time_max is not None:
        res = [it for it in res if int(it.get("estimated_minutes", 0)) <= time_max]
    return res

def _apply_sort(items: List[Dict[str, Any]], sort: str) -> List[Dict[str, Any]]:
    key = sort or "-updated_at"
    if key == "updated_at":
        return sorted(items, key=lambda x: x.get("updated_at") or "")
    if key == "-updated_at":
        return sorted(items, key=lambda x: x.get("updated_at") or "", reverse=True)
    if key == "priority":
        return sorted(items, key=lambda x: int(x.get("priority", 0)))
    if key == "-priority":
        return sorted(items, key=lambda x: int(x.get("priority", 0)), reverse=True)
    if key == "estimated_minutes":
        return sorted(items, key=lambda x: int(x.get("estimated_minutes", 0)))
    if key == "-estimated_minutes":
        return sorted(items, key=lambda x: int(x.get("estimated_minutes", 0)), reverse=True)
    # default
    return sorted(items, key=lambda x: x.get("updated_at") or "", reverse=True)

def _paginate(items: List[Dict[str, Any]], page: int, page_size: int):
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end], total

def _to_out(d: Dict[str, Any]) -> IdeaOut:
    # parse stored iso datetimes to datetime objects
    def parse_dt(s: Any) -> datetime:
        if isinstance(s, datetime):
            return s
        return datetime.fromisoformat(str(s))
    return IdeaOut(
        id=int(d["id"]),
        title=d["title"],
        description=d.get("description", ""),
        priority=int(d.get("priority", 0)),
        feasibility_proved=bool(d.get("feasibility_proved", False)),
        estimated_minutes=int(d.get("estimated_minutes", 0)),
        planned_conferences=list(d.get("planned_conferences") or []),
        created_at=parse_dt(d.get("created_at")),
        updated_at=parse_dt(d.get("updated_at")),
    )

# ----------------------- Routes -----------------------

@router.post("", response_model=IdeaOut, status_code=status.HTTP_201_CREATED)
def create_idea(body: IdeaCreate):
    created = _create(body.dict())
    return _to_out(created)

@router.get("", response_model=IdeaListOut)
def list_ideas(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    q: Optional[str] = None,
    priority: Optional[str] = None,      # e.g. "3,4,5"
    feasible: Optional[bool] = None,
    time_min: Optional[int] = Query(None, ge=0),
    time_max: Optional[int] = Query(None, ge=0),
    sort: str = Query("-updated_at"),
):
    items = _list()
    items = _apply_filters(items, q, _parse_priority_csv(priority), feasible, time_min, time_max)
    items = _apply_sort(items, sort)
    page_items, total = _paginate(items, page, page_size)
    return IdeaListOut(
        items=[_to_out(x) for x in page_items],
        total=total,
        page=page,
        page_size=page_size,
    )

@router.get("/{id}", response_model=IdeaOut)
def get_idea(id: int):
    it = _get(id)
    if not it:
        raise HTTPException(404, "Idea not found")
    return _to_out(it)

@router.patch("/{id}", response_model=IdeaOut)
def patch_idea(id: int, body: IdeaUpdate):
    if body is None or not body.dict(exclude_unset=True):
        raise HTTPException(400, "Empty patch")
    current = _get(id)
    if not current:
        raise HTTPException(404, "Idea not found")
    patch = {**current, **body.dict(exclude_unset=True)}
    updated = _update(id, patch)
    if not updated:
        raise HTTPException(404, "Idea not found")
    return _to_out(updated)

@router.delete("/{id}", status_code=204)
def delete_idea(id: int):
    ok = _delete(id)
    if not ok:
        # 仍返回 204，幂等
        return