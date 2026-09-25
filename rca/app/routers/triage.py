from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from rca.app.deps import current_session, get_db
from rca.app.schemas import TriageRequest, TriageResponse
from rca.security.policy import COVERAGE
from rca.services import triage as triage_svc

router = APIRouter(tags=["triage"])


@router.post("/triage", response_model=TriageResponse)
async def triage(
    body: TriageRequest, request: Request, s=Depends(current_session), db: AsyncSession = Depends(get_db)
):
    groups = sorted(COVERAGE.get(s.user_id, set())) if "team_lead" not in s.roles else None
    result = await triage_svc.triage(db, text=body.text, group_ids=groups)
    return TriageResponse(request_id=request.state.request_id, **result)
