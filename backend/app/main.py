from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pathlib import Path
from .core.config import settings
from .db.database import init_db
from .api.router import api_router

app = FastAPI(title="InfiniPaper API", version="0.1.0")

# Mount static file serving for uploaded PDFs
import os
os.makedirs(settings.STORAGE_DIR, exist_ok=True)
app.mount("/files", StaticFiles(directory=settings.STORAGE_DIR), name="files")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],   # 包含 DELETE
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    logger.info("Starting InfiniPaper API")
    init_db()

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {
        "name": "InfiniPaper API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/healthz",
        "api": settings.API_V1_STR,
    }

# from fastapi.routing import APIRoute
# print("=== ROUTES DUMP START ===")
# for r in app.routes:
#     if isinstance(r, APIRoute):
#         print("ROUTE", r.path, r.methods)
# print("=== ROUTES DUMP END ===")