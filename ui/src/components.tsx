import type { Evidence } from "./api";

export function LabelChip({ label, reasons }: { label: string; reasons?: string[] }) {
  const cls: Record<string, string> = {
    verified: "chip verified",
    needs_review: "chip review",
    conflict: "chip conflict",
    not_in_records: "chip absent",
    escalate: "chip escalate",
  };
  const txt: Record<string, string> = {
    verified: "✓ Verified",
    needs_review: "◐ Needs review",
    conflict: "⇄ Conflict",
    not_in_records: "◌ Not in records",
    escalate: "↑ Escalate",
  };
  return (
    <span className={cls[label] || "chip"} title={(reasons || []).join("\n")}>
      {txt[label] || label}
    </span>
  );
}

export function Citation({
  ev,
  n,
  onOpen,
}: {
  ev: Evidence;
  n: number;
  onOpen: (e: Evidence) => void;
}) {
  return (
    <button className="cite" title={`${ev.source_system} · ${ev.record_id} · ${ev.as_of}`} onClick={() => onOpen(ev)}>
      [{n}]
    </button>
  );
}

export function SourceDrawer({ ev, onClose }: { ev: Evidence | null; onClose: () => void }) {
  if (!ev) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} dir={ev.lang === "ar" ? "rtl" : "ltr"}>
        <div className="drawer-head">
          <strong>Source</strong>
          <span className="meta">
            {ev.source_system} · {ev.record_id} · v{ev.record_version} · {ev.as_of} · {ev.lang.toUpperCase()}
          </span>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="source-text">{ev.quote}</p>
        <p className="meta">Quoted span ({ev.span_start}–{ev.span_end}) shown above.</p>
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
