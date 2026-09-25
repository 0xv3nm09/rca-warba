from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from rca.db.session import Base


class Entity(Base):
    __tablename__ = "entities"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(40), index=True)
    legal_name_ar: Mapped[str | None] = mapped_column(Text)
    legal_name_en: Mapped[str | None] = mapped_column(Text)
    cr_number: Mapped[str | None] = mapped_column(String(40), unique=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("entities.id"))
    role: Mapped[str | None] = mapped_column(String(40))  # holding / subsidiary / single
    group_name_en: Mapped[str | None] = mapped_column(Text)


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(40), index=True)
    record_id: Mapped[str] = mapped_column(String(80), index=True)
    source_system: Mapped[str] = mapped_column(String(20))
    lang: Mapped[str] = mapped_column(String(2))
    text: Mapped[str] = mapped_column(Text)  # original
    text_norm: Mapped[str] = mapped_column(Text)  # normalised for search
    span_start: Mapped[int] = mapped_column(Integer)
    span_end: Mapped[int] = mapped_column(Integer)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    acl_users: Mapped[list[str]] = mapped_column(ARRAY(String))
    embedding: Mapped[list[float]] = mapped_column(JSONB)  # hash backend stores plain JSON
    tsv: Mapped[str | None] = mapped_column(TSVECTOR)

    __table_args__ = (
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
        Index("ix_chunks_acl", "acl_users", postgresql_using="gin"),
    )


class FactRow(Base):
    __tablename__ = "facts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    amount_kwd: Mapped[float | None] = mapped_column(Numeric(18, 3))
    due_date: Mapped[date | None] = mapped_column(Date)
    label: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float] = mapped_column(Float)
    material: Mapped[bool] = mapped_column(Boolean)
    reasons: Mapped[list[str]] = mapped_column(ARRAY(Text))
    evidence: Mapped[list[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommitmentRow(Base):
    __tablename__ = "commitments"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str] = mapped_column(Text)
    promised_by: Mapped[str] = mapped_column(String(80))
    promised_to: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20))
    due_date: Mapped[date | None] = mapped_column(Date)
    owner: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(20))
    reasons: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    evidence: Mapped[list[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HandoverRow(Base):
    __tablename__ = "handovers"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(40), index=True)
    from_rm: Mapped[str] = mapped_column(String(80))
    to_rm: Mapped[str] = mapped_column(String(80))
    effective_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(20))  # permanent / cover / referral
    status: Mapped[str] = mapped_column(String(20))  # preparing / open / closed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class HandoverItemRow(Base):
    __tablename__ = "handover_items"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    handover_id: Mapped[str] = mapped_column(ForeignKey("handovers.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # commitment / conflict / question
    ref_id: Mapped[str | None] = mapped_column(String(40))
    question_text: Mapped[str | None] = mapped_column(Text)
    why_asked: Mapped[str | None] = mapped_column(Text)
    failure_point: Mapped[str | None] = mapped_column(String(40))
    answer_text: Mapped[str | None] = mapped_column(Text)
    answer_confidence_note: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(80))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open/accepted/returned/resolved
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AlertRow(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(40))
    group_id: Mapped[str | None] = mapped_column(String(40), index=True)
    text: Mapped[str] = mapped_column(Text)
    to_role: Mapped[str] = mapped_column(String(40))
    raised_once_key: Mapped[str] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AgentDocRow(Base):
    __tablename__ = "agent_docs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)  # cover_brief / return_summary / referral_pack
    group_id: Mapped[str | None] = mapped_column(String(40), index=True)
    for_user: Mapped[str | None] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"

    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(60))
    subject: Mapped[str] = mapped_column(String(120))
    payload_hash: Mapped[str] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), unique=True)
    signature: Mapped[str] = mapped_column(String(64))
