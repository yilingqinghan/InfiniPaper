from __future__ import annotations
import os, re
from typing import Dict, Any, Optional, List
import httpx
from loguru import logger

from .external_enrich import (
    DOI_RE, merge_meta, fetch_crossref_by_doi, fetch_crossref_by_title, fetch_openalex
)

def _extract_text_first_pages(file_path: str, max_pages: int = 5) -> str:
    try:
        from PyPDF2 import PdfReader
        r = PdfReader(file_path)
        text = []
        for page in r.pages[:max_pages]:
            try:
                text.append(page.extract_text() or "")
            except Exception:
                pass
        return "\n".join(text)
    except Exception as e:
        logger.debug(f"PyPDF2 failed: {e}")
        return ""

def _filename_to_title(path: str) -> str:
    name = os.path.splitext(os.path.basename(path))[0]
    name = re.sub(r"[_\-]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def _tei_find(pat: str, xml: str, default=None):
    m = re.search(pat, xml, flags=re.I | re.S)
    return m.group(1).strip() if m else default

def _parse_tei(tei_xml: str) -> Dict[str, Any]:
    title = _tei_find(r"<title[^>]*>(.*?)</title>", tei_xml)
    year = _tei_find(r"<date[^>]*when=['\"](\d{4})", tei_xml)

    aff_blocks = re.findall(r"<affiliation\b[^>]*>(.*?)</affiliation>", tei_xml, flags=re.I | re.S)
    aff_texts: List[str] = []
    for block in aff_blocks:
        t = re.sub(r"<[^>]+>", " ", block)
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            aff_texts.append(t)

    authors = []
    for m in re.finditer(r"<author\b[^>]*>(.*?)</author>", tei_xml, flags=re.I | re.S):
        chunk = m.group(1)
        nm = re.search(r"<persName[^>]*>(.*?)</persName>", chunk, flags=re.I | re.S)
        name = re.sub(r"<[^>]+>", " ", (nm.group(1) if nm else "")).strip() or None
        orcid = None
        m_orcid = re.search(r'<idno[^>]*type=["\']ORCID["\'][^>]*>([^<]+)</idno>', chunk, flags=re.I)
        if m_orcid:
            orcid = m_orcid.group(1).replace("https://orcid.org/","").strip()
        aff = None
        m_aff_inline = re.search(r"<affiliation\b[^>]*>(.*?)</affiliation>", chunk, flags=re.I | re.S)
        if m_aff_inline:
            aff = re.sub(r"<[^>]+>", " ", m_aff_inline.group(1))
            aff = re.sub(r"\s+", " ", aff).strip() or None
        if not aff:
            m_ptr = re.search(r'target=["\']#?aff(\d+)["\']', chunk, flags=re.I)
            if m_ptr:
                idx = int(m_ptr.group(1)) - 1
                if 0 <= idx < len(aff_texts):
                    aff = aff_texts[idx]
        if not aff and aff_texts:
            i = len(authors)
            if i < len(aff_texts):
                aff = aff_texts[i]
        authors.append({"name": name, "affiliation": aff, "orcid": orcid})

    return {"title": title, "year": int(year) if year else None, "authors": authors}

async def parse_pdf_metadata(file_path: str) -> Dict[str, Any]:
    """
    返回：title / year / venue / doi / url / oa_pdf_url / authors[{name,affiliation,orcid}]
    """
    from ..core.config import settings

    got: Dict[str, Any] = {}

    # 1) GROBID
    url = f"{settings.GROBID_URL}/api/processHeaderDocument"
    try:
        with open(file_path, "rb") as f:
            files = {"input": (os.path.basename(file_path), f, "application/pdf")}
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                r = await client.post(url, files=files)
                r.raise_for_status()
                tei = r.text
                grobid_meta = _parse_tei(tei)
                got = merge_meta(got, grobid_meta)
    except Exception as e:
        logger.warning(f"GROBID failed: {e}")

    text = _extract_text_first_pages(file_path, 5)

    # 2) DOI -> Crossref + OpenAlex
    doi_match = DOI_RE.search(text or "")
    if doi_match:
        cr = await fetch_crossref_by_doi(doi_match.group(0))
        oa = await fetch_openalex(doi=doi_match.group(0))
        got = merge_meta(got, cr, oa)

    # 3) 按标题搜索
    if not got.get("doi"):
        title_guess = got.get("title") or None
        if not title_guess:
            lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
            for ln in lines[:15]:
                if len(ln) > 8 and len(ln.split()) >= 3 and not ln.lower().startswith("abstract"):
                    title_guess = ln
                    break
        if title_guess:
            cr2 = await fetch_crossref_by_title(title_guess)
            oa2 = await fetch_openalex(title=title_guess)
            got = merge_meta(got, cr2, oa2)

    # 4) venue 简单兜底
    if not got.get("venue"):
        m = re.search(r"(Proceedings of the [^\n]+|International Conference on [^\n]+|ACM [^\n]+ Conference)", text or "", re.I)
        if m:
            got["venue"] = m.group(1).strip()

    if not got.get("title"):
        got["title"] = _filename_to_title(file_path)

    return got
