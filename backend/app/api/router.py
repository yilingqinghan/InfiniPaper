from fastapi import APIRouter
from .v1 import papers, notes, tags, search

api_router = APIRouter()
api_router.include_router(papers.router, prefix="/papers", tags=["papers"])
api_router.include_router(notes.router, prefix="/notes", tags=["notes"])
api_router.include_router(tags.router, prefix="/tags", tags=["tags"])
api_router.include_router(search.router, prefix="/search", tags=["search"])