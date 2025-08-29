
from loguru import logger
from ..core.config import settings
import httpx

async def parse_pdf_metadata(file_path: str) -> dict:
    """Send PDF to GROBID for header extraction. If GROBID_URL is empty/unavailable, return {}."""
    if not settings.GROBID_URL:
        logger.warning("GROBID_URL not configured; skipping structured parsing.")
        return {}
    url = f"{settings.GROBID_URL.rstrip('/')}/api/processHeaderDocument"
    try:
        with open(file_path, "rb") as f:
            files = {"input": ("paper.pdf", f, "application/pdf")}
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(url, files=files)
                r.raise_for_status()
                return {"tei_xml": r.text}
    except Exception as e:
        logger.error(f"GROBID error: {e}")
        return {}
