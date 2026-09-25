"""Deterministic rules extractor: the offline 'dummy' model route.

It implements the same contract as the LLM extractor (claims with verbatim
quotes, raw amount/date text, no inference of approvals) using bilingual
pattern rules. The verification pipeline treats its output exactly like model
output: quotes must be located, numbers must match, labels are computed.
"""

import re
import typing

from rca.domain.models import ExtractedClaim, FactKind

_SENT_SPLIT = re.compile(r"(?<=[.!?؟।])\s+|\n+")


def _sentence_around(text: str, match: re.Match) -> str:
    start = match.start()
    sentences = [s for s in _SENT_SPLIT.split(text) if s.strip()]
    pos = 0
    for s in sentences:
        end = pos + len(s)
        if pos <= start < end:
            return s.strip()[:600]
        pos = end + 1
    return text[max(0, start - 100) : start + 400].strip()[:600]


RULES: list[tuple[re.Pattern, "str | typing.Callable[[re.Match], str]", FactKind, str | None]] = [
    # Arabic: pricing requested, reply promised, not approved
    (
        re.compile(r"طلب العميل تحديث التسعير"),
        "Client requested revised pricing for guarantee G-2291",
        FactKind.commitment,
        None,
    ),
    (
        re.compile(r"وعدنا بالرد"),
        "Bank promised a reply to the pricing request",
        FactKind.commitment,
        None,
    ),
    (
        re.compile(r"لم تتم الموافقة"),
        "Pricing update not approved",
        FactKind.decision,
        None,
    ),
    # English commitments with dates: copy the substance being sent, don't invent it
    (
        re.compile(
            r"we (?:will send|promised to send|shall send)\s+(?P<what>[^.]*?)\s+by\s+"
            r"(?:Thursday|\d{1,2}\s+\w+|\d{4}-\d{2}-\d{2})",
            re.I,
        ),
        lambda m: f"Bank will send {m.group('what').strip()} by the promised date",
        FactKind.commitment,
        "by_date",
    ),
    # Documents re-sent (F5)
    (
        re.compile(r"re-?sent[^.]*?(?:second time|twice|again)|sent[^.]*?twice", re.I),
        "Client re-sent documents already held",
        FactKind.document,
        None,
    ),
    # Decisions / context
    (
        re.compile(r"declined[^.]*?proposal|proposal[^.]*?declined", re.I),
        "Previous pricing proposal declined by the client; no reason recorded",
        FactKind.event,
        None,
    ),
    (
        re.compile(r"basically done", re.I),
        "Email describes the Islamic contract as basically done; wording ahead of records",
        FactKind.decision,
        None,
    ),
    (
        re.compile(r"is the signatory", re.I),
        "Note names this person as the signatory; mandate record is the authority",
        FactKind.contact,
        None,
    ),
]

_DATE_TAIL = re.compile(r"by\s+(\d{1,2}\s+\w+|\d{4}-\d{2}-\d{2}|Thursday)", re.I)


def extract_claims_rules(passage: str, lang: str) -> list[ExtractedClaim]:
    # Hidden channels (HTML comments) are stripped before any extraction sees them.
    cleaned = re.sub(r"<!--.*?-->", "[flagged-content]", passage, flags=re.DOTALL)
    claims: list[ExtractedClaim] = []
    for pattern, claim_spec, kind, date_mode in RULES:
        m = pattern.search(cleaned)
        if not m:
            continue
        claim_text = claim_spec(m) if callable(claim_spec) else claim_spec
        quote = _sentence_around(cleaned, m)
        date_text = None
        if date_mode == "by_date":
            dm = _DATE_TAIL.search(quote)
            date_text = dm.group(1) if dm else None
        claims.append(
            ExtractedClaim(
                kind=kind,
                entity_hint="",
                claim=claim_text,
                quote=quote,
                amount_text=None,
                date_text=date_text,
            )
        )
    return claims
