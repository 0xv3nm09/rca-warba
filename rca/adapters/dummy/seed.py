"""Seed the local database with the synthetic dataset and build everything
the demo needs: entities, chunks, living files, a demo handover with gap
questions, leave-cover brief, and the first alerts."""

import asyncio

import structlog

from rca.agents import triggers
from rca.db.models import AgentDocRow, AlertRow, Chunk, CommitmentRow, FactRow, HandoverItemRow, HandoverRow
from rca.db.session import create_all, make_engine, make_sessionmaker
from rca.services import handover as ho
from rca.services import living_file
from rca.services.handover import today

log = structlog.get_logger()

GROUPS = ["GHC-001", "ALS-014", "NLG-022"]


async def main() -> None:
    from rca.ai.gateway import ModelGateway

    engine = make_engine()
    await create_all(engine)
    sm = make_sessionmaker(engine)
    async with sm() as db:
        for t in (HandoverItemRow, HandoverRow, FactRow, CommitmentRow, AlertRow, AgentDocRow, Chunk):
            await db.execute(t.__table__.delete())
        await db.commit()

        n_chunks = await living_file.ingest_all(db)
        await db.commit()
        log.info("ingested", chunks=n_chunks)

        gw = ModelGateway()
        for g in GROUPS:
            counts = await living_file.rebuild_group(db, gw, g, today())
            await db.commit()
            log.info("living_file_built", group=g, **counts)

        # Demo handover so the readiness board is populated on first load.
        h = await ho.start(
            db,
            group_id="GHC-001",
            from_rm="omar.rm",
            to_rm="sara.rm",
            effective_date=today(),
            kind="permanent",
            actor="lead.one",
        )
        log.info("handover_created", handover_id=h.id, group=h.group_id)

        # Agent triggers on dummy HR data + nightly scans.
        await triggers.process_leave_events(db)
        exp = await triggers.scan_expiries(db, today())
        ovd = await triggers.scan_overdue(db, today())
        log.info("triggers_done", expiry_alerts=exp, overdue_alerts=ovd)

        n_facts = len((await db.execute(FactRow.__table__.select())).all())
        print(
            f"\nSeed complete: {n_chunks} chunks, {n_facts} facts, "
            f"{exp} expiry alerts, {ovd} overdue alerts, demo handover {h.id}\n"
        )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
