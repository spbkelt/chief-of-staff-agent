# Acceptance Criteria (Canonical)

This is the single source of truth for the 23 "Key Features & Acceptance Criteria" items, their current status, and proof references.

Current rollup: **23 ✅ Proven | 0 ⚠️ Partial | 0 ⏳ Deferred**.

## Verbatim Criteria

| AC-ID | Criterion |
|---|---|
| AC-01 | Use the existing agent network framework from the soofi-xyz GitHub repository |
| AC-02 | Package the solution as a reusable agent within the existing agent ecosystem |
| AC-03 | Connect multiple calendar providers and accounts (personal + corporate) |
| AC-04 | Aggregate calendar events into a unified timeline view |
| AC-05 | Connect multiple email providers and accounts |
| AC-06 | Ingest email threads and metadata into the knowledge graph |
| AC-07 | Connect Asana workspaces, projects, tasks, and comments |
| AC-08 | Consolidate all connected data sources into a centralized knowledge graph |
| AC-09 | Implement a RAG pipeline to retrieve contextual information across systems |
| AC-10 | Generate contextual notifications based on meetings, tasks, communications, and priorities |
| AC-11 | Suggest intelligent responses using available organizational and communication context |
| AC-12 | Preserve conversation and activity history across connected platforms |
| AC-13 | Support extensibility for SMS, WhatsApp, Telegram, X, and additional communication channels |
| AC-14 | Provide a modular connector architecture for adding future integrations |
| AC-15 | Enable secure authentication and token management for all connected services |
| AC-16 | Support user-specific permission boundaries across connected accounts |
| AC-17 | Provide an executive-friendly workflow that does not require software development knowledge |
| AC-18 | Support operation directly within Cursor |
| AC-19 | Minimize setup complexity for non-technical users |
| AC-20 | Deliver an initial functional prototype within an estimated five-hour implementation scope |
| AC-21 | Demonstrate end-to-end ingestion, retrieval, notification, and response suggestion workflows |
| AC-22 | Document setup instructions for deploying the agent within the soofi-xyz ecosystem |
| AC-23 | Ensure the platform can scale to additional agents and communication channels in future iterations |

## Phase 1 Status

| AC-ID | Status | Notes |
|---|---|---|
| AC-01 | ✅ | Cursor plugin + soofi framework conventions |
| AC-02 | ✅ | Reusable `@bigboss` agent packaging in repo |
| AC-03 | ✅ | Google Calendar + Microsoft Calendar connectors; multi-account per provider |
| AC-04 | ✅ | Unified timeline via brief workflow |
| AC-05 | ✅ | Gmail + Microsoft Mail connectors; multi-account per provider |
| AC-06 | ✅ | Email threads and metadata ingested into graph |
| AC-07 | ✅ | Asana workspaces/projects/tasks/comments ingestion |
| AC-08 | ✅ | Centralized graph across connected sources |
| AC-09 | ✅ | RAG pipeline implemented and used in runtime |
| AC-10 | ✅ | Contextual notifications generated |
| AC-11 | ✅ | Intelligent suggestions with human approval gate |
| AC-12 | ✅ | Conversation/activity history preserved |
| AC-13 | ✅ | `NotificationDeliveryAdapter` + Telegram; registry extensibility for SMS/WhatsApp/X (ingest Phase 3+) |
| AC-14 | ✅ | Modular connector architecture in place |
| AC-15 | ✅ | Secure auth/token handling for current scope |
| AC-16 | ✅ | User-specific permission boundary enforcement (`ownerUserId`) |
| AC-17 | ✅ | Executive-friendly Cursor workflow |
| AC-18 | ✅ | Operates directly within Cursor |
| AC-19 | ✅ | Setup remains minimal for non-technical users |
| AC-20 | ✅ | Functional prototype scope delivered |
| AC-21 | ✅ | End-to-end ingest → retrieve → notify → suggest demonstrated |
| AC-22 | ✅ | Setup docs available for ecosystem deployment |
| AC-23 | ✅ | Scalable architecture path for future channels/agents |

## Proof References

- Architecture, team-kit agent audit, Espeon CLI: `docs/ARCHITECTURE.md`
- Setup/deployment instructions: `docs/DEPLOYMENT.md`
- Contributor commands and live API checklist: `CONTRIBUTING.md`

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ Proven | Verified with real APIs and/or Cursor executive path |
| ⚠️ Partial | Partially implemented — scope note below |
| ⏳ Deferred | Phase 2+ — no stub connectors claimed as delivered |

## Proof Model

