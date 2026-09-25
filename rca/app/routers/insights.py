from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rca.app.deps import current_session, get_db
from rca.app.schemas import AlertOut

router = APIRouter(tags=["insights"])


@router.get("/alerts")
async def alerts(s=Depends(current_session), db: AsyncSession = Depends(get_db)):
    from rca.db.models import AlertRow

    rows = list((await db.execute(select(AlertRow).order_by(AlertRow.created_at.desc()))).scalars())
    out = []
    for a in rows:
        if s.user_id not in {"lead.one"} and a.to_role != "rm":
            continue  # team-lead alerts for the demo lead account
        out.append(AlertOut(alert_id=a.id, kind=a.kind, group_id=a.group_id, text=a.text, to_role=a.to_role))
    return {"alerts": out}


@router.get("/groups/{group_id}/insights")
async def group_insights(group_id: str, s=Depends(current_session), db: AsyncSession = Depends(get_db)):
    from rca.app.errors import OutOfScope
    from rca.db.models import AgentDocRow, AlertRow

    if s.group_id and s.group_id != group_id and "team_lead" not in s.roles:
        raise OutOfScope("Session is not bound to this client group")
    alerts = list((await db.execute(select(AlertRow).where(AlertRow.group_id == group_id))).scalars())
    docs = list((await db.execute(select(AgentDocRow))).scalars())
    briefs = [d for d in docs if d.kind == "cover_brief" and group_id in (d.payload or {}).get("groups", [])]
    return {
        "group_id": group_id,
        "alerts": [
            AlertOut(alert_id=a.id, kind=a.kind, group_id=a.group_id, text=a.text, to_role=a.to_role)
            for a in alerts
        ],
        "cover_briefs": [
            {"doc_id": b.id, "for": b.for_user, **{k: v for k, v in b.payload.items() if k != "groups"}}
            for b in briefs
        ],
    }
