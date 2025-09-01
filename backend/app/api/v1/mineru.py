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

    if not (req.pdf_path or req.pdf_url):
        raise HTTPException(400, "pdf_path or pdf_url required")

    # 建议 tmp 根目录简化为 storage/mineru（避免 backend/backend 重叠）
    tmp_root = Path(os.environ.get("MINERU_TMP_DIR", "storage/mineru")).resolve()
    _ensure_dir(tmp_root)
    out_dir = tmp_root / uuid.uuid4().hex
    _ensure_dir(out_dir)

    # → 本地化 PDF
    if req.pdf_path:
        p = Path(req.pdf_path)
        if not p.exists():
            p2 = Path("backend") / req.pdf_path
            if p2.exists():
                p = p2
        if not p.exists():
            raise HTTPException(404, f"pdf_path not found: {req.pdf_path}")
        local_pdf = p
    else:
        local_pdf = await _download_pdf(req.pdf_url, tmp_root / "tmp")

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