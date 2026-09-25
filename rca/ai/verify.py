"""Verification checks every extracted claim must pass before it becomes a fact."""

import re
from decimal import Decimal, InvalidOperation

from rca.retrieval.normalise_ar import normalise


def locate_quote(chunk_text: str, quote: str) -> tuple[int, int] | None:
    """Exact match first, then normalised match (Arabic forms, whitespace, digits).

    NOTE: offsets from the normalised path index the normalised text; callers
    that need original-text offsets for highlighting must store both mappings.
    The prototype stores the normalised offsets and re-locates on display.
    """
    i = chunk_text.find(quote)
    if i >= 0:
        return i, i + len(quote)
    nt, nq = normalise(chunk_text), normalise(quote)
    j = nt.find(nq)
    return (j, j + len(nq)) if j >= 0 else None


AMOUNT_RE = re.compile(r"(\d{1,3}(?:[,\u066C]\d{3})+|\d+)(?:[.\u066B](\d+))?")


def parse_amount(text: str | None) -> Decimal | None:
    if not text:
        return None
    t = normalise(text)  # Arabic-Indic digits -> 0-9
    m = AMOUNT_RE.search(t)
    if not m:
        return None
    whole = re.sub(r"[,\u066C]", "", m.group(1))
    try:
        return Decimal(f"{whole}.{m.group(2)}" if m.group(2) else whole)
    except InvalidOperation:
        return None


def numbers_match(extracted: Decimal | None, structured: Decimal | None) -> bool:
    if extracted is None or structured is None:
        return True  # nothing to compare
    return extracted.quantize(Decimal("0.001")) == structured.quantize(Decimal("0.001"))


_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
_ISO_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_MONTH_DAY_RE = re.compile(rf"\b(\d{{1,2}})\s+({'|'.join(_MONTHS)})\b", re.IGNORECASE)


def parse_date(text: str | None, default_year: int = 2026):
    """Parse ISO or '24 September' style dates from raw extracted text. Returns None if absent."""
    from datetime import date

    if not text:
        return None
    if m := _ISO_RE.search(text):
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if m := _MONTH_DAY_RE.search(text):
        return date(default_year, _MONTHS[m.group(2).lower()], int(m.group(1)))
    return None


def _token_f1(a: str, b: str) -> float:
    ta = set(normalise(a).split())
    tb = set(normalise(b).split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return 2 * inter / (len(ta) + len(tb))


def _has_arabic(text: str) -> bool:
    return any("\u0600" <= ch <= "\u06ff" for ch in text)


def entailment_prob(premise: str, hypothesis: str) -> float:
    """Probability that the premise (source span) entails the hypothesis (claim).

    Prototype backend: token overlap for same-language pairs. Cross-language
    pairs get a fixed conservative score (span + number checks still apply);
    install the `ml` extra and set NLI_MODEL to a multilingual NLI model for
    real entailment scoring of Arabic/English pairs.
    """
    if _has_arabic(premise) != _has_arabic(hypothesis):
        return 0.85
    return round(min(1.0, _token_f1(premise, hypothesis) * 1.35), 3)
