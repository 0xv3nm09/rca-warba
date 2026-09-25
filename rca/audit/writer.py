import hashlib
import hmac
from datetime import UTC, datetime

import orjson
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rca.db.models import AuditEvent
from rca.settings import get_settings


def _canonical(d: dict) -> bytes:
    return orjson.dumps(d, option=orjson.OPT_SORT_KEYS)


async def append(db: AsyncSession, *, actor: str, action: str, subject: str, payload: dict) -> AuditEvent:
    # Serialise writers so the chain has a single order.
    await db.execute(text("SELECT pg_advisory_xact_lock(424242)"))
    prev = (
        await db.execute(select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(1))
    ).scalar_one_or_none()
    prev_hash = prev.hash if prev else "0" * 64
    body = {
        "ts": datetime.now(UTC).isoformat(),
        "actor": actor,
        "action": action,
        "subject": subject,
        "payload_hash": hashlib.sha256(_canonical(payload)).hexdigest(),
    }
    digest = hashlib.sha256(prev_hash.encode() + _canonical(body)).hexdigest()
    sig = hmac.new(
        get_settings().audit_hmac_key.get_secret_value().encode(), digest.encode(), hashlib.sha256
    ).hexdigest()
    ev = AuditEvent(prev_hash=prev_hash, hash=digest, signature=sig, **body)
    db.add(ev)  # computed before insert: never UPDATE an audit row
    return ev


async def verify_chain(db: AsyncSession) -> tuple[bool, int | None]:
    prev = "0" * 64
    for ev in (await db.execute(select(AuditEvent).order_by(AuditEvent.seq))).scalars():
        body = {
            "ts": ev.ts,
            "actor": ev.actor,
            "action": ev.action,
            "subject": ev.subject,
            "payload_hash": ev.payload_hash,
        }
        if ev.prev_hash != prev or hashlib.sha256(prev.encode() + _canonical(body)).hexdigest() != ev.hash:
            return False, ev.seq
        prev = ev.hash
    return True, None
