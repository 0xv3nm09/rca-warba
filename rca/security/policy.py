from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    allow: bool
    reason: str


# Loaded from CRM coverage in real mode; the dummy fixture set in synthetic mode.
COVERAGE = {
    "sara.rm": {"GHC-001", "ALS-014"},
    "omar.rm": {"GHC-001"},
    "lead.one": {"GHC-001", "ALS-014", "NLG-022"},
}

ALL_GROUPS = sorted({g for gs in COVERAGE.values() for g in gs})

ROLES = {
    "sara.rm": ["rm"],
    "omar.rm": ["rm"],
    "lead.one": ["team_lead"],
    "trade.spec": ["specialist"],
}


def roles_for(user_id: str) -> list[str]:
    return ROLES.get(user_id, ["rm"])


def can_access(user_id: str, roles: list[str], group_id: str, purpose: str) -> Decision:
    if "team_lead" in roles:
        return Decision(True, "team lead of coverage unit")
    if group_id in COVERAGE.get(user_id, set()):
        return Decision(True, "assigned coverage")
    if purpose in {"handover", "cover"} and "rm" in roles:
        return Decision(False, "handover access requires assignment by team lead")
    return Decision(False, "no coverage")
