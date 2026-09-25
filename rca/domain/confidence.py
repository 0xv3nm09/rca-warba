from dataclasses import dataclass

from rca.domain.models import Label

AUTHORITY = {
    "core_banking": 1.0,
    "credit": 0.95,
    "trade": 0.95,
    "ecm": 0.85,
    "crm": 0.75,
    "mail": 0.6,
    "teams": 0.55,
    "recollection": 0.4,
}


@dataclass(frozen=True)
class Signals:
    span_ok: bool
    is_numeric: bool
    numbers_match: bool
    entail_p: float  # 0..1 from NLI
    source: str
    age_days: int
    agreeing_sources: int
    conflicting_sources: int
    self_consistency: float  # 0..1 share of 3 extractions that agree
    material: bool


def raw_score(s: Signals) -> float:
    if not s.span_ok or (s.is_numeric and not s.numbers_match):
        return 0.0
    freshness = max(0.0, 1.0 - s.age_days / 365)
    agreement = min(1.0, s.agreeing_sources / 2)
    return (
        0.40 * s.entail_p
        + 0.20 * AUTHORITY.get(s.source, 0.5)
        + 0.15 * freshness
        + 0.15 * agreement
        + 0.10 * s.self_consistency
    )


def label(s: Signals, calibrated: float) -> tuple[Label, list[str]]:
    reasons = []
    if s.conflicting_sources:
        return Label.conflict, [f"{s.conflicting_sources} source(s) disagree"]
    if calibrated == 0.0:
        return Label.not_in_records, ["No supporting span or numbers did not match"]
    if s.source == "recollection":
        return Label.needs_review, ["Based on outgoing RM recollection only"]
    if s.material and calibrated < 0.90:
        return Label.escalate, [f"Material fact below 0.90 ({calibrated:.2f})"]
    if calibrated < 0.75:
        return Label.needs_review, [f"Confidence {calibrated:.2f} below 0.75"]
    reasons.append(f"Supported by {s.source}; entailment {s.entail_p:.2f}")
    return Label.verified, reasons
