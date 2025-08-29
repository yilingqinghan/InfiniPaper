
from fastapi import APIRouter
from sqlmodel import select
from ..deps import SessionDep
from ...models import Paper

router = APIRouter()

@router.get("/summary")
def summary(session: SessionDep):
    papers = session.exec(select(Paper)).all()
    missing_doi = [p.id for p in papers if not p.doi]
    missing_year = [p.id for p in papers if not p.year]
    missing_venue = [p.id for p in papers if not p.venue]
    missing_abs = [p.id for p in papers if not p.abstract]
    return {
        "missing": {
            "doi": missing_doi,
            "year": missing_year,
            "venue": missing_venue,
            "abstract": missing_abs,
        },
        "total": len(papers)
    }
