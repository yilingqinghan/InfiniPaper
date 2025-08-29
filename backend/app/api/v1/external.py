
from __future__ import annotations
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
import httpx
from ..deps import SessionDep
from ...models import Paper, Author, PaperAuthorLink, Tag, PaperTagLink
from ...schemas import PaperRead
from sqlmodel import select
from datetime import datetime

router = APIRouter()

OPENALEX_BASE = "https://api.openalex.org"

def _norm(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    return s or None

def _first_year(dt: Optional[str]) -> Optional[int]:
    if not dt: return None
    try:
        return int(dt.split("-")[0])
    except Exception:
        return None

async def _fetch_openalex(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{OPENALEX_BASE}/works", params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("results", [])

def _map_openalex_to_paper(item: Dict[str, Any]) -> Dict[str, Any]:
    # Map OpenAlex response to our Paper fields
    oa_id = item.get("id")
    doi = item.get("doi")
    title = item.get("title")
    abstract = item.get("abstract")
    if isinstance(abstract, dict):  # sometimes is inverted index format
        abstract = " ".join(abstract.get("inverted_index", {}).keys())
    published_year = item.get("publication_year") or _first_year(item.get("publication_date"))
    venue = None
    host = item.get("host_venue") or {}
    if host:
        venue = host.get("display_name") or host.get("publisher")
    authors = []
    for au in item.get("authorships", []):
        name = au.get("author", {}).get("display_name")
        orcid = au.get("author", {}).get("orcid")
        aff = None
        if au.get("institutions"):
            aff = ", ".join([i.get("display_name") for i in au["institutions"] if i.get("display_name")])
        if name:
            authors.append({"name": name, "orcid": orcid, "affiliation": aff})
    url = item.get("primary_location", {}).get("source", {}).get("hosted_documents_url") or item.get("primary_location", {}).get("landing_page_url")
    return {
        "title": title,
        "abstract": abstract,
        "year": published_year,
        "venue": venue,
        "doi": doi,
        "url": url,
        "source_id": oa_id,
        "source": "openalex",
        "authors": authors
    }

@router.get("/openalex", response_model=List[PaperRead])
async def search_openalex(session: SessionDep, q: str, per_page: int = 20):
    """Search by keyword/author/institution/topic using OpenAlex; returns transient PaperRead-like objects (not stored)."""
    params = {"search": q, "per_page": per_page}
    items = await _fetch_openalex(params)
    results: List[PaperRead] = []
    for it in items:
        m = _map_openalex_to_paper(it)
        # Build a transient PaperRead dict; id will be -1
        authors = []
        # Ensure authors exist or transient
        for au in m["authors"]:
            authors.append({"id": -1, **au})
        results.append(PaperRead(
            id=-1, title=m["title"], abstract=m["abstract"], year=m["year"], venue=m["venue"],
            doi=m["doi"], url=m["url"], authors=authors, tags=[]
        ))
    return results

@router.post("/openalex/import", response_model=List[PaperRead])
async def import_openalex(session: SessionDep, ids: List[str]):
    """Import list of OpenAlex works by OpenAlex IDs."""
    # Fetch individually (OpenAlex supports filter=ids.openalex_id:.. but keep simple)
    imported: List[PaperRead] = []
    async with httpx.AsyncClient(timeout=20) as client:
        for oid in ids:
            r = await client.get(f"{OPENALEX_BASE}/works/{oid}")
            r.raise_for_status()
            it = r.json()
            m = _map_openalex_to_paper(it)
            # Deduplicate by DOI
            paper = None
            if m["doi"]:
                stmt = select(Paper).where(Paper.doi == m["doi"])
                paper = session.exec(stmt).first()
            if not paper:
                paper = Paper(
                    title=_norm(m["title"]) or "(untitled)",
                    abstract=_norm(m["abstract"]),
                    year=m["year"],
                    venue=_norm(m["venue"]),
                    doi=_norm(m["doi"]),
                    url=_norm(m["url"]),
                    source="openalex",
                    source_id=m["source_id"]
                )
                session.add(paper)
                session.commit()
                session.refresh(paper)
                # authors
                for au in m["authors"]:
                    if not au.get("name"): 
                        continue
                    a = session.exec(select(Author).where(Author.name==au["name"], Author.orcid==au.get("orcid"))).first()
                    if not a:
                        a = Author(name=au["name"], orcid=au.get("orcid"), affiliation=au.get("affiliation"))
                        session.add(a); session.commit(); session.refresh(a)
                    session.add(PaperAuthorLink(paper_id=paper.id, author_id=a.id))
                session.commit()
            imported.append(PaperRead.from_orm(paper))
    return imported
