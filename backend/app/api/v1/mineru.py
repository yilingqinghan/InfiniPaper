from __future__ import annotations

import os
import re
import uuid
import hashlib
import subprocess
import shlex
from pathlib import Path
from typing import Optional, List, Tuple
from urllib.parse import urlparse, urlunparse, urlsplit, urlunsplit, quote

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from loguru import logger

router = APIRouter()

# ===================== Models =====================
class ParseReq(BaseModel):
    # 三选一：优先使用 pdf_url；否则 pdf_path；否则 paper_id（保留扩展）
    pdf_path: Optional[str] = None
    pdf_url: Optional[str] = None
    paper_id: Optional[int] = None


class ParseResp(BaseModel):
    used_mode: str
    out_dir: str
    html: Optional[str] = None
    md: Optional[str] = None
    html_file: Optional[str] = None
    md_file: Optional[str] = None
    # 前端拼资源所需：
    cache_key: Optional[str] = None
    assets_base: Optional[str] = None  # 现在是【绝对 URL】，避免 3000 代理 404
    md_rel: Optional[str] = None       # md 所在目录（相对 out_dir），用于调试
    md_base: Optional[str] = None      # 图片/附件基准目录（相对 out_dir），通常是 "<Title>/auto"


# ===================== Helpers =====================
def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _mineru_roots() -> Tuple[Path, Path]:
    base_root = Path(os.environ.get("MINERU_TMP_DIR", "storage/mineru")).resolve()
    cache_root = base_root / "cache"
    return base_root, cache_root


def _cache_base_for_key(cache_key: str) -> Path:
    """
    为给定 cache_key 定位实际 mineru 缓存根目录（…/storage/mineru 或 backend/storage/mineru）。
    优先 env MINERU_TMP_DIR，其次常见候选，选择真正包含 cache/<key> 的目录。
    """
    candidates: List[Path] = []
    env = os.environ.get("MINERU_TMP_DIR")
    if env:
        candidates.append(Path(env).resolve())
    candidates += [
        Path("storage/mineru").resolve(),
        Path("backend/storage/mineru").resolve(),
        Path("./storage/mineru").resolve(),
        Path("./backend/storage/mineru").resolve(),
    ]
    # 去重
    uniq: List[Path] = []
    seen = set()
    for c in candidates:
        s = str(c)
        if s in seen:
            continue
        seen.add(s)
        uniq.append(c)

    for base in uniq:
        probe = base / "cache" / cache_key
        if probe.exists() and probe.is_dir():
            logger.info(f"[mineru/assets] cache base matched: {probe}")
            return base
    for base in uniq:
        if (base / "cache").exists():
            logger.info(f"[mineru/assets] cache base fallback: {base}/cache (key not found)")
            return base

    last = uniq[0] if uniq else Path("storage/mineru").resolve()
    logger.warning(f"[mineru/assets] cache base not found for key={cache_key}, using {last}")
    return last


def _files_root() -> Path:
    root = os.environ.get("FILES_ROOT") or os.environ.get("MINERU_FILES_DIR")
    if root:
        return Path(root).resolve()
    for guess in ("storage", "backend/storage", "./storage", "./backend/storage"):
        p = Path(guess).resolve()
        if p.exists():
            return p
    return Path("storage").resolve()


def _try_local_path_from_url(pdf_url: str) -> Optional[Path]:
    """将 http://127.0.0.1:8000/files/... 映射为本地文件系统路径。"""
    try:
        u = urlparse(pdf_url)
        if not u.path.startswith("/files/"):
            return None
        rel = u.path[len("/files/"):].lstrip("/")
        candidate = _files_root() / rel
        return candidate if candidate.exists() else None
    except Exception:
        return None


def _sha1_file(path: Path, chunk: int = 1024 * 1024) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _result_patterns() -> List[str]:
    # 覆盖不同 MinerU 版本常见输出位置
    return ["*.html", "html/*.html", "**/result.html",
            "*.md", "markdown/*.md", "md/*.md"]


