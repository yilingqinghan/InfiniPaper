from fastapi import APIRouter

# 其它模块照旧
from .v1 import papers, notes, tags, search, external, dedupe, quality

# —— 关键改动：稳健加载 folders 子模块（即使包索引异常也能成功）——
def _load_folders_router():
    try:
        # 首选：常规包内导入
        from .v1.folders import router as _router  # type: ignore
        return _router
    except Exception:
        # 兜底：按物理路径加载（避免 __init__.py 或包结构问题）
        import importlib.util, sys, pathlib
        here = pathlib.Path(__file__).resolve().parent  # .../app/api
        candidate = here / "v1" / "folders.py"
        if candidate.exists():
            spec = importlib.util.spec_from_file_location("app.api.v1.folders", str(candidate))
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                sys.modules["app.api.v1.folders"] = mod
                spec.loader.exec_module(mod)
                return getattr(mod, "router", None)
        # 最后：没有就返回 None（不阻塞应用启动）
        return None

folders_router = _load_folders_router()

api_router = APIRouter()
api_router.include_router(papers.router, prefix="/papers", tags=["papers"])
api_router.include_router(notes.router, prefix="/notes", tags=["notes"])
api_router.include_router(tags.router, prefix="/tags", tags=["tags"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(external.router, prefix="/import", tags=["import"])
api_router.include_router(dedupe.router, prefix="/dedupe", tags=["dedupe"])
api_router.include_router(quality.router, prefix="/quality", tags=["quality"])
