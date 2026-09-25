"""Background worker: rebuilds, triggers and nightly scans (arq)."""

from arq.connections import RedisSettings

from rca.db.session import make_engine, make_sessionmaker
from rca.settings import get_settings


async def rebuild_living_file(ctx, group_id: str, as_of_iso: str):
    from rca.ai.gateway import ModelGateway
    from rca.services import living_file
    from rca.services.handover import today

    async with ctx["sessionmaker"]() as db:
        counts = await living_file.rebuild_group(db, ModelGateway(), group_id, today())
        await db.commit()
    return counts


async def scan_expiries_job(ctx):
    from datetime import date

    from rca.agents.triggers import scan_expiries

    async with ctx["sessionmaker"]() as db:
        return await scan_expiries(db, date.today())


async def scan_overdue_job(ctx):
    from datetime import date

    from rca.agents.triggers import scan_overdue

    async with ctx["sessionmaker"]() as db:
        return await scan_overdue(db, date.today())


async def startup(ctx):
    engine = make_engine()
    ctx["engine"] = engine
    ctx["sessionmaker"] = make_sessionmaker(engine)


async def shutdown(ctx):
    await ctx["engine"].dispose()


class WorkerSettings:
    functions = [rebuild_living_file, scan_expiries_job, scan_overdue_job]
    cron_jobs = []
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 8
    job_timeout = 900
    keep_result = 3600


try:
    from arq import cron

    WorkerSettings.cron_jobs = [
        cron(scan_expiries_job, hour={4}, minute={30}),
        cron(scan_overdue_job, hour={4}, minute={45}),
    ]
except Exception as exc:  # pragma: no cover - arq cron import is optional
    import structlog

    structlog.get_logger().warning("arq_cron_unavailable", err=str(exc))
