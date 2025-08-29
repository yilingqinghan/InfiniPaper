from typing import Generator
from sqlmodel import SQLModel, create_engine, Session
from loguru import logger
from ..core.config import settings

connect_args = {}
if not settings.is_postgres and settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True, connect_args=connect_args)

def init_db() -> None:
    if settings.is_postgres:
        with engine.begin() as conn:
            try:
                conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
            except Exception as e:
                logger.warning(f"Could not ensure pgvector extension: {e}")
    SQLModel.metadata.create_all(bind=engine)

def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session