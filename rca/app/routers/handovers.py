from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from rca.app.deps import current_session, get_db, require_role
from rca.app.schemas import (
    AcceptRequest,
    AnswerRequest,
    AssignRequest,
    BoardResponse,
    CloseResponse,
    HandoverCreate,
    HandoverDetail,
    ItemOut,
)
from rca.audit import writer as audit
from rca.db.models import CommitmentRow, FactRow
from rca.services import handover as svc

router = APIRouter(prefix="/handovers", tags=["handovers"])


@router.post("", status_code=201)
async def start(
    body: HandoverCreate,
    request: Request,
    s=Depends(require_role("team_lead")),
    db: AsyncSession = Depends(get_db),
):
    h = await svc.start(
        db,
        group_id=body.group_id,
        from_rm=body.from_rm,
        to_rm=body.to_rm,
        effective_date=body.effective_date,
        kind=body.kind,
        actor=s.user_id,
    )
    return {"request_id": request.state.request_id, "handover_id": h.id, "status": h.status}


@router.get("", response_model=BoardResponse)
async def board(
    request: Request, s=Depends(require_role("team_lead", "rm")), db: AsyncSession = Depends(get_db)
):
    return BoardResponse(request_id=request.state.request_id, transfers=await svc.board(db))


@router.get("/{handover_id}", response_model=HandoverDetail)
async def detail(
    handover_id: str, request: Request, s=Depends(current_session), db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import select

    from rca.app.errors import NotFound
    from rca.db.models import CommitmentRow, FactRow, HandoverRow

    h = await db.get(HandoverRow, handover_id)
    if h is None:
        raise NotFound("Handover not found")
    items = await svc.items(db, handover_id)
    r = await svc.readiness(db, handover_id)

    # Map each blocking reason to the item that resolves it, so the console can
    # link the reason to its fix (walkthrough screen: close blocked -> item).
    comms = {
        c.id: c
        for c in (
            await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == h.group_id))
        ).scalars()
    }
    facts = {
        f.id: f for f in (await db.execute(select(FactRow).where(FactRow.group_id == h.group_id))).scalars()
    }
    blocking = []
    for reason in r.blocking:
        linked = None
        for it in items:
            if it.kind == "conflict" and "conflict" in reason.lower():
                linked = it.id
                break
            if (
                it.kind == "commitment"
                and it.ref_id in comms
                and comms[it.ref_id].description[:40].lower() in reason.lower()
            ):
                linked = it.id
                break
        if linked is None:
            for it in items:
                if (
                    it.kind == "conflict"
                    and it.ref_id in facts
                    and facts[it.ref_id].text[:40].lower() in reason.lower()
                ):
                    linked = it.id
                    break
        blocking.append({"reason": reason, "item_id": linked})

    return HandoverDetail(
        request_id=request.state.request_id,
        handover_id=h.id,
        group_id=h.group_id,
        from_rm=h.from_rm,
        to_rm=h.to_rm,
        status=h.status,
        ready=r.ready,
        blocking=blocking,
        items=[
            ItemOut(
                item_id=i.id,
                kind=i.kind,
                status=i.status,
                owner=i.owner,
                due_date=str(i.due_date) if i.due_date else None,
                question_text=i.question_text,
                why_asked=i.why_asked,
                failure_point=i.failure_point,
                answer_text=i.answer_text,
                ref_id=i.ref_id,
            )
            for i in items
        ],
    )


@router.get("/{handover_id}/questions")
async def questions(
    handover_id: str, request: Request, s=Depends(current_session), db: AsyncSession = Depends(get_db)
):
    its = [i for i in await svc.items(db, handover_id) if i.kind == "question"]
    return {
        "request_id": request.state.request_id,
        "questions": [
            {
                "question_id": i.id,
                "text": i.question_text,
                "why_asked": i.why_asked,
                "failure_point": i.failure_point,
                "answer": i.answer_text,
            }
            for i in its
        ],
    }


@router.post("/{handover_id}/answers")
async def answer(
    handover_id: str,
    body: AnswerRequest,
    request: Request,
    s=Depends(current_session),
    db: AsyncSession = Depends(get_db),
):
    it = await svc.answer_question(
        db, handover_id, body.question_id, body.answer, body.confidence_note, actor=s.user_id
    )
    return {"request_id": request.state.request_id, "question_id": it.id, "saved": True}


@router.post("/{handover_id}/accept")
async def accept(
    handover_id: str,
    body: AcceptRequest,
    request: Request,
    s=Depends(require_role("rm", "team_lead")),
    db: AsyncSession = Depends(get_db),
):
    result = await svc.accept(
        db, handover_id, body.accepted_item_ids, body.returned_item_ids, body.note, actor=s.user_id
    )
    return {"request_id": request.state.request_id, **result}


