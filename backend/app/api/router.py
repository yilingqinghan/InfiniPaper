from __future__ import annotations
from fastapi import APIRouter

api_router = APIRouter()

# 固定导入；某个模块缺失也不影响其他模块
try:
    from .v1 import papers
    api_router.include_router(papers.router,   prefix="/papers",   tags=["papers"])
except Exception as e:
    print("[router] skip papers:", e)

try:
    from .v1 import notes
    api_router.include_router(notes.router,    prefix="/notes",    tags=["notes"])
except Exception as e:
    print("[router] skip notes:", e)

try:
    from .v1 import tags
    api_router.include_router(tags.router,     prefix="/tags",     tags=["tags"])
except Exception as e:
    print("[router] skip tags:", e)

try:
    from .v1 import search
    api_router.include_router(search.router,   prefix="/search",   tags=["search"])
except Exception as e:
    print("[router] skip search:", e)

try:
    from .v1 import external
    api_router.include_router(external.router, prefix="/external", tags=["external"])
except Exception as e:
    print("[router] skip external:", e)

try:
    from .v1 import dedupe
    api_router.include_router(dedupe.router,   prefix="/dedupe",   tags=["dedupe"])
except Exception as e:
    print("[router] skip dedupe:", e)

try:
    from .v1 import quality
    api_router.include_router(quality.router,  prefix="/quality",  tags=["quality"])
except Exception as e:
    print("[router] skip quality:", e)

try:
    import importlib
    folders_module = importlib.import_module("app.api.v1.folders")
    if hasattr(folders_module, "router"):
        api_router.include_router(folders_module.router, prefix="/folders", tags=["folders"])
        print("[router] folders mounted at /api/v1/folders")
    else:
        print("[router] folders module has no 'router' attribute")
except Exception as e:
    import traceback
    print("[router] skip folders due to error:", repr(e))
    traceback.print_exc()