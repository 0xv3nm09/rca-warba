from collections.abc import AsyncIterator
from datetime import datetime
from typing import Protocol

from pydantic import BaseModel


class SourceRecord(BaseModel):
    system: str
    record_id: str
    version: int
    group_id: str
    entity_id: str | None
    kind: str  # note, email, facility, contract, document, mandate, account
    lang: str
    text: str | None
    structured: dict | None  # amounts, dates, IDs from systems of record
    as_of: datetime
    acl_users: list[str]
    blob_path: str | None = None


class SourceAdapter(Protocol):
    system: str

    async def changed_since(self, since: datetime) -> AsyncIterator[SourceRecord]: ...

    async def records_for_group(self, group_id: str) -> list[SourceRecord]: ...

    async def get(self, record_id: str) -> SourceRecord | None: ...
