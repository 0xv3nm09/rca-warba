# Relationship Continuity Assistant (RCA)

**Ignyte by DIFC × Warba Bank · Corporate Banking AI Challenge · Track 2 — Intelligent Relationship Handover**
Magnus Mage · prototype · **all client data is synthetic**

A service that keeps every corporate client handover-ready: a sourced, living
relationship file (facts, commitments, people, conflicts — every item linked to
its source record), a guided exit interview for the outgoing RM, acceptance by
the incoming RM, and a transfer that **cannot close** until every critical item
has an owner, a date and no unresolved material conflict.

**Demo video (84 s):** [84-second narrated walkthrough](https://github.com/0xv3nm09/rca-warba/releases/tag/demo-video) —
the full story in one take. Guided path in the console: `http://localhost:8000/?demo=1`.

The five rules (enforced by tests):

1. The model never decides — status, readiness and approvals are deterministic code (state machines).
2. Untrusted text is data — emails/notes reach only a tool-less extractor; injection attempts are flagged and logged, never obeyed.
3. Numbers are copied, not generated — amounts/dates come from structured fields; mismatches become conflicts.
4. Confidence is computed from checks, not asked of the model.
5. One change cannot break everything — adapters and model routes are swappable via configuration.

---

## Quickstart (one command, no API keys needed)

```bash
docker compose up -d --build      # postgres + redis + api + worker + console
# the API container seeds synthetic data on boot; wait ~15 s, then open:
open http://localhost:8000        # console (login as Team lead / Sara / Omar)
```

That's the whole demo. The default model routes are **deterministic in-process
providers**, so the stack runs anywhere with zero downloads and zero API keys.
The verification pipeline treats them exactly like model output: quotes must be
located verbatim, numbers must match structured fields, labels are computed.

Native development:

```bash
brew install uv colima docker docker-compose   # or Docker Desktop
uv sync --extra dev                            # Python 3.12 venv
docker compose up -d postgres redis            # data services only
uv run python -m rca.adapters.dummy.seed       # load synthetic fixtures
uv run uvicorn rca.app.main:app --reload       # API on :8000
cd ui && npm install && npm run dev            # console on :5173 (proxies /api)
```

Useful commands:

| Command | What it does |
| --- | --- |
| `make test` | full test suite (51 tests: domain, API flows, security) |
| `make eval` | golden-set evaluation; all release gates green (hermetic — no API key needed) |
| `make restart` | emergency fast dev: rebuild + force-recreate all containers |
| `make down` | stop everything |
| `curl localhost:8000/admin/audit/verify -H "Authorization: Bearer <lead token>"` | verify the hash-chained audit log |

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | end-to-end flows (ingestion, ask, handover), the layer-by-layer guardrail stack with code, model gateway, confidence & labels, eval gates, invariants, prototype boundaries |
| [docs/USE_CASES.md](docs/USE_CASES.md) | each use case → demo path, code path, core snippet, automated proof; demo-video beat map |
| [docs/prototype-notes.md](docs/prototype-notes.md) | per-use-case coverage table (what is working vs deferred to pilot) |

The console also has a **guided demo path**: open `http://localhost:8000/?demo=1`
and follow the 8 beats on the right-hand rail — the same beats a judge sees in
five minutes.

## Demo logins (local profile, synthetic data)

| User | Role | Group |
| --- | --- | --- |
| `lead.one` | team lead | all |
| `sara.rm` | incoming RM | GHC-001, ALS-014 |
| `omar.rm` | outgoing RM | GHC-001 |

## The 5-minute demo (matches proposal section 15)

1. **Board** — login as Team lead: GHC-001 transfer blocked with 3 reasons.
2. **Client file** — as Sara: every fact labelled and cited; the G-2291 conflict shows core banking 750,000 vs CRM 700,000 with dates; click [1] on any fact — the source drawer opens (Arabic included, RTL).
3. **Ask** — "Can I tell the client the new price is approved?" → **Not in records**, cited, with the reason "Commitment state is 'requested'".
4. **Injection** — switch group to ALS-014, ask "What stage is the Murabaha at?" → stage from the contract record, the "basically done" email flagged, hidden instruction logged with no effect. Asking the injection as a question is refused (422 `guardrail_blocked`).
5. **Transfer** — as Team lead: open the transfer, answer a gap question (saved as *recollection*), accept duties, close → blocked → assign owners → closes. Then re-run `make seed` for a fresh board.

## Using a real LLM (optional)

**Free API, no download (recommended for reviewer demos):** get a key at
https://console.groq.com/keys (free tier, no card). In `.env`:

```dotenv
LLM_EXTRACT_MODEL=llama-3.3-70b-versatile
LLM_EXTRACT_BASE_URL=https://api.groq.com/openai/v1
LLM_DRAFT_MODEL=llama-3.3-70b-versatile
LLM_DRAFT_BASE_URL=https://api.groq.com/openai/v1
LLM_CLASSIFY_MODEL=llama-3.3-70b-versatile
LLM_CLASSIFY_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<your groq key>
```

then `make restart`. Any OpenAI-compatible endpoint works the same way.

**Local model (in-bank pattern):** Ollama on the host
(`ollama pull qwen3:4b`), then `LLM_*_MODEL=qwen3:4b`,
`LLM_*_BASE_URL=http://host.docker.internal:11434/v1` (from containers).
Reasoning models' `<think>` blocks are stripped automatically; extraction
output is schema-validated and quote-checked exactly like the dummy route.

> Prototype data is synthetic, so a cloud API is safe here. In the Warba
> sandbox/pilot the same variables point at the in-bank endpoint and no data
> leaves the bank — that is the deployment posture in the proposal.

## Deployment options for reviewers

1. **Docker image (recommended).** Build once, push, reviewers pull:
   ```bash
   docker build -f docker/Dockerfile -t <registry>/rca-warba:latest .
   docker push <registry>/rca-warba:latest
   # reviewer side:
   curl -O https://raw.githubusercontent.com/magnusmage/rca-warba/main/docker-compose.yml
   docker compose up -d && open http://localhost:8000
   ```
   Works on Docker Desktop, colima, or any Linux Docker host. No keys needed.
2. **Hosted URL.** The same compose file deploys to Fly.io / Railway / any
   small host; point the platform's Postgres/Redis at managed instances or keep
   the bundled containers. Console + API are one service (port 8000).
3. **Git clone.** `git clone … && cd rca-warba && docker compose up -d --build`.

## What is real vs synthetic

| Real (in this repo) | Synthetic / simulated |
| --- | --- |
| FastAPI service, schemas, error envelope | Client records (3 groups, planted problems) |
| State machines (commitments, Murabaha), readiness rules | Source systems behind dummy adapters (CRM, core, ECM, mail, HR) |
| Extraction → verification (span, number, entailment) → labels | Teams app / Entra ID (web console + dev login instead) |
| Handover workflow, gap questions, acceptance, blocking close | — |
| Agent triggers: leave-cover brief, nightly expiry/overdue scans | — |
| Hash-chained audit log + verifier | — |
| 51 automated tests; golden-set eval with release gates (incl. Arabic-English parity) | — |
| Arabic normalisation, ACL-before-retrieval, injection guards | — |

## Repository map

```
rca/
├── app/          # FastAPI: routers (auth, files, ask, triage, handovers, insights, admin)
├── domain/       # pure logic: models, state machines, readiness, confidence, calibrator
├── ai/           # gateway (dummy + OpenAI-compatible routes), verify, guards, rules extractor
├── retrieval/    # Arabic normalisation, hash/bge-m3 embeddings
├── adapters/     # source Protocol + dummy adapters + fixtures + seed
├── services/     # living-file builder, handover workflow, ask, triage
├── agents/       # event triggers (cover brief, return summary, nightly scans)
├── db/           # SQLAlchemy models, sessions
├── audit/        # hash-chained writer + chain verifier
└── evals/        # golden-set harness (make eval)
ui/               # React + TypeScript console (built bundle served by the API)
tests/            # unit + API flow/security tests
evals/golden/     # per-group golden cases
```

## Gates (all green on the synthetic golden set)

| Metric | Gate |
| --- | --- |
| Numeric exactness | 100% |
| Critical-item recall | 100% (7/7 planted items; gate ≥ 95%) |
| Arabic–English parity | 0 pts gap across mirrored AR/EN question pairs (gate < 3 pts) |
| Unsupported material claims | 0 |
| Cross-group leakage | 0 |
| Injection success | 0 (email flagged+ignored; question refused 422 — English and Arabic) |
| Recollection promoted to verified | never (state enforced) |
| Eval snapshot | `reports/golden_snapshot.json` (hermetic: reproducible with `make eval`, no API key) |

Present these as synthetic-data results, never as Warba results.
