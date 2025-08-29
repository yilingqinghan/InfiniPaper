
from __future__ import annotations
from loguru import logger
import httpx, os, re
from typing import Dict, Any

# ---- Heuristics & helpers ----
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)

def _parse_tei(tei_xml: str) -> Dict[str, Any]:
    def _find(pattern, default=None):
        m = re.search(pattern, tei_xml, flags=re.I|re.S)
        return m.group(1).strip() if m else default
    title = _find(r"<title[^>]*>(.*?)</title>")
    year = _find(r"<date[^>]*when=['\"](\d{4})")
    authors = re.findall(r"<author[^>]*>.*?<persName[^>]*>(.*?)</persName>.*?</author>", tei_xml, flags=re.I|re.S)
    clean_authors = []
    for a in authors:
        name = re.sub(r"<.*?>", " ", a)
        name = re.sub(r"\s+", " ", name).strip()
        if name:
            clean_authors.append(name)
    return {"title": title, "year": int(year) if year else None, "authors": clean_authors}

def _filename_to_title(path: str) -> str:
    name = os.path.splitext(os.path.basename(path))[0]
    name = re.sub(r"[_\-]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def _extract_text_first_pages(file_path: str, max_pages: int = 5) -> str:
    try:
        from PyPDF2 import PdfReader
        r = PdfReader(file_path)
        text = []
        for i, page in enumerate(r.pages[:max_pages]):
            try:
                text.append(page.extract_text() or "")
            except Exception:
                pass
        return "\n".join(text)
    except Exception as e:
        logger.debug(f"PyPDF2 not available or failed: {e}")
        return ""

async def _enrich_by_crossref(doi: str) -> Dict[str, Any]:
    url = f"https://api.crossref.org/works/{doi}"
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url, headers={"Accept": "application/json"})
            r.raise_for_status()
            obj = r.json().get("message", {})
            title = (obj.get("title") or [None])[0]
            container = (obj.get("container-title") or [None])[0]
            year = None
            issued = obj.get("issued", {}).get("date-parts")
            if issued and isinstance(issued, list) and issued and issued[0]:
                year = issued[0][0]
            authors = []
            for a in obj.get("author", []) or []:
                given = a.get("given") or ""
                family = a.get("family") or ""
                nm = f"{given} {family}".strip()
                if nm:
                    authors.append(nm)
            return {"title": title, "venue": container, "year": year, "authors": authors, "doi": doi}
    except Exception as e:
        logger.debug(f"Crossref lookup failed: {e}")
    return {}

async def _crossref_search_by_title(title: str) -> Dict[str, Any]:
    url = "https://api.crossref.org/works"
    params = {"query.title": title, "rows": 3}
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url, params=params, headers={"Accept":"application/json"})
            r.raise_for_status()
            items = (r.json().get("message", {}) or {}).get("items", []) or []
            for it in items:
                t = (it.get("title") or [None])[0]
                if not t: 
                    continue
                a = t.lower(); b = title.lower()
                if (a in b) or (b in a) or (len(set(a.split()) & set(b.split())) >= max(2, min(len(b.split()), len(a.split()))//2)):
                    year = None
                    issued = it.get("issued", {}).get("date-parts")
                    if issued and isinstance(issued, list) and issued and issued[0]:
                        year = issued[0][0]
                    container = (it.get("container-title") or [None])[0]
                    doi = it.get("DOI")
                    return {"title": t, "venue": container, "year": year, "doi": doi}
            if items:
                it = items[0]
                t = (it.get("title") or [None])[0]
                container = (it.get("container-title") or [None])[0]
                year = None
                issued = it.get("issued", {}).get("date-parts")
                if issued and isinstance(issued, list) and issued and issued[0]:
                    year = issued[0][0]
                doi = it.get("DOI")
                return {"title": t, "venue": container, "year": year, "doi": doi}
    except Exception as e:
        logger.debug(f"Crossref title search failed: {e}")
    return {}

def _guess_venue_from_text(text: str) -> str | None:
    patterns = [
        r"Proceedings of the ([^\n,]+)",
        r"In Proceedings of the ([^\n,]+)",
        r"International Conference on ([^\n,]+)",
        r"ACM SIGPLAN ([^\n,]+)",
        r"IEEE/ACM ([^\n,]+)",
        r"ACM ([^\n]+) Conference",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.I)
        if m:
            v = m.group(0)
            v = re.sub(r"^(In )?Proceedings of the ", "Proceedings of the ", v, flags=re.I)
            return v.strip()
    return None

async def parse_pdf_metadata(file_path: str) -> dict:
    """
    Heuristic extraction order:
    1) GROBID (if reachable)
    2) DOI in first pages -> Crossref
    3) Title guess (first lines) -> Crossref search
    4) Venue guess from text
    5) Filename -> title
    """
    from ..core.config import settings

    # 1) GROBID
    url = f"{settings.GROBID_URL}/api/processHeaderDocument"
    try:
        with open(file_path, "rb") as f:
            files = {"input": (os.path.basename(file_path), f, "application/pdf")}
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                r = await client.post(url, files=files)
                r.raise_for_status()
                tei = r.text
                meta = _parse_tei(tei)
                meta["tei_xml"] = tei
                if meta.get("title") and (meta.get("year") or meta.get("doi")):
                    text = _extract_text_first_pages(file_path, 5)
                    if not meta.get("doi"):
                        m = DOI_RE.search(text)
                        if m:
                            cr = await _enrich_by_crossref(m.group(0))
                            for k,v in cr.items():
                                meta.setdefault(k, v)
                    if not meta.get("venue"):
                        guess = _guess_venue_from_text(text)
                        if guess:
                            meta["venue"] = guess
                    return meta
    except Exception as e:
        logger.warning(f"GROBID unavailable or failed: {e}")

    # 2) DOI from text
    text = _extract_text_first_pages(file_path, 5)
    m = DOI_RE.search(text)
    if m:
        cr = await _enrich_by_crossref(m.group(0))
        if cr:
            if not cr.get("venue"):
                guess = _guess_venue_from_text(text)
                if guess:
                    cr["venue"] = guess
            if not cr.get("title"):
                cr["title"] = _filename_to_title(file_path)
            return cr

    # 3) Title guess -> Crossref
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    candidate = None
    for ln in lines[:15]:
        if len(ln) > 8 and len(ln.split()) >= 3 and not ln.lower().startswith("abstract"):
            candidate = ln
            break
    if not candidate:
        candidate = _filename_to_title(file_path)
    cr = await _crossref_search_by_title(candidate)
    if cr:
        if not cr.get("venue"):
            guess = _guess_venue_from_text(text)
            if guess:
                cr["venue"] = guess
        return cr

    # 4) Fallback
    return {"title": _filename_to_title(file_path)}
