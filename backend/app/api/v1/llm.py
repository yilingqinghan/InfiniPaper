# app/api/v1/llm.py
from __future__ import annotations
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

router = APIRouter()

OLLAMA_BASE = os.getenv("OLLAMA_BASE", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:32b-instruct")

class AskReq(BaseModel):
    prompt: str
    system: str | None = None
    model: str | None = None
    context: str | None = None    # 可选：附加上下文（例如论文标题等）

class AskResp(BaseModel):
    text: str

@router.post("/ask", response_model=AskResp)
async def ask_ollama(req: AskReq):
    model = req.model or OLLAMA_MODEL
    url = f"{OLLAMA_BASE}/api/chat"
    payload = {
        "model": model,
        "stream": False,
        "messages": []
    }
    if req.system:
        payload["messages"].append({"role": "system", "content": req.system})
    # 将选中文本与上下文拼接
    user_content = req.prompt if not req.context else f"{req.prompt}\n\n[Context]\n{req.context}"
    payload["messages"].append({"role":"user","content": user_content})

    try:
        async with httpx.AsyncClient(timeout=60, trust_env=False, proxies=None) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
            text = (data.get("message") or {}).get("content") or ""
            return AskResp(text=text.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama error: {e}")