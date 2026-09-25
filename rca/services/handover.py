"""Handover workflow: gap questions, acceptance, exceptions, readiness close."""

import re
from datetime import UTC, date, datetime

import structlog
from sqlalchemy import select

from rca.audit import writer as audit
from rca.db.models import CommitmentRow, FactRow, HandoverItemRow, HandoverRow
from rca.db.session import make_sessionmaker
from rca.domain.ids import new_id
from rca.domain.models import Evidence, Label, SourceSystem
from rca.domain.readiness import Readiness, evaluate

log = structlog.get_logger()

DEMO_TODAY = date(2026, 9, 22)  # fixed demo clock so planted dates stay consistent


def today() -> date:
    return DEMO_TODAY


async def _facts(db, group_id: str) -> list:
    return list((await db.execute(select(FactRow).where(FactRow.group_id == group_id))).scalars())


async def _commitments(db, group_id: str) -> list:
    return list((await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == group_id))).scalars())


async def start(
    db, *, group_id: str, from_rm: str, to_rm: str, effective_date: date, kind: str, actor: str
) -> HandoverRow:
    h = HandoverRow(
        id=new_id("hov"),
        group_id=group_id,
        from_rm=from_rm,
        to_rm=to_rm,
        effective_date=effective_date,
        kind=kind,
        status="open",
    )
    db.add(h)
    await db.flush()

    for c in await _commitments(db, group_id):
        if c.state in {"closed", "withdrawn"}:
            continue
        db.add(
            HandoverItemRow(
                id=new_id("hit"),
                handover_id=h.id,
                kind="commitment",
                ref_id=c.id,
                failure_point="no_open_item_list",
                owner=c.owner,
                due_date=c.due_date,
                status="open",
            )
        )
    for f in await _facts(db, group_id):
        if f.material and f.label == Label.conflict.value:
            db.add(
                HandoverItemRow(
                    id=new_id("hit"),
                    handover_id=h.id,
                    kind="conflict",
                    ref_id=f.id,
                    failure_point="systems_disagree",
                    status="open",
                )
            )

    for q in await gap_questions(db, group_id):
        db.add(
            HandoverItemRow(
                id=new_id("hit"),
                handover_id=h.id,
                kind="question",
                ref_id=None,
                question_text=q["text"],
                why_asked=q["why"],
                failure_point=q["failure_point"],
                owner=from_rm,
                status="open",
            )
        )
    await audit.append(
        db,
        actor=actor,
        action="handover_started",
        subject=h.id,
        payload={"group_id": group_id, "from": from_rm, "to": to_rm},
    )
    await db.commit()
    return h


async def gap_questions(db, group_id: str) -> list[dict]:
    """Only what the records cannot answer (deterministic rules over the file)."""
    questions = []
    for f in await _facts(db, group_id):
        rec = f.evidence[0]["record_id"] if f.evidence else "record"
        if re.search(r"declin|reject", f.text, re.I):
            # The decision is on file; if a reason existed it would appear as a
            # separate claim, so this question is asked whenever none is linked.
            questions.append(
                {
                    "text": "Why did the client decline the pricing proposal?",
                    "why": f"Decision recorded ({rec}) but no reason given",
                    "failure_point": "unwritten_context",
                }
            )
    for c in await _commitments(db, group_id):
        if c.state == "requested" and c.promised_to is None and c.due_date:
            rec = c.evidence[0]["record_id"] if c.evidence else "record"
            questions.append(
                {
                    "text": f"Who at the client should receive the update "
                    f"due {c.due_date.strftime('%d %b')}?",
                    "why": f"Promise found ({rec}) but recipient not named",
                    "failure_point": "no_open_item_list",
                }
            )
    return questions


async def items(db, handover_id: str) -> list[HandoverItemRow]:
    return list(
        (
            await db.execute(select(HandoverItemRow).where(HandoverItemRow.handover_id == handover_id))
        ).scalars()
    )


async def answer_question(
    db, handover_id: str, item_id: str, answer: str, confidence_note: str | None, actor: str
) -> HandoverItemRow:
    it = await db.get(HandoverItemRow, item_id)
    if it is None or it.handover_id != handover_id:
        raise KeyError("question not found")
    it.answer_text = answer
    it.answer_confidence_note = confidence_note
    h = await db.get(HandoverRow, handover_id)

    # Recollection: saved and attributed, never promoted to verified.
    ev = Evidence(
        source_system=SourceSystem.recollection,
        record_id=f"recollection:{item_id}",
        span_start=0,
        span_end=len(answer),
        quote=answer[:600],
        as_of=today(),
        lang="en",
    )
    db.add(
        FactRow(
            id=new_id("fct"),
            group_id=h.group_id,
            entity_id="",
            kind="event",
            text=f"Recollection: {answer[:450]}",
            label=Label.needs_review.value,
            confidence=0.0,
            material=False,
            reasons=["From outgoing RM interview", "Based on outgoing RM recollection only"],
            evidence=[ev.model_dump(mode="json")],
        )
    )
    await audit.append(
        db,
        actor=actor,
        action="gap_answered",
        subject=item_id,
        payload={"handover": handover_id, "chars": len(answer)},
    )
    await db.commit()
    return it


