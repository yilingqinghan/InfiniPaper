from __future__ import annotations
from fastapi import APIRouter

api_router = APIRouter()

# —— 固定功能模块（缺哪个不影响其他路由挂载）——
try:
    from .v1 import papers
    api_router.include_router(papers.router,   prefix="/papers",   tags=["papers"])
except Exception as e:
    print("[router] skip papers:", repr(e))

try:
    from .v1 import notes
    api_router.include_router(notes.router,    prefix="/notes",    tags=["notes"])
except Exception as e:
    print("[router] skip notes:", repr(e))

try:
    from .v1 import tags as tags_module
    api_router.include_router(tags_module.router, prefix="/tags", tags=["tags"])
except Exception as e:
    print("[router] skip tags:", e)

try:
    from .v1 import search
    api_router.include_router(search.router,   prefix="/search",   tags=["search"])
except Exception as e:
    print("[router] skip search:", repr(e))

try:
    from .v1 import external
    api_router.include_router(external.router, prefix="/external", tags=["external"])
except Exception as e:
    print("[router] skip external:", repr(e))

try:
    from .v1 import dedupe
    api_router.include_router(dedupe.router,   prefix="/dedupe",   tags=["dedupe"])
except Exception as e:
    print("[router] skip dedupe:", repr(e))

try:
    from .v1 import quality
    api_router.include_router(quality.router,  prefix="/quality",  tags=["quality"])
except Exception as e:
    print("[router] skip quality:", repr(e))

try:
    from .v1.mineru import router as mineru_router
    api_router.include_router(mineru_router,  prefix="/mineru",  tags=["mineru"])
except Exception as e:
    print("[router] skip mineru:", repr(e))

try:
    from .v1 import llm
    api_router.include_router(llm.router, prefix="/llm", tags=["llm"])
except Exception as e:
    print("[router] skip llm:", repr(e))

try:
    from .v1 import annotations
    api_router.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
except Exception as e:
    print("[router] skip annotations:", repr(e))

# —— folders 子模块（稳健导入，避免包索引/循环依赖导致 404）——
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

try:
    from .v1 import richnotes
    api_router.include_router(richnotes.router, prefix="/richnotes", tags=["richnotes"])
except Exception as e:
    print("[router] skip richnotes:", repr(e))