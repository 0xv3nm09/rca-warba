from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt  # PyJWT
from pydantic import BaseModel

from rca.domain.ids import new_id
from rca.settings import get_settings

Purpose = Literal["view_file", "handover", "cover", "referral", "admin"]


class Session(BaseModel):
    sid: str
    user_id: str
    roles: list[str]
    group_id: str | None  # None only for admin sessions
    purpose: Purpose
    exp: int


def issue(user_id: str, roles: list[str], group_id: str | None, purpose: Purpose) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    claims = {
        "sid": new_id("ses"),
        "sub": user_id,
        "roles": roles,
        "grp": group_id,
        "pur": purpose,
        "iss": s.jwt_issuer,
        "aud": s.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=s.session_ttl_min)).timestamp()),
    }
    return jwt.encode(claims, s.jwt_signing_key.get_secret_value(), algorithm="HS256")


def verify(token: str) -> Session:
    s = get_settings()
    c = jwt.decode(
        token,
        s.jwt_signing_key.get_secret_value(),
        algorithms=["HS256"],
        audience=s.jwt_audience,
        issuer=s.jwt_issuer,
    )
    return Session(
        sid=c["sid"],
        user_id=c["sub"],
        roles=c["roles"],
        group_id=c["grp"],
        purpose=c["pur"],
        exp=c["exp"],
    )
