# backend/app/services/doi_resolver.py
from __future__ import annotations
import httpx

class DoiResolveError(Exception): pass

async def fetch_by_doi(doi: str) -> dict:
    doi = doi.strip()
    if not doi:
        raise DoiResolveError("empty doi")
    url = f"https://api.crossref.org/works/{doi}"
    headers = {
        "User-Agent": "InfiniPaper/1.0 (mailto:you@example.com)"
    }
    async with httpx.AsyncClient(timeout=10, follow_redirects=True, trust_env=False) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        m = r.json().get("message") or {}

    title = " ".join(m.get("title") or []) or None
    venue = (m.get("container-title") or [None])[0]
    # Crossref 年份通常在 issued.date-parts[0][0]
    year = None
    try:
        year = (m.get("issued", {}).get("date-parts") or [[None]])[0][0]
        if isinstance(year, str) and year.isdigit(): year = int(year)
    except Exception:
        year = None

    authors = []
    for a in m.get("author") or []:
        name = (f"{a.get('given','')} {a.get('family','')}".strip()) or a.get("name")
        aff = None
        try:
            aff = (a.get("affiliation") or [{}])[0].get("name")
        except Exception:
            pass
        if name:
            authors.append({"name": name, "affiliation": aff})

    return {
        "title": title,
        "venue": venue,
        "year": year,
        "authors": authors,
        "doi": doi,
        # Crossref 很少返回摘要，这里先不取
    }