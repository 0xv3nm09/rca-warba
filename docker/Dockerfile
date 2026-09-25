# Stage 1: build the console (no host Node needed; fresh clones work)
FROM node:22-alpine AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Stage 2: API + console + eval snapshot
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"

# Install dependencies first so this layer caches independently of app code.
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev \
 || uv sync --no-install-project --no-dev

COPY rca ./rca
COPY config ./config
COPY --from=ui /ui/dist ./ui/dist
COPY reports/golden_snapshot.json ./reports/golden_snapshot.json
RUN uv sync --no-dev

EXPOSE 8000
CMD ["uvicorn", "rca.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
