from celery import Celery
from loguru import logger
from ..core.config import settings

celery_app = Celery("infinipaper", broker=settings.REDIS_URL, backend=settings.REDIS_URL)

@celery_app.task
def ping_task(msg: str = "pong"):
    logger.info(f"Celery ping: {msg}")
    return {"ok": True, "msg": msg}