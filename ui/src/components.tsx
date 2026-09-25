import type { Evidence } from "./api";

const CHIP_TXT: Record<string, string> = {
  verified: "Verified",
  needs_review: "Needs review",
  conflict: "Conflict",
  not_in_records: "Not in records",
  escalate: "Escalate",
};

export function LabelChip({ label, reasons }: { label: string; reasons?: string[] }) {
  return (
    <span className={`chip ${label}`} title={(reasons || []).join("\n")}>
      {CHIP_TXT[label] || label}
    </span>
  );
}

/** Guide §26: labels, not decimals — High / Medium / Low bands with reason on hover. */
export function ConfidenceBand({ confidence }: { confidence: number }) {
  const band = confidence >= 0.9 ? "high" : confidence >= 0.75 ? "medium" : "low";
  return (
    <span className={`band ${band}`} title={`Computed confidence ${confidence.toFixed(2)}`}>
      {band === "high" ? "High confidence" : band === "medium" ? "Medium confidence" : "Low confidence"}
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
    <div className="drawer-backdrop" onClick={onClose}>
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
        <p className="source-text">{ev.quote}</p>
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
