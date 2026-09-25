import os

# Tests must be able to import rca.settings without a real .env file.
os.environ.setdefault("RCA_PROFILE", "local")
os.environ.setdefault("LLM_EXTRACT_MODEL", "dummy-extractor")
os.environ.setdefault("LLM_EXTRACT_BASE_URL", "local")
os.environ.setdefault("LLM_DRAFT_MODEL", "dummy-drafter")
os.environ.setdefault("LLM_DRAFT_BASE_URL", "local")
os.environ.setdefault("LLM_CLASSIFY_MODEL", "dummy-classifier")
os.environ.setdefault("LLM_CLASSIFY_BASE_URL", "local")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://rca:rca@localhost:5433/rca")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SIGNING_KEY", "dev-only-change-me")
os.environ.setdefault("JWT_ISSUER", "rca-local")
os.environ.setdefault("JWT_AUDIENCE", "rca-api")
os.environ.setdefault("AUDIT_HMAC_KEY", "dev-only-change-me")
os.environ.setdefault("NLI_MODEL", "dummy")
