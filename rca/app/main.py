import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles

from rca.ai.gateway import ModelGateway
from rca.app import errors
from rca.app.routers import admin, agents, ask, auth, files, handovers, health, insights, triage
from rca.db.session import create_all, make_engine, make_sessionmaker
from rca.settings import get_settings

log = structlog.get_logger()
UI_DIST = Path(__file__).resolve().parents[2] / "ui" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    engine = make_engine()
    if s.rca_profile == "local":
        await create_all(engine)
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.gateway = ModelGateway()
    log.info("api_started", profile=s.rca_profile, routes=list(s.routes()))
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Relationship Continuity Assistant",
        version="0.1.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    errors.install(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex[:16]}"
        resp = await call_next(request)
        resp.headers["x-request-id"] = request.state.request_id
        resp.headers["Cache-Control"] = "no-store"
        return resp

    for r in (health, auth, files, ask, handovers, triage, insights, agents, admin):
        app.include_router(r.router)

    # Serve the built console (single container serves UI + API).
    if UI_DIST.exists():
        app.mount("/assets", StaticFiles(directory=UI_DIST / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        async def index():
            return FileResponse(UI_DIST / "index.html")

    return app


app = create_app()
