from __future__ import annotations
import os, re, urllib.parse
from typing import Dict, Any, List, Optional
import httpx
from loguru import logger

CR_BASE = "https://api.crossref.org/works"
OA_BASE = "https://api.openalex.org/works"

# export for other modules
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)

def _norm_doi(doi: Optional[str]) -> Optional[str]:
    if not doi: return None
    doi = doi.strip()
    doi = doi.replace("https://doi.org/", "").replace("http://doi.org/", "").strip()
    return doi or None

async def fetch_crossref_by_doi(doi: str) -> Dict[str, Any]:
    doi = _norm_doi(doi)
    if not doi: return {}
    url = f"{CR_BASE}/{urllib.parse.quote(doi)}"
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url, headers={"Accept":"application/json"})
            r.raise_for_status()
            msg = (r.json() or {}).get("message", {}) or {}
            title = (msg.get("title") or [None])[0]
            container = (msg.get("container-title") or [None])[0]
            issued = msg.get("issued", {}).get("date-parts") or []
            year = issued[0][0] if issued and issued[0] else None
            url_cr = msg.get("URL")
            authors: List[Dict[str, Optional[str]]] = []
            for a in msg.get("author", []) or []:
                given = (a.get("given") or "").strip()
                family = (a.get("family") or "").strip()
                name = (f"{given} {family}".strip() or a.get("name") or None)
                aff = None
                if a.get("affiliation"):
                    aff = (a["affiliation"][0].get("name") or "").strip() or None
                orcid = a.get("ORCID")
                if orcid:
                    orcid = orcid.replace("https://orcid.org/","").strip()
                authors.append({"name": name, "affiliation": aff, "orcid": orcid})
            return {
                "title": title, "venue": container, "year": year,
                "authors": authors, "url": url_cr, "doi": doi
            }
    except Exception as e:
        logger.debug(f"Crossref DOI fetch failed: {e}")
        return {}

async def fetch_crossref_by_title(title: str) -> Dict[str, Any]:
    try:
        params = {"query.title": title, "rows": 3}
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(CR_BASE, params=params, headers={"Accept":"application/json"})
            r.raise_for_status()
            items = ((r.json() or {}).get("message") or {}).get("items", []) or []
            if not items: return {}
            it = items[0]
            title = (it.get("title") or [None])[0]
            container = (it.get("container-title") or [None])[0]
            issued = it.get("issued", {}).get("date-parts") or []
            year = issued[0][0] if issued and issued[0] else None
            url_cr = it.get("URL")
            doi = it.get("DOI")
            return {"title": title, "venue": container, "year": year, "url": url_cr, "doi": doi}
    except Exception as e:
        logger.debug(f"Crossref title search failed: {e}")
        return {}

async def fetch_openalex(doi: Optional[str]=None, title: Optional[str]=None) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            if doi := _norm_doi(doi):
                url = f"{OA_BASE}/https://doi.org/{urllib.parse.quote(doi)}"
                r = await client.get(url)
                if r.status_code == 404:
                    pass
                else:
                    r.raise_for_status()
                    obj = r.json()
                    return _openalex_payload(obj)

            if title:
                q = urllib.parse.quote(title)
                url = f"{OA_BASE}?search={q}&per-page=1"
                r = await client.get(url)
                r.raise_for_status()
                results = (r.json() or {}).get("results", []) or []
                if results:
                    return _openalex_payload(results[0])
    except Exception as e:
        logger.debug(f"OpenAlex fetch failed: {e}")
    return {}

def _openalex_payload(obj: Dict[str, Any]) -> Dict[str, Any]:
    authors: List[Dict[str, Optional[str]]] = []
    for au in obj.get("authorships", []) or []:
        name = (au.get("author") or {}).get("display_name")
        aff = None
        insts = au.get("institutions") or []
        if insts:
            aff = (insts[0].get("display_name") or "").strip() or None
        authors.append({"name": name, "affiliation": aff, "orcid": None})

    year = obj.get("publication_year")
    url = (obj.get("primary_location") or {}).get("landing_page_url")
    oa_pdf_url = (obj.get("primary_location") or {}).get("pdf_url")
    if not oa_pdf_url:
        oa = obj.get("open_access") or {}
        oa_pdf_url = oa.get("oa_url") or None

    venue = None
    src = (obj.get("primary_location") or {}).get("source") or {}
    if src:
        venue = src.get("display_name") or venue

    doi = None
    ids = obj.get("ids") or {}
    if ids.get("doi"):
        doi = _norm_doi(ids["doi"])

    return {
        "authors": authors, "year": year, "url": url, "oa_pdf_url": oa_pdf_url,
        "venue": venue, "doi": doi
    }

def merge_meta(*metas: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for m in metas:
        if not m: continue
        for k, v in m.items():
            if k == "authors":
                if not out.get("authors") and v:
                    out["authors"] = v
            elif k in ("oa_pdf_url","url","venue","title","year","doi"):
                if (out.get(k) in (None, "", 0)) and v not in (None,"",0,[]):
                    out[k] = v
            else:
                if k not in out:
                    out[k] = v
    return out
