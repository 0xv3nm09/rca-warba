import { useCallback, useEffect, useState } from "react";
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
import { Citation, ConfidenceBand, fmtDate, fmtKwd, LabelChip, SourceDrawer } from "./components";

type View = "board" | "file" | "handover" | "agents";

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
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const loadBoard = useCallback(async () => {
    try {
      const d = await api.board();
      setBoard(d.transfers);
    } catch (e: any) {
      setError(e?.error?.message || "failed to load board");
    }
  }, []);

  const loadFile = useCallback(async (g: string) => {
    try {
      setFile(await api.file(g));
    } catch (e: any) {
      setError(e?.error?.message || "failed to load file");
    }
  }, []);

  const loadHandover = useCallback(async (id: string) => {
    try {
      setHandover(await api.handover(id));
    } catch (e: any) {
      setError(e?.error?.message || "failed to load handover");
    }
  }, []);

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

      {error && (
        <div className="banner error" onClick={() => setError("")}>
          {error}
        </div>
      )}

      <main>
        {view === "board" && (
          <Board
            board={board}
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
            onAsk={async () => {
              setBusy(true);
              setAsk(null);
              try {
                setAsk(await api.ask(file.group_id, question));
              } catch (e: any) {
                setError(e?.error?.message || "ask failed");
              }
              setBusy(false);
            }}
            onOpenSource={setDrawer}
            onGroup={setGroup}
          />
        )}
        {view === "handover" && (
          <HandoverView handover={handover} onReload={() => handover && loadHandover(handover.handover_id)} onError={setError} />
        )}
        {view === "agents" && <AgentsView />}
      </main>

      <SourceDrawer ev={drawer} onClose={() => setDrawer(null)} />
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

function Board({ board, onOpen, onReload }: { board: BoardItem[]; onOpen: (id: string) => void; onReload: () => void }) {
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
          <p className="meta">A transfer closes only when every critical item is owned, dated and accepted.</p>
        </div>
        <button className="ghost" onClick={onReload}>
          Refresh
        </button>
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
          {board.length === 0 && <p className="meta">No transfers. Start one via the API, or re-seed.</p>}
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
}: {
  file: ClientFile;
  ask: AskResult | null;
  question: string;
  setQuestion: (s: string) => void;
  busy: boolean;
  onAsk: () => void;
  onOpenSource: (e: Evidence) => void;
  onGroup: (g: string) => void;
}) {
  const [tab, setTab] = useState<"brief" | "commitments" | "people" | "sources">("brief");
  const groups = ["GHC-001", "ALS-014", "NLG-022"];
  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>{file.group_name || file.group_id}</h2>
          <p className="meta">
            {file.group_id} · as of {fmtDate(file.as_of)} · {file.open_conflicts} open conflict
            {file.open_conflicts === 1 ? "" : "s"}
          </p>
        </div>
        <select value={file.group_id} onChange={(e) => onGroup(e.target.value)} aria-label="Client group">
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>

      <div className="ask-panel">
        <input
          placeholder="Ask the file… e.g. Can I tell the client the new price is approved?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAsk()}
        />
        <button disabled={busy || question.length < 3} onClick={onAsk}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>
      {ask && (
        <div className={`answer ${ask.label}`}>
          <div className="row">
            <LabelChip label={ask.label} reasons={ask.reasons} />
            <ConfidenceBand confidence={ask.confidence} />
          </div>
          <p>{ask.answer}</p>
          <p className="meta">
            {ask.reasons.join(" · ")}
            {ask.citations.map((c, i) => (
              <Citation key={i} ev={c} n={i + 1} onOpen={onOpenSource} />
            ))}
          </p>
        </div>
      )}

      <nav className="tabs">
        {(["brief", "commitments", "people", "sources"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "brief" ? "Relationship brief" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "brief" && (
        <ul className="facts">
          {file.facts.map((f) => (
            <li key={f.fact_id}>
              <div className="fact-row">
                <p dir="auto">
                  {f.text}
                  {f.amount_kwd && <strong> · {fmtKwd(f.amount_kwd)}</strong>}
                  {f.due_date && <span className="meta"> · due {fmtDate(f.due_date)}</span>}
                </p>
                <div className="fact-side">
                  <ConfidenceBand confidence={f.confidence} />
                  <LabelChip label={f.label} reasons={f.reasons} />
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

      {tab === "commitments" && (
        <table>
          <thead>
            <tr>
              <th>Commitment</th>
              <th>State</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {file.commitments.map((c) => (
              <tr key={c.commitment_id}>
                <td>{c.description}</td>
                <td>
                  <span className="chip">{c.state}</span>
                </td>
                <td>{c.owner || <span className="chip conflict">Unowned</span>}</td>
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
                  No open commitments recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
                      <LabelChip label={f.label} reasons={f.reasons} />
                      {f.evidence.map((e, i) => (
                        <Citation key={i} ev={e} n={i + 1} onOpen={onOpenSource} />
                      ))}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Legal entity</th>
                <th>Role</th>
                <th>CR number</th>
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

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>
            Transfer {handover.group_id} <span className={`pill ${handover.status}`}>{handover.status}</span>
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
        <span className="step">1</span> Gap questions for the outgoing RM
      </h3>
      {questions.map((q) => (
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
              />
              <button
                disabled={(answers[q.item_id] || "").length < 2}
                onClick={async () => {
                  try {
                    await api.answerQuestion(handover.handover_id, q.item_id, answers[q.item_id]);
                    onReload();
                  } catch (e: any) {
                    onError(e?.error?.message || "save failed");
                  }
                }}
              >
                Save answer
              </button>
            </div>
          )}
        </div>
      ))}

      <h3>
        <span className="step">2</span> Acceptance by the incoming RM
      </h3>
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
            <tr key={i.item_id}>
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
                    } catch (e: any) {
                      onError(e?.error?.message || "assign failed");
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
            } catch (e: any) {
              onError(e?.error?.message || "accept failed");
            }
          }}
        >
          Accept duties / return conflicts
        </button>
      </div>
      <p className="meta">accepted: {accepted} · returned: {returned}</p>

      <h3>
        <span className="step">3</span> Close transfer
      </h3>
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
        className="primary"
        onClick={async () => {
          setCloseMsg([]);
          try {
            await api.close(handover.handover_id);
            onReload();
          } catch (e: any) {
            setCloseMsg(e?.error?.details?.blocking_reasons || [e?.error?.message || "close failed"]);
            onReload();
          }
        }}
      >
        Close transfer
      </button>
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
