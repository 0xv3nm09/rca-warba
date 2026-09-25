FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"

# Install dependencies first so this layer caches independently of app code.
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev \
 || uv sync --no-install-project --no-dev

COPY rca ./rca
COPY config ./config
COPY ui/dist ./ui/dist
RUN uv sync --no-dev

EXPOSE 8000
CMD ["uvicorn", "rca.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
