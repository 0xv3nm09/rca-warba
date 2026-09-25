"""Shared API test fixtures: engine-backed client + fresh synthetic seed."""

import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://rca:rca@localhost:5433/rca")

from rca.app.main import app  # noqa: E402
from rca.db.session import create_all, make_engine, make_sessionmaker  # noqa: E402


@pytest.fixture
async def client():
    engine = make_engine()
    await create_all(engine)
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    from rca.ai.gateway import ModelGateway

    app.state.gateway = ModelGateway()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        yield c
    await engine.dispose()


@pytest.fixture(autouse=True)
async def fresh_seed(client):
    """Each test gets pristine synthetic state (fast: rules extractor, no network)."""
    from rca.adapters.dummy.seed import main as seed_main

    await seed_main()


async def token_for(client, user, group=None):
    r = await client.post("/auth/dev-login", json={"user": user, "group": group})
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
async def seeded_handover(client):
    t = await token_for(client, "lead.one")
    r = await client.get("/handovers", headers=H(t))
    return r.json()["transfers"][0]["handover_id"]
