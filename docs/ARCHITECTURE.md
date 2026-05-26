# Architecture

This document is the canonical architecture reference for BigBoss.

## System Overview

BigBoss is an executive-focused coordination agent in Cursor. It consolidates **operational and communication data** from connected sources into a **unified intelligence layer**—local knowledge graph, retrieval, contextual notifications, and human-gated draft responses. The platform leverages the [soofi-xyz agent network](https://github.com/soofi-xyz/soofi-xyz-team-kit) **at build time** (team-kit skills and specialist agents) to implement proven patterns quickly; **at runtime**, operators interact only with `@bigboss`, which executes `apps/cos-runtime` against live APIs.

**Sources (Phase 1–2):**

- Google Calendar and Gmail (multi-account)
- Microsoft Calendar and Mail (multi-account, optional)
- Asana (pull ingest)

Core flow:

1. Ingest connector data
2. Normalize into graph nodes/edges
3. Chunk/embed/retrieve contextual data (RAG)
4. Generate notifications and suggested responses
5. Present via Cursor (`@bigboss`) with human approval controls

## Runtime Design

- **Interface:** Cursor agent (`@bigboss`) + supporting CLI workflows
- **Knowledge graph (phase 1):** libSQL local DB
- **RAG:** local chunking + embedding + retrieval pipeline
- **LLM provider layer:** Vercel AI SDK (`ai`) only
  - Primary provider path: Bedrock
  - Secondary provider path: SDK-based fallback (no direct provider SDK usage in app code)
- **Observability:** LangSmith tracing with flush at AI entrypoints

## Runtime vs build-time

> **BigBoss is the product/runtime coordinator. Team-kit agents are build-time advisors and pattern owners, not runtime workers.**

**Operator / evaluator (product runtime):**

```text
@bigboss in Cursor → approved pnpm Run → apps/cos-runtime → external APIs / graph / RAG / notify / suggest
```

- `@bigboss notify list` runs **`pnpm notify`** and the COS notification runtime — it does **not** invoke `/oranguru`.
- `@bigboss suggest <id>` runs **`pnpm suggest`** — it does **not** invoke `/chatot`.
- `@bigboss query …` runs local RAG in **`apps/cos-runtime/src/rag/*`** — it does **not** invoke `/espeon` at runtime.

**Contributor / builder (optional team-kit plugin):**

```text
Developer → /arceus (routing) → team-kit skill + skills/build-cos-* overlay → implement in apps/cos-runtime
```

- `/arceus` is **not** the Chief of Staff runtime coordinator; it recommends which team-kit specialist or skill applies when **building** BigBoss.
- Do not make BigBoss a live multi-agent orchestrator in Phase 1; the product must run self-contained from this repo (AC-18/19).

## Deployment tracks

| Track | Who | Graph | RAG | Proof |
|-------|-----|-------|-----|-------|
| **Local demo / Phase 1 product** | Operators + contributors | libSQL `~/.cos/graph.db` | `apps/cos-runtime/src/rag/*` (espeon / `build-local-rag-pocs` at build time) | `@bigboss` + live creds; `pnpm acceptance` (CI) |
| **Customer production target** | Future hosted deploy | DynamoDB (see `lib/cos-stack.ts`) | OpenSearch + Bedrock per `/alakazam` + `build-rag-systems` | Separate gate—not claimed until AWS path is implemented |

Operators on the demo track need Bedrock (or configured LLM) for embeddings/LLM; they do **not** need OpenSearch or team-kit installed. See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for AWS prerequisites when migrating.

### Prototype ingestion budgets

| Connector | Window / filter | Volume cap | Notes |
|-----------|----------------|------------|-------|
| Google Calendar | ±30 days (`timeMin`/`timeMax`) | 250 events/page, all pages | Recurring events expanded (`singleEvents=true`) |
| Gmail | `in:inbox newer_than:30d` | `MAX_THREADS = 50` | No backfill; SPAM/TRASH body stripped |
| Asana | Active projects only (`archived=false`) | `MAX_TASKS_TOTAL = 200` | All stories fetched per included task |
| Microsoft Calendar | ±30 days (`calendarView/delta`) | All pages | Delta sync after first run |
| Microsoft Mail | Inbox delta | `MAX_MESSAGES = 50` | Groups by `conversationId` |

## Extensibility Model

### Connector architecture

- Connector interface pattern supports adding new providers without rewriting core graph logic
- Current implemented providers: Google Calendar, Gmail, Microsoft Calendar, Microsoft Mail, Asana
- Deferred providers/channels are represented as roadmap entries and registry status

### Channel extensibility

- Current phase focuses on in-Cursor delivery
- Telegram delivery adapter is implemented; SMS/WhatsApp/X remain deferred under AC-13
- Architecture remains open for adding channel adapters in later phases

## Team-kit alignment (audit @ `8e85bc1`)

**Governance:** When a team-kit agent owns a concern, follow that agent’s skills/rules—do not invent contradictory defaults. Custom COS code is allowed only when **no** kit agent applies (e.g. `bigboss`, pull connectors, executive brief UX).

| Agent | Applies to COS? | Mandate | COS status |
|-------|-----------------|---------|------------|
| **espeon** | Yes (demo RAG) | Local libSQL POC; `inspect`/`query` with **JSON stdout**; then AWS gate | **Partial** — tables + Bedrock embed OK; `query` human text today (target: JSON default) |
| **alakazam** | Yes (customer RAG) | SAM + Docker OpenSearch + Bedrock; no alt prod vector DB | Documented; not product-default |
| **oranguru** | Yes (notify) | Runtime data contract → score → deliver | Partial — pipeline in `notifications/*`; contract types planned |
| **chatot** | Yes (suggest + delivery) | Delivery feedback + activity closure; no auto-send | Partial — Telegram + `recordActivity` on product CLIs |
| **ash** | Boundary only | Asana **Lambda + Chat SDK** — not pull ingest | Correct — PAT pull in Phase 1; no webhook automation here |
| **arceus** | Build-time only | Route contributors to skills | Never runtime |
| **xatu** | Adapted | `ownerUserId` permission boundary | Enforced in retrieve + node writes |
| **conkeldurr** | Adapted | Platform products (Persist, etc.) | libSQL POC; Neptune/Persist is production graph path |

18 other kit agents (e.g. `kadabra`, `machamp`) are out of Chief of Staff Phase 1 scope. Pin: [external/soofi-team-kit.lock](../external/soofi-team-kit.lock).

### Espeon compliance (local RAG)

Per [espeon.md](https://github.com/soofi-xyz/soofi-xyz-team-kit/blob/8e85bc148f5a8c101c135f3cb72a4cfcab176126/agents/espeon.md) and [`apps/cos-runtime/AGENTS.md`](../apps/cos-runtime/AGENTS.md):

- **Source/chunk/link model:** `rag_sources`, `rag_chunks`, `rag_links` (populated on chunk via `CHUNK_OF`)
- **Embeddings:** Vercel AI SDK — `local-hash` (demo) or Bedrock `cohere.embed-v4:0`
- **CLI:** `pnpm inspect`, `pnpm query`, `pnpm paths` — **JSON stdout default**; `--format text` for humans; `RAG_DEBUG` on stderr
- **AWS:** optional `COS_RAG_BACKEND=opensearch` — contributor path only; not the executive demo default

## Team-Kit Automation Boundary

BigBoss is a **composition layer**. Do not reimplement capabilities already owned by hosted team-kit agents.

Before implementing any automation, route through team-kit first:

- Team-kit agents catalog: [soofi-xyz-team-kit agents](https://github.com/soofi-xyz/soofi-xyz-team-kit/tree/main/agents)
- Asana adapter package: [soofi-xyz/chat-adapter-asana](https://github.com/soofi-xyz/chat-adapter-asana)

| Capability | Primary owner | COS role |
|---|---|---|
| Pull connector DI / OAuth patterns | `/arceus` → `build-cos-connectors` skill | COS implementation; `/ash` owns Asana Lambda automation path only |
| Local RAG pattern | `/espeon` (`build-local-rag-pocs`) | COS overlay only |
| Production RAG | `/alakazam` (`build-rag-systems`) | Deferred to Phase 2+ |
| Notification runtime/scoring | `/oranguru` (`assemble-communication-runtime`) | COS runs `pnpm notify` — not `/oranguru` at runtime |
| Suggestion/comms lifecycle | `/chatot` (`manage-communication-activity`) | COS runs `pnpm suggest` / `approve` — not `/chatot` at runtime |
| Permission boundaries | `/xatu` (`select-communication-audience`) | Enforce `ownerUserId`; no custom RBAC framework |

### Asana integration modes

- **Phase 1 (product runtime in this repo):** pull-based ingest (PAT + REST API) into the knowledge graph.
- **Phase 2+ (event-driven automation):** use `chat-adapter-asana` (+ companion CDK package) for webhook/event workflows.
- Do **not** build custom Asana webhook automation in this repo when adapter-based automation applies.

## Security and Boundaries

- No auto-send behavior in prototype
- Secrets never logged or committed
- Token and credential handling scoped to configured user
- Retrieval and context operations enforce per-user boundaries (`ownerUserId`)
- Vercel AI SDK policy prevents direct provider SDK sprawl

## Supported Features (Phase 2)

- Multi-account Google ingest (calendar/email)
- Multi-account Microsoft ingest (calendar/email via Microsoft Graph)
- Asana workspace/project/task/comment ingestion
- Unified timeline brief
- Cross-source contextual retrieval
- Notification generation
- Suggestion generation with human gate
- Conversation/activity history persistence

## Deferred / Future

- SMS/WhatsApp/X delivery channels (Telegram proves extensibility; others Phase 3+)
- External channel delivery adapters beyond Telegram
- Hosted secret management and cloud-first runtime components
- Production-scale graph and retrieval infrastructure — see DEPLOYMENT § Customer production prerequisites (AWS RAG)

## Related Canonical Docs

- Acceptance criteria and status: `docs/ACCEPTANCE_CRITERIA.md`
- Setup and operational runbook: `docs/DEPLOYMENT.md`
