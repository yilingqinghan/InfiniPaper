from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    ENV: str = "dev"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "change-me"

    # Only IP_* env vars will override these defaults (avoid collisions)
    DATABASE_URL: str = "sqlite:///./infinipaper.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    GROBID_URL: str = "http://localhost:8070"
    EMBEDDING_MODEL_NAME: str = "specter2"

    # File storage (served at /files)
    STORAGE_DIR: str = "./storage"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="IP_",
        extra="ignore",       # <-- ignore unrecognized keys (e.g., legacy DATABASE_URL)
    )

    @property
    def is_postgres(self) -> bool:
        return self.DATABASE_URL.startswith("postgresql")

settings = Settings()
