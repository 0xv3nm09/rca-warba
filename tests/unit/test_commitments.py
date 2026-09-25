import pytest

from rca.domain.commitments import InvalidTransition, advance
from rca.domain.models import CommitmentState as S


def test_cannot_jump_to_approved():
    with pytest.raises(InvalidTransition):
        advance(S.discussed, S.approved, "approval_record_from_credit_or_pricing")


def test_approval_needs_record():
    with pytest.raises(InvalidTransition):
        advance(S.recommended, S.approved, "meeting_note_or_email")


def test_valid_transition_with_right_evidence():
    assert advance(S.recommended, S.approved, "approval_record_from_credit_or_pricing") is S.approved


def test_requested_to_discussed_via_meeting_note():
    assert advance(S.requested, S.discussed, "meeting_note_or_email") is S.discussed
