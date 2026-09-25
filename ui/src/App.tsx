import { useCallback, useEffect, useRef, useState } from "react";
import {
  allowedGroups,
  api,
  clearAuth,
  currentUser,
  currentGroup,
  setAuth,
  type AskResult,
  type BoardItem,
  type ClientFile,
  type Evidence,
  type HandoverDetail,
} from "./api";
import {
  Citation,
  ConflictCard,
  ConfidenceBand,
  fmtDate,
  fmtKwd,
  LabelChip,
  SkeletonCards,
  SkeletonRows,
  SourceDrawer,
  Toasts,
} from "./components";
import { DemoRail } from "./DemoRail";
import { Intro } from "./Intro";

type View = "board" | "file" | "handover" | "agents" | "evals";

/** U9: gentle polling that pauses when the tab is hidden. */
function usePolling(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let id: number;
    const tick = () => {
      if (!document.hidden) fn();
      id = window.setTimeout(tick, ms);
    };
    id = window.setTimeout(tick, ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, ms, active]);
}

function Ago({ ts }: { ts: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return <span className="meta">updated {sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`} ago</span>;
}

/** U3: failure-point codes from the proposal (F1–F7). */
function fcodeFor(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("owner") && r.includes("expiry")) return "F1";
  if (r.includes("conflict")) return "F4";
  if (r.includes("accept")) return "F2";
  if (r.includes("owner")) return "F1";
  return "•";
}

function scrollToItem(itemId: string) {
  const el = document.getElementById(`item-${itemId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1400);
  }
}

const DEMO_USERS = [
  { id: "sara.rm", label: "Sara — incoming RM", role: "RM · GHC-001", group: "GHC-001" },
  { id: "omar.rm", label: "Omar — outgoing RM", role: "RM · GHC-001", group: "GHC-001" },
  { id: "lead.one", label: "Team lead", role: "Lead · all groups", group: null },
];

export default function App() {
  const [view, setView] = useState<View>("board");
  const [group, setGroup] = useState<string>(currentGroup || "GHC-001");
  const [file, setFile] = useState<ClientFile | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [handover, setHandover] = useState<HandoverDetail | null>(null);
  const [drawer, setDrawer] = useState<Evidence | null>(null);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [question, setQuestion] = useState("");
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const toastId = useRef(0);
  const showToast = useCallback((text: string, kind = "error") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const showError = useCallback((text: string) => showToast(text, "error"), [showToast]);
  const [intro, setIntro] = useState(!localStorage.getItem("rca_intro_done"));
  const [boardLoading, setBoardLoading] = useState(true);
  const [lastSync, setLastSync] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const askAbort = useRef<AbortController | null>(null);

  const loadBoard = useCallback(async () => {
    try {
      const d = await api.board();
      setBoard(d.transfers);
      setLastSync(Date.now());
    } catch (e: any) {
      showError(e?.error?.message || "failed to load board");
    } finally {
      setBoardLoading(false);
    }
  }, [showError]);

  const loadFile = useCallback(
    async (g: string) => {
      try {
        setFile(await api.file(g));
        setLastSync(Date.now());
      } catch (e: any) {
        showError(e?.error?.message || "failed to load file");
      }
    },
    [showError]
  );

  const loadHandover = useCallback(
    async (id: string) => {
      try {
        setHandover(await api.handover(id));
      } catch (e: any) {
        showError(e?.error?.message || "failed to load handover");
      }
    },
    [showError]
  );

  // U8: cancel a stale Ask when a new one starts or the view changes.
  const runAsk = useCallback(
    async (groupId: string, q: string) => {
      askAbort.current?.abort();
      const ac = new AbortController();
      askAbort.current = ac;
      setBusy(true);
      setAsk(null);
      try {
        setAsk(await api.ask(groupId, q, ac.signal));
      } catch (e: any) {
        if (e?.name !== "AbortError") showError(e?.error?.message || "ask failed");
      } finally {
        if (askAbort.current === ac) setBusy(false);
      }
    },
    [showError]
  );
  useEffect(() => () => askAbort.current?.abort(), []);

  usePolling(loadBoard, 15000, view === "board");

  useEffect(() => {
    if (!currentUser) return;
    if (view === "board") loadBoard();
    if (view === "file") loadFile(group);
    if (view === "handover" && handover) loadHandover(handover.handover_id);
  }, [view, group, loadBoard, loadFile, loadHandover, handover]);

  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  useEffect(() => {
    document.body.classList.toggle("demo-mode", isDemo);
    return () => document.body.classList.remove("demo-mode");
  }, [isDemo]);

  // N5 + demo beats: navigate programmatically from the rail / nudges.
  const goTo = useCallback(
    (target: string) => {
      const [v, g] = target.split(":");
      if (v === "file" && g) {
        setGroup(g);
        setView("file");
        loadFile(g);
        return;
      }
      if (v === "cite" || v === "conflict" || v === "ask") {
        // beats 3-5 land on the GHC file; the reviewer performs the interaction
        setView("file");
        if (!file) loadFile(group);
        return;
      }
      if (v === "handover") {
        if (handover) {
          setView("handover");
          loadHandover(handover.handover_id);
        } else {
          api.board().then((d) => {
            const t0 = d.transfers[0];
            if (t0) {
              setView("handover");
              loadHandover(t0.handover_id);
            }
          });
        }
        return;
      }
      setView(v as View);
    },
    [file, group, handover, loadFile, loadHandover]
  );

  if (intro) {
    return (
      <Intro
        onDone={() => {
          localStorage.setItem("rca_intro_done", "1");
          setIntro(false);
        }}
      />
    );
  }

  if (!currentUser) {
    return (
      <>
        <Login />
        {isDemo && <DemoRail onGo={goTo} />}
      </>
    );
  }

  const initials = currentUser.split(".")[0].charAt(0).toUpperCase() + currentUser.split(".")[1]?.charAt(0).toUpperCase();

  return (
    <div className="app">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header>
        <div className="brand">
          <span className="mark">R</span>
          <span>
            RCA <span className="sub">· Relationship Continuity Assistant</span>
          </span>
        </div>
        <nav>
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
            Readiness board
          </button>
          <button className={view === "file" ? "on" : ""} onClick={() => setView("file")}>
            Client file
          </button>
          <button className={view === "agents" ? "on" : ""} onClick={() => setView("agents")}>
            Agents
          </button>
          <button className={view === "evals" ? "on" : ""} onClick={() => setView("evals")}>
            Evals
          </button>
        </nav>
        <div className="who">
          <span className="avatar">{initials}</span>
          <span>
            {currentUser} · {currentGroup || "all groups"}
          </span>
          <button
            className="ghost"
            onClick={() => {
              clearAuth();
              location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="synthetic-ribbon">Demo · all data synthetic · جميع البيانات تجريبية</div>
      <ContextStrip view={view} file={file} board={board} />

      <main id="main">
        {view === "board" && (
          <Board
            board={board}
            loading={boardLoading}
            lastSync={lastSync}
            onOpen={(id) => {
              setHandover(null);
              setView("handover");
              loadHandover(id);
            }}
            onReload={loadBoard}
          />
        )}
        {view === "file" && file && (
          <FileView
            file={file}
            ask={ask}
            question={question}
            setQuestion={setQuestion}
            busy={busy}
            onAsk={() => runAsk(file.group_id, question)}
            onOpenSource={setDrawer}
            onGroup={setGroup}
            onError={showError}
            notify={(t) => showToast(t, "ok")}
            reloadFile={() => loadFile(group)}
            onOpenAgents={() => setView("agents")}
            onOpenHandover={(id) => {
              setView("handover");
              loadHandover(id);
            }}
          />
        )}
        {view === "handover" && (
          <HandoverView handover={handover} onReload={() => handover && loadHandover(handover.handover_id)} onError={showError} />
        )}
        {view === "agents" && (
          <AgentsView
            onOpenGroup={(g) => {
              setGroup(g);
              setView("file");
              loadFile(g);
            }}
          />
        )}
        {view === "evals" && <EvalsView />}
      </main>

      {isDemo && <DemoRail onGo={goTo} />}
      <SourceDrawer ev={drawer} onClose={() => setDrawer(null)} />
      <Toasts items={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

function ContextStrip({ view, file, board }: { view: string; file: ClientFile | null; board: BoardItem[] }) {
  const blocked = board.filter((t) => t.status !== "closed" && t.blocking_count > 0).length;
  const msg: Record<string, string> = {
    board: blocked
      ? `${blocked} transfer(s) can't safely close yet — open one to see what's blocking it.`
      : "Every transfer in progress. Open one to review or close it.",
    file: file
      ? `This file was assembled from the bank's systems — ${file.open_conflicts} conflict(s) found. Every fact links to its source; ask it anything below.`
      : "Loading the client file…",
    handover:
      "Three steps: answer the gap questions, accept the duties, then close — only when nothing critical is unowned.",
    agents: "Work the assistant prepared on its own. A person always acts on it.",
    evals: "Automated safety checks on synthetic data. Green means the guarantees held.",
  };
  return (
    <div className="context-strip">
      <span className="dot" />
      {msg[view] || ""}
    </div>
  );
}

function Login() {
  const [err, setErr] = useState("");
  return (
    <div className="login-wrap">
      <div className="login">
        <div className="logo">R</div>
        <h1>RCA Console</h1>
        <p className="meta" style={{ marginBottom: 22 }}>
          Warba Track 2 prototype · synthetic data · local profile
        </p>
        {DEMO_USERS.map((u) => (
          <button
            key={u.id}
            className="login-btn"
            onClick={async () => {
              try {
                const d = await api.login(u.id, u.group);
                setAuth(d.session_token, u.id, u.group, d.allowed_groups);
                location.reload();
              } catch {
                setErr("Login failed");
              }
            }}
          >
            {u.label} <span className="r">{u.role}</span>
          </button>
        ))}
        {err && <p className="banner error">{err}</p>}
        <p className="meta" style={{ marginTop: 14 }}>
          Judges & demo: append <code>?demo=1</code> to the URL for the guided 8-beat path.
        </p>
      </div>
    </div>
  );
}

function Board({
  board,
  loading,
  lastSync,
  onOpen,
  onReload,
}: {
  board: BoardItem[];
  loading: boolean;
  lastSync: number;
  onOpen: (id: string) => void;
  onReload: () => void;
}) {
  const [alerts, setAlerts] = useState<{ alert_id: string; kind: string; text: string; group_id: string | null; status: string }[]>([]);
  useEffect(() => {
    api.alerts().then((d) => setAlerts(d.alerts)).catch(() => {});
  }, []);
  const blocked = board.filter((t) => t.status !== "closed" && t.blocking_count > 0).length;
  const reasons = board.reduce((n, t) => n + t.blocking_count, 0);

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Readiness board</h2>
          <p className="lead">
            A banker is leaving; their clients must move without anything falling through the
            cracks. This board shows every transfer and exactly what's stopping each one from
            closing safely.
          </p>
        </div>
        <div className="row">
          <Ago ts={lastSync} />
          <button className="ghost" onClick={onReload}>
            Refresh
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="n">{board.length}</span>
          <span className="l">transfers in flight</span>
        </div>
        <div className="stat">
          <span className="n warn">{blocked}</span>
          <span className="l">blocked</span>
        </div>
        <div className="stat">
          <span className="n">{reasons}</span>
          <span className="l">blocking reasons</span>
        </div>
        <div className="stat">
          <span className="n warn">{alerts.length}</span>
          <span className="l">agent alerts</span>
        </div>
      </div>

      <div className="board-grid">
        <div className="cards">
          {loading && <SkeletonCards n={3} />}
          {!loading && board.length === 0 && (
            <p className="meta">No transfers. Start one via the API, or re-seed.</p>
          )}
          {board.map((t) => (
            <div key={t.handover_id} className="card">
              <div className="status-line">
                <span className="gid">{t.group_id}</span>
                <span className={`pill ${t.status}`}>{t.status}</span>
              </div>
              <p className="meta">
                {t.from_rm} → {t.to_rm} · effective {fmtDate(t.effective_date)} · {t.kind}
              </p>
              {t.blocking_count > 0 ? (
                <ul className="blockers">
                  {t.blocking.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p className="ok-text">✓ Ready to close</p>
              )}
              {yourPart(currentUser, t) && <p className="your-part">Your part: {yourPart(currentUser, t)}</p>}
              <div className="foot">
                <span className="meta">
                  {t.open_items} open · next due {fmtDate(t.next_due)}
                </span>
                <button onClick={() => onOpen(t.handover_id)}>Open transfer</button>
              </div>
            </div>
          ))}
        </div>

        {alerts.length > 0 && (
          <aside className="alerts">
            <h3 style={{ marginTop: 0 }}>Agent alerts</h3>
            {alerts.map((a) => (
              <div key={a.alert_id} className="alert-item">
                <div className="row">
                  <span className="chip escalate">{a.kind.replace(/_/g, " ")}</span>
                  <span className={`chip ${a.status === "resolved" ? "verified" : "conflict"}`}>
                    {a.status}
                  </span>
                </div>
                <p>{a.text}</p>
                <span className="meta">
                  raised automatically · routed to {a.group_id ? `${a.group_id} team lead` : "team lead"}
                </span>
              </div>
            ))}
            <p className="meta" style={{ marginTop: 10 }}>
              Nightly scans run in the worker; duplicate alerts are suppressed by key.
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}

function FileView({
  file,
  ask,
  question,
  setQuestion,
  busy,
  onAsk,
  onOpenSource,
  onGroup,
  onError,
  notify,
  reloadFile,
  onOpenHandover,
  onOpenAgents,
}: {
  file: ClientFile;
  ask: AskResult | null;
  question: string;
  setQuestion: (s: string) => void;
  busy: boolean;
  onAsk: () => void;
  onOpenSource: (e: Evidence) => void;
  onGroup: (g: string) => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
  reloadFile: () => void;
  onOpenHandover: (id: string) => void;
  onOpenAgents: () => void;
}) {
  const [tab, setTab] = useState<"brief" | "timeline" | "commitments" | "people" | "sources">("brief");
  const [ar, setAr] = useState(false);
  const [link, setLink] = useState<{ handover_id: string | null; items: { item_id: string; kind: string; ref_id: string | null; status: string }[] }>({ handover_id: null, items: [] });
  const [refOpen, setRefOpen] = useState(false);
  const [refQuestion, setRefQuestion] = useState("");
  const [refRole, setRefRole] = useState("trade_specialist");
  const [refDone, setRefDone] = useState(false);
  const groups = allowedGroups();
  const canAssign = currentUser === "lead.one";

  const loadLink = useCallback(() => {
    api.handoverLink(file.group_id).then(setLink).catch(() => {});
  }, [file.group_id]);
  useEffect(() => {
    loadLink();
  }, [loadLink]);

  const conflicts = file.facts.filter((f) => f.label === "conflict");
  const dayMs = 86400000;
  const daysUntil = (d?: string | null) =>
    d ? Math.round((new Date(d + "T00:00:00").getTime() - new Date(file.as_of + "T00:00:00").getTime()) / dayMs) : null;

  // Banking 360 triage numbers: exposure, next deadline, decisions, documents.
  const facilities = file.facts.filter((f) => f.kind === "facility");
  const exposure = facilities.reduce((sum, f) => sum + parseFloat(f.amount_kwd || "0"), 0);
  const unowned = file.commitments.filter(
    (c) => !c.owner && !["closed", "withdrawn"].includes(c.state)
  );
  const docsValid = file.facts.filter(
    (f) => f.kind === "document" && f.due_date && f.due_date >= file.as_of
  );
  const attention = conflicts.length + unowned.length;

  const facilityDeadlines = facilities.map((f) => f.due_date).filter(Boolean) as string[];
  const commitmentDeadlines = file.commitments.map((c) => c.due_date).filter(Boolean) as string[];
  const allDeadlines = [...facilityDeadlines, ...commitmentDeadlines].sort();
  const deadline = allDeadlines.find((d) => d >= file.as_of) || allDeadlines[0] || null;
  const deadlineDays = daysUntil(deadline);
  const deadlineIsFacility = deadline !== null && facilityDeadlines.includes(deadline);
  const deadlineFact = facilities.find((f) => f.due_date === deadline);

  // Brief sections: triage order a corporate banker reads in.
  const nonConflict = file.facts.filter((f) => f.label !== "conflict" && f.kind !== "contact");
  const promiseFacts = nonConflict.filter((f) => f.kind === "commitment" || f.kind === "event");
  const decisionFacts = nonConflict.filter((f) => f.kind === "decision");
  const docFacts = nonConflict.filter((f) => f.kind === "document");

  const assignConflict = async (factId: string) => {
    const item = link.items.find((i) => i.kind === "conflict" && i.ref_id === factId);
    if (!item || !link.handover_id) return;
    try {
      await api.assign(link.handover_id, item.item_id, "sara.rm", "2026-09-26");
      loadLink();
      reloadFile();
    } catch (e: any) {
      onError(e?.error?.message || "assign failed");
    }
  };

  // Timeline: dated events derived from facts and commitments (walkthrough tab 2).
  const timeline = [
    ...file.facts.map((f) => ({
      date: (f.evidence.length ? f.evidence.map((e) => e.as_of).sort().slice(-1)[0] : f.due_date) || "",
      text: f.text,
      kind: f.kind,
      label: f.label,
      ar,
    })),
    ...file.commitments.map((c) => ({
      date: c.due_date || "",
      text: c.description,
      kind: "commitment",
      label: c.owner ? "verified" : "conflict",
      ar,
    })),
  ]
    .filter((e) => e.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 24);

  const T = (en: string, arb: string) => (ar ? arb : en);
  const TABS = [
    { id: "brief", label: T("Relationship brief", "الملف") },
    { id: "timeline", label: T("Timeline", "السجل الزمني") },
    { id: "commitments", label: T("Commitments", "الالتزامات") },
    { id: "people", label: T("People", "الأشخاص") },
    { id: "sources", label: T("Sources", "المصادر") },
  ] as const;

  return (
    <section dir={ar ? "rtl" : "ltr"}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>{file.group_name || file.group_id}</h2>
          <p className="lead">
            {T(
              "Every fact links to its source. Nothing is marked approved without a record.",
              "كل معلومة مرتبطة بمصدرها. لا شيء يُعتبر معتمداً دون سجل."
            )}
          </p>
          <p className="meta">
            {file.group_id} · {T("as of", "ب تاريخ")} {fmtDate(file.as_of)} ·{" "}
            {file.open_conflicts} {T("open conflict(s)", "تعارض مفتوح")}
          </p>
        </div>
        <div className="row">
          <div className="lang-toggle">
            <button className={!ar ? "on" : ""} onClick={() => setAr(false)}>EN</button>
            <button className={ar ? "on" : ""} onClick={() => setAr(true)}>AR</button>
          </div>
          <select value={file.group_id} onChange={(e) => onGroup(e.target.value)} aria-label="Client group">
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="glance">
        <div className="gcard">
          <span className="g-num">{exposure > 0 ? fmtKwd(String(exposure)) : "—"}</span>
          <span className="g-label">{T("Facilities exposure", "إجمالي التسهيلات")}</span>
        </div>
        <div className={`gcard ${deadlineDays !== null && deadlineDays <= 30 ? "urgent" : ""}`}>
          <span className="g-num">{deadline ? fmtDate(deadline) : "—"}</span>
          <span className="g-label">
            {T("Next deadline", "الموعد القادم")}
            {deadlineDays !== null && ` · ${deadlineDays}d`}
            {deadlineFact && deadlineDays !== null && deadlineDays <= 30 && (
              <em> · {deadlineIsFacility ? T("facility expiry", "انتهاء تسهيل") : T("promise due", "استحقاق وعد")}</em>
            )}
          </span>
        </div>
        <div className={`gcard ${attention > 0 ? "urgent" : ""}`}>
          <span className="g-num">{attention}</span>
          <span className="g-label">{T("Items need a decision", "بنود تحتاج قراراً")}</span>
        </div>
        <div className="gcard">
          <span className="g-num">{docsValid.length}</span>
          <span className="g-label">{T("Valid documents on file", "مستندات سارية")}</span>
        </div>
      </div>

      <div className="assembled-note">
        <span className="pull">{T("Assembled for you", "أُعدّ لك تلقائياً")}</span>
        {T(
          `Pulled together from CRM, core banking, the document archive, email and notes — ${file.facts.length} facts, ${file.open_conflicts} conflict(s), every line traceable to its source.`,
          `جُمع من أنظمة البنك — ${file.facts.length} معلومة، ${file.open_conflicts} تعارض، كل سطر مرتبط بمصدره.`
        )}
      </div>

      <div className="ask-panel">
        <input
          placeholder={T(
            "Ask the file… e.g. Can I tell the client the new price is approved?",
            "اسأل الملف… مثال: هل يمكنني إبلاغ العميل بأن السعر الجديد معتمد؟"
          )}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAsk()}
        />
        <button disabled={busy || question.length < 3} onClick={onAsk}>
          {busy ? "…" : T("Ask", "اسأل")}
        </button>
      </div>
      {ask && (
        <div className={`answer ${ask.label}`} role="status" aria-live="polite">
          <div className="answer-head">
            <LabelChip label={ask.label} reasons={ask.reasons} ar={ar} />
            <ConfidenceBand confidence={ask.confidence} reasons={ask.reasons} />
            {ask.label === "not_in_records" && (
              <span className="trust-flag">{T("Guarded answer", "إجابة محافِظة")}</span>
            )}
          </div>
          <p className="answer-text" dir="auto">
            {ask.answer}
          </p>
          {ask.citations.length > 0 && (
            <div className="answer-cites">
              <span className="meta">{T("Based on", "استناداً إلى")}:</span>
              {ask.citations.map((c, i) => (
                <Citation key={i} ev={c} n={i + 1} onOpen={onOpenSource} />
              ))}
            </div>
          )}
        </div>
      )}

      {link.handover_id && (
        <div className="next-nudge">
          Next:{" "}
          <button className="link" onClick={() => onOpenHandover(link.handover_id!)}>
            open the transfer for this client →
          </button>
        </div>
      )}

      <div className="ref-row">
        {!refOpen ? (
          <button className="ghost" onClick={() => setRefOpen(true)}>
            {T("Refer to a specialist", "إحالة إلى مختص")}
          </button>
        ) : (
          <div className="ref-form">
            <select value={refRole} onChange={(e) => setRefRole(e.target.value)} aria-label="Specialist role">
              <option value="trade_specialist">{T("Trade specialist", "مختص تجارة")}</option>
              <option value="credit_officer">{T("Credit officer", "مسؤول ائتمان")}</option>
            </select>
            <input
              placeholder={T(
                "What should the specialist confirm? e.g. documents required to renew G-2291",
                "ما الذي يجب أن يؤكده المختص؟"
              )}
              value={refQuestion}
              onChange={(e) => setRefQuestion(e.target.value)}
            />
            <button
              disabled={refQuestion.trim().length < 8}
              onClick={async () => {
                try {
                  await api.referral(file.group_id, refQuestion.trim(), refRole);
                  setRefOpen(false);
                  setRefDone(true);
                  setRefQuestion("");
                  notify(T("Referral pack assembled — the specialist has everything on file.", "تم إعداد حزمة الإحالة."));
                } catch (e: any) {
                  onError(e?.error?.message || "referral failed");
                }
              }}
            >
              {T("Assemble pack", "إعداد الحزمة")}
            </button>
            <button className="ghost" onClick={() => setRefOpen(false)}>
              {T("Cancel", "إلغاء")}
            </button>
          </div>
        )}
        {refDone && (
          <span className="next-nudge" style={{ margin: 0 }}>
            {T("Referral pack ready —", "الحزمة جاهزة —")}{" "}
            <button className="link" onClick={onOpenAgents}>
              {T("open it on the Agents screen →", "افتحها على شاشة الوكلاء ←")}
            </button>
          </span>
        )}
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "brief" && (
        <>
          {conflicts.length > 0 && (
            <div className="brief-section">
              <h4>
                {T("Needs a decision", "يحتاج قراراً")}
                <span className="count urgent">{conflicts.length}</span>
                <span className="meta sec-note">
                  {T("two systems disagree — shown, never hidden", "نظامان يختلفان — نعرضه لا نخفيه")}
                </span>
              </h4>
              <ul className="facts">
                {conflicts.map((f) => (
                  <ConflictCard
                    key={f.fact_id}
                    fact={f}
                    ar={ar}
                    canAssign={canAssign}
                    linked={{
                      handover_id: link.handover_id,
                      item_id:
                        link.items.find((i) => i.kind === "conflict" && i.ref_id === f.fact_id)?.item_id || null,
                    }}
                    onAssign={() => assignConflict(f.fact_id)}
                    onOpenSource={onOpenSource}
                  />
                ))}
              </ul>
            </div>
          )}

          <div className="brief-section">
            <h4>
              {T("Facilities & exposure", "التسهيلات والتعرض")}
              <span className="count">{facilities.length}</span>
            </h4>
            <ul className="facts">
              {facilities.map((f) => {
                const dd = daysUntil(f.due_date);
                return (
                  <li key={f.fact_id}>
                    <div className="fact-row">
                      <p dir="auto">
                        {f.text}
                        {f.amount_kwd && <strong> · {fmtKwd(f.amount_kwd)}</strong>}
                        {f.due_date && <span className="meta"> · {T("expires", "ينتهي")} {fmtDate(f.due_date)}</span>}
                      </p>
                      <div className="fact-side">
                        {dd !== null && dd <= 30 && (
                          <span className={`due-chip ${dd <= 14 ? "now" : "soon"}`}>
                            {dd < 0 ? T("expired", "منتهي") : T(`${dd}d to expiry`, `${dd} يوماً للانتهاء`)}
                          </span>
                        )}
                        <ConfidenceBand confidence={f.confidence} reasons={f.reasons} />
                        <LabelChip label={f.label} reasons={f.reasons} ar={ar} />
                        {f.evidence.map((e, i) => (
                          <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                        ))}
                      </div>
                    </div>
                    {f.reasons.length > 0 && <p className="meta reasons">{f.reasons.join(" · ")}</p>}
                  </li>
                );
              })}
              {facilities.length === 0 && <li className="meta">No facilities recorded.</li>}
            </ul>
          </div>

          <div className="brief-section">
            <h4>
              {T("Promises & requests", "الوعود والطلبات")}
              <span className="count">{promiseFacts.length}</span>
            </h4>
            <ul className="facts">
              {promiseFacts.map((f) => (
                <li key={f.fact_id}>
                  <div className="fact-row">
                    <p dir="auto">
                      {f.text}
                      {f.due_date && <span className="meta"> · {T("due", "يستحق")} {fmtDate(f.due_date)}</span>}
                    </p>
                    <div className="fact-side">
                      <ConfidenceBand confidence={f.confidence} reasons={f.reasons} />
                      <LabelChip label={f.label} reasons={f.reasons} ar={ar} />
                      {f.evidence.map((e, i) => (
                        <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                      ))}
                    </div>
                  </div>
                  {f.reasons.length > 0 && <p className="meta reasons">{f.reasons.join(" · ")}</p>}
                </li>
              ))}
              {promiseFacts.length === 0 && <li className="meta">Nothing promised or requested.</li>}
            </ul>
          </div>

          <div className="brief-section">
            <h4>
              {T("Context & decisions", "السياق والقرارات")}
              <span className="count">{decisionFacts.length}</span>
            </h4>
            <ul className="facts">
              {decisionFacts.map((f) => (
                <li key={f.fact_id}>
                  <div className="fact-row">
                    <p dir="auto">{f.text}</p>
                    <div className="fact-side">
                      <ConfidenceBand confidence={f.confidence} reasons={f.reasons} />
                      <LabelChip label={f.label} reasons={f.reasons} ar={ar} />
                      {f.evidence.map((e, i) => (
                        <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                      ))}
                    </div>
                  </div>
                  {f.reasons.length > 0 && <p className="meta reasons">{f.reasons.join(" · ")}</p>}
                </li>
              ))}
              {decisionFacts.length === 0 && <li className="meta">No decisions recorded.</li>}
            </ul>
          </div>

          <div className="brief-section">
            <h4>
              {T("Documents on file", "مستندات محفوظة")}
              <span className="count">{docFacts.length}</span>
            </h4>
            <ul className="facts">
              {docFacts.map((f) => (
                <li key={f.fact_id}>
                  <div className="fact-row">
                    <p dir="auto">
                      📄 {f.text}
                    </p>
                    <div className="fact-side">
                      <ConfidenceBand confidence={f.confidence} reasons={f.reasons} />
                      <LabelChip label={f.label} reasons={f.reasons} ar={ar} />
                      {f.evidence.map((e, i) => (
                        <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                      ))}
                    </div>
                  </div>
                </li>
              ))}
              {docFacts.length === 0 && <li className="meta">No documents recorded.</li>}
            </ul>
          </div>
        </>
      )}

      {tab === "timeline" && (
        <ul className="timeline">
          {timeline.map((e, i) => (
            <li key={i}>
              <span className="tl-date">{fmtDate(e.date)}</span>
              <span className="tl-dot" />
              <div className="tl-body">
                <p dir="auto">{e.text}</p>
                <span className="meta">
                  {e.kind} · <LabelChip label={e.label} ar={ar} />
                </span>
              </div>
            </li>
          ))}
          {timeline.length === 0 && <li className="meta">No dated events.</li>}
        </ul>
      )}

      {tab === "commitments" && (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{T("Commitment", "الالتزام")}</th>
              <th>{T("State", "الحالة")}</th>
              <th>{T("Owner", "المسؤول")}</th>
              <th>{T("Due", "الاستحقاق")}</th>
              <th>{T("Source", "المصدر")}</th>
            </tr>
          </thead>
          <tbody>
            {[...file.commitments]
              .sort(
                (a, b) =>
                  (a.owner ? 1 : 0) - (b.owner ? 1 : 0) ||
                  (a.due_date || "9999").localeCompare(b.due_date || "9999")
              )
              .map((c) => {
                const dd = daysUntil(c.due_date);
                const urgent =
                  c.state === "requested" && dd !== null && (dd < 0 || !c.owner);
                return (
              <tr key={c.commitment_id} className={urgent ? "row-urgent" : ""}>
                <td dir="auto">{c.description}</td>
                <td>
                  <span className="chip">{c.state}</span>
                </td>
                <td>{c.owner || <span className="chip conflict">{ar ? "بلا مسؤول" : "Unowned"}</span>}</td>
                <td>
                  {fmtDate(c.due_date)}
                  {dd !== null && c.state === "requested" && (
                    <span className={`due-chip ${dd < 0 ? "now" : dd <= 7 ? "soon" : "later"}`}>
                      {dd < 0 ? T(`${-dd}d overdue`, `متأخر ${-dd} يوماً`) : T(`in ${dd}d`, `بعد ${dd} يوماً`)}
                    </span>
                  )}
                </td>
                <td>
                  {c.evidence.map((e, i) => (
                    <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                  ))}
                </td>
              </tr>
                );
              })}
            {file.commitments.length === 0 && (
              <tr>
                <td colSpan={5} className="meta">
                  {T("No open commitments recorded.", "لا توجد التزامات مفتوحة.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {tab === "people" && (
        <>
          <ul className="facts">
            {file.facts
              .filter((f) => f.kind === "contact")
              .map((f) => (
                <li key={f.fact_id}>
                  <div className="fact-row">
                    <p dir="auto">{f.text}</p>
                    <div className="fact-side">
                      <LabelChip label={f.label} reasons={f.reasons} ar={ar} />
                      {f.evidence.map((e, i) => (
                        <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                      ))}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
          <h4 className="tree-title">{T("Group structure", "هيكل المجموعة")}</h4>
          <div className="tree">
            {file.entities
              .filter((e) => e.role === "holding" || e.role === "single")
              .map((h) => (
                <div key={h.entity_id} className="tree-branch">
                  <div className="tree-node root">
                    <strong>{h.legal_name_en}</strong>
                    <span className="meta">
                      {h.role} · CR {h.cr_number}
                    </span>
                  </div>
                  {file.entities
                    .filter((c) => c.role === "subsidiary")
                    .map((c) => (
                      <div key={c.entity_id} className="tree-node child">
                        <span className="tree-line" />
                        <div>
                          <strong>{c.legal_name_en}</strong>
                          <span className="meta">
                            {T("subsidiary", "فرع")} · CR {c.cr_number}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "sources" &&
        (() => {
          const all = [...new Set(file.facts.flatMap((f) => f.evidence))];
          const bySystem = new Map<string, typeof all>();
          for (const e of all) {
            const list = bySystem.get(e.source_system) || [];
            list.push(e);
            bySystem.set(e.source_system, list);
          }
          return (
            <>
              <p className="meta" style={{ margin: "4px 0 12px" }}>
                {T(
                  "Grouped by source system. Records older than 60 days are flagged — verify freshness before quoting.",
                  "مجمّعة حسب النظام. السجلات الأقدم من 60 يوماً معلّمة — تحقق من حداثتها قبل الاقتباس."
                )}
              </p>
              {[...bySystem.entries()].map(([sys, evs]) => (
                <div key={sys} className="src-group">
                  <h4 className="tree-title">
                    <span className="chip">{sys}</span>
                    <span className="count">{evs.length}</span>
                  </h4>
                  <ul className="sources">
                    {evs.map((e, i) => {
                      const age = daysUntil(e.as_of);
                      const stale = age !== null && -age > 60;
                      return (
                        <li key={i} onClick={() => onOpenSource(e)} className="source-row">
                          {e.record_id}{" "}
                          <span className="meta">
                            v{e.record_version} · {e.as_of} · {e.lang.toUpperCase()}
                          </span>
                          {stale && <span className="due-chip soon">{T("stale", "قديم")} · {-age}d</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          );
        })()}
    </section>
  );
}
/** The handover is a transfer between named people - say whose turn it is. */
function yourPart(user: string, h: { from_rm: string; to_rm: string; status: string }): string | null {
  if (h.status !== "open") return null;
  if (user === h.from_rm)
    return "answer the outgoing gap questions — your answers are saved as recollection, never as fact";
  if (user === h.to_rm) return "review the duties and accept or return them";
  if (user === "lead.one") return "clear the exceptions: assign owners, then close the transfer";
  return null;
}

function plainBlock(reasons: string[]): string {
  const owner = reasons.filter((r) => /owner/i.test(r)).length;
  const conflict = reasons.filter((r) => /conflict/i.test(r)).length;
  const accept = reasons.filter((r) => /accept/i.test(r)).length;
  const parts: string[] = [];
  if (owner) parts.push(`${owner} item(s) still need someone to own them`);
  if (conflict) parts.push(`${conflict} fact(s) where two systems disagree`);
  if (accept) parts.push(`${accept} duty(ies) the incoming RM hasn't accepted`);
  return parts.join("; ") + ". Nothing critical is allowed to slip through.";
}

function HandoverView({
  handover,
  onReload,
  onError,
}: {
  handover: HandoverDetail | null;
  onReload: () => void;
  onError: (s: string) => void;
}) {
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [closeMsg, setCloseMsg] = useState<string[]>([]);
  if (!handover) return <p className="meta">Loading transfer…</p>;

  const questions = handover.items.filter((i) => i.kind === "question");
  const duties = handover.items.filter((i) => i.kind === "commitment");
  const conflicts = handover.items.filter((i) => i.kind === "conflict");
  const accepted = handover.items.filter((i) => i.status === "accepted").length;
  const returned = handover.items.filter((i) => i.status === "returned").length;
  const open = handover.items.filter((i) => i.status === "open");
  // Walkthrough: the interview shows one question at a time.
  const current = questions.find((q) => !q.answer_text);
  const qIndex = current ? questions.indexOf(current) + 1 : questions.length;
  const blockers = handover.status === "closed" ? [] : handover.blocking;
  const total = handover.items.length || 1;
  const done = handover.items.filter((i) => i.status === "accepted" || i.status === "resolved").length;
  const pct = Math.round((done / total) * 100);

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>
            Transfer {handover.group_id}{" "}
            <span className={`pill ${handover.status}`}>{handover.status}</span>
          </h2>
          <p className="meta">
            {handover.from_rm} → {handover.to_rm}
          </p>
        </div>
        <button className="ghost" onClick={onReload}>
          Refresh
        </button>
      </div>

      <div className="progress">
        <div className="progress-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="meta">
          {done} of {total} items settled ·{" "}
          {handover.ready ? "ready to close" : `${handover.blocking.length} blocker(s)`}
        </span>
      </div>
      {yourPart(currentUser, handover) && (
        <div className="role-part">
          <strong>Your part:</strong> {yourPart(currentUser, handover)}
        </div>
      )}
      {!handover.ready && handover.blocking.length > 0 && (
        <div className="why-blocked">
          <strong>Why this can't close yet:</strong>{" "}
          {plainBlock(handover.blocking.map((b) => b.reason))}
        </div>
      )}

      <h3>
        <span className="step">1</span> Gap questions for the outgoing RM{" "}
        <span className="meta">
          {qIndex} / {questions.length}
        </span>
      </h3>
      {questions
        .filter((q) => q.answer_text || q === current)
        .map((q) => (
          <div key={q.item_id} className="q-card">
            <p className="q-text">{q.question_text}</p>
            <p className="meta">Why asked: {q.why_asked} · failure point {q.failure_point}</p>
            {q.answer_text ? (
              <p className="recollection">Saved as recollection — “{q.answer_text}”</p>
            ) : (
              <div className="ask-panel">
                <input
                  placeholder="Your answer (saved as recollection, never as verified fact)…"
                  value={answers[q.item_id] || ""}
                  onChange={(e) => setAnswers({ ...answers, [q.item_id]: e.target.value })}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && (answers[q.item_id] || "").length >= 2) {
                      try {
                        await api.answerQuestion(handover.handover_id, q.item_id, answers[q.item_id]);
                        onReload();
                      } catch (err: any) {
                        onError(err?.error?.message || "save failed");
                      }
                    }
                  }}
                />
                <button
                  disabled={(answers[q.item_id] || "").length < 2}
                  onClick={async () => {
                    try {
                      await api.answerQuestion(handover.handover_id, q.item_id, answers[q.item_id]);
                      onReload();
                    } catch (err: any) {
                      onError(err?.error?.message || "save failed");
                    }
                  }}
                >
                  Save answer
                </button>
                <button
                  className="ghost"
                  onClick={async () => {
                    try {
                      await api.answerQuestion(
                        handover.handover_id,
                        q.item_id,
                        "I don't know",
                        "Outgoing RM could not recall; item stays unknown, never filled in"
                      );
                      onReload();
                    } catch (err: any) {
                      onError(err?.error?.message || "save failed");
                    }
                  }}
                >
                  I don't know
                </button>
              </div>
            )}
          </div>
        ))}
      {questions.length > 0 && !current && (
        <p className="ok-text">✓ All gap questions answered ({questions.length}).</p>
      )}

      <h3>
        <span className="step">2</span> Acceptance by the incoming RM
      </h3>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Kind</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Assign</th>
          </tr>
        </thead>
        <tbody>
          {[...duties, ...conflicts].map((i) => (
            <tr key={i.item_id} id={`item-${i.item_id}`} className={open.includes(i) ? "unresolved" : ""}>
              <td>{i.kind === "conflict" ? "Conflict fact" : "Commitment"}</td>
              <td className="meta">{i.kind}</td>
              <td>{i.owner || "—"}</td>
              <td>
                <span className="chip">{i.status}</span>
              </td>
              <td>
                <button
                  className="assign-btn"
                  onClick={async () => {
                    try {
                      await api.assign(handover.handover_id, i.item_id, "sara.rm", "2026-09-26");
                      onReload();
                    } catch (err: any) {
                      onError(err?.error?.message || "assign failed");
                    }
                  }}
                >
                  → sara.rm
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="ask-panel">
        <input placeholder="Note for returned items…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          onClick={async () => {
            try {
              await api.accept(
                handover.handover_id,
                duties.filter((d) => d.status !== "returned").map((d) => d.item_id),
                conflicts.map((c) => c.item_id),
                note || undefined
              );
              onReload();
            } catch (err: any) {
              onError(err?.error?.message || "accept failed");
            }
          }}
        >
          Accept duties / return conflicts
        </button>
      </div>
      <p className="meta">
        accepted: {accepted} · returned: {returned}
      </p>

      <div className="close-panel">
        <div className="close-head">
          <h3 style={{ margin: 0 }}>
            <span className="step">3</span> Close transfer
          </h3>
          <span className={`state-pill ${handover.status === "closed" || blockers.length === 0 ? "ready" : "blocked"}`}>
            {handover.status === "closed" ? "Closed" : blockers.length === 0 ? "Ready" : "Blocked"}
          </span>
        </div>

        {blockers.length > 0 && (
          <>
            <p className="meta">
              This transfer cannot close until every critical item has an owner, a date and no
              unresolved conflict. Click a reason to jump to the item that resolves it.
            </p>
            <ul className="block-reasons">
              {blockers.map((b, i) => (
                <li key={i}>
                  <button
                    className="reason-chip"
                    onClick={() => b.item_id && scrollToItem(b.item_id)}
                    disabled={!b.item_id}
                  >
                    <span className="fcode">{fcodeFor(b.reason)}</span>
                    {b.reason}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {blockers.length === 0 && handover.status !== "closed" && (
          <p className="ok-text">✓ Readiness checks pass — the transfer can close.</p>
        )}
        {closeMsg.length > 0 && (
          <div className="banner error">
            {closeMsg.map((m, i) => (
              <p key={i} style={{ margin: "4px 0" }}>
                ⛔ {m}
              </p>
            ))}
          </div>
        )}
        <button
          className="primary close-btn"
          disabled={handover.status === "closed" || blockers.length > 0}
          onClick={async () => {
            setCloseMsg([]);
            try {
              await api.close(handover.handover_id);
              onReload();
            } catch (err: any) {
              setCloseMsg(err?.error?.details?.blocking_reasons || [err?.error?.message || "close failed"]);
              onReload();
            }
          }}
          aria-disabled={handover.status === "closed" || blockers.length > 0}
        >
          {handover.status === "closed"
            ? "Transfer closed"
            : blockers.length > 0
              ? "Resolve items to close"
              : "Close transfer"}
        </button>
      </div>
    </section>
  );
}

function AgentsView({ onOpenGroup }: { onOpenGroup: (groupId: string) => void }) {
  type Overview = Awaited<ReturnType<typeof api.agentsOverview>>;
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.agentsOverview().then(setData).catch((e) => setErr(e?.error?.message || "failed to load"));
  }, []);
  if (err)
    return (
      <section>
        <h2>Agentic workflow</h2>
        <div className="role-note">
          <strong>Not available right now.</strong> The agent overview needs the API to be up —
          try refreshing. <span className="meta">{err}</span>
        </div>
      </section>
    );
  if (!data) return <p className="meta">Loading agent overview…</p>;

  const statusPill = (s: string) =>
    s === "fired" ? (
      <span className="pill closed">fired</span>
    ) : s === "scheduled" || s === "due" ? (
      <span className="pill open">{s}</span>
    ) : s === "not_in_prototype" ? (
      <span className="pill preparing">planned</span>
    ) : (
      <span className="pill preparing">waiting</span>
    );

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Agentic workflow</h2>
          <p className="lead">
            The assistant prepares work on triggers — leave, expiry, handover, referrals — and a
            person always acts.
          </p>
          <p className="meta">
            {data.pattern} · as of {data.as_of} ·{" "}
            <a className="link" href="/docs" target="_blank" rel="noreferrer">
              interactive API docs
            </a>
          </p>
        </div>
      </div>

      <div className="principles">
        {data.principles.map((p) => (
          <span key={p} className="principle">
            ✓ {p}
          </span>
        ))}
      </div>

      <h3>
        <span className="step">→</span> Triggers · jobs · human gates
      </h3>
      <div className="cards triggers">
        {data.triggers.map((t) => (
          <div key={t.trigger} className={`card trigger ${t.status}`}>
            <div className="status-line">
              <span className="gid">{t.label}</span>
              {statusPill(t.status)}
            </div>
            <p className="meta">
              {t.source} → <code>{t.job}</code> · use case {t.use_case}
            </p>
            <p className="trig-effect">{t.effect}</p>
            {t.output && t.output !== "cover_brief" && t.output !== "return_summary" && (
              <p className="meta output-line">↳ {t.output}</p>
            )}
            <p className="gate">
              <strong>Human gate:</strong> {t.human_step}
            </p>
          </div>
        ))}
      </div>

      {data.cover_briefs.map((b) => (
        <div key={b.doc_id} className="q-card" style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="q-text">
              Cover brief for {b.for} — covering {b.covering}, {b.from} → {b.to}
            </p>
            <span className="chip verified">drafted automatically</span>
          </div>
          <p className="meta" style={{ marginTop: 4 }}>
            Groups: {b.groups.join(", ")}
          </p>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Due during cover</th>
                <th>Owner</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {b.due_during_cover.map((d, i) => (
                <tr key={i}>
                  <td>{d.item}</td>
                  <td>{d.owner}</td>
                  <td>
                    <span className={`chip ${d.label}`}>{d.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.do_not_say.length > 0 && (
            <p className="recollection" style={{ marginTop: 10 }}>
              <strong>Do not say:</strong> {b.do_not_say.join(" · ")}
            </p>
          )}
        </div>
      ))}

      {data.referral_packs.map((rp) => (
        <div key={rp.doc_id} className="q-card" style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="q-text">Referral pack — {rp.to_role}</p>
            <span className="chip verified">assembled automatically</span>
          </div>
          <p className="meta" style={{ marginTop: 4 }}>
            {rp.group_id} · asked by {rp.requested_by} · decision needed by {rp.decision_needed_by}
          </p>
          <p style={{ margin: "8px 0" }} dir="auto">
            <strong>{rp.question}</strong>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documents already held (never re-ask the client)</th>
                  <th>Record</th>
                  <th>Valid until</th>
                </tr>
              </thead>
              <tbody>
                {rp.documents_already_held.map((d, i) => (
                  <tr key={i}>
                    <td>{d.title}</td>
                    <td className="meta">{d.record_id}</td>
                    <td className="meta">{d.valid_until}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rp.history.length > 0 && (
            <p className="meta" style={{ marginTop: 8 }}>
              History: {rp.history.join(" · ")}
            </p>
          )}
        </div>
      ))}

      <h3>
        <span className="step">!</span> Alerts — raised automatically, resolved by people
      </h3>
      <div className="cards">
        {data.alerts.map((a) => (
          <div key={a.alert_id} className="card">
            <div className="status-line">
              <span className="chip escalate">{a.kind.replace(/_/g, " ")}</span>
              <span className={`chip ${a.status === "resolved" ? "verified" : "conflict"}`}>
                {a.status === "resolved" ? "resolved since" : "still open"}
              </span>
            </div>
            <p style={{ margin: "6px 0" }}>{a.text}</p>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="meta">
                routed to {a.group_id ? `${a.group_id} team lead` : "team lead"}
              </span>
              {a.group_id && (
                <button className="assign-btn" onClick={() => onOpenGroup(a.group_id!)}>
                  Open client file →
                </button>
              )}
            </div>
          </div>
        ))}
        {data.alerts.length === 0 && <p className="meta">No alerts raised.</p>}
      </div>

      <h3>
        <span className="step">✎</span> Audit tail (hash-chained)
      </h3>
      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {data.audit_tail.map((e) => (
            <tr key={e.seq}>
              <td className="meta">{e.seq}</td>
              <td className="meta">{e.ts.slice(0, 19).replace("T", " ")}</td>
              <td>{e.actor}</td>
              <td>
                <span className="chip">{e.action}</span>
              </td>
              <td className="meta">{e.subject}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}


function EvalsView() {
  type Evals = Awaited<ReturnType<typeof api.evals>>;
  const [data, setData] = useState<Evals | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.evals().then(setData).catch((e) => setErr(e?.error?.message || "failed to load"));
  }, []);
  if (err)
    return (
      <section>
        <h2>Release gates — synthetic golden set</h2>
        <div className="role-note">
          <strong>Not available right now.</strong> The evaluation snapshot appears once the
          golden suite has been run (<code>make eval</code>) and is readable by all signed-in
          staff. <span className="meta">{err}</span>
        </div>
      </section>
    );
  if (!data) return <p className="meta">Loading eval snapshot…</p>;

  return (
    <section>
      <h2>Release gates — synthetic golden set</h2>
      <p className="meta">
        Generated {data.generated_at?.slice(0, 19).replace("T", " ") || "—"} · routes:{" "}
        {Object.entries(data.routes || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}
      </p>
      <div className="stats">
        <div className="stat">
          <span className={`n ${data.gates.all_gates_green ? "" : "warn"}`}>
            {data.gates.all_gates_green ? "PASS" : "FAIL"}
          </span>
          <span className="l">all gates green</span>
        </div>
        <div className="stat">
          <span className="n">
            {data.gates.checks_passed}/{data.gates.checks_total}
          </span>
          <span className="l">checks passed</span>
        </div>
        <div className="stat">
          <span className="n">{Math.round(data.gates.numeric_exactness * 100)}%</span>
          <span className="l">numeric exactness</span>
        </div>
      </div>
      <p className="meta" style={{ margin: "6px 0 16px" }}>
        Gates: numeric exactness 100% · unsupported material claims 0 · cross-group leakage 0 ·
        critical recall ≥ 95% · Arabic–English gap under 3 pts. Synthetic data only — never Warba
        results. Re-run: <code>make eval</code>.
      </p>
      <div className="cards">
        {data.cases.map((c) => (
          <div key={c.case_id} className="card">
            <div className="status-line">
              <span className="gid">{c.case_id}</span>
              <span className={`pill ${c.passed ? "closed" : "open"}`}>{c.passed ? "pass" : "fail"}</span>
            </div>
            <ul className="eval-checks">
              {c.checks.map((k, i) => (
                <li key={i} className={k.ok ? "" : "bad"}>
                  {k.ok ? "✓" : "✗"} {k.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
