.PHONY: install up down seed test lint fmt api worker eval restart logs

install:  ## create .venv and install dependencies
	uv sync --extra dev

up:       ## start the full stack in Docker (postgres, redis, api, worker) and seed
	docker compose up -d --build
	docker compose run --rm seed || true

restart:  ## emergency fast dev: rebuild and force-recreate every container
	docker compose up -d --build --force-recreate

logs:     ## follow API logs
	docker compose logs -f api

down:     ## stop the stack
	docker compose down

seed:     ## load synthetic fixtures into the local database
	uv run python -m rca.adapters.dummy.seed

test:     ## run the test suite
	uv run pytest -q

lint:     ## ruff check + format check
	uv run ruff check . && uv run ruff format --check .

fmt:      ## ruff format
	uv run ruff format .

api:      ## run the API with reload on :8000
	uv run uvicorn rca.app.main:app --reload

worker:   ## run the background worker
	uv run arq rca.ingest.worker.WorkerSettings

eval:     ## run the golden evaluation suite
	uv run python -m rca.evals.run --suite golden --report reports/
