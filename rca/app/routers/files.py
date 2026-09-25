from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rca.app.deps import get_db, group_scope
from rca.app.schemas import CommitmentOut, EntityOut, EvidenceOut, FactOut, FileResponse
from rca.audit import writer as audit
from rca.db.models import CommitmentRow, Entity, FactRow
from rca.services.handover import today

router = APIRouter(prefix="/groups", tags=["files"])


def _ev_out(e: dict) -> EvidenceOut:
    return EvidenceOut(
        source_system=e["source_system"],
        record_id=e["record_id"],
        record_version=e.get("record_version", 1),
        span_start=e.get("span_start", 0),
        span_end=e.get("span_end", 0),
        quote=e.get("quote", ""),
        as_of=e.get("as_of"),
        lang=e.get("lang", "en"),
    )


@router.get("/{group_id}/file", response_model=FileResponse)
async def file(group_id: str, request: Request, s=Depends(group_scope), db: AsyncSession = Depends(get_db)):
    facts = list((await db.execute(select(FactRow).where(FactRow.group_id == group_id))).scalars())
    commitments = list(
        (await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == group_id))).scalars()
    )
    entities = list((await db.execute(select(Entity).where(Entity.group_id == group_id))).scalars())

    await audit.append(
        db,
        actor=s.user_id,
        action="file_read",
        subject=group_id,
        payload={"facts": len(facts), "commitments": len(commitments)},
    )
    await db.commit()

    return FileResponse(
        request_id=request.state.request_id,
        group_id=group_id,
        group_name=entities[0].group_name_en if entities else None,
        as_of=today().isoformat(),
        entities=[
            EntityOut(entity_id=e.id, legal_name_en=e.legal_name_en, role=e.role, cr_number=e.cr_number)
            for e in entities
        ],
        facts=sorted(
            [
                FactOut(
                    fact_id=f.id,
                    group_id=f.group_id,
                    entity_id=f.entity_id,
                    kind=f.kind,
                    text=f.text,
                    amount_kwd=str(f.amount_kwd) if f.amount_kwd is not None else None,
                    due_date=f.due_date,
                    label=f.label,
                    confidence=f.confidence,
                    material=f.material,
                    evidence=[_ev_out(e) for e in (f.evidence or [])],
                    reasons=list(f.reasons or []),
                )
                for f in facts
            ],
            key=lambda f: (f.material is not True, f.kind != "facility", f.text),
        ),
        commitments=[
            CommitmentOut(
                commitment_id=c.id,
                group_id=c.group_id,
                entity_id=c.entity_id,
                description=c.description,
                promised_by=c.promised_by,
                promised_to=c.promised_to,
                kind=c.kind,
                due_date=c.due_date,
                owner=c.owner,
                state=c.state,
                evidence=[_ev_out(e) for e in (c.evidence or [])],
            )
            for c in commitments
        ],
        open_conflicts=sum(1 for f in facts if f.label == "conflict"),
        stale_sources=[],
    )
