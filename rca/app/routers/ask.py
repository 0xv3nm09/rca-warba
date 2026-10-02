from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from rca.ai.gateway import ModelGateway
from rca.app.deps import get_db, get_gateway, group_scope
from rca.app.schemas import AskRequest, AskResponse, EvidenceOut
from rca.audit import writer as audit
from rca.services import ask as ask_svc

router = APIRouter(prefix="/groups", tags=["ask"])


@router.post("/{group_id}/ask", response_model=AskResponse)
async def ask(
    group_id: str,
    body: AskRequest,
    request: Request,
    s=Depends(group_scope),
    db: AsyncSession = Depends(get_db),
    gw: ModelGateway = Depends(get_gateway),
):
    result = await ask_svc.answer(
        db, gw, group_id=group_id, question=body.question, user_id=s.user_id, lang=body.lang
    )
    await audit.append(
        db,
        actor=s.user_id,
        action="ask",
        subject=group_id,
        payload={"label": result["label"], "q_len": len(body.question)},
    )
    await db.commit()
    return AskResponse(
        request_id=request.state.request_id,
        answer=result["answer"],
        label=result["label"],
        confidence=result["confidence"],
        citations=[
            EvidenceOut(
                source_system=c.get("source_system", "crm"),
                record_id=c.get("record_id", ""),
                record_version=c.get("record_version", 1),
                span_start=c.get("span_start", 0),
                span_end=c.get("span_end", 0),
                quote=c.get("quote", ""),
                as_of=c.get("as_of"),
                lang=c.get("lang", "en"),
            )
            for c in result["citations"]
        ],
        reasons=result["reasons"],
    )
