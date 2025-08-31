# backend/app/services/mineru_client.py
from __future__ import annotations
import os, io, asyncio, json, tempfile, shutil, pathlib, subprocess
from typing import Optional, Dict, Any
import httpx
from loguru import logger
from ..core.config import settings

class MineruError(RuntimeError): ...

class MineruClient:
    def __init__(self):
        self.mode = (getattr(settings, "MINERU_MODE", "http") or "http").lower()
        self.base = getattr(settings, "MINERU_BASE", "http://127.0.0.1:17860")
        self.bin  = getattr(settings, "MINERU_BIN", "mineru")

    async def parse_pdf(self, file_path: str) -> Dict[str, Any]:
        if self.mode == "http":
            return await self._parse_http(file_path)
        return await self._parse_cli(file_path)

    async def _parse_http(self, file_path: str) -> Dict[str, Any]:
        url = f"{self.base.rstrip('/')}/parse"
        try:
            with open(file_path, "rb") as f:
                files = {"file": (os.path.basename(file_path), f, "application/pdf")}
                async with httpx.AsyncClient(timeout=120, trust_env=False, headers={
                    "User-Agent": "InfiniPaper/reader"
                }) as client:
                    r = await client.post(url, files=files)
                    r.raise_for_status()
                    return r.json()  # 期望返回 {html, markdown, toc?, map?}
        except Exception as e:
            logger.error(f"MinerU HTTP failed: {e}")
            raise MineruError(str(e))

    async def _parse_cli(self, file_path: str) -> Dict[str, Any]:
        # 约定：mineru parse <pdf> -o <out_dir> --format html,md --single-file
        outdir = tempfile.mkdtemp(prefix="mineru_")
        try:
            proc = await asyncio.create_subprocess_exec(
                self.bin, "parse", file_path, "-o", outdir, "--format", "html,md", "--single-file",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            out, err = await proc.communicate()
            if proc.returncode != 0:
                raise MineruError(err.decode() or out.decode())

            html_path = None; md_path = None
            for p in pathlib.Path(outdir).glob("*"):
                if p.suffix.lower() in {".html", ".htm"}: html_path = p
                if p.suffix.lower() == ".md": md_path = p
            html = html_path.read_text(encoding="utf-8") if html_path and html_path.exists() else ""
            md   = md_path.read_text(encoding="utf-8") if md_path and md_path.exists() else ""
            return {"html": html, "markdown": md}
        finally:
            shutil.rmtree(outdir, ignore_errors=True)