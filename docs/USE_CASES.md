# Use cases — where each one lives in the code, and how it is proven

**Relationship Continuity Assistant · Track 2 prototype · all data synthetic**
Companion to `docs/prototype-notes.md` (coverage table) and
`docs/ARCHITECTURE.md` (flows). One section per use case: the demo path, the
code path, the core snippet, and the automated proof.

**Demo video map** (guided path `?demo=1`, same order as the beats below):

| Beat | Time | Screen |
| --- | --- | --- |
| 1 | 0:00 | Readiness board — blocked transfer + agent alerts |
| 2 | 0:13 | Client file assembled for you |
| 3 | 0:26 | Citation → source drawer on the Arabic note |
| 4 | 0:35 | Two systems disagree — the conflict card |
| 5 | 0:46 | "Is the price approved?" → *not in records* |
| 6 | 0:57 | Email hijack attempt ignored; Murabaha stage from the contract |
| 7 | 1:09 | Gap answer saved as recollection; duty assigned; close blocked |
| 8 | 1:21 | Agents: triggers, cover brief with do-not-say, alerts |

---

## 1 · Planned RM exit — the transfer that cannot close unsafely

**Demo:** Board → GHC-001 blocked with 3 reasons → Transfer → answer a gap
question, accept duties, see close stay blocked. **Video 0:00, 1:09.**

**Code:** `rca/app/routers/handovers.py` (workflow), `rca/domain/readiness.py`
(close gate), `rca/services/handover.py`.

```python
# rca/domain/readiness.py — plain code decides, not a model
if not c.owner or not c.due_date:
    blocking.append(f"Commitment '{c.description}' has no owner or due date")
if c.state != "accepted":
    blocking.append(f"Commitment '{c.description}' not accepted by incoming RM")
```

Interview answers are stored as **recollection** and the label rules make
promotion impossible:

```python
if s.source == "recollection":
    return Label.needs_review, ["Based on outgoing RM recollection only"]
```

**Proof:** `test_close_blocked_without_owner`, `test_full_handover_cycle_closes`,
`test_recollection_never_verified` (API); readiness unit tests (unowned,
unaccepted, material conflict, expiry-without-owner). Golden: gap questions
cover the planted failure points; close returns 409 with item-linked reasons.

## 2 · Leave cover and return — the brief exists before anyone asks

**Demo:** Agents screen → "Cover brief for sara.rm — covering omar.rm" with
what falls due during cover and a **do-not-say** guard on the unapproved price.
**Video 1:21.**

**Code:** `rca/agents/triggers.py::on_leave_booked` (cover brief +
do-not-say), `on_leave_ended` (return summary, scheduled).

The do-not-say line is generated from the same commitment state machine the
ask path uses — an unapproved price cannot enter a covering RM's vocabulary.

**Proof:** golden handover flow; `test_alert_status_resolves_when_fixed`
covers the trigger→alert lifecycle.

## 3 · Merger portfolio reassignment — batch is the same gate, per group

**Deliberately deferred as batch (proposal §14, production months 3–8).** The
readiness evaluation that blocks one transfer is exactly what a merger batch
runs across many groups — `readiness()` takes a group's facts and commitments
and returns blocking reasons. The board already renders *every* group the role
can see; a merger batch is a loop over groups, not new logic.

**Proof:** `team_lead` sees all groups in one board
(`test_login_returns_allowed_groups`); per-group readiness unit tests.

## 4 · Islamic conversion continuity — wording guarded by a state machine

**Demo:** ALS-014 → "What stage is the Murabaha at?" → *promise recorded*,
"should not be described as sold", citing the contract record while a client
email says "basically done" and carries a hidden instruction. **Video 0:57.**

**Code:** `rca/domain/islamic_contracts.py`:

```python
def can_describe_as_sold(stage: Murabaha) -> bool:
    """Brief wording guard: never say 'sold' before the sale record exists."""
    return stage in {Murabaha.sold_to_client, Murabaha.repaying, Murabaha.settled}
```

The stage machine has no shortcut past bank ownership
(`test_flow_has_no_shortcut_past_bank_ownership`) and every active stage
demands its record (`REQUIRED_RECORD`).

**Proof:** `test_injection_email_has_no_effect`, `test_promise_stage_is_not_sold`,
golden case `als-014` (stage answer cites `ecm:doc-PRM-ALS-2`; the injection
phrasing of the same request is refused 422).

## 5 · Specialist referral — the client is never re-asked

**Demo:** Client file → "Refer to a specialist" → pack on the Agents screen
listing the documents **already on file** with validity dates.
**Code:** `rca/agents/triggers.py::prepare_referral_pack` (idempotent via
`blake2b` key), `POST /agents/referrals`.

**Proof:** `test_referral_lists_valid_documents_only` — the pack may only list
documents the bank already holds, with validity checked.

## 6 · Sudden absence — no new screen by design

The emergency brief *is* the living file: assembled from records only,
unknowns shown as gaps (gap questions), nothing invented. Per the proposal
this is exercised via simulation in the pilot; today, opening any client file
with no handover prepared demonstrates exactly this view.

**Proof:** the living file requires a source record for every fact — the same
verification stack as use case 1; `test_signatory_only_from_mandate` shows
people data only entering from recorded mandates.

## 7 · New RM onboarding — follows from 1

The portfolio brief is the same per-group client file; the 7/30/90-day plan
generator is deferred to the pilot (proposal §05). Nothing extra to build for
the prototype.

## 8 · Daily triage and alerts — prepare the routine, escalate the material

**Demo:** Board → alerts with *still open / resolved since* chips; triage an
inbound message → escalation with the matched overdue commitment.
**Video 0:00, 1:21.**

**Code:** `rca/agents/triggers.py::scan_expiries / scan_overdue` (idempotent),
`rca/services/triage.py`, the intake-triage panel on the Board.

```python
overdue = [c for c in commitments if c.due_date and c.due_date < t and c.state == "requested"]
if overdue:
    return {
        "issue_class": "commitment_follow_up", "action": "escalate",
        "route_to": "team_lead", "label": "escalate", "confidence": 0.88,
        "reasons": [f"Matches overdue commitment {c.id} ...", "Material client promise"],
        "matched_commitment": c.id,
    }
```

Alerts are append-only history joined with live state at read time, so two
screens can never disagree:

**Proof:** `test_triage_overdue_escalates`, `test_alert_status_resolves_when_fixed`,
`test_live_failure_mode_probes_pass`; golden triage checks.

---

## The claim → proof discipline

Every claim above is checkable without trusting this document:

- `make test` — 51 tests covering the domain (state machines, readiness,
  confidence), API flows, and the §10 failure modes.
- `make eval` — the golden set whose release gates render on the console's
  **Evals** screen (hermetic: no API key needed).
- The Evals screen's **live checks** drive the same service paths a user
  triggers, against whatever model route is configured — including
  "skipped" honesty when a probe cannot run.