@router.post("/{handover_id}/exceptions/{item_id}/assign")
async def assign(
    handover_id: str,
    item_id: str,
    body: AssignRequest,
    request: Request,
    s=Depends(require_role("team_lead")),
    db: AsyncSession = Depends(get_db),
):
    it = await svc.assign(db, handover_id, item_id, body.owner, body.due_date, actor=s.user_id)
    return {"request_id": request.state.request_id, "item_id": it.id, "owner": it.owner, "status": it.status}


@router.post("/{handover_id}/close", response_model=CloseResponse)
async def close(
    handover_id: str,
    request: Request,
    s=Depends(require_role("team_lead")),
    db: AsyncSession = Depends(get_db),
):
    result = await svc.try_close(db, handover_id, actor=s.user_id)
    return CloseResponse(request_id=request.state.request_id, **result)


@router.get("/{handover_id}/package")
async def handover_package(
    handover_id: str, request: Request, s=Depends(current_session), db: AsyncSession = Depends(get_db)
):
    """The Track 2 deliverable as a single artifact: the full client context,
    structured into one transferable dossier (brief, commitments, people,
    open items, sources). Every line keeps its source link."""
    from sqlalchemy import select

    from rca.app.errors import NotFound
    from rca.db.models import Entity, HandoverRow

    h = await db.get(HandoverRow, handover_id)
    if h is None:
        raise NotFound("Handover not found")

    facts = list((await db.execute(select(FactRow).where(FactRow.group_id == h.group_id))).scalars())
    commitments = list(
        (await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == h.group_id))).scalars()
    )
    entities = list((await db.execute(select(Entity).where(Entity.group_id == h.group_id))).scalars())
    readiness = await svc.readiness(db, handover_id)
    items = await svc.items(db, handover_id)

    # Sources appendix: deduped by record (record_id + version), with freshness.
    sources, seen = [], set()
    for f in facts:
        for e in f.evidence or []:
            key = (e["record_id"], e.get("record_version", 1))
            if key in seen:
                continue
            seen.add(key)
            sources.append(e)

    await audit.append(
        db, actor=s.user_id, action="package_viewed", subject=handover_id,
        payload={"group": h.group_id, "facts": len(facts)},
    )
    await db.commit()

    return {
        "request_id": request.state.request_id,
        "handover": {
            "handover_id": h.id, "group_id": h.group_id, "from_rm": h.from_rm,
            "to_rm": h.to_rm, "effective_date": str(h.effective_date),
            "kind": h.kind, "status": h.status,
        },
        "readiness": {
            "ready": readiness.ready,
            "blocking": readiness.blocking,
            "statement": (
                "Readiness checks pass: every critical item is owned and dated."
                if readiness.ready
                else "Cannot close yet — the blocking reasons below are enforced by code, not judgement."
            ),
        },
        "brief": [
            {
                "kind": f.kind, "text": f.text, "label": f.label,
                "confidence": f.confidence, "amount_kwd": str(f.amount_kwd) if f.amount_kwd else None,
                "due_date": str(f.due_date) if f.due_date else None,
                "reasons": list(f.reasons or []),
                "sources": list(dict.fromkeys(e["record_id"] for e in (f.evidence or []))),
            }
            for f in facts
            if f.material or f.label == "conflict"
        ],
        "commitments": [
            {
                "description": c.description, "state": c.state, "owner": c.owner,
                "due_date": str(c.due_date) if c.due_date else None,
                "promised_by": c.promised_by,
                "sources": [e["record_id"] for e in (c.evidence or [])],
            }
            for c in commitments
        ],
        "people": {
            "entities": [
                {"name": e.legal_name_en, "role": e.role, "cr": e.cr_number} for e in entities
            ],
            "contacts": [
                {"text": f.text, "label": f.label}
                for f in facts if f.kind == "contact"
            ],
        },
        "open_items": [
            {
                "kind": i.kind, "status": i.status, "owner": i.owner,
                "question": i.question_text, "failure_point": i.failure_point,
            }
            for i in items
        ],
        "sources": sorted(
            sources,
            key=lambda e: (e["source_system"], e["record_id"]),
        ),
        "provenance": {
            "assembled_from": sorted({e["source_system"] for e in sources}),
            "fact_count": len(facts),
            "source_count": len(sources),
            "note": (
                "All client data in this prototype is synthetic. Every line links to a source "
                "record; recollection items are marked, never presented as fact."
            ),
        },
    }
