"""Event-driven agent triggers. Every trigger is deterministic code that
produces a draft (brief, alert, question); people act on it. Jobs are
idempotent: running twice never duplicates a brief or an alert."""

import re
from datetime import date, timedelta

import structlog
from sqlalchemy import select

from rca.adapters.dummy import DummyLeaveCalendar
from rca.db.models import AgentDocRow, AlertRow, CommitmentRow, FactRow
from rca.domain.ids import new_id
from rca.security.policy import COVERAGE

log = structlog.get_logger()


async def on_leave_booked(db, leave: dict) -> AgentDocRow:
    """Cover brief, drafted before anyone asks (use case 2)."""
    doc_id = f"cover_brief:{leave['rm']}:{leave['start']}"
    existing = await db.get(AgentDocRow, doc_id)
    if existing:
        return existing

    from rca.services.handover import today

    rm, cover = leave["rm"], leave["cover"]
    start, end = date.fromisoformat(leave["start"]), date.fromisoformat(leave["end"])
    groups = sorted(COVERAGE.get(rm, set()))

    due_rows, do_not_say = [], []
    for g in groups:
        facts = list((await db.execute(select(FactRow).where(FactRow.group_id == g))).scalars())
        comms = list((await db.execute(select(CommitmentRow).where(CommitmentRow.group_id == g))).scalars())
        for f in facts:
            if (
                f.kind == "facility"
                and f.due_date
                and start - timedelta(days=7) <= f.due_date <= end + timedelta(days=7)
            ):
                due_rows.append({"item": f"{f.text}", "owner": cover, "label": f.label})
            # Do-not-say: an unapproved pricing request must never be repeated as
            # approved in the covering RM's ear (failure point F3).
            if f.kind == "decision" and re.search(r"pricing|تسعير", f.text, re.I) and re.search(
                r"not|pending|awaiting|yet|لم تتم", f.text, re.I
            ):
                fid = next(iter(re.findall(r"G-\d+", f.text)), None)
                if not fid:
                    fac = next(
                        (x for x in facts if x.kind == "facility" and re.findall(r"G-\d+", x.text)),
                        None,
                    )
                    fid = next(iter(re.findall(r"G-\d+", fac.text)), "the facility") if fac else "the facility"
                msg = f"Pricing for {fid} is approved (no approval recorded)"
                if msg not in do_not_say:
                    do_not_say.append(msg)
        for c in comms:
            if c.due_date and c.due_date <= end:
                overdue = c.due_date < today()
                due_rows.append(
                    {
                        "item": f"{c.description} (due {c.due_date.isoformat()}"
                        + (f", overdue {(today() - c.due_date).days} days)" if overdue else ")"),
                        "owner": f"{rm} -> {cover}" if c.owner == rm else (c.owner or "unassigned"),
                        "label": "escalate" if overdue else "verified",
                    }
                )
            if "pricing" in c.description.lower() and c.state != "approved":
                fid = next(iter(re.findall(r"G-\d+", c.description)), "the facility")
                msg = f"Pricing for {fid} is approved (no approval recorded)"
                if msg not in do_not_say:
                    do_not_say.append(msg)

    doc = AgentDocRow(
        id=doc_id,
        kind="cover_brief",
        group_id=None,
        for_user=cover,
        payload={
            "covering": rm,
            "from": leave["start"],
            "to": leave["end"],
            "groups": groups,
            "due_during_cover": due_rows,
            "do_not_say": do_not_say,
        },
    )
    db.add(doc)
    await db.commit()
    log.info("cover_brief_ready", for_user=cover, covering=rm)
    return doc


async def on_leave_ended(db, leave: dict) -> AgentDocRow:
    """Return summary: what changed while away."""
    doc_id = f"return_summary:{leave['rm']}:{leave['end']}"
    existing = await db.get(AgentDocRow, doc_id)
    if existing:
        return existing
    start = date.fromisoformat(leave["start"])
    changes = []
    for g in sorted(COVERAGE.get(leave["rm"], set())):
        facts = list((await db.execute(select(FactRow).where(FactRow.group_id == g))).scalars())
        for f in facts:
            if f.created_at and f.created_at.date() >= start:
                changes.append({"group": g, "text": f.text, "label": f.label})
    doc = AgentDocRow(
        id=doc_id,
        kind="return_summary",
        group_id=None,
        for_user=leave["rm"],
        payload={"away_from": leave["start"], "away_to": leave["end"], "changes": changes},
    )
    db.add(doc)
    await db.commit()
    return doc


async def _raise_once(
    db, *, kind: str, key: str, text: str, to_role: str, group_id: str | None
) -> AlertRow | None:
    existing = await db.execute(select(AlertRow).where(AlertRow.raised_once_key == key))
    if existing.scalar_one_or_none():
        return None
    a = AlertRow(
        id=new_id("alr"), kind=kind, group_id=group_id, text=text, to_role=to_role, raised_once_key=key
    )
    db.add(a)
    return a


async def scan_expiries(db, today: date) -> int:
    """Facilities expiring within 30 days whose entity has no owned open commitment."""
    facts = list((await db.execute(select(FactRow).where(FactRow.kind == "facility"))).scalars())
    comms = list((await db.execute(select(CommitmentRow))).scalars())
    n = 0
    for f in facts:
        if not f.due_date or f.due_date > today + timedelta(days=30):
            continue
        owned = any(
            c.entity_id == f.entity_id and c.owner and c.state not in {"closed", "withdrawn"} for c in comms
        )
        if owned:
            continue
        fid = next(iter(re.findall(r"G-\d+", f.text)), f.text)
        amount = f"{float(f.amount_kwd):,.0f}" if f.amount_kwd else ""
        alert = await _raise_once(
            db,
            kind="expiry_no_owner",
            key=f"expiry_no_owner:{fid}",
            group_id=f.group_id,
            to_role="team_lead",
            text=f"Guarantee {fid} (KWD {amount}) expires {f.due_date.isoformat()}; no owned open commitment",
        )
        n += 1 if alert else 0
    await db.commit()
    return n


async def scan_overdue(db, today: date) -> int:
    comms = list(
        (await db.execute(select(CommitmentRow).where(CommitmentRow.state == "requested"))).scalars()
    )
    n = 0
    for c in comms:
        if c.due_date and c.due_date < today:
            alert = await _raise_once(
                db,
                kind="promise_overdue",
                key=f"overdue:{c.id}",
                group_id=c.group_id,
                to_role="team_lead",
                text=f"Promise overdue {(today - c.due_date).days} days: {c.description} "
                f"(due {c.due_date.isoformat()}, owner {c.owner or 'unassigned'})",
            )
            n += 1 if alert else 0
    await db.commit()
    return n


async def process_leave_events(db) -> list[str]:
    """Wire the (dummy) HR calendar to the triggers."""
    cal = DummyLeaveCalendar()
    ids = []
    for leave in await cal.all_rows():
        ids.append((await on_leave_booked(db, leave)).id)
    return ids
