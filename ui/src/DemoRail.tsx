const BEATS = [
  { go: "board", label: "1 · A banker is leaving — see the blocked transfer" },
  { go: "file", label: "2 · The whole client story, assembled for you" },
  { go: "cite", label: "3 · Click a citation — trace it to the Arabic note" },
  { go: "conflict", label: "4 · Two systems disagree — we caught it" },
  { go: "ask", label: "5 · Ask: is the price approved? → not in records" },
  { go: "file:ALS-014", label: "6 · An email tries to hijack the tool — ignored" },
  { go: "handover", label: "7 · Answer, accept, and close — blocked until safe" },
  { go: "agents", label: "8 · Work prepared automatically overnight" },
];

export function DemoRail({ onGo }: { onGo: (target: string) => void }) {
  return (
    <div className="demo-rail">
      <div className="demo-title">Guided demo</div>
      {BEATS.map((b, i) => (
        <button key={i} onClick={() => onGo(b.go)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
