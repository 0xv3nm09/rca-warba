import { useState } from "react";

const STEPS = [
  {
    k: "Situation",
    t: "A relationship manager is leaving",
    d: "Omar is handing his corporate client, Gulf Horizon Contracting, to Sara. A guarantee is about to expire, a price was discussed but never approved, and a complaint is open.",
  },
  {
    k: "What the tool does",
    t: "It assembles the whole story from the bank's systems",
    d: "CRM, core banking, the document archive, email and notes — every fact linked to its source, conflicts flagged, nothing invented.",
  },
  {
    k: "The guarantee",
    t: "The handover can't finish until it's safe",
    d: "A discussion never becomes an approval. Every promise must have an owner and a date before the transfer can close.",
  },
];

export function Intro({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  const s = STEPS[i];
  return (
    <div className="intro-backdrop" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="intro">
        <div className="intro-kicker">{s.k}</div>
        <h2>{s.t}</h2>
        <p>{s.d}</p>
        <div className="intro-dots">
          {STEPS.map((_, n) => (
            <span key={n} className={n === i ? "on" : ""} />
          ))}
        </div>
        <div className="intro-actions">
          <button className="ghost" onClick={onDone}>
            Skip
          </button>
          <button className="primary" onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
