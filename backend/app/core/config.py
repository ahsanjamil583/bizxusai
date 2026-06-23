from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BizxusAI API"
    app_env: str = "development"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    host: str = "0.0.0.0"
    port: int = 8000

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "bizxus_ai"

    jwt_secret_key: str = "change-this-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    default_admin_full_name: str = ""
    default_admin_email: str = ""
    default_admin_phone: str = ""
    default_admin_password: str = ""

    bcrypt_rounds: int = 12

    chroma_host: str = "localhost"
    chroma_port: int = 8001
    chroma_persist_directory: str = "./chroma-data"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"

    whatsapp_provider: str = "mock"
    whatsapp_verify_token: str = "bizxus-whatsapp-verify"
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_api_version: str = "v21.0"

    sms_provider: str = "mock"
    sms_api_key: str = ""
    sms_http_url: str = ""
    sms_sender_id: str = "BizXusAI"

    otp_code_length: int = 6
    otp_expire_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 30
    otp_demo_code: str = "123456"
    otp_return_code_in_response: bool = True

    local_upload_dir: str = "./uploads"
    temp_upload_dir: str = "./uploads/temp"
    log_dir: str = "../logs"
    log_level: str = "INFO"
    backup_dir: str = "./backups"

    app_version: str = "0.32.0"
    build_label: str = "phase-32-critical-bug-fixes"
    rate_limit_enabled: bool = False
    rate_limit_requests_per_minute: int = 120

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on", "debug", "development"}:
                return True
            if normalized in {"false", "0", "no", "off", "release", "production"}:
                return False
        return value

    @field_validator("app_env", mode="before")
    @classmethod
    def normalize_app_env(cls, value):
        normalized = str(value or "development").strip().lower()
        if normalized in {"dev", "development", "local"}:
            return "development"
        if normalized in {"test", "testing"}:
            return "test"
        if normalized in {"prod", "production", "release"}:
            return "production"
        return normalized

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value):
        normalized = str(value or "INFO").strip().upper()
        return normalized if normalized in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"} else "INFO"

    @model_validator(mode="after")
    def enforce_production_safety(self):
        if self.app_env == "production":
            if self.debug:
                raise ValueError("DEBUG must be false in production.")
            if self.jwt_secret_key in {"", "change-this-secret", "changeme", "secret"}:
                raise ValueError("Set a strong JWT_SECRET_KEY before running in production.")
            if self.bcrypt_rounds < 12:
                raise ValueError("BCRYPT_ROUNDS must be at least 12 in production.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
