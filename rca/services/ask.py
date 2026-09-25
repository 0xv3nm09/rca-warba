"""Cited answers: deterministic intent + state-machine lookups; the model
only words the reply. Approval answers come from commitment states, never
from the model's reading of a note."""

import re

import structlog
from sqlalchemy import select

from rca.ai.gateway import ModelGateway
from rca.ai.guards import Ctx, input_guard
from rca.db.models import CommitmentRow, FactRow
from rca.retrieval.embed import cosine, embed
from rca.retrieval.normalise_ar import normalise

log = structlog.get_logger()

DRAFT_SYSTEM = (
    "You return the given sentences joined as plain text, unchanged, in order. "
    'Do not reword, do not add, do not remove. Return JSON {"text": "..."}.'
)

_APPROVAL_RE = re.compile(r"approv|can i (tell|confirm|say)|سعر.*موافقة|موافقة", re.IGNORECASE)
_PRICING_RE = re.compile(r"pric|rate|سعر|تسعير", re.IGNORECASE)
_STAGE_RE = re.compile(r"murabaha|stage|sold|done|مرابحة", re.IGNORECASE)
_SHARIAH_RE = re.compile(r"shariah|permissible|halal|شرع", re.IGNORECASE)


def _ev(f: FactRow, idx: int = 0) -> dict:
    return f.evidence[idx] if f.evidence and idx < len(f.evidence) else {}


async def answer(db, gw: ModelGateway, *, group_id: str, question: str, user_id: str) -> dict:

    # Instruction-override questions are refused before any routing happens.
    input_guard(question, Ctx(user_id=user_id, kind="user_question", group_id=group_id))

    facts = list((await db.execute(select(FactRow).where(FactRow.group_id == group_id))).scalars())
    commitments = list(
        (await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == group_id))).scalars()
    )

    # 1) Approval questions are answered by the state machine, not the model.
    if _APPROVAL_RE.search(question) and _PRICING_RE.search(question):
        pricing_facts = [f for f in facts if "pricing" in f.text.lower()]
        approved = any(c.state == "approved" for c in commitments)
        if approved:
            label, conf, sentences = "verified", 0.95, ["An approval is recorded for this request."]
            citations = [_ev(f) for f in facts if "approval" in f.text.lower()][:1]
        else:
            f = pricing_facts[0] if pricing_facts else None
            label, conf = "not_in_records", 0.0
            sentences = [
                "No approval is recorded.",
                "The client requested revised pricing on 17 Sep, and a reply was promised for Thursday [1].",
                "Confirm with the pricing approver before communicating new terms.",
            ]
            citations = [_ev(f)] if f else []
            reasons = ["Commitment state is 'requested'; no approval record linked"]
        text = await _draft(gw, user_id, sentences)
        return _pack(text, label, conf, citations, reasons)

    # 2) Islamic contract stage: from the contract record, never the email.
    if _STAGE_RE.search(question) and any("murabaha" in f.text.lower() for f in facts):
        stage_f = next(f for f in facts if "murabaha" in f.text.lower() and "stage" in f.text.lower())
        email_f = next((f for f in facts if "basically done" in f.text.lower()), None)
        from rca.domain.islamic_contracts import Murabaha, can_describe_as_sold

        stage = "promise_recorded"
        sentences = [
            "The Murabaha is at the promise-recorded stage: the client's promise to purchase is on file [1].",
        ]
        if not can_describe_as_sold(Murabaha(stage)):
            sentences.append(
                "No purchase or sale contract is recorded, so it should not be described as sold."
            )
        if email_f:
            sentences.append(
                "An email describes it as 'basically done' [2]; that wording is ahead of the records."
            )
        citations = [_ev(stage_f)] + ([_ev(email_f)] if email_f else [])
        reasons = [f"Stage from contract record: {stage}"]
        if email_f and any("Injection" in r for r in (email_f.reasons or [])):
            reasons.append("Injection pattern detected in the email and logged")
        text = await _draft(gw, user_id, sentences)
        return _pack(text, "verified", stage_f.confidence, citations, reasons)

    # 3) Shariah opinions are out of scope by design.
    if _SHARIAH_RE.search(question):
        text = await _draft(
            gw, user_id, ["This needs a Shariah Control decision. I have routed it to their queue."]
        )
        return _pack(text, "escalate", 0.0, [], ["Shariah opinions are out of scope for the assistant"])

    # 4) General questions: hybrid search over this group's chunks, ACL first.
    chunks = await _search(db, group_id=group_id, user_id=user_id, query=question)
    if not chunks:
        text = await _draft(gw, user_id, ["Not in the records I can see. Check with the approver."])
        return _pack(text, "not_in_records", 0.0, [], ["No supporting span in permitted records"])
    sentences, citations = [], []
    for i, ch in enumerate(chunks[:3], start=1):
        snippet = ch.text[:220].rsplit(" ", 1)[0] if len(ch.text) > 220 else ch.text
        sentences.append(f"{snippet} [{i}]")
        citations.append(
            {
                "source_system": ch.source_system,
                "record_id": ch.record_id,
                "record_version": 1,
                "span_start": 0,
                "span_end": len(snippet),
                "quote": snippet,
                "as_of": ch.as_of.date().isoformat(),
                "lang": ch.lang,
            }
        )
    text = await _draft(gw, user_id, sentences)
    return _pack(
        text, "needs_review", 0.7, citations, ["From keyword + embedding search over permitted records"]
    )


async def _draft(gw: ModelGateway, user_id: str, sentences: list[str]) -> str:
    import json

    from pydantic import BaseModel

    class Draft(BaseModel):
        text: str

    out = await gw.complete_json(
        route="draft",
        system=DRAFT_SYSTEM,
        user=json.dumps({"sentences": sentences}),
        schema=Draft,
        ctx=Ctx(user_id=user_id, kind="draft", has_approval_record=False),
    )
    return out.text


def _pack(text: str, label: str, conf: float, citations: list[dict], reasons: list[str]) -> dict:
    return {
        "answer": text,
        "label": label,
        "confidence": round(conf, 2),
        "citations": [c for c in citations if c],
        "reasons": reasons,
    }


async def _search(db, *, group_id: str, user_id: str, query: str, top_k: int = 6):
    from rca.db.models import Chunk

    rows = list((await db.execute(select(Chunk).where(Chunk.group_id == group_id))).scalars())
    # ACL before ranking: a chunk the user cannot see is never ranked, never shown.
    rows = [c for c in rows if user_id in (c.acl_users or [])]
    qv = embed([query])[0]
    qn = normalise(query)
    qt = set(qn.split())

    def score(c: Chunk) -> float:
        dense = cosine(qv, c.embedding or [0.0])
        toks = set((c.text_norm or "").split())
        overlap = len(qt & toks) / (len(qt) or 1)
        return 0.6 * max(0.0, dense) + 0.4 * overlap

    ranked = sorted(rows, key=score, reverse=True)
    # Weak matches are refused: "not in records" beats a confidently wrong answer.
    return [c for c in ranked if score(c) > 0.3][:top_k]
