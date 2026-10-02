import re

from rca.app.errors import GuardrailBlocked

INJECTION_PATTERNS = [
    r"ignore (all|any|previous|prior) (instructions|rules|prompts)",
    r"you are now",
    r"system prompt",
    r"تجاهل (جميع|كل) التعليمات",
    r"forward (this|all) (email|emails|data)",
    r"<\s*/?\s*passage",
    r"disregard.*instructions",
    r"mark (it|this|the murabaha.*?) (as )?(sold|approved)",
]
_inj = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE)

BANNED_CLAIMS = [
    # "not approved" is a record quoting its own refusal — quoting it with a
    # citation is safe; only an un-negated approval claim is banned.
    re.compile(r"\b(?<!not )approved\b", re.I),
    re.compile(r"\bconfirmed rate\b|\bguaranteed\b", re.I),
    re.compile(r"(تمت الموافقة|معتمد)"),
]


def injection_score(text: str) -> float:
    """Cheap heuristic; pilot adds a classifier model behind the same function."""
    return 1.0 if _inj.search(text) else 0.0


def sanitise_untrusted(text: str) -> str:
    """Strip HTML comments (hidden injection channels) before extraction."""
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


class Ctx:
    """Per-call context the guards reason about."""

    def __init__(
        self,
        user_id: str,
        kind: str = "extraction",
        group_id: str | None = None,
        has_approval_record: bool = False,
    ):
        self.user_id = user_id
        self.kind = kind  # extraction | user_question | draft | classify
        self.group_id = group_id
        self.has_approval_record = has_approval_record


def input_guard(text: str, ctx: Ctx) -> None:
    if len(text) > 60_000:
        raise GuardrailBlocked("Input too large")
    if ctx.kind == "user_question" and injection_score(text) >= 1.0:
        raise GuardrailBlocked("Question looks like an instruction override")


def output_guard(out_text: str, ctx: Ctx) -> None:
    if ctx.kind == "draft" and any(p.search(out_text) for p in BANNED_CLAIMS):
        if not ctx.has_approval_record:
            raise GuardrailBlocked("Draft claims an approval that is not recorded")
