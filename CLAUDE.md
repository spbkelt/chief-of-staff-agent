# Chief of Staff Agent (BigBoss)

**BigBoss** is a Cursor-first Chief of Staff agent for the soofi-xyz ecosystem. It consolidates an executive's Google Calendar, Gmail, and Asana data into a local knowledge graph, generates contextual notifications, and drafts suggested responses — all without sending anything automatically.

**Always read `MEMORY.md` first** — it tracks current phase, decisions, known bugs, and blockers.

**Acceptance checklist (canonical 23 criteria + status + proof):** `docs/ACCEPTANCE_CRITERIA.md` — single source for “Key Features & Acceptance Criteria”.

**Canonical architecture reference:** `docs/ARCHITECTURE.md`  
**Canonical setup/deployment reference:** `docs/DEPLOYMENT.md`  
**Contributor reference:** `CONTRIBUTING.md`

---

## Customer Call Alignment — Non-Negotiable

1. **Speed + reuse first.** Reuse soofi/prism skills and patterns (agent format, connector DI, RAG, notification scoring) before writing anything new.
2. **Executable proof over words.** Executive proof = Cursor `@bigboss` + live APIs. CI = `pnpm acceptance` + `pnpm demo-fixtures` only.
3. **No mock ingest/RAG on product paths.** `COS_ALLOW_FIXTURES` for Vitest (`__tests__/`) and `pnpm demo-fixtures` (contributor CI) only. Never use on product paths.
4. **Cursor-only operator UX. pnpm-backed execution and proof.** Executives use `@bigboss` in Cursor; BigBoss proposes pnpm commands as one-click terminal actions. Contributors use CLI directly. See `docs/DEPLOYMENT.md`.
5. **Rollup:** 23 ✅ | 0 ⚠️ | 0 ⏳ (AC-13: delivery adapter extensibility + Telegram; SMS/WA/X ingest Phase 3+).

---

## Developer Workflow — Soofi Team-Kit

Install team-kit before feature work: `pnpm setup-soofi-plugin`  
Verify: `pnpm verify-soofi-plugin`

Do NOT design greenfield agent patterns. **Compose before implementing**: if a hosted team-kit agent already owns a capability pattern, wire to it instead of reimplementing.