def _has_outputs(root: Path) -> bool:
    for pat in _result_patterns():
        if any(root.rglob(pat)):
            return True
    return False


def _normalize_pdf_url(url: str) -> str:
    try:
        if not url:
            return url
        u = urlparse(url if "://" in url else f"http://{url.lstrip('/')}")
        if u.path.startswith("/files/") and u.hostname in {"localhost", "127.0.0.1"}:
            host = "127.0.0.1:8000"  # 后端端口
            return urlunparse((u.scheme or "http", host, u.path, "", "", ""))
    except Exception:
        pass
    return url


def _percent_encode_url(u: str) -> str:
    try:
        s = urlsplit(u)
        netloc = s.hostname.encode("idna").decode("ascii") if s.hostname else ""
        if s.port:
            netloc = f"{netloc}:{s.port}"
        path = quote(s.path)
        return urlunsplit((s.scheme, netloc, path, s.query, s.fragment))
    except Exception:
        return u


async def _download_pdf(pdf_url: str, dest_dir: Path) -> Path:
    pdf_url = _normalize_pdf_url(pdf_url)
    pdf_url = _percent_encode_url(pdf_url)
    _ensure_dir(dest_dir)

    fname = re.sub(r"[^A-Za-z0-9_.-]+", "_", os.path.basename(urlsplit(pdf_url).path)) or f"{uuid.uuid4().hex}.pdf"
    if not fname.lower().endswith(".pdf"):
        fname += ".pdf"
    dest = dest_dir / fname

    logger.info(f"[mineru] ↓ download: {pdf_url} -> {dest}")
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False, follow_redirects=True) as client:
            r = await client.get(pdf_url)
            logger.info(f"[mineru] HTTP GET {pdf_url} -> {r.status_code}, bytes={len(r.content)}")
            r.raise_for_status()
            dest.write_bytes(r.content)
        return dest
    except httpx.HTTPStatusError as e:
        logger.exception(f"[mineru] HTTP error on {pdf_url}")
        raise HTTPException(e.response.status_code, f"download failed: {pdf_url} - {e}")
    except httpx.RequestError as e:
        logger.exception(f"[mineru] Request error on {pdf_url}")
        raise HTTPException(502, f"download failed: {pdf_url} - {e}")


def _mineru_cli(pdf_path: Path, out_dir: Path) -> None:
    bin_ = os.environ.get("MINERU_CLI_BIN", "mineru")
    # Use space-separated option style (-p <path>) because some mineru builds
    # treat "-p=<path>" as a literal value starting with '=' (see error log).
    p_str = str(Path(pdf_path).resolve())
    o_str = str(Path(out_dir).resolve())
    cmd = [
        bin_,
        "-p", p_str,
        "-o", o_str,
        "--format", "html,md",
    ]
    # Log a shell-safe version for easier debugging
    log_cmd = " ".join(shlex.quote(x) for x in cmd)
    logger.info(f"[mineru-cli] exec: {log_cmd}")

    r = subprocess.run(cmd, capture_output=True, text=True)
    logger.info(f"[mineru-cli] stdout:\n{(r.stdout or '')[:4000]}")
    if r.returncode != 0:
        logger.error(f"[mineru-cli] code={r.returncode}\nSTDERR:\n{(r.stderr or '')[:4000]}")
        raise RuntimeError(r.stderr or "mineru failed")

async def _mineru_http(pdf_path: Path, out_dir: Path) -> None:
    base = os.environ.get("MINERU_HTTP_URL", "http://127.0.0.1:7001").rstrip("/")
    url = f"{base}/parse"
    logger.info(f"[mineru-http] POST {url}")
    files = {"file": (pdf_path.name, open(pdf_path, "rb"), "application/pdf")}
    data = {"format": "html,md", "out_dir": str(out_dir)}
    async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
        r = await client.post(url, data=data, files=files)
        logger.info(f"[mineru-http] -> {r.status_code}")
        r.raise_for_status()


