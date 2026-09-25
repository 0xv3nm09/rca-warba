from dataclasses import dataclass, field
from datetime import date, timedelta

from rca.domain.models import Commitment, Fact, Label


@dataclass(frozen=True)
class Readiness:
    ready: bool
    blocking: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def evaluate(
    facts: list[Fact],
    commitments: list[Commitment],
    today: date,
    accepted_ids: set[str],
    stale_sources: list[str],
) -> Readiness:
    blocking, warnings = [], []
    for c in commitments:
        if c.state.value in {"closed", "withdrawn"}:
            continue
        if not c.owner or not c.due_date:
            blocking.append(f"Commitment '{c.description}' has no owner or due date")
        elif c.commitment_id not in accepted_ids:
            blocking.append(f"Commitment '{c.description}' not accepted by incoming RM")
    for f in facts:
        if f.material and f.label in {Label.conflict, Label.escalate}:
            blocking.append(f"Unresolved material {f.label.value}: {f.text}")
        if f.kind.value == "facility" and f.due_date and f.due_date <= today + timedelta(days=30):
            if not any(c.entity_id == f.entity_id and c.owner for c in commitments):
                blocking.append(f"Expiry within 30 days without an owner: {f.text}")
    if stale_sources:
        warnings.append(f"Stale sources: {', '.join(stale_sources)}")
    return Readiness(ready=not blocking, blocking=blocking, warnings=warnings)
