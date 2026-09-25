from fastapi import Depends, Header, Path, Request

from rca.app.errors import Forbidden, OutOfScope
from rca.security.sessions import Session, verify


async def get_db(request: Request):
    async with request.app.state.sessionmaker() as db:
        yield db


def get_gateway(request: Request):
    return request.app.state.gateway


async def current_session(authorization: str = Header(...)) -> Session:
    if not authorization.startswith("Bearer "):
        raise Forbidden("Missing bearer token")
    try:
        return verify(authorization.removeprefix("Bearer "))
    except Exception as exc:
        raise Forbidden("Invalid or expired session") from exc


def group_scope(group_id: str = Path(...), s: Session = Depends(current_session)) -> Session:
    # Team leads may view any group (policy: team lead of the coverage unit);
    # RM sessions stay bound to their single client group.
    if s.group_id != group_id and "team_lead" not in s.roles:
        raise OutOfScope("Session is not bound to this client group")
    return s


def require_role(*roles: str):
    def dep(s: Session = Depends(current_session)) -> Session:
        if not set(roles) & set(s.roles):
            raise Forbidden("Role not permitted")
        return s

    return dep
