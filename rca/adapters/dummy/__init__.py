from rca.adapters.base import SourceRecord
from rca.adapters.dummy import fixtures


def _load(system: str) -> list[SourceRecord]:
    return [SourceRecord(**r) for r in fixtures.RECORDS if r["system"] == system]


class _BaseDummy:
    def __init__(self, system: str):
        self.system = system
        self.rows = _load(system)

    async def changed_since(self, since):
        for r in self.rows:
            if r.as_of >= since:
                yield r

    async def records_for_group(self, group_id: str) -> list[SourceRecord]:
        return [r for r in self.rows if r.group_id == group_id]

    async def get(self, record_id: str) -> SourceRecord | None:
        return next((r for r in self.rows if r.record_id == record_id), None)


class DummyCRM(_BaseDummy):
    def __init__(self):
        super().__init__("crm")


class DummyCore(_BaseDummy):
    def __init__(self):
        super().__init__("core_banking")


class DummyECM(_BaseDummy):
    def __init__(self):
        super().__init__("ecm")


class DummyMail(_BaseDummy):
    def __init__(self):
        super().__init__("mail")


class DummyLeaveCalendar:
    system = "hr_leave"

    def __init__(self, path: str | None = None):
        self.rows = fixtures.LEAVE

    async def starting_between(self, start, end) -> list[dict]:
        return [r for r in self.rows if r["start"] <= end.isoformat() and r["end"] >= start.isoformat()]

    async def all_rows(self) -> list[dict]:
        return self.rows
