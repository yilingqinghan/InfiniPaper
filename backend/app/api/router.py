from fastapi import APIRouter
from .v1 import papers, notes, tags, search, external, dedupe, quality

api_router = APIRouter()
api_router.include_router(papers.router, prefix="/papers", tags=["papers"])
api_router.include_router(notes.router, prefix="/notes", tags=["notes"])
api_router.include_router(tags.router, prefix="/tags", tags=["tags"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(external.router, prefix="/import", tags=["import"])
api_router.include_router(dedupe.router, prefix="/dedupe", tags=["dedupe"])
api_router.include_router(quality.router, prefix="/quality", tags=["quality"])
