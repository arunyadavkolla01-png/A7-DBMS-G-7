from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:arun2007@localhost:5432/tripwise"
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "tripwise_db"
    SECRET_KEY: str = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    EVENT_BUS_MODE: str = "off"
    KAFKA_BROKER: str = "127.0.0.1:9092"
    KAFKA_TOPIC: str = "tripwise.events"
    NOTIFY_URL: str = "http://127.0.0.1:4000/notify"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    OPENAI_API_KEY: str = ""

    model_config = ConfigDict(env_file=".env", extra="ignore")


settings = Settings()