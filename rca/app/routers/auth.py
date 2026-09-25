from fastapi import APIRouter, Depends, Request

from rca.app.deps import current_session
from rca.app.errors import Forbidden
from rca.app.schemas import DevLoginRequest, TokenResponse
from rca.security import policy, sessions
from rca.settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(body: DevLoginRequest, request: Request):
    """Local profile only. Sandbox and pilot use Entra ID (OIDC)."""
    s = get_settings()
    if s.rca_profile != "local":
        raise Forbidden("Dev login disabled outside local")
    roles = policy.roles_for(body.user)
    if body.group:
        d = policy.can_access(body.user, roles, body.group, "view_file")
        if not d.allow:
            raise Forbidden(f"Access denied: {d.reason}")
    token = sessions.issue(body.user, roles, body.group, "view_file")
    allowed = (
        policy.ALL_GROUPS if "team_lead" in roles else sorted(policy.COVERAGE.get(body.user, set()))
    )
    return TokenResponse(
        request_id=request.state.request_id,
        session_token=token,
        user=body.user,
        roles=roles,
        group_id=body.group,
        allowed_groups=allowed,
    )


@router.get("/whoami")
async def whoami(s=Depends(current_session)):
    return {"user": s.user_id, "roles": s.roles, "group_id": s.group_id, "purpose": s.purpose}
