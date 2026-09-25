from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Route(BaseModel):
    name: str
    model: str
    base_url: str
    external: bool = False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    rca_profile: Literal["local", "sandbox", "pilot"] = "local"
    rca_log_level: str = "INFO"

    llm_extract_model: str = "dummy-extractor"
    llm_extract_base_url: str = "local"
    llm_draft_model: str = "dummy-drafter"
    llm_draft_base_url: str = "local"
    llm_classify_model: str = "dummy-classifier"
    llm_classify_base_url: str = "local"
    llm_fallback_model: str | None = None
    llm_fallback_base_url: str | None = None
    llm_fallback_is_external: bool = False
    llm_api_key: SecretStr | None = None

    embed_backend: Literal["hash", "bge-m3"] = "hash"
    embed_dim: int = 1024

    llm_max_concurrency: int = Field(4, ge=1, le=64)
    llm_rpm: int = 60
    llm_tpm: int = 200_000
    llm_timeout_s: int = 60
    llm_max_retries: int = 3
    user_tokens_per_hour: int = 200_000

    database_url: str
    redis_url: str
    object_store_path: str = "./data/objects"

    session_ttl_min: int = 30
    jwt_signing_key: SecretStr
    jwt_issuer: str = "rca-local"
    jwt_audience: str = "rca-api"
    entra_tenant_id: str | None = None
    entra_client_id: str | None = None
    step_up_acr: str = "c1"
    audit_hmac_key: SecretStr
    adapters: Literal["dummy", "real"] = "dummy"
    allow_writes_to_sources: bool = False

    nli_model: str = "dummy"

    def routes(self) -> dict[str, Route]:
        r = {
            "extract": Route(
                name="extract", model=self.llm_extract_model, base_url=self.llm_extract_base_url
            ),
            "draft": Route(name="draft", model=self.llm_draft_model, base_url=self.llm_draft_base_url),
            "classify": Route(
                name="classify", model=self.llm_classify_model, base_url=self.llm_classify_base_url
            ),
        }
        if self.llm_fallback_model and self.llm_fallback_base_url:
            r["fallback"] = Route(
                name="fallback",
                model=self.llm_fallback_model,
                base_url=self.llm_fallback_base_url,
                external=self.llm_fallback_is_external,
            )
        return r

    @model_validator(mode="after")
    def _safety(self) -> "Settings":
        if self.rca_profile != "local":
            if self.allow_writes_to_sources:
                raise ValueError("Writes to source systems are forbidden outside local")
            if "dev-only" in self.jwt_signing_key.get_secret_value():
                raise ValueError("Dev signing key used outside local")
            if self.adapters != "real":
                raise ValueError("Sandbox and pilot must use real adapters")
            if not (self.entra_tenant_id and self.entra_client_id):
                raise ValueError("Sandbox and pilot require Entra ID")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