- **Executives:** `@bigboss` + live APIs + approved `pnpm` Run — team-kit subagents are **not** proof steps.
- **Contributors:** `pnpm acceptance` / `pnpm demo-fixtures` (CI only).
- **AC-09:** Proven on **local** libSQL RAG; **production** OpenSearch path documented in ARCHITECTURE/DEPLOYMENT — optional via bootstrap + Bedrock.

## Executive Proof (operators — Cursor only)

**QuickStart:** `@bigboss setup` → `@bigboss validate` → `@bigboss ingest` → daily commands

1. Open repo root in Cursor → **bigboss** in agent picker
2. `@bigboss setup` → Google, Microsoft (optional), Asana, Bedrock, optional Telegram
3. `@bigboss validate`
4. `@bigboss ingest` (optional `pnpm embed -- --reindex` when switching RAG backends)
5. `@bigboss brief today` · `@bigboss query …` · `@bigboss notify list` · `@bigboss suggest` · `@bigboss approve sr-…` · `@bigboss history`
6. Optional one-shot: `@bigboss demo`

No fixture ingest or mock RAG on this path. See [README.md](../README.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Contributor Proof

```bash
pnpm acceptance          # build + test + file checks
pnpm demo-fixtures       # COS_ALLOW_FIXTURES — fixture E2E only (contributor CI)
```

Live API checklist: [CONTRIBUTING.md](../CONTRIBUTING.md)

## Per-Criterion Proof

| AC | Description | Status | Proof |
|---|---|---|---|
| AC-01 | soofi agent network framework | ✅ | `.cursor-plugin/plugin.json`; `@bigboss` in Cursor |
| AC-02 | Reusable agent in ecosystem | ✅ | `agents/bigboss.md`; standalone + optional contributor team-kit |
| AC-03 | Multiple calendar providers + accounts | ✅ | Google Calendar + Microsoft Calendar; multi-account per provider |
| AC-04 | Unified timeline | ✅ | `@bigboss brief`; `brief` CLI |
| AC-05 | Multiple email providers + accounts | ✅ | Gmail + Microsoft Mail; multi-account per provider |
| AC-06 | Email threads in graph | ✅ | Real ingest + dedup tests |
| AC-07 | Asana WS/proj/task/comment | ✅ | Real Asana ingest |
| AC-08 | Centralized knowledge graph | ✅ | `inspect` / graph tests |
| AC-09 | RAG pipeline | ✅ | Local libSQL + live embed + `query`; OpenSearch optional (`/alakazam`) |
| AC-10 | Contextual notifications | ✅ | `notify` + live LLM |
| AC-11 | Suggested responses | ✅ | `suggest` + approve; no auto-send |
| AC-12 | Conversation + history | ✅ | history store + demo/live |
| AC-13 | SMS/WhatsApp/Telegram/X extensibility | ✅ | Delivery adapters (`notifications/delivery/`); Telegram shipped; registry for future channels |
| AC-14 | Modular connector architecture | ✅ | DI + connector tests |
| AC-15 | Secure auth + tokens | ✅ | setup → `~/.cos/config.json` 0600 |
| AC-16 | Permission boundaries | ✅ | `ownerUserId` on all nodes |
| AC-17 | Executive-friendly | ✅ | Cursor-only README |
| AC-18 | Operate in Cursor | ✅ | Primary surface `@bigboss` |
| AC-19 | Minimal setup | ✅ | Workspace + setup + brief |
| AC-20 | 5-hour prototype scope | ✅ | Phase 1–2 delivered |
| AC-21 | E2E workflows | ✅ | Live demo path / Cursor chain |
| AC-22 | Setup documentation | ✅ | README + DEPLOYMENT.md |
| AC-23 | Scale agents + channels | ✅ | Connector registry + delegation docs |

## Rollup Summary

| Status | Count |
|---|---|
| ✅ Proven | 23 |
| ⚠️ Partial | 0 |
| ⏳ Deferred | 0 |

## AC-to-Team-Kit Agent Mapping

**Runtime proof** for every AC is `@bigboss` + `apps/cos-runtime` (and approved `pnpm` where applicable). The table below is **build-time pattern guidance** for contributors — not live subagent orchestration when an operator runs the product.

| AC-ID | Demo / Phase 1 runtime proof | Customer / production target | Build-time agent(s) |
|---|---|---|---|
| AC-01 | `.cursor-plugin` + `@bigboss` | Same + optional org team-kit for builders | `/arceus` |
| AC-02 | `agents/bigboss.md` packaging | Marketplace multi-agent (future) | `/arceus`, `/conkeldurr` |
| AC-03 | `pnpm ingest` Google + Microsoft calendars | More providers via registry | `/arceus` + `build-cos-connectors` |
| AC-04 | `@bigboss brief` | Hosted brief API (future) | `/arceus` |
| AC-05 | Gmail + Microsoft mail ingest | More mail providers | `/arceus` + `build-cos-connectors` |
| AC-06 | Email threads in graph | Same on DynamoDB | `/arceus` + `build-cos-connectors` |
| AC-07 | Asana pull ingest | Webhooks via `chat-adapter-asana` + `/ash` | `/arceus`; `/ash` Phase 2+ only |
| AC-08 | libSQL centralized graph | Persist / Neptune path | `/arceus` + `build-cos-connectors` |
| AC-09 | Local RAG `pnpm query` + ingest embed | OpenSearch + `/alakazam` | `/espeon` now; `/alakazam` gated |
| AC-10 | `pnpm notify` + rules | Scheduled push (future) | `/oranguru` |
| AC-11 | `pnpm suggest` + `approve`; no send | Send adapters (future) | `/chatot` |
| AC-12 | `pnpm history` + activity events | Cross-platform mirror (future) | `/chatot` guided |
| AC-13 | Telegram + delivery adapter interface | SMS/WA/X ingest providers (Phase 3+) | `/oranguru`, `/chatot` |
| AC-14 | Connector registry | Same in Lambda ingest | `/arceus` + `build-cos-connectors` |
| AC-15 | `~/.cos/config.json` | Secrets Manager | `/arceus`, `/xatu` |
| AC-16 | `ownerUserId` enforcement | OpenSearch filter | `/xatu` |
| AC-17–19 | Cursor `@bigboss` UX | Same | `/arceus` |
| AC-20–21 | Prototype + `@bigboss` E2E (`validate`, `ingest`, `notify`, `query`, `demo`) | — | `/arceus` |
| AC-22 | README + DEPLOYMENT | Hosted runbook | `/arceus` |
| AC-23 | Registry + adapters | `/conkeldurr` boundaries | `/conkeldurr`, `/arceus` |

### Build-time detail (contributors)

| AC-ID | Primary team-kit agent(s) | Ownership mode | Notes |
|---|---|---|---|
| AC-01 | `/arceus` | routing/advisory | Team-kit usage pattern + engineering guardrails |
| AC-02 | `/arceus`, `/conkeldurr` | routing/advisory | Packaging pattern alignment and ecosystem fit |
| AC-03 | `/arceus` + `build-cos-connectors` skill | COS implementation | Google Calendar ✅ + Microsoft Calendar ✅ |
| AC-04 | `/arceus` | routing/advisory | Unified timeline is COS product behavior |
| AC-05 | `/arceus` + `build-cos-connectors` skill | COS implementation | Gmail ✅ + Microsoft Mail ✅ |
| AC-06 | `/arceus` + `build-cos-connectors` skill | COS implementation | Email ingestion schema/connectors in COS runtime |
| AC-07 | `/arceus` + `build-cos-connectors` skill; `/ash` for webhook path | COS pull + adapter boundary | Pull ingest in COS; event automation via `chat-adapter-asana` + `/ash` |
| AC-08 | `/arceus` + `build-cos-connectors` skill | COS implementation | Central graph model and upserts remain COS-owned |
| AC-09 | `/espeon`, `/alakazam` | team-kit-owned pattern | Local RAG now; production RAG path owned by team-kit pattern |
| AC-10 | `/oranguru` | team-kit-owned pattern | Notification runtime/scoring pattern reused with COS overlay |
| AC-11 | `/chatot` | team-kit-owned pattern | Suggestion/comms lifecycle pattern reused with COS overlay |
| AC-12 | `/chatot` | COS implementation (team-kit guided) | History persistence implemented in COS with team-kit guidance |
| AC-13 | `/oranguru`, `/chatot` | COS implementation (team-kit guided) | Delivery adapter extensibility in COS; Telegram shipped |
| AC-14 | `/arceus` + `build-cos-connectors` skill | COS implementation | Connector modularity follows `build-cos-connectors` skill pattern |
| AC-15 | `/arceus`, `/xatu` | COS implementation | Auth/token handling in COS; boundary semantics via `/xatu` |
| AC-16 | `/xatu` | team-kit-owned pattern | Permission boundary semantics and audience-bound context |
| AC-17 | `/arceus` | routing/advisory | Executive-friendly workflow is product UX in COS |
| AC-18 | `/arceus`, `/conkeldurr` | routing/advisory | Cursor operation model and packaging conventions |
| AC-19 | `/arceus` | routing/advisory | Setup simplicity is product UX/documentation concern |
| AC-20 | `/arceus` | routing/advisory | Prototype scope governance and acceptance framing |
| AC-21 | all specialists via `/arceus` | routing/advisory | End-to-end demo stitches multiple owned patterns |
| AC-22 | `/arceus` | routing/advisory | Documentation and operator guidance alignment |
| AC-23 | `/conkeldurr`, `/arceus` | routing/advisory | Scalability path depends on modular product boundaries |

## Team-Kit Module Alignment

How each `apps/cos-runtime` module maps to the soofi team-kit parent skill, current fidelity, and AWS production target. **Principle:** runtime is custom TypeScript; AWS is the production substrate per team-kit specs. All LLM/embedding calls use the Vercel AI SDK (`ai` package).

| cos-runtime module | Team-kit parent skill | Current implementation | AWS production target |
|---|---|---|---|
| `connectors/` (gcal, gmail, asana, ms-calendar, ms-mail) | `build-cos-connectors` → `build-ai-agents` | libSQL connector registry + DI; live Google/Microsoft/Asana APIs | Same; connector secrets → AWS Secrets Manager (`/{stage}/cos/{userId}/{connectorId}`) |
| `graph/` (libSQL) | `build-cos-knowledge-graph` → `build-ai-agents` | libSQL single-table (`~/.cos/graph.db`); rawHash dedup; upsertNode/getNode | `graph/dynamo-store.ts` — DynamoDB single-table (pk=canonicalId, sk=nodeType, GSI ownerUserId+nodeType) |
| `rag/embed.ts` + local retrieve | `build-cos-rag` → `build-local-rag-pocs` | libSQL rag_chunks; Vercel AI SDK `embed()`; cohere.embed-v4:0 (1024 dims) | `rag/opensearch-store.ts` — OpenSearch Serverless knn_vector (1024 dims); SigV4 auth |
| `llm/provider.ts` | `build-cos-rag` → `build-rag-systems` | Vercel AI SDK: Bedrock (SSO or keys), OpenAI, Anthropic+OpenAI-embed | Same; `COS_RAG_BACKEND=opensearch` switches retrieval to OpenSearch |
| `notifications/` (generator, lifecycle) | `build-cos-notifications` → `assemble-communication-runtime` | In-process LLM scoring + libSQL dedup; console + Telegram delivery | `lambda/notification-push.ts` — EventBridge Lambda; CDK: `lib/cos-stack.ts` |
| `notifications/delivery/` adapters | `build-cos-notifications` → `assemble-communication-runtime` | TelegramDeliveryAdapter + ConsoleDeliveryAdapter | Same; Lambda reads TELEGRAM_BOT_TOKEN from env (Secrets Manager via CDK) |
| `suggestions/` (generator, lifecycle) | `build-cos-suggestions` → `manage-communication-activity` | Pending → approved/rejected/modified; ownerUserId check | Same; no auto-send; human approval before outbound action |
| `history/` (store, record-activity) | `build-cos-knowledge-graph` → `build-ai-agents` | ActivityEventNode for product mutations | DynamoDB when `COS_GRAPH_BACKEND=dynamo` |
| `config/aws-credentials.ts` | (COS-specific) | SSO via `fromSSO({profile})` or static keys | Same; SSO recommended for production |
| `lib/cos-stack.ts` | (CDK — Phase 2+) | DynamoDB + OpenSearch Serverless + Lambda + EventBridge | `npx cdk deploy --profile cos-default` |

### Scope boundary

- **In this repo:** Chief of Staff product code — connectors, graph, RAG, notifications, suggestions, history, LLM provider, CLI, CDK stack.
- **In team-kit (dev-time only):** Parent skill patterns and specialists (`/alakazam`, `/espeon`, `/oranguru`, `/chatot`, `/xatu`, `/ash`, `/arceus`). Loaded as a Cursor local plugin — not vendored here.
- **Never duplicated:** Generic RAG frameworks, communication scoring, audience selection — compose from team-kit skills.

### ownerUserId boundary (AC-16)

Every read path must filter by `ownerUserId`:

- `rag/retrieve.ts` — mandatory in `RetrievalFilter`
- `rag/opensearch-store.ts` — `filter: [{ term: { ownerUserId } }]` on knn queries
- `graph/dynamo-store.ts` — GSI queries keyed on `ownerUserId`
- `notifications/generator.ts` — all queries scoped to `ownerUserId`

Agent-level audit and Espeon CLI compliance: `docs/ARCHITECTURE.md` § Team-kit alignment. Pin: `external/soofi-team-kit.lock` (`8e85bc1`).

## Maintenance Rule

When acceptance status changes, update this file only (verbatim criteria, status table, and per-criterion proof).
