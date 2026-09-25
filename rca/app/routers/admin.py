from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rca.app.deps import get_db, require_role
from rca.audit import writer as audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit/verify")
async def audit_verify(s=Depends(require_role("team_lead", "admin")), db: AsyncSession = Depends(get_db)):
    ok, broken_at = await audit.verify_chain(db)
    return {"chain_valid": ok, "broken_at_seq": broken_at}


@router.get("/audit/tail")
async def audit_tail(s=Depends(require_role("team_lead", "admin")), db: AsyncSession = Depends(get_db)):
    from rca.db.models import AuditEvent

    rows = list((await db.execute(select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(20))).scalars())
    return {
        "events": [
            {
                "seq": e.seq,
                "ts": e.ts,
                "actor": e.actor,
                "action": e.action,
                "subject": e.subject,
                "hash": e.hash[:12],
            }
            for e in rows
        ]
    }


@router.post("/triggers/run")
async def run_triggers(s=Depends(require_role("team_lead", "admin")), db: AsyncSession = Depends(get_db)):
    """Run the agent scans now (the worker runs them nightly in the background)."""
    from rca.agents import triggers
    from rca.services.handover import today

    briefs = await triggers.process_leave_events(db)
    exp = await triggers.scan_expiries(db, today())
    ovd = await triggers.scan_overdue(db, today())
    return {"cover_briefs": briefs, "expiry_alerts_raised": exp, "overdue_alerts_raised": ovd}
