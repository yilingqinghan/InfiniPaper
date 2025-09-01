# backend/app/api/v1/mineru.py
from __future__ import annotations

import os
import re
import uuid
import subprocess
from pathlib import Path
from typing import Optional, List
from urllib.parse import urlparse, urlunparse, urlsplit, urlunsplit, quote
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger
import hashlib
from typing import Tuple

router = APIRouter()


# ========= Models =========
class ParseReq(BaseModel):
    # 二选一：本地路径 or URL
    pdf_path: Optional[str] = None
    pdf_url: Optional[str] = None


class ParseResp(BaseModel):
    used_mode: str
    out_dir: str
    html: Optional[str] = None
    md: Optional[str] = None
    html_file: Optional[str] = None
    md_file: Optional[str] = None


# ========= Helpers =========
def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def _normalize_pdf_url(url: str) -> str:
    try:
        if not url:
            return url
        u = urlparse(url if "://" in url else f"http://{url.lstrip('/')}")
        if u.path.startswith("/files/") and u.hostname in {"localhost", "127.0.0.1"}:
            host = "127.0.0.1:8000"
            return urlunparse((u.scheme or "http", host, u.path, "", "", ""))
    except Exception:
        pass
    return url

def _percent_encode_url(u: str) -> str:
    try:
        s = urlsplit(u)
        netloc = s.hostname.encode("idna").decode("ascii")
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
    cmd = [bin_, "-p", str(pdf_path), "-o", str(out_dir), "--format", "html,md"]
    logger.info(f"[mineru-cli] exec: {' '.join(cmd)}")
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


def _files_root() -> Path:
    # 允许通过环境变量覆盖静态文件根目录，默认与后端静态挂载一致
    root = os.environ.get("FILES_ROOT") or os.environ.get("MINERU_FILES_DIR")
    if root:
        return Path(root).resolve()
    # 与 main.py 的 staticfiles(directory=...) 保持一致；优先 storage，再回退 backend/storage
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
        rel = u.path[len("/files/"):].lstrip("/")  # e.g. "pdfs/foo.pdf"
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
    # 覆盖不同 MinerU 版本的常见输出位置
    return [
        "*.html", "html/*.html", "**/result.html",
        "*.md", "markdown/*.md", "md/*.md",
    ]


def _has_outputs(root: Path) -> bool:
    pats = _result_patterns()
    for pat in pats:
        if any(root.rglob(pat)):
            return True
    return False


# ========= Endpoint =========
def _resolve_result_root(out_dir: Path) -> Path:
    # 先看直接 auto
    if (out_dir / "auto").is_dir():
        return out_dir / "auto"
    # 只有一个子目录则钻进去；该目录下若有 auto 再进一层
    subdirs = [p for p in out_dir.iterdir() if p.is_dir()]
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

@router.post("/parse", response_model=ParseResp)
async def parse_with_mineru(req: ParseReq) -> ParseResp:
    logger.info(f"[mineru] req pdf_path={req.pdf_path} pdf_url={req.pdf_url}")

    # 根目录：临时与缓存
    base_root = Path(os.environ.get("MINERU_TMP_DIR", "storage/mineru")).resolve()
    _ensure_dir(base_root)
    cache_root = base_root / "cache"
    pdf_cache_root = base_root / "cache_pdfs"
    _ensure_dir(cache_root)
    _ensure_dir(pdf_cache_root)

    # → 本地化 PDF，并生成稳定 cache_key（基于文件内容 sha1）
    local_pdf: Optional[Path] = None
    if req.pdf_path:
        p = Path(req.pdf_path)
        if not p.exists():
            p2 = Path("backend") / req.pdf_path
            if p2.exists():
                p = p2
        if not p.exists():
            raise HTTPException(404, f"pdf_path not found: {req.pdf_path}")
        local_pdf = p
    elif req.pdf_url:
        # 优先直接映射到本地静态文件，避免重复下载
        mapped = _try_local_path_from_url(req.pdf_url)
        if mapped:
            logger.info(f"[mineru] mapped url -> local file: {mapped}")
            local_pdf = mapped
        else:
            # URL 下载到缓存
            normalized_url = _percent_encode_url(_normalize_pdf_url(req.pdf_url))
            # 先用 url 的 sha1 作为文件名再下载；下载后再对内容求 sha1 作为最终 key
            url_hash = hashlib.sha1(normalized_url.encode("utf-8")).hexdigest()
            tmp_target = pdf_cache_root / f"{url_hash}.pdf"
            if not tmp_target.exists():
                tmp_target = await _download_pdf(normalized_url, pdf_cache_root)
            local_pdf = tmp_target
    else:
        raise HTTPException(400, "pdf_path or pdf_url required")

    # 内容哈希作为 cache key（确保同一份 PDF 始终复用同一目录）
    try:
        cache_key = _sha1_file(local_pdf)
    except Exception as e:
        logger.warning(f"[mineru] sha1 failed: {e}; fallback to random key")
        cache_key = uuid.uuid4().hex

    out_dir = cache_root / cache_key
    _ensure_dir(out_dir)

    # Cache hit：已有解析结果则直接返回
    if _has_outputs(out_dir):
        result_root = _resolve_result_root(out_dir)
        html_p = _pick_latest(result_root, ["*.html", "html/*.html", "**/result.html"])
        md_p   = _pick_latest(result_root, ["*.md", "markdown/*.md", "md/*.md"])
        logger.info(f"[mineru] cache hit: {out_dir} html={html_p} md={md_p}")
        html = html_p.read_text("utf-8", errors="ignore") if html_p and html_p.exists() else None
        md   = md_p.read_text("utf-8", errors="ignore") if md_p and md_p.exists() else None
        return ParseResp(
            used_mode="cache",
            out_dir=str(out_dir),
            html=html,
            md=md,
            html_file=str(html_p) if html_p else None,
            md_file=str(md_p) if md_p else None,
        )

    # ✅ 提前定义 mode，避免 UnboundLocalError
    mode = (os.environ.get("MINERU_MODE") or "cli").strip().lower()
    used = None

    # 执行 MinerU
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

    # 进入真正的结果目录并递归找文件
    result_root = _resolve_result_root(out_dir)
    try:
        listing = ", ".join(sorted(p.name for p in result_root.iterdir())[:20])
        logger.info(f"[mineru] result_root={result_root} | {listing}")
    except Exception:
        pass

    html_p = _pick_latest(result_root, ["*.html", "html/*.html", "**/result.html"])
    md_p   = _pick_latest(result_root, ["*.md", "markdown/*.md", "md/*.md"])

    logger.info(f"[mineru] outputs html={html_p} md={md_p}")

    html = html_p.read_text("utf-8", errors="ignore") if html_p and html_p.exists() else None
    md   = md_p.read_text("utf-8", errors="ignore") if md_p and md_p.exists() else None

    logger.info(f"[mineru] ok html={bool(html)} md={bool(md)} out={out_dir}")
    return ParseResp(
        used_mode=used or mode,
        out_dir=str(out_dir),
        html=html,
        md=md,
        html_file=str(html_p) if html_p else None,
        md_file=str(md_p) if md_p else None,
    )