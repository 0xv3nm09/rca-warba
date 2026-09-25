"""Triage: classify an incoming client message, match it to commitments,
and route it (answer / remind / assign / escalate)."""

import re

from sqlalchemy import select

from rca.db.models import CommitmentRow

_FOLLOWUP_RE = re.compile(r"waiting|promised|term sheet|chase|follow|followed up|still no", re.IGNORECASE)


async def triage(db, *, text: str, group_ids: list[str] | None = None) -> dict:
    from rca.services.handover import today

    q = select(CommitmentRow)
    if group_ids:
        q = q.where(CommitmentRow.group_id.in_(group_ids))
    commitments = list((await db.execute(q)).scalars())

    if _FOLLOWUP_RE.search(text):
        t = today()
        overdue = [c for c in commitments if c.due_date and c.due_date < t and c.state == "requested"]
        if overdue:
            c = overdue[0]
            days = (t - c.due_date).days
            return {
                "issue_class": "commitment_follow_up",
                "action": "escalate",
                "route_to": "team_lead",
                "label": "escalate",
                "confidence": 0.88,
                "reasons": [
                    f"Matches overdue commitment {c.id} (due {c.due_date.isoformat()}, {days} days overdue)",
                    "Material client promise",
                ],
                "matched_commitment": c.id,
            }
        return {
            "issue_class": "commitment_follow_up",
            "action": "remind",
            "route_to": "owner",
            "label": "needs_review",
            "confidence": 0.7,
            "reasons": ["Promise language found; no overdue commitment matched"],
            "matched_commitment": None,
        }
    return {
        "issue_class": "general",
        "action": "answer",
        "route_to": None,
        "label": "not_in_records",
        "confidence": 0.4,
        "reasons": ["No commitment or conflict pattern matched"],
        "matched_commitment": None,
    }
