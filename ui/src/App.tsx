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
import { Citation, fmtDate, fmtKwd, LabelChip, SourceDrawer } from "./components";

type View = "board" | "file" | "handover";

const DEMO_USERS = [
  { id: "sara.rm", label: "Sara — incoming RM", group: "GHC-001" },
  { id: "omar.rm", label: "Omar — outgoing RM", group: "GHC-001" },
  { id: "lead.one", label: "Team lead", group: null },
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

  return (
    <div className="app">
      <header>
        <div className="brand">
          RCA <span>· Relationship Continuity Assistant</span>
        </div>
        <nav>
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
            Readiness board
          </button>
          <button className={view === "file" ? "on" : ""} onClick={() => setView("file")}>
            Client file
          </button>
        </nav>
        <div className="who">
          {currentUser} · {currentGroup || "all groups"}{" "}
          <button
            className="ghost"
            onClick={() => {
              clearAuth();
              location.reload();
            }}
          >
            sign out
          </button>
        </div>
      </header>

      {error && <div className="banner error" onClick={() => setError("")}>{error}</div>}

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
          <FileView file={file} ask={ask} question={question} setQuestion={setQuestion} busy={busy}
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
          <HandoverView
            handover={handover}
            onReload={() => handover && loadHandover(handover.handover_id)}
            onError={setError}
          />
        )}
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
        <h1>RCA Console</h1>
        <p className="meta">Warba Track 2 prototype · synthetic data · local profile</p>
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
            {u.label}
          </button>
        ))}
        {err && <p className="banner error">{err}</p>}
      </div>
    </div>
  );
}

function Board({ board, onOpen, onReload }: { board: BoardItem[]; onOpen: (id: string) => void; onReload: () => void }) {
  return (
    <section>
      <div className="row">
        <h2>Readiness board</h2>
        <button className="ghost" onClick={onReload}>refresh</button>
      </div>
      {board.length === 0 && <p className="meta">No transfers. Start one via the API, or re-seed.</p>}
      <div className="cards">
        {board.map((t) => (
          <div key={t.handover_id} className={`card ${t.status === "closed" ? "done" : t.blocking_count ? "blocked" : "ok"}`}>
            <div className="row">
              <strong>{t.group_id}</strong>
              <span className="chip">{t.status}</span>
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
              <p className="ok-text">Ready to close</p>
            )}
            <p className="meta">{t.open_items} open items · next due {fmtDate(t.next_due)}</p>
            <button onClick={() => onOpen(t.handover_id)}>Open transfer</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function FileView({
  file, ask, question, setQuestion, busy, onAsk, onOpenSource, onGroup,
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
      <div className="row">
        <h2>
          {file.group_name || file.group_id} <span className="meta">· {file.group_id} · as of {fmtDate(file.as_of)}</span>
        </h2>
        <select value={file.group_id} onChange={(e) => onGroup(e.target.value)}>
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
          {busy ? "…" : "Ask"}
        </button>
      </div>
      {ask && (
        <div className={`answer ${ask.label}`}>
          <div className="row">
            <LabelChip label={ask.label} reasons={ask.reasons} />
            <span className="meta">confidence {ask.confidence}</span>
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
            {t}
          </button>
        ))}
        {file.open_conflicts > 0 && <span className="chip conflict">{file.open_conflicts} conflict(s)</span>}
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
                <td>{c.owner || <span className="chip conflict">unowned</span>}</td>
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
          <li className="meta">Entities: {file.entities.map((e) => e.legal_name_en).join(" · ")}</li>
        </ul>
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
  handover, onReload, onError,
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
  const accepted = handover.items.filter((i) => i.status === "accepted").map((i) => i.item_id);
  const returned = handover.items.filter((i) => i.status === "returned").map((i) => i.item_id);

  return (
    <section>
      <div className="row">
        <h2>
          Transfer {handover.group_id} <span className="meta">{handover.from_rm} → {handover.to_rm} · {handover.status}</span>
        </h2>
        <button className="ghost" onClick={onReload}>refresh</button>
      </div>

      <h3>1 · Gap questions for the outgoing RM</h3>
      {questions.map((q) => (
        <div key={q.item_id} className="q-card">
          <p>
            <strong>{q.question_text}</strong>
          </p>
          <p className="meta">Why asked: {q.why_asked} · failure point {q.failure_point}</p>
          {q.answer_text ? (
            <p className="recollection">Saved as recollection: “{q.answer_text}”</p>
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

      <h3>2 · Acceptance by the incoming RM</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Kind</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Assign to</th>
          </tr>
        </thead>
        <tbody>
          {[...duties, ...conflicts].map((i) => (
            <tr key={i.item_id}>
              <td>{i.kind === "conflict" ? "Conflict fact" : "Commitment"}</td>
              <td>{i.kind}</td>
              <td>{i.owner || "—"}</td>
              <td>
                <span className="chip">{i.status}</span>
              </td>
              <td className="row">
                <button
                  className="ghost"
                  onClick={async () => {
                    try {
                      await api.assign(handover.handover_id, i.item_id, "sara.rm", "2026-09-26");
                      onReload();
                    } catch (e: any) {
                      onError(e?.error?.message || "assign failed");
                    }
                  }}
                >
                  sara.rm
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
      <p className="meta">accepted: {accepted.length} · returned: {returned.length}</p>

      <h3>3 · Close transfer</h3>
      {closeMsg.length > 0 && (
        <div className="banner error">
          {closeMsg.map((m, i) => (
            <p key={i}>⛔ {m}</p>
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