def _resolve_result_root(out_dir: Path) -> Path:
    # 先看直接 auto
    if (out_dir / "auto").is_dir():
        return out_dir / "auto"
    # 只有一个子目录则钻进去；该目录下若有 auto 再进一层
    try:
        subdirs = [p for p in out_dir.iterdir() if p.is_dir()]
    except FileNotFoundError:
        return out_dir
    if len(subdirs) == 1:
        inner = subdirs[0]
        return inner / "auto" if (inner / "auto").is_dir() else inner
    return out_dir


def _pick_latest(root: Path, patterns: List[str]) -> Optional[Path]:
    candidates: List[Path] = []
    for pat in patterns:
        candidates += list(root.rglob(pat))
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


# ===================== Assets Endpoint =====================
@router.api_route("/assets/{cache_key}/{subpath:path}", methods=["GET", "HEAD"])
def mineru_asset(cache_key: str, subpath: str):
    """
    只读地从 storage/mineru/cache/<cache_key>/<subpath> 返回文件，带诊断日志。
    """
    cache_base = _cache_base_for_key(cache_key)
    base = (cache_base / "cache" / cache_key).resolve()
    target = (base / subpath).resolve()
    logger.info("[mineru/assets] key=%s base=%s subpath=%s -> target=%s",
                cache_key, str(base), subpath, str(target))

    if not str(target).startswith(str(base)):
        logger.warning("[mineru/assets] traversal blocked: %s NOT under %s", target, base)
        raise HTTPException(403, "forbidden")

    if not target.exists():
        hint = []
        parent = target.parent
        try:
            if parent.exists():
                hint = [p.name for p in list(parent.iterdir())[:20]]
        except Exception:
            pass
        logger.warning("[mineru/assets] 404 target missing: %s | parent=%s | siblings(sample)=%s",
                       target, parent, hint)
        raise HTTPException(404, "not found")

    if not target.is_file():
        logger.warning("[mineru/assets] 404 not a file: %s", target)
        raise HTTPException(404, "not found")

    return FileResponse(target)


