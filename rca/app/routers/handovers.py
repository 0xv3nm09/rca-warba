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
    from rca.app.errors import NotFound
    from rca.db.models import CommitmentRow, FactRow, HandoverRow
    from sqlalchemy import select

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
