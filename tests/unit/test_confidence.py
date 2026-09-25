from rca.domain.confidence import Signals, label, raw_score
from rca.domain.models import Label


def sig(**kw) -> Signals:
    base = dict(
        span_ok=True,
        is_numeric=True,
        numbers_match=True,
        entail_p=0.95,
        source="core_banking",
        age_days=0,
        agreeing_sources=2,
        conflicting_sources=0,
        self_consistency=1.0,
        material=True,
    )
    base.update(kw)
    return Signals(**base)


def test_conflict_when_sources_disagree():
    lab, reasons = label(sig(conflicting_sources=1), 0.9)
    assert lab is Label.conflict
    assert "disagree" in reasons[0]


def test_not_in_records_when_score_zero():
    assert label(sig(span_ok=False), 0.0)[0] is Label.not_in_records


def test_recollection_never_verified():
    lab, _ = label(sig(source="recollection"), 0.95)
    assert lab is Label.needs_review


def test_material_below_90_escalates():
    assert label(sig(), 0.85)[0] is Label.escalate


def test_verified_when_strong():
    assert label(sig(), 0.95)[0] is Label.verified


def test_raw_score_zero_on_number_mismatch():
    assert raw_score(sig(numbers_match=False)) == 0.0
