from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .core.config import settings
from .db.database import init_db
from .api.router import api_router

app = FastAPI(title="InfiniPaper API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
