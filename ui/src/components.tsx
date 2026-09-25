import type { Evidence, Fact } from "./api";

const CHIP_TXT: Record<string, string> = {
  verified: "Verified",
  needs_review: "Needs review",
  conflict: "Conflict",
  not_in_records: "Not in records",
  escalate: "Escalate",
};

// Guide §26.3: bilingual chips (EN / AR)
const CHIP_TXT_AR: Record<string, string> = {
  verified: "موثّق",
  needs_review: "يحتاج مراجعة",
  conflict: "تعارض",
  not_in_records: "غير موجود في السجلات",
  escalate: "تم التصعيد",
};

export function LabelChip({ label, reasons, ar }: { label: string; reasons?: string[]; ar?: boolean }) {
  const txt = ar ? CHIP_TXT_AR[label] || label : CHIP_TXT[label] || label;
  return (
    <span className={`chip ${label}`} title={(reasons || []).join("\n")} dir={ar ? "rtl" : undefined}>
      {txt}
    </span>
  );
}

/** Guide §26: labels, not decimals — High / Medium / Low bands with reason on hover. */
export function ConfidenceBand({ confidence, reasons }: { confidence: number; reasons?: string[] }) {
  const band = confidence >= 0.85 ? "high" : confidence >= 0.6 ? "medium" : "low";
  const label = band === "high" ? "High" : band === "medium" ? "Medium" : "Low";
  const tip = reasons && reasons.length ? reasons.join(" · ") : `confidence ${confidence.toFixed(2)}`;
  return (
    <span
      className={`band ${band}`}
      tabIndex={0}
      data-tip={tip}
      aria-label={`Confidence ${label}. ${tip}`}
    >
      {label} · {(confidence * 100).toFixed(0)}%
    </span>
  );
}

export function Citation({ ev, n, onOpen }: { ev: Evidence; n: number; onOpen: (e: Evidence) => void }) {
  return (
    <button
      className="cite"
      title={`${ev.source_system} · ${ev.record_id} · ${ev.as_of}`}
      onClick={() => onOpen(ev)}
      aria-label={`Open source ${ev.record_id}`}
    >
      {n}
    </button>
  );
}

export function SourceDrawer({ ev, onClose }: { ev: Evidence | null; onClose: () => void }) {
  if (!ev) return null;
  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Source record"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      tabIndex={-1}
    >
      <div className="drawer" onClick={(e) => e.stopPropagation()} dir={ev.lang === "ar" ? "rtl" : "ltr"}>
        <div className="drawer-head">
          <strong>Source record</strong>
          <span className="meta">
            {ev.source_system} · {ev.record_id} · v{ev.record_version} · {ev.as_of} · {ev.lang.toUpperCase()}
          </span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <Highlighted ev={ev} />
        <p className="meta">Quoted span ({ev.span_start}–{ev.span_end}) shown above, exactly as recorded.</p>
      </div>
    </div>
  );
}

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtKwd(v: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  return "KWD " + n.toLocaleString("en-KW", { maximumFractionDigits: 0 });
}

/** Walkthrough screen: Conflict view — both values side by side with dates and
 * systems, and "Assign to owner" wired to the transfer exception. */
export function ConflictCard({
  fact,
  ar,
  canAssign,
  linked,
  onAssign,
  onOpenSource,
}: {
  fact: Fact;
  ar?: boolean;
  canAssign: boolean;
  linked: { handover_id: string | null; item_id: string | null } | null;
  onAssign: () => void;
  onOpenSource: (e: Evidence) => void;
}) {
  return (
    <li className="conflict-card">
      <div className="fact-row">
        <p dir="auto">
          <strong>{ar ? "تعارض: " : "Conflict: "}</strong>
          {fact.text}
        </p>
        <div className="fact-side">
          <LabelChip label={fact.label} reasons={fact.reasons} ar={ar} />
        </div>
      </div>
      <div className="conflict-grid">
        {fact.evidence.map((e, i) => (
          <button key={i} className="conflict-side" onClick={() => onOpenSource(e)} dir="auto">
            <span className={`chip ${i === 0 ? "verified" : "review"}`}>{e.source_system}</span>
            <span className="meta">{e.as_of} · {e.lang.toUpperCase()}</span>
            <p>{e.quote}</p>
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="meta">{fact.reasons.join(" · ")}</p>
        {canAssign && linked?.item_id ? (
          <button className="primary" onClick={onAssign}>
            {ar ? "تعيين المسؤول" : "Assign to owner"}
          </button>
        ) : (
          canAssign && <span className="meta">{ar ? "لا يوجد تحويل مفتوح" : "No open transfer for this group"}</span>
        )}
      </div>
    </li>
  );
}


/** U2: mark the exact quoted span so the eye lands on the recorded words. */
function Highlighted({ ev }: { ev: Evidence }) {
  return (
    <p className="source-text" dir={ev.lang === "ar" ? "rtl" : "ltr"}>
      <mark className="span">{ev.quote}</mark>
    </p>
  );
}

/** U5: skeletons — content is coming, not broken. */
export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <ul className="facts" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="sk-row">
          <span className="sk sk-line" style={{ width: `${55 + (i % 3) * 12}%` }} />
          <span className="sk sk-chip" />
        </li>
      ))}
    </ul>
  );
}

export function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div className="cards" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card">
          <span className="sk sk-line" style={{ width: "40%" }} />
          <span className="sk sk-block" />
        </div>
      ))}
    </div>
  );
}

/** U12: stacked toasts, self-dismissing. */
export function Toasts({
  items,
  dismiss,
}: {
  items: { id: number; text: string; kind: string }[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="toasts" role="region" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