Route through team-kit specialists:
- `/arceus` — start here for all ambiguous or multi-system tasks
- `/ash` — Asana Lambda automation builder (`chat-adapter-asana`, CDK). For pull connectors (Google/Microsoft/Asana ingest): `/arceus` → `build-cos-connectors` skill
Asana automation boundary:
- Phase 1 pull ingest remains in this repo.
- Event-driven/webhook Asana automation uses [soofi-xyz/chat-adapter-asana](https://github.com/soofi-xyz/chat-adapter-asana).
- Do not build custom Asana webhook automation here when adapter path applies.

- `/espeon` — local RAG POC (H3+)
- `/alakazam` — AWS RAG / Bedrock production path
- `/chatot` — email/communication lifecycle (H4.5+)
- `/xatu` — permission boundaries
- `/oranguru` — notification design / scoring patterns (H4+; COS runs `pnpm notify`)
- `/chatot` — suggestion and delivery lifecycle patterns (H4.5+; COS runs `pnpm suggest`)
- `/conkeldurr` — platform product reuse decisions

Do NOT copy or vendor team-kit skills into this repo.  
Do NOT mark an AC complete on static mock data alone.  
**COS-only scope:** Implement Chief of Staff product code in this repo only. If a team-kit parent skill or specialist agent already owns a pattern (Lambda runtime, communication scoring, production RAG, etc.), compose it — do not reimplement here.  
COS-specific skills in `skills/build-cos-*/` are overlays — load team-kit parent skill first.  
See `docs/ARCHITECTURE.md` for scope boundary and extensibility model.

**Before writing new code:** Route through `/arceus`. If the parent skill covers it, do not duplicate that pattern in runtime code or overlay skills.

---

## Phase 1 Packaging Scope

**This repo is the complete Phase 1 customer deliverable.**

Do NOT create or require an upstream PR to `soofi-xyz/soofi-xyz-team-kit`.  
Do NOT add Copilot-specific packaging (deferred to Phase 2).  
Runtime code stays in this repo; feature development requires the local team-kit plugin (see Developer Workflow above). Team-kit is a dev-time Cursor local plugin, not a runtime or vendored dependency.

Required proof commands:
```
pnpm build          — TypeScript compile (must exit 0)
pnpm test           — 251+ Vitest (must be green)
pnpm setup          — customer onboarding wizard (writes ~/.cos/config.json)
pnpm validate       — credential + schema checks
pnpm inspect        — node/edge counts by type
pnpm brief          — unified calendar timeline (today | tomorrow | week)
pnpm demo           — live E2E demo (real credentials required)
pnpm acceptance     — all of the above + file checks + AC coverage table
```

Contributor / CI only (not product proof commands):
```
pnpm demo-fixtures  — fixture E2E (COS_ALLOW_FIXTURES=true, CI path)
```

---

## Hard Constraints

These are non-negotiable. Violating any of them is a blocking issue.

1. **Never auto-send.** No code path sends email, Asana comments, or any message without `status === "approved"` AND an explicit human trigger. In the prototype there is no send capability at all. See `skills/build-cos-suggestions/SKILL.md`.
2. **No secrets in files.** `.env` is git-ignored. Secrets Manager paths are used in production. Never log `accessToken`, `refreshToken`, email addresses (raw), or email body text. Never commit real credentials.
3. **No direct LLM provider SDKs.** Use `ai` (Vercel AI SDK) for all LLM calls and embeddings. `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`, and `openai` direct SDK are forbidden.
4. **Email body text out of LangSmith traces.** LLM inputs must strip body content. Log only chunk IDs and metadata, never full message text.
5. **LangSmith wired before any prompt iteration.** `LangSmith.flush()` is required at every AI entrypoint. See observability rules below.
6. **TypeScript only.** No Python, no JavaScript without types, no raw shell scripts that do business logic.
7. **Vitest for tests.** No Jest, no Mocha.
8. **CDK for IaC (Phase 2+).** No Terraform, SAM YAML, or raw CloudFormation.

---

## Technology Mandates

| Concern | Required choice |
|---|---|
| LLM / embeddings | `ai` package (Vercel AI SDK) |
| LLM backend (default) | Amazon Bedrock via `@ai-sdk/amazon-bedrock` |
| LLM backend (secondary path) | Provider path via Vercel AI SDK abstraction |
| Knowledge graph (prototype) | libSQL via `@libsql/client` at `~/.cos/graph.db` |
| Knowledge graph (production) | DynamoDB single-table + OpenSearch Serverless |
| Secret storage (prototype) | `.env` file (git-ignored) |
| Secret storage (production) | AWS Secrets Manager at `/{stage}/cos/{userId}/{connectorId}` |
| Schema validation | `zod` — all external inputs and env vars |
| Telemetry | `langsmith` package; AWS Powertools in Lambda |
| AWS region | `us-east-2` |
| Runtime | Node.js; `tsx` for CLI |

---

## Directory Map

```
chief-of-staff-agent/
├── CLAUDE.md                         ← you are here
├── docs/                             ← canonical docs (read before implementing)
│   ├── ACCEPTANCE_CRITERIA.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── archived/                     ← historical docs (git-ignored)
├── scripts/                          ← setup-soofi-plugin.sh, verify-soofi-plugin.sh
├── external/                         ← soofi-team-kit.lock (tested commit pin)
├── skills/                           ← task-specific implementation guides
│   ├── build-cos-connectors/
│   ├── build-cos-knowledge-graph/
│   ├── build-cos-rag/
│   ├── build-cos-notifications/
│   └── build-cos-suggestions/
├── apps/
│   └── cos-runtime/src/
│       ├── connectors/               → GoogleCalendar, Gmail, Asana, mock, registry
│       ├── graph/                    → libSQL schema, upsert helpers
│       ├── rag/                      → chunk, embed, retrieve
│       ├── notifications/            → generator, rules
│       ├── suggestions/              → generator
│       ├── history/                  → ConversationTurn store
│       ├── observability/            → LangSmith wrapper
│       ├── config/                   → Zod env validation
│       ├── auth/                     → Google OAuth, token helpers
│       └── cli/                      → setup, ingest, query, notify, suggest, approve, demo, validate
├── agents/
│   └── bigboss.md                    → Cursor agent definition
├── fixtures/                         → demo JSON (calendar, email, asana, embeddings)
├── lib/
│   └── cos-stack.ts                  → CDK placeholder (Phase 2)
├── .env.example                      → copy this; never commit .env
└── vitest.config.ts
```

---

## Commands

```bash
pnpm install           # install dependencies
pnpm build             # compile TypeScript
pnpm test              # run Vitest test suite
pnpm setup             # customer onboarding wizard (external users)

pnpm ingest            # pull data from all connectors (or --connector gcal|gmail|asana)
pnpm query -- "text"   # RAG query against knowledge graph
pnpm notify            # generate notifications
pnpm suggest -- <id>   # suggest response for thread-XXX | task-XXX | cal-XXX
pnpm brief             # unified calendar timeline (today | tomorrow | week)
pnpm inspect           # show node/chunk/embedding counts
pnpm validate          # check all credentials and connections
pnpm demo              # live E2E demo (real credentials required)
pnpm demo-fixtures     # fixture E2E (contributor CI only — COS_ALLOW_FIXTURES=true)
pnpm clean             # remove demo data (keeps credentials)
pnpm acceptance        # full acceptance proof suite (build+test+file checks+AC table)
pnpm setup-soofi-plugin  # install soofi team-kit Cursor local plugin (contributors only)
pnpm verify-soofi-plugin # verify team-kit plugin is installed and up to date
```

---

## Skills Index

Load skills in order: (1) `apply-engineering-guidelines` from team-kit, (2) parent skill from `~/.cursor/plugins/local/soofi-xyz/skills/`, (3) COS overlay from this repo. Reference architecture + scope boundaries in `docs/ARCHITECTURE.md`.

| Task | Team-kit parent (load first) | COS overlay | Agent |
|---|---|---|---|
| Add or modify a connector | `build-ai-agents` | `skills/build-cos-connectors/SKILL.md` | `/ash` |
| Change the knowledge graph schema | `build-ai-agents` | `skills/build-cos-knowledge-graph/SKILL.md` | `/ash` |
| Modify chunking, embedding, or retrieval (prototype) | `build-local-rag-pocs` | `skills/build-cos-rag/SKILL.md` | `/espeon` |
| RAG production migration (Phase 2+) | `build-rag-systems` | `skills/build-cos-rag/SKILL.md` | `/alakazam` |
| Change notification triggers or scoring | `assemble-communication-runtime` | `skills/build-cos-notifications/SKILL.md` | `/oranguru` |
| Modify response suggestion generation | `manage-communication-activity` | `skills/build-cos-suggestions/SKILL.md` | `/chatot` |
| Permission boundaries | `select-communication-audience` | *(team-kit only)* | `/xatu` |
| All tasks | `apply-engineering-guidelines` | — | `/arceus` |

Also read `docs/ARCHITECTURE.md` for COS-specific requirements.

---

## Auth Rules

- Product path: credentials in `~/.cos/config.json` (from `pnpm setup`); `.env` optional override; never commit either
- Before each connector sync: check `expiresAt - now < 5 minutes`; refresh if expiring
- On `401/403` from provider: throw `ConnectorAuthError`; surface re-auth prompt; do not retry indefinitely
- On refresh failure: pause sync, alert user, do not fall through silently
- Asana prototype: Personal Access Token only (PAT in `.env`); OAuth2 is Phase 2
- Never include credentials in any LLM prompt, log line, or LangSmith trace field

---

## Observability Rules

- Wire `langsmith` before writing any LLM prompt. No exceptions.
- Call `LangSmith.flush()` at the end of every AI entrypoint (CLI command or Lambda handler).
- Every LLM trace must include: `run_id`, `name`, `inputs.query` (text only, no email body), `inputs.retrievedChunkIds` (IDs only, never chunk text), `outputs.summary`, `usage.inputTokens`, `usage.outputTokens`.
- Forbidden in any log or trace: `accessToken`, `refreshToken`, raw email addresses, email body text, Asana comment text.
- Identity references in logs: `sha256(email)` only, never raw email.
- CloudWatch metrics live in `cos.ingestion.*`, `cos.rag.*`, `cos.notifications.*`, `cos.suggestions.*`, `cos.connector.*` namespaces (Phase 2+).

---

## Prototype vs Production

The prototype implements a **real** core loop (ingest → graph → RAG → LLM → suggest) using local libSQL and `.env` credentials. The following are deferred in Phase 1:

- SMS/WhatsApp/X delivery channels (Phase 3+ — Telegram proves extensibility)
- Multi-account per provider beyond Google
- Token auto-refresh to Secrets Manager (refresh persists to `~/.cos/config.json` on product path)
- AWS Secrets Manager
- Lambda / EventBridge / CDK
- Email/Asana send capability

Phase boundaries: `docs/ARCHITECTURE.md`
