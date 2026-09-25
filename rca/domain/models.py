from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class Lang(StrEnum):
    en = "en"
    ar = "ar"


class Label(StrEnum):
    verified = "verified"
    needs_review = "needs_review"
    conflict = "conflict"
    not_in_records = "not_in_records"
    escalate = "escalate"


class SourceSystem(StrEnum):
    core = "core_banking"
    crm = "crm"
    ecm = "ecm"
    credit = "credit"
    trade = "trade"
    mail = "mail"
    teams = "teams"
    recollection = "recollection"  # outgoing RM answers; never "verified" on their own


class Evidence(Strict):
    source_system: SourceSystem
    record_id: str
    record_version: int = 1
    span_start: int = Field(ge=0)
    span_end: int = Field(ge=0)
    quote: str = Field(max_length=600)
    as_of: date
    lang: Lang


class FactKind(StrEnum):
    facility = "facility"
    commitment = "commitment"
    decision = "decision"
    contact = "contact"
    complaint = "complaint"
    document = "document"
    event = "event"


class Fact(Strict):
    fact_id: str
    group_id: str
    entity_id: str
    kind: FactKind
    text: str = Field(max_length=500)
    amount_kwd: Decimal | None = None  # only from structured fields
    due_date: date | None = None  # only from structured fields
    label: Label
    confidence: float = Field(ge=0.0, le=1.0)
    material: bool
    evidence: list[Evidence] = Field(min_length=0)
    reasons: list[str] = []


class CommitmentState(StrEnum):
    requested = "requested"
    discussed = "discussed"
    recommended = "recommended"
    approved = "approved"
    executed = "executed"
    withdrawn = "withdrawn"
    closed = "closed"


class Commitment(Strict):
    commitment_id: str
    group_id: str
    entity_id: str
    description: str
    promised_by: str
    promised_to: str | None = None
    kind: Literal["respond", "deliver", "approve", "execute"]
    due_date: date | None
    owner: str | None
    state: CommitmentState
    evidence: list[Evidence]


class FailurePoint(StrEnum):
    F1 = "no_open_item_list"
    F2 = "unwritten_context"
    F3 = "request_read_as_approval"
    F4 = "systems_disagree"
    F5 = "client_reasked_documents"
    F6 = "specialist_reasked"
    F7 = "unowned_request"


class WaitReason(StrEnum):
    outgoing_rm_time = "outgoing_rm_time"
    specialist_answer = "specialist_answer"
    client_update = "client_update"
    data_owner = "data_owner"


class HandoverItem(Strict):
    item_id: str
    handover_id: str
    kind: str  # commitment, conflict, question, referral
    handoff_from: str | None = None
    handoff_to: str | None = None
    owner: str | None = None
    due_date: str | None = None
    failure_point: FailurePoint | None = None
    wait_reason: WaitReason | None = None
    wait_started_at: datetime | None = None
    status: str = Field(pattern="^(open|accepted|returned|resolved)$")


# --- extraction output (what the tool-less extractor must return) ---


class ExtractedClaim(Strict):
    kind: FactKind
    entity_hint: str = Field(max_length=200)
    claim: str = Field(max_length=400)
    quote: str = Field(max_length=600)  # must appear verbatim in the chunk
    amount_text: str | None = None  # raw text only; parsed and checked later
    date_text: str | None = None


class ExtractionResult(Strict):
    claims: list[ExtractedClaim] = Field(max_length=40)
