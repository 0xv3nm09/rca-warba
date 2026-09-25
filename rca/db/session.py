from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from rca.settings import get_settings


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_async_engine(get_settings().database_url, pool_pre_ping=True)


def make_sessionmaker(engine=None) -> async_sessionmaker:
    return async_sessionmaker(engine or make_engine(), expire_on_commit=False)


async def create_all(engine) -> None:
    """Prototype bootstrap. Alembic migrations replace this before the pilot."""
    from rca.db import models  # noqa: F401  (register mappings)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
