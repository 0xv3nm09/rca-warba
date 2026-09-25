from datetime import date

from pydantic import Field

from rca.domain.models import Strict


class Envelope(Strict):
    request_id: str
    model_route: str | None = None


class EvidenceOut(Strict):
    source_system: str
    record_id: str
    record_version: int = 1
    span_start: int = 0
    span_end: int = 0
    quote: str
    as_of: date
    lang: str


class FactOut(Strict):
    fact_id: str
    group_id: str
    entity_id: str
    kind: str
    text: str
    amount_kwd: str | None = None
    due_date: date | None = None
    label: str
    confidence: float
    material: bool
    evidence: list[EvidenceOut] = []
    reasons: list[str] = []


class CommitmentOut(Strict):
    commitment_id: str
    group_id: str
    entity_id: str
    description: str
    promised_by: str
    promised_to: str | None = None
    kind: str
    due_date: date | None = None
    owner: str | None = None
    state: str
    evidence: list[EvidenceOut] = []


class EntityOut(Strict):
    entity_id: str
    legal_name_en: str | None = None
    role: str | None = None
    cr_number: str | None = None


class FileResponse(Envelope):
    group_id: str
    group_name: str | None = None
    as_of: str
    entities: list[EntityOut] = []
    facts: list[FactOut]
    commitments: list[CommitmentOut]
    open_conflicts: int
    stale_sources: list[str] = []


class AskRequest(Strict):
    question: str = Field(min_length=3, max_length=1000)
    lang: str = "en"


class AskResponse(Envelope):
    answer: str
    label: str
    confidence: float
    citations: list[EvidenceOut] = []
    reasons: list[str] = []


class TriageRequest(Strict):
    text: str = Field(min_length=3, max_length=4000)
    lang: str = "en"


class TriageResponse(Envelope):
    issue_class: str
    action: str
    route_to: str | None
    label: str
    confidence: float
    reasons: list[str]
    matched_commitment: str | None = None


class DevLoginRequest(Strict):
    user: str
    group: str | None = None


class TokenResponse(Envelope):
    session_token: str
    user: str
    roles: list[str]
    group_id: str | None
    allowed_groups: list[str] = []


class HandoverCreate(Strict):
    group_id: str
    from_rm: str
    to_rm: str
    effective_date: date
    kind: str = Field(pattern="^(permanent|cover|referral)$")


class AnswerRequest(Strict):
    question_id: str
    answer: str = Field(min_length=1, max_length=4000)
    confidence_note: str | None = Field(default=None, max_length=500)


class AcceptRequest(Strict):
    accepted_item_ids: list[str] = []
    returned_item_ids: list[str] = []
    note: str | None = Field(default=None, max_length=1000)


class AssignRequest(Strict):
    owner: str
    due_date: date | None = None


class CloseResponse(Envelope):
    closed: bool
    blocking_reasons: list[str]


class BoardItem(Strict):
    handover_id: str
    group_id: str
    from_rm: str
    to_rm: str
    status: str
    effective_date: str
    kind: str
    blocking: list[str]
    blocking_count: int
    open_items: int
    next_due: str | None


class BoardResponse(Envelope):
    transfers: list[BoardItem]


class ItemOut(Strict):
    item_id: str
    kind: str
    status: str
    owner: str | None = None
    due_date: str | None = None
    question_text: str | None = None
    why_asked: str | None = None
    failure_point: str | None = None
    answer_text: str | None = None
    ref_id: str | None = None


class BlockingReason(Strict):
    reason: str
    item_id: str | None = None


class HandoverDetail(Envelope):
    handover_id: str
    group_id: str
    from_rm: str
    to_rm: str
    status: str
    ready: bool = True
    blocking: list[BlockingReason] = []
    items: list[ItemOut]


class AlertOut(Strict):
    alert_id: str
    kind: str
    group_id: str | None
    text: str
    to_role: str
    status: str = "open"
