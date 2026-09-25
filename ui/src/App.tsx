import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  const showError = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind: "error" }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
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

  if (!currentUser) return <Login />;

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
            reloadFile={() => loadFile(group)}
          />
        )}
        {view === "handover" && (
          <HandoverView handover={handover} onReload={() => handover && loadHandover(handover.handover_id)} onError={showError} />
        )}
        {view === "agents" && <AgentsView />}
        {view === "evals" && <EvalsView />}
      </main>

      <SourceDrawer ev={drawer} onClose={() => setDrawer(null)} />
      <Toasts items={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
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
                setAuth(d.session_token, u.id, u.group);
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
  const [alerts, setAlerts] = useState<{ alert_id: string; kind: string; text: string; group_id: string | null }[]>([]);
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
            Every transfer, and exactly what is blocking it from closing.
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
                <span className="chip escalate">{a.kind.replace(/_/g, " ")}</span>
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
  reloadFile,
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
  reloadFile: () => void;
}) {
  const [tab, setTab] = useState<"brief" | "timeline" | "commitments" | "people" | "sources">("brief");
  const [ar, setAr] = useState(false);
  const [link, setLink] = useState<{ handover_id: string | null; items: { item_id: string; kind: string; ref_id: string | null; status: string }[] }>({ handover_id: null, items: [] });
  const groups = ["GHC-001", "ALS-014", "NLG-022"];
  const canAssign = currentUser === "lead.one";

  const loadLink = useCallback(() => {
    api.handoverLink(file.group_id).then(setLink).catch(() => {});
  }, [file.group_id]);
  useEffect(() => {
    loadLink();
  }, [loadLink]);

  const conflicts = file.facts.filter((f) => f.label === "conflict");
  const others = file.facts.filter((f) => f.label !== "conflict");

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

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "brief" && (
        <ul className="facts">
          {conflicts.map((f) => (
            <ConflictCard
              key={f.fact_id}
              fact={f}
              ar={ar}
              canAssign={canAssign}
              linked={{
                handover_id: link.handover_id,
                item_id: link.items.find((i) => i.kind === "conflict" && i.ref_id === f.fact_id)?.item_id || null,
              }}
              onAssign={() => assignConflict(f.fact_id)}
              onOpenSource={onOpenSource}
            />
          ))}
          {others.map((f) => (
            <li key={f.fact_id}>
              <div className="fact-row">
                <p dir="auto">
                  {f.text}
                  {f.amount_kwd && <strong> · {fmtKwd(f.amount_kwd)}</strong>}
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
        </ul>
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
            {file.commitments.map((c) => (
              <tr key={c.commitment_id}>
                <td dir="auto">{c.description}</td>
                <td>
                  <span className="chip">{c.state}</span>
                </td>
                <td>{c.owner || <span className="chip conflict">{ar ? "بلا مسؤول" : "Unowned"}</span>}</td>
                <td>{fmtDate(c.due_date)}</td>
                <td>
                  {c.evidence.map((e, i) => (
                    <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                  ))}
                </td>
              </tr>
            ))}
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
          <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>{T("Legal entity", "الكيان القانوني")}</th>
                <th>{T("Role", "الدور")}</th>
                <th>CR</th>
              </tr>
            </thead>
            <tbody>
              {file.entities.map((e) => (
                <tr key={e.entity_id}>
                  <td>{e.legal_name_en}</td>
                  <td className="meta">{e.role}</td>
                  <td className="meta">{e.cr_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {tab === "sources" && (
        <ul className="sources">
          {[...new Set(file.facts.flatMap((f) => f.evidence))].map((e, i) => (
            <li key={i} onClick={() => onOpenSource(e)} className="source-row">
              <span className="chip">{e.source_system}</span> {e.record_id}{" "}
              <span className="meta">
                v{e.record_version} · {e.as_of} · {e.lang.toUpperCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

function AgentsView() {
  type Overview = Awaited<ReturnType<typeof api.agentsOverview>>;
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.agentsOverview().then(setData).catch((e) => setErr(e?.error?.message || "failed to load"));
  }, []);
  if (err) return <p className="banner error">{err}</p>;
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
            The assistant prepares work on triggers — leave, expiry, handover — and a person always
            acts.
          </p>
          <p className="meta">{data.pattern} · as of {data.as_of}</p>
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
  if (err) return <p className="banner error">{err}</p>;
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