# ===================== Parse Endpoint =====================
def _build_assets_base(cache_key: str) -> str:
    """
    返回【绝对 URL】形式的 assets_base：
      {BACKEND_PUBLIC_URL or http://127.0.0.1:8000}/api/v1/mineru/assets/{cache_key}
    这样前端直接连 8000，不再经 3000 代理，避免 404。
    """
    backend_base = os.environ.get("BACKEND_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
    return f"{backend_base}/api/v1/mineru/assets/{cache_key}"


@router.post("/parse", response_model=ParseResp)
async def parse_with_mineru(req: ParseReq) -> ParseResp:
    logger.info(f"[mineru] req pdf_path={req.pdf_path} pdf_url={req.pdf_url} paper_id={req.paper_id}")

    # 根目录：临时与缓存
    base_root = Path(os.environ.get("MINERU_TMP_DIR", "storage/mineru")).resolve()
    _ensure_dir(base_root)
    cache_root = base_root / "cache"
    pdf_cache_root = base_root / "cache_pdfs"
    _ensure_dir(cache_root)
    _ensure_dir(pdf_cache_root)

    # → 本地化 PDF
    local_pdf: Optional[Path] = None
    if req.pdf_url:
        mapped = _try_local_path_from_url(req.pdf_url)
        if mapped:
            logger.info(f"[mineru] mapped url -> local file: {mapped}")
            local_pdf = mapped
        else:
            normalized = _percent_encode_url(_normalize_pdf_url(req.pdf_url))
            url_hash = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
            tmp_target = pdf_cache_root / f"{url_hash}.pdf"
            if not tmp_target.exists():
                tmp_target = await _download_pdf(normalized, pdf_cache_root)
            local_pdf = tmp_target
    elif req.pdf_path:
        p = Path(req.pdf_path)
        if not p.exists():
            p2 = Path("backend") / req.pdf_path
            if p2.exists():
                p = p2
        if not p.exists():
            raise HTTPException(404, f"pdf_path not found: {req.pdf_path}")
        local_pdf = p
    else:
        # 预留：若传 paper_id，可在此查数据库得 pdf_path/url
        raise HTTPException(400, "pdf_path or pdf_url required")

    # cache key = 内容 sha1
    try:
        cache_key = _sha1_file(local_pdf)
    except Exception as e:
        logger.warning(f"[mineru] sha1 failed: {e}; fallback to random key")
        cache_key = uuid.uuid4().hex

    out_dir = cache_root / cache_key
    _ensure_dir(out_dir)

    # Cache 命中
    if _has_outputs(out_dir):
        result_root = _resolve_result_root(out_dir)
        html_p = _pick_latest(result_root, ["*.html", "html/*.html", "**/result.html"])
        md_p = _pick_latest(result_root, ["*.md", "markdown/*.md", "md/*.md"])

        html = html_p.read_text("utf-8", errors="ignore") if html_p and html_p.exists() else None
        md = md_p.read_text("utf-8", errors="ignore") if md_p and md_p.exists() else None

        md_rel = ""
        md_base = ""
        if md_p:
            try:
                md_dir_rel = md_p.parent.relative_to(out_dir)
                md_rel = str(md_dir_rel)
                md_base = str(md_dir_rel.parent) if md_dir_rel.name.lower() in ("markdown", "md") else str(md_dir_rel)
            except Exception:
                pass

        logger.info(f"[mineru] cache hit: {out_dir} html={html_p} md={md_p}")
        return ParseResp(
            used_mode="cache",
            out_dir=str(out_dir),
            html=html, md=md,
            html_file=str(html_p) if html_p else None,
            md_file=str(md_p) if md_p else None,
            cache_key=cache_key,
            assets_base=_build_assets_base(cache_key),
            md_rel=md_rel or "",
            md_base=md_base or md_rel or "",
        )

    # 执行 MinerU
    mode = (os.environ.get("MINERU_MODE") or "cli").strip().lower()
    used = None
    try:
        if mode == "http":
            await _mineru_http(local_pdf, out_dir)
            used = "http"
        else:
            _mineru_cli(local_pdf, out_dir)
            used = "cli"
    except Exception as e:
        logger.exception("[mineru] parse failed")
        raise HTTPException(500, f"MinerU failed: {e}")

    # 读取结果
    result_root = _resolve_result_root(out_dir)
    html_p = _pick_latest(result_root, ["*.html", "html/*.html", "**/result.html"])
    md_p = _pick_latest(result_root, ["*.md", "markdown/*.md", "md/*.md"])
    try:
        listing = ", ".join(sorted(p.name for p in result_root.iterdir())[:20])
        logger.info(f"[mineru] result_root={result_root} | {listing}")
    except Exception:
        pass

    html = html_p.read_text("utf-8", errors="ignore") if html_p and html_p.exists() else None
    md = md_p.read_text("utf-8", errors="ignore") if md_p and md_p.exists() else None

    logger.info(f"[mineru] ok html={bool(html)} md={bool(md)} out={out_dir}")

    md_rel = ""
    md_base = ""
    if md_p:
        try:
            md_dir_rel = md_p.parent.relative_to(out_dir)
            md_rel = str(md_dir_rel)
            md_base = str(md_dir_rel.parent) if md_dir_rel.name.lower() in ("markdown", "md") else str(md_dir_rel)
        except Exception:
            pass

    return ParseResp(
        used_mode=used or mode,
        out_dir=str(out_dir),
        html=html, md=md,
        html_file=str(html_p) if html_p else None,
        md_file=str(md_p) if md_p else None,
        cache_key=cache_key,
        assets_base=_build_assets_base(cache_key),  # 绝对 URL，前端直连 8000
        md_rel=md_rel or "",
        md_base=md_base or md_rel or "",
    )