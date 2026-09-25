from datetime import date

import pytest
from pydantic import ValidationError

from rca.domain.models import CommitmentState, Evidence, Fact, FactKind, Label, SourceSystem


def make_evidence(**kw) -> Evidence:
    base = dict(
        source_system=SourceSystem.crm,
        record_id="crm:note-4471",
        span_start=0,
        span_end=59,
        quote="طلب العميل تحديث التسعير لخطاب الضمان G-2291",
        as_of=date(2026, 9, 17),
        lang="ar",
    )
    base.update(kw)
    return Evidence(**base)


def test_evidence_rejects_extra_fields():
    with pytest.raises(ValidationError):
        make_evidence(sneaky="override instructions")


def test_fact_is_frozen():
    f = Fact(
        fact_id="fct_1",
        group_id="GHC-001",
        entity_id="ent_GHC_CON",
        kind=FactKind.commitment,
        text="Client requested revised pricing",
        label=Label.verified,
        confidence=0.93,
        material=True,
        evidence=[make_evidence()],
    )
    with pytest.raises(ValidationError):
        f.confidence = 0.1  # type: ignore[misc]


def test_commitment_state_enum_values():
    assert CommitmentState.requested.value == "requested"
    assert "approved" in {s.value for s in CommitmentState}