async def accept(
    db, handover_id: str, accepted_ids: list[str], returned_ids: list[str], note: str | None, actor: str
) -> dict:
    its = await items(db, handover_id)
    for it in its:
        if it.id in accepted_ids:
            it.status = "accepted"
            it.note = note if it.kind == "commitment" else it.note
        elif it.id in returned_ids:
            it.status = "returned"
            it.note = note
    await audit.append(
        db,
        actor=actor,
        action="handover_acceptance",
        subject=handover_id,
        payload={"accepted": accepted_ids, "returned": returned_ids},
    )
    await db.commit()
    return {"accepted": accepted_ids, "returned": returned_ids}


async def assign(
    db, handover_id: str, item_id: str, owner: str, due_date: date | None, actor: str
) -> HandoverItemRow:
    it = await db.get(HandoverItemRow, item_id)
    if it is None or it.handover_id != handover_id:
        raise KeyError("item not found")
    it.owner, it.due_date = owner, due_date or it.due_date
    # Acceptance survives assignment: an accepted duty stays accepted once it has an owner.
    if it.status in {"open", "returned"}:
        it.status = "resolved"
    if it.kind == "commitment" and it.ref_id:
        c = await db.get(CommitmentRow, it.ref_id)
        if c:
            c.owner, c.due_date = owner, due_date or c.due_date
    if it.kind == "conflict" and it.ref_id:
        f = await db.get(FactRow, it.ref_id)
        if f:
            f.label = Label.needs_review.value
            f.reasons = list(f.reasons or []) + [
                f"Conflict assigned to {owner}; core banking value stands pending confirmation"
            ]
    await audit.append(
        db,
        actor=actor,
        action="exception_assigned",
        subject=item_id,
        payload={"owner": owner, "due": str(due_date) if due_date else None},
    )
    await db.commit()
    return it


async def readiness(db, handover_id: str) -> Readiness:
    h = await db.get(HandoverRow, handover_id)
    if h is None:
        raise KeyError("handover not found")
    domain_facts = [f for f in await _facts(db, h.group_id) if f.label != Label.conflict.value or f.material]
    commitments = await _commitments(db, h.group_id)
    accepted = {
        it.ref_id
        for it in await items(db, handover_id)
        if it.kind == "commitment" and it.status == "accepted"
    }

    def to_domain_fact(f: FactRow):
        from rca.domain.models import Fact as DFact

        return DFact(
            fact_id=f.id,
            group_id=f.group_id,
            entity_id=f.entity_id,
            kind=f.kind,
            text=f.text,
            amount_kwd=f.amount_kwd,
            due_date=f.due_date,
            label=f.label,
            confidence=f.confidence,
            material=f.material,
            evidence=[Evidence(**e) for e in (f.evidence or [])],
            reasons=list(f.reasons or []),
        )

    def to_domain_commitment(c: CommitmentRow):
        from rca.domain.models import Commitment as DCm

        return DCm(
            commitment_id=c.id,
            group_id=c.group_id,
            entity_id=c.entity_id,
            description=c.description,
            promised_by=c.promised_by,
            promised_to=c.promised_to,
            kind="respond",  # type: ignore[arg-type]
            due_date=c.due_date,
            owner=c.owner,
            state=c.state,  # type: ignore[arg-type]
            evidence=[Evidence(**e) for e in (c.evidence or [])],
        )

    return evaluate(
        [to_domain_fact(f) for f in domain_facts],
        [to_domain_commitment(c) for c in commitments],
        today(),
        accepted,
        [],
    )


async def try_close(db, handover_id: str, actor: str) -> dict:
    r = await readiness(db, handover_id)
    if not r.ready:
        from rca.app.errors import NotReady

        await db.rollback()
        raise NotReady("Transfer cannot close", {"blocking_reasons": r.blocking})
    h = await db.get(HandoverRow, handover_id)
    h.status = "closed"
    h.closed_at = datetime.now(UTC)
    await audit.append(db, actor=actor, action="handover_closed", subject=handover_id, payload={})
    await db.commit()
    return {"closed": True, "blocking_reasons": []}


async def board(db) -> list[dict]:
    rows = list((await db.execute(select(HandoverRow).order_by(HandoverRow.created_at.desc()))).scalars())
    out = []
    for h in rows:
        r = await readiness(db, h.id)
        its = await items(db, h.id)
        next_due = min((it.due_date for it in its if it.due_date), default=None)
        out.append(
            {
                "handover_id": h.id,
                "group_id": h.group_id,
                "from_rm": h.from_rm,
                "to_rm": h.to_rm,
                "status": h.status,
                "effective_date": str(h.effective_date),
                "kind": h.kind,
                "blocking": r.blocking,
                "blocking_count": len(r.blocking),
                "open_items": sum(1 for i in its if i.status == "open"),
                "next_due": str(next_due) if next_due else None,
            }
        )
    return out


def session_factory():
    return make_sessionmaker()
