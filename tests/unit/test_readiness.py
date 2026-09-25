from datetime import date

from rca.domain.models import Commitment, CommitmentState, Evidence, Fact, FactKind, Label, SourceSystem
from rca.domain.readiness import evaluate

TODAY = date(2026, 9, 22)
EV = [
    Evidence(
        source_system=SourceSystem.core,
        record_id="core:fac-G-2291",
        span_start=0,
        span_end=28,
        quote="Performance guarantee G-2291",
        as_of=TODAY,
        lang="en",  # type: ignore[arg-type]
    )
]


def fact(
    label: Label, kind: FactKind = FactKind.facility, due: date | None = None, material: bool = True
) -> Fact:
    return Fact(
        fact_id="fct_1",
        group_id="GHC-001",
        entity_id="ent_GHC_CON",
        kind=kind,
        text="Guarantee G-2291 expires 13 Oct 2026",
        amount_kwd=None,
        due_date=due,
        label=label,
        confidence=0.9,
        material=material,
        evidence=EV,
    )


def commitment(owner: str | None = None, due: date | None = None, cid: str = "cmt_1") -> Commitment:
    return Commitment(
        commitment_id=cid,
        group_id="GHC-001",
        entity_id="ent_GHC_CON",
        description="Renewal status update to client",
        promised_by="omar.rm",
        promised_to="client finance team",
        kind="respond",
        due_date=due,
        owner=owner,
        state=CommitmentState.requested,
        evidence=[],
    )


def test_blocks_on_unowned_commitment():
    r = evaluate([], [commitment(owner=None, due=None)], TODAY, set(), [])
    assert not r.ready
    assert any("no owner" in b for b in r.blocking)


def test_blocks_on_unaccepted_commitment():
    r = evaluate([], [commitment(owner="sara.rm", due=date(2026, 9, 24))], TODAY, set(), [])
    assert not r.ready
    assert any("not accepted" in b for b in r.blocking)


def test_blocks_on_material_conflict():
    r = evaluate([fact(Label.conflict)], [], TODAY, set(), [])
    assert not r.ready
    assert any("conflict" in b for b in r.blocking)


def test_blocks_on_expiry_without_owner():
    r = evaluate([fact(Label.verified, due=date(2026, 10, 13))], [], TODAY, set(), [])
    assert not r.ready
    assert any("without an owner" in b for b in r.blocking)


def test_ready_when_all_clear():
    f = fact(Label.verified, due=date(2026, 10, 13))
    c = commitment(owner="sara.rm", due=date(2026, 9, 24))
    r = evaluate([f], [c], TODAY, {c.commitment_id}, [])
    assert r.ready, r.blocking


def test_stale_sources_are_warnings_not_blockers():
    c = commitment(owner="sara.rm", due=date(2026, 9, 24))
    r = evaluate([], [c], TODAY, {c.commitment_id}, ["crm:acct-GHC"])
    assert r.ready
    assert r.warnings and "Stale" in r.warnings[0]
