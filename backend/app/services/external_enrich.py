from __future__ import annotations
import os, re, urllib.parse
from typing import Dict, Any, List, Optional
import httpx
from loguru import logger
from xml.etree import ElementTree as ET

CR_BASE = "https://api.crossref.org/works"
OA_BASE = "https://api.openalex.org/works"

# export for other modules
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)

def _norm_doi(doi: Optional[str]) -> Optional[str]:
    if not doi:
        return None
    d = doi.strip()
    # 去掉常见前缀（doi: / https://doi.org/ / http://doi.org/ / dx.doi.org）
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d, flags=re.I)
    d = re.sub(r"^doi:\s*", "", d, flags=re.I)
    # 去掉常见结尾标点（含中英文）
    d = d.rstrip('.,;:)]}>\u3002\uff0c\uff1a')
    # 处理 PDF 粘连（正确 DOI 末尾通常是数字，后面不应直接接英文字母串）
    m = re.match(r"^(.*?\d)([A-Za-z]{3,})$", d)
    if m:
        d = m.group(1)
    return d or None

async def fetch_crossref_by_doi(doi: str) -> Dict[str, Any]:
    doi = _norm_doi(doi)
    if not doi: return {}
    url = f"{CR_BASE}/{urllib.parse.quote(doi, safe='/')}"
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
                "authors": authors, "url": url_cr, "doi": doi,
                "cited_by_count": msg.get("is-referenced-by-count")
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
            return {"title": title, "venue": container, "year": year, "url": url_cr, "doi": doi, "cited_by_count": it.get("is-referenced-by-count")}
    except Exception as e:
        logger.debug(f"Crossref title search failed: {e}")
        return {}

async def fetch_openalex(
    doi: Optional[str] = None,
    title: Optional[str] = None,
    arxiv_id: Optional[str] = None,
) -> Dict[str, Any]:
    # 1) arXiv by id（优先）
    if arxiv_id:
        aid = arxiv_id.strip()
        if aid.lower().startswith("arxiv:"):
            aid = aid.split(":", 1)[1]
        url = f"{OA_BASE}/works/arXiv:{aid}"
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url)
            if r.status_code != 404:
                r.raise_for_status()
                obj = r.json()
                return _openalex_payload(obj)

    # 2) DOI（你之前已做：清洗 + quote(..., safe='/')）
    d = _norm_doi(doi)
    if d:
        url = f"{OA_BASE}/https://doi.org/{urllib.parse.quote(d, safe='/')}"
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url)
            if r.status_code != 404:
                r.raise_for_status()
                return _openalex_payload(r.json())

    # 3) 标题（保留你原有实现）
    if title:
        # ...保留你现有的 title 搜索逻辑
        ...
    return {}

# ---------------------------------------------------------------------------
# arXiv 直连（Atom API）
# ---------------------------------------------------------------------------
async def fetch_arxiv_by_id(arxiv_id: str) -> Dict[str, Any]:
    """Query arXiv Atom API by id and return unified payload."""
    if not arxiv_id:
        return {}
    aid = arxiv_id.strip()
    if aid.lower().startswith("arxiv:"):
        aid = aid.split(":", 1)[1]
    url = f"http://export.arxiv.org/api/query?search_query=id:{aid}"
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False, headers={
            # arXiv 要求设置 UA；随便放你项目名/邮箱
            "User-Agent": "InfiniPaper/1.0 (+https://your.domain/; mailto:you@example.com)"
        }) as client:
            r = await client.get(url)
            r.raise_for_status()
            xml = r.text

        ns = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
        root = ET.fromstring(xml)
        entry = root.find("atom:entry", ns)
        if entry is None:
            return {}

        title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip() or None
        pub = entry.findtext("atom:published", default="", namespaces=ns) or ""
        year = int(pub[:4]) if (len(pub) >= 4 and pub[:4].isdigit()) else None
        doi = entry.findtext("arxiv:doi", default=None, namespaces=ns)
        jref = entry.findtext("arxiv:journal_ref", default=None, namespaces=ns)
        url_html = entry.findtext("atom:id", default=None, namespaces=ns)

        authors: List[Dict[str, Optional[str]]] = []
        for a in entry.findall("atom:author", ns):
            nm = (a.findtext("atom:name", default="", namespaces=ns) or "").strip()
            if nm:
                authors.append({"name": nm, "affiliation": None})

        return {
            "title": title,
            "year": year,
            "venue": jref or "arXiv",
            "url": url_html,
            "doi": doi,
            "authors": authors,
        }
    except Exception as e:
        logger.warning(f"arXiv fetch failed for {arxiv_id}: {e}")
        return {}

# ---------------------------------------------------------------------------
# Semantic Scholar（Graph API）按 arXiv id 兜底
# ---------------------------------------------------------------------------
async def fetch_semanticscholar_by_arxiv(arxiv_id: str) -> Dict[str, Any]:
    if not arxiv_id:
        return {}
    aid = arxiv_id.strip()
    if aid.lower().startswith("arxiv:"):
        aid = aid.split(":", 1)[1]
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/ArXiv:" + aid +
        "?fields=title,year,venue,publicationVenue,authors.name,externalIds,url,citationCount"
    )
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            r = await client.get(url)
            if r.status_code == 404:
                return {}
            r.raise_for_status()
            obj = r.json()

        title = obj.get("title") or None
        year = obj.get("year")
        pv = obj.get("publicationVenue") or {}
        venue = pv.get("displayName") or obj.get("venue") or "arXiv"
        url_html = obj.get("url")
        ex = obj.get("externalIds") or {}
        doi = ex.get("DOI")
        cc = obj.get("citationCount")

        authors: List[Dict[str, Optional[str]]] = []
        for a in (obj.get("authors") or []):
            nm = (a or {}).get("name")
            if nm:
                authors.append({"name": nm, "affiliation": None})

        return {"title": title, "year": year, "venue": venue, "url": url_html, "doi": doi, "authors": authors, "cited_by_count": cc}
    except Exception as e:
        logger.warning(f"SemanticScholar fetch failed for arXiv:{arxiv_id}: {e}")
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

    cited = obj.get("cited_by_count")

    return {
        "authors": authors, "year": year, "url": url, "oa_pdf_url": oa_pdf_url,
        "venue": venue, "doi": doi, "cited_by_count": cited
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
