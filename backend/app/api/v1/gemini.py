from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import os
import requests
import base64
import time

router = APIRouter()
# Load environment variables from backend/.env (when running via `make backend`)
try:
    from dotenv import load_dotenv
    load_dotenv()  # loads `.env` from current working dir
except Exception:
    pass
    
class AskReq(BaseModel):
    prompt: str
    context: str | None = None
    model: str | None = None  # optional override

class AskResp(BaseModel):
    text: str

# ---- Helpers for PDF upload via Gemini Files API ----
def _gemini_upload_file(api_key: str, filename: str, mime_type: str, data: bytes) -> dict:
    """Uploads a file to Gemini Files API using resumable upload.
    Returns the created file resource dict (expects keys: name, uri, state, ...).
    """
    # 1) Start resumable session
    start_url = f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={api_key}"
    headers = {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(len(data)),
        "X-Goog-Upload-Header-Content-Type": mime_type,
        "Content-Type": "application/json",
    }
    payload = {"file": {"display_name": filename}}
    r = requests.post(start_url, headers=headers, json=payload, timeout=60)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=f"files.upload start failed: {r.text}")
    upload_url = r.headers.get("X-Goog-Upload-URL") or r.headers.get("x-goog-upload-url")
    if not upload_url:
        raise HTTPException(status_code=502, detail="files.upload: missing upload URL")

    # 2) Upload bytes and finalize
    headers2 = {
        "Content-Length": str(len(data)),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
    }
    r2 = requests.post(upload_url, headers=headers2, data=data, timeout=300)
    if r2.status_code >= 400:
        raise HTTPException(status_code=r2.status_code, detail=f"files.upload finalize failed: {r2.text}")
    file_info = r2.json().get("file") or {}
    if not file_info.get("uri"):
        raise HTTPException(status_code=502, detail="files.upload: missing file uri in response")
    return file_info

def _wait_file_active(api_key: str, file_name: str, timeout_s: int = 30) -> dict:
    """Polls files.get until state != PROCESSING or timeout. Returns latest file metadata dict."""
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        # files.get expects name like "files/abc" in the path
        url = f"https://generativelanguage.googleapis.com/v1beta/{file_name}?key={api_key}"
        r = requests.get(url, timeout=30)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=f"files.get failed: {r.text}")
        last = r.json().get("file") or {}
        state = (last.get("state") or "").upper()
        if state and state != "PROCESSING":
            return last
        time.sleep(1.5)
    return last or {}

@router.get("/ping")
def ping():
    # Always available so /docs shows this group even without API key
    return {"ok": True}

@router.post("/ask", response_model=AskResp)
def ask(req: AskReq):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")

    model = (req.model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()

    # Compose prompt with optional context
    prompt = req.prompt if not req.context else f"{req.prompt}\n\n{req.context}"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]}
        ]
        # Optionally add generationConfig/safetySettings here
        # "generationConfig": {"temperature": 0.7}
    }

    try:
        r = requests.post(url, json=payload, timeout=60)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"request failed: {e}")

    if r.status_code >= 400:
        # Surface upstream errors for easier debugging
        raise HTTPException(status_code=r.status_code, detail=r.text)

    data = r.json()

    # Extract text from candidates.parts[*].text
    out_chunks = []
    for cand in data.get("candidates", []):
        content = cand.get("content") or {}
        for part in content.get("parts", []):
            t = part.get("text")
            if t:
                out_chunks.append(t)

    text = ("\n".join(out_chunks)).strip() or "(空)"
    return {"text": text}

@router.post("/ask_pdf", response_model=AskResp)
async def ask_pdf(
    prompt: str = Form(...),
    file: UploadFile = File(...),
    model: str | None = Form(None),
):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")

    chosen_model = (model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-pro").strip()

    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    mime = file.content_type or "application/pdf"
    if "pdf" not in mime:
        # Allow octet-stream but still treat as pdf
        if mime != "application/octet-stream":
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
        mime = "application/pdf"

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Small PDFs (<= ~20MB total request) can be sent inline as base64 to simplify flow.
    # For larger PDFs use the Files API (resumable upload) and reference file_data by URI.
    use_inline = len(pdf_bytes) <= 20 * 1024 * 1024

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{chosen_model}:generateContent?key={api_key}"

    if use_inline:
        b64 = base64.b64encode(pdf_bytes).decode("ascii")
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "application/pdf", "data": b64}},
                    ]
                }
            ]
        }
    else:
        # Upload to Files API and then reference via file_data
        file_meta = _gemini_upload_file(api_key, file.filename, "application/pdf", pdf_bytes)
        # Optional: wait until file is processed (ACTIVE) to reduce 429/async issues
        name = file_meta.get("name")  # e.g. "files/abc-123"
        if name:
            _wait_file_active(api_key, name, timeout_s=30)
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"file_data": {"mime_type": "application/pdf", "file_uri": file_meta.get("uri")}},
                    ]
                }
            ]
        }

    try:
        r = requests.post(url, json=payload, timeout=120)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"request failed: {e}")

    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)

    data = r.json()
    out_chunks = []
    for cand in data.get("candidates", []):
        content = cand.get("content") or {}
        for part in content.get("parts", []):
            t = part.get("text")
            if t:
                out_chunks.append(t)

    text = ("\n".join(out_chunks)).strip() or "(空)"
    return {"text": text}