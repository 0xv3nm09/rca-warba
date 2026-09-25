"""Agentic workflow overview: every trigger, its job, its output and the human
gate — the operating picture of the bounded agent (proposal section 07)."""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rca.adapters.dummy import DummyLeaveCalendar
from rca.app.deps import current_session, get_db
from rca.db.models import AgentDocRow, AlertRow, AuditEvent, HandoverRow
from rca.security.policy import COVERAGE
from rca.services.handover import today

router = APIRouter(prefix="/agents", tags=["agents"])

TRIGGERS = [
    {
        "trigger": "leave_booked",
        "label": "Leave booked",
        "source": "HR leave calendar",
        "job": "draft_cover_brief",
        "effect": "Dated cover brief drafted before anyone asks",
        "human_step": "Covering RM confirms statuses",
        "use_case": 2,
    },
    {
        "trigger": "leave_ended",
        "label": "Leave ends",
        "source": "HR leave calendar",
        "job": "draft_return_summary",
        "effect": "What changed while away",
        "human_step": "Returning RM reviews",
        "use_case": 2,
    },
    {
        "trigger": "handover_started",
        "label": "Handover started",
        "source": "Workflow event",
        "job": "prepare_handover",
        "effect": "File refreshed, conflicts found, gap questions sent",
        "human_step": "Outgoing RM answers; incoming accepts; lead closes",
        "use_case": 1,
    },
    {
        "trigger": "expiry_no_owner",
        "label": "Nightly expiry scan",
        "source": "Cron 04:30 (worker)",
        "job": "raise_expiry_alert",
        "effect": "Facility expiring within 30 days with no owned commitment",
        "human_step": "Team lead assigns an owner",
        "use_case": 8,
    },
    {
        "trigger": "promise_overdue",
        "label": "Nightly overdue scan",
        "source": "Cron 04:45 (worker)",
        "job": "raise_overdue_alert",
        "effect": "Promise past due date, still requested",
        "human_step": "Owner acts; escalates after 1 day",
        "use_case": 8,
    },
    {
        "trigger": "referral_requested",
        "label": "Specialist referral",
        "source": "RM action",
        "job": "prepare_referral_pack",
        "effect": "Question, documents held, history — no re-asking",
        "human_step": "Specialist accepts the task",
        "use_case": 5,
    },
]

PRINCIPLES = [
    "Agent acts on triggers, not only questions",
    "Proposes only: drafts, alerts, questions — people decide",
    "No write tools; read-only access to source systems",
    "Jobs are idempotent: running twice never duplicates",
    "Every action lands in the hash-chained audit log",
]


@router.get("/overview")
async def overview(s=Depends(current_session), db: AsyncSession = Depends(get_db)):
    t = today()
    docs = list((await db.execute(select(AgentDocRow))).scalars())
    alerts = list((await db.execute(select(AlertRow).order_by(AlertRow.created_at.desc()))).scalars())
    handovers = list((await db.execute(select(HandoverRow))).scalars())
    leave = (await DummyLeaveCalendar().all_rows())[0]

    doc_by_id = {d.id: d for d in docs}

    def status_for(trig: dict) -> dict:
        if trig.get("prototype") == "not_built":
            return {"status": "not_in_prototype", "output": None, "when": None}
        if trig["trigger"] == "leave_booked":
            d = doc_by_id.get(f"cover_brief:{leave['rm']}:{leave['start']}")
            return {
                "status": "fired" if d else "waiting",
                "output": ("cover_brief" if d else None),
                "when": d.created_at.isoformat() if d else None,
            }
        if trig["trigger"] == "leave_ended":
            end = date.fromisoformat(leave["end"])
            d = doc_by_id.get(f"return_summary:{leave['rm']}:{leave['end']}")
            return {
                "status": "fired" if d else ("scheduled" if end > t else "due"),
                "output": ("return_summary" if d else None),
                "when": leave["end"],
            }
        if trig["trigger"] == "handover_started":
            h = handovers[0] if handovers else None
            return {
                "status": "fired" if h else "waiting",
                "output": (h.id if h else None),
                "when": h.created_at.isoformat() if h else None,
            }
        kind = {
            "expiry_no_owner": "expiry_no_owner",
            "promise_overdue": "promise_overdue",
            "referral_requested": "referral_pack",
        }[trig["trigger"]]
        if trig["trigger"] == "referral_requested":
            hit = next((d for d in docs if d.kind == "referral_pack"), None)
            return {
                "status": "fired" if hit else "waiting",
                "output": (hit.payload.get("question", "") if hit else None),
                "when": (hit.created_at.isoformat() if hit else None),
            }
        hit = next((a for a in alerts if a.kind == kind), None)
        return {
            "status": "fired" if hit else "waiting",
            "output": (hit.text if hit else None),
            "when": (hit.created_at.isoformat() if hit else None),
        }

    triggers = [{**trig, **status_for(trig)} for trig in TRIGGERS]

    briefs = [
        {
            "doc_id": d.id,
            "for": d.for_user,
            **{k: v for k, v in d.payload.items()},
        }
        for d in docs
        if d.kind == "cover_brief"
    ]

    referrals = [
        {
            "doc_id": d.id,
            **{k: v for k, v in d.payload.items()},
        }
        for d in docs
        if d.kind == "referral_pack"
    ]

    audit_tail = list(
        (await db.execute(select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(8))).scalars()
    )

    return {
        "as_of": t.isoformat(),
        "pattern": "deterministic triggers → model drafts via gateway (proposal) → human gate → audit",
        "principles": PRINCIPLES,
        "triggers": triggers,
        "cover_briefs": briefs,
        "referral_packs": referrals,
        "alerts": [
            {"alert_id": a.id, "kind": a.kind, "group_id": a.group_id, "text": a.text, "to_role": a.to_role}
            for a in alerts
        ],
        "audit_tail": [
            {"seq": e.seq, "ts": e.ts, "actor": e.actor, "action": e.action, "subject": e.subject}
            for e in audit_tail
        ],
        "coverage": {u: sorted(gs) for u, gs in COVERAGE.items()},
    }


@router.post("/referrals", status_code=201)
async def create_referral(body: dict, s=Depends(current_session), db: AsyncSession = Depends(get_db)):
    """RM requests a specialist referral; the agent assembles the pack (use case 5)."""
    import uuid

    from rca.agents.triggers import prepare_referral_pack
    from rca.app.errors import OutOfScope, ValidationFailed

    group_id = body.get("group_id", "")
    question = (body.get("question") or "").strip()
    if not group_id or len(question) < 8:
        raise ValidationFailed("group_id and a question (min 8 chars) are required")
    if s.group_id != group_id and "team_lead" not in s.roles:
        raise OutOfScope("Session is not bound to this client group")
    pack = await prepare_referral_pack(
        db,
        group_id=group_id,
        question=question,
        to_role=body.get("to_role", "trade_specialist"),
        requested_by=s.user_id,
        today_=today(),
    )
    return {"request_id": f"req_{uuid.uuid4().hex[:16]}", "pack": pack}
