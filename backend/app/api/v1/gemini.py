from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import requests

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

@router.get("/ping")
def ping():
    # Always available so /docs shows this group even without API key
    return {"ok": True}

@router.post("/ask", response_model=AskResp)
def ask(req: AskReq):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")

    model = (req.model or os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash").strip()

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