from rca.domain.models import CommitmentState as S

# (from, to) -> evidence required for the move
TRANSITIONS: dict[tuple[S, S], str] = {
    (S.requested, S.discussed): "meeting_note_or_email",
    (S.discussed, S.recommended): "internal_recommendation_record",
    (S.recommended, S.approved): "approval_record_from_credit_or_pricing",
    (S.approved, S.executed): "core_banking_or_contract_record",
    (S.requested, S.withdrawn): "client_or_rm_note",
    (S.discussed, S.withdrawn): "client_or_rm_note",
    (S.executed, S.closed): "completion_record",
}


class InvalidTransition(Exception):
    pass


def advance(current: S, target: S, evidence_type: str | None) -> S:
    need = TRANSITIONS.get((current, target))
    if need is None:
        raise InvalidTransition(f"{current} -> {target} is not allowed")
    if evidence_type != need:
        raise InvalidTransition(f"{current} -> {target} needs {need}")
    return target
