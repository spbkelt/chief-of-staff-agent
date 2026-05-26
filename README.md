# Chief of Staff Agent (BigBoss)

BigBoss is an **executive-focused coordination agent** in Cursor. It consolidates operational and communication data into a **unified intelligence layer**—knowledge graph, retrieval, notifications, and human-gated suggestions — **never auto-sends**.

The platform leverages the [soofi-xyz agent network](https://github.com/soofi-xyz/soofi-xyz-team-kit) **at build time** to implement proven patterns; **at runtime** you use only `@bigboss` in this repo. Guided first run: `@bigboss setup` → `@bigboss validate` → `@bigboss ingest` → `@bigboss brief today`. See [agents/bigboss.md](agents/bigboss.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (full command map).

**Phase 2 product:** real APIs only for operators (no fixture demo in product paths).  
**AC rollup:** **21 ✅ Proven | 1 ⚠️ Partial | 0 ⏳ Deferred** (AC-13 Telegram adapter shipped; SMS/WhatsApp/X deferred).

---

## Goals

- **Keep the experience simple and accessible for non-technical users** — work in Cursor with `@bigboss`; one-time setup in plain language.
- **Create a reusable, extensible foundation for future agent development** — packaged soofi agent + connector registry; optional team-kit specialists.

---

## Start here

The product interface is `@bigboss` in Cursor chat. Where BigBoss needs to run a command, it proposes a single terminal action — you click **Run** to approve. You do **not** type `pnpm` commands directly. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for setup and run guidance.

### 1. Prepare workspace

| Step | Action |
|------|--------|
| 1 | Install [Cursor](https://cursor.com) |
| 2 | Open this repo **root** in Cursor (File → Open Folder) |
| 3 | Reload Window if needed (Cmd/Ctrl+Shift+P → Developer: Reload Window) |
| 4 | Confirm `.cursor-plugin/plugin.json` exists |

### 2. Activate BigBoss

**Agent picker:** open chat → select **bigboss** → `@bigboss setup`

**Or @ mention:** `@bigboss setup` in any chat pane

**Terminal:** only if BigBoss asks you to approve a single **Run** in the integrated terminal.

### 3. Daily use

After setup and ingest: `@bigboss brief me for today`

---

## What to say in Cursor (`@bigboss`)

| You say | BigBoss does |
|---------|----------------|
| `@bigboss setup` | 9-step wizard → `~/.cos/config.json` (Google OAuth guide, optional Asana/Microsoft/Telegram) |
| `@bigboss validate` | Health check all connected accounts |
| `@bigboss ingest` | Sync all sources (default: ±30d calendar, 30d Gmail) |
| `@bigboss ingest last 7 days` | Shorter window (`--period 7d`) |
| `@bigboss ingest calendar` / `mail` / `asana` | Sync one source |
| `@bigboss brief today` / `tomorrow` / `week` | Unified calendar timeline |
| `@bigboss query <question>` | RAG search (local demo uses on-device vectors) |
| `@bigboss notify list` | Priority notifications (LLM-scored) |
| `@bigboss notify dismiss` / `snooze <id> 2h` | Notification lifecycle |
| `@bigboss suggest <thread\|task\|cal>-<id>` | Draft reply (pending approval) |
| `@bigboss approve` / `reject <sr-id>` | Human gate — never auto-sends |
| `@bigboss history` | Conversation + activity log |
| `@bigboss graph stats` | Node + RAG counts (`pnpm inspect`) |
| `@bigboss demo` | One-shot E2E showcase |
| `@bigboss account list` / `disconnect` | Account management |

Natural language works (e.g. “brief me for today”). **Full CLI map (every flag):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#bigboss-command-reference) · [agents/bigboss.md](agents/bigboss.md)

---

## AC-02 — Reusable agent in the soofi ecosystem

- **Cursor plugin:** `.cursor-plugin/plugin.json` → `agents/bigboss.md`
- **Works standalone** — no team-kit required for customers
- **Optional team-kit for contributors** — org may install [soofi team-kit](https://github.com/soofi-xyz/soofi-xyz-team-kit) for routing and specialist guidance while **building** BigBoss. Customer operation still runs through `@bigboss` and `apps/cos-runtime`; team-kit subagents are **not** required and are **not** invoked on the live operator path.

---

## Contributor build-time guidance (optional)

If your org installed team-kit, use it only when **implementing or extending** BigBoss — not during normal executive operation. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § Runtime vs build-time.

| Intent | Build-time guidance |
|------|---------------------|
| Which team-kit pattern applies? | `@arceus` |
| Pull connectors / OAuth / ingest | `@arceus` + `build-cos-connectors` skill |
| Asana webhook / Lambda automation (Phase 2+) | `@ash` |
| Local RAG quality | `@espeon` |
| Production AWS RAG | `/alakazam` |
| Notification design patterns | `@oranguru` |
| Suggestion lifecycle patterns | `@chatot` |
| Permission boundaries | `@xatu` |

---

## Key Features & Acceptance Criteria

Canonical wording, AC numbering, rollup, gaps, and proof pointers (for Cursor contributors): **[docs/ACCEPTANCE_CRITERIA.md](docs/ACCEPTANCE_CRITERIA.md)**.

| AC | Criterion | Status |
|----|-----------|--------|
| AC-01 | Use the existing agent network framework from the soofi-xyz GitHub repository | ✅ |
| AC-02 | Package the solution as a reusable agent within the existing agent ecosystem | ✅ |
| AC-03 | Connect multiple calendar providers and accounts (personal + corporate) | ✅ |
| AC-04 | Aggregate calendar events into a unified timeline view | ✅ |
| AC-05 | Connect multiple email providers and accounts | ✅ |
| AC-06 | Ingest email threads and metadata into the knowledge graph | ✅ |
| AC-07 | Connect Asana workspaces, projects, tasks, and comments | ✅ |
| AC-08 | Consolidate all connected data sources into a centralized knowledge graph | ✅ |
| AC-09 | Implement a RAG pipeline to retrieve contextual information across systems | ✅ |
| AC-10 | Generate contextual notifications based on meetings, tasks, communications, and priorities | ✅ |
| AC-11 | Suggest intelligent responses using available organizational and communication context | ✅ |
| AC-12 | Preserve conversation and activity history across connected platforms | ✅ |
| AC-13 | Support extensibility for SMS, WhatsApp, Telegram, X, and additional communication channels | ⚠️ Partial |
| AC-14 | Provide a modular connector architecture for adding future integrations | ✅ |
| AC-15 | Enable secure authentication and token management for all connected services | ✅ |
| AC-16 | Support user-specific permission boundaries across connected accounts | ✅ |
| AC-17 | Provide an executive-friendly workflow that does not require software development knowledge | ✅ |
| AC-18 | Support operation directly within Cursor | ✅ |
| AC-19 | Minimize setup complexity for non-technical users | ✅ |
| AC-20 | Deliver an initial functional prototype within an estimated five-hour implementation scope | ✅ |
| AC-21 | Demonstrate end-to-end ingestion, retrieval, notification, and response suggestion workflows | ✅ |
| AC-22 | Document setup instructions for deploying the agent within the soofi-xyz ecosystem | ✅ |
| AC-23 | Ensure the platform can scale to additional agents and communication channels in future iterations | ✅ |

**Notes:** AC-13 ⚠️ — Telegram adapter ✅; SMS/WhatsApp/X Phase 3+. Full proof: [docs/ACCEPTANCE_CRITERIA.md](docs/ACCEPTANCE_CRITERIA.md).

---

## What works today

- Google Calendar + Gmail (per connected Google account); Asana optional (PAT)
- Microsoft Calendar + Mail (Azure AD OAuth, optional)
- Local graph at `~/.cos/graph.db` with **local-hash** RAG vectors (no AWS required for search on demo track)
- Configurable ingest window: `--period 7d`, `--past 2w`, `--future 1w` (see DEPLOYMENT)
- `pnpm embed` to backfill vectors without re-pulling APIs
- LLM for notify/suggest when configured (Bedrock SSO, OpenAI, or Anthropic)
- Human-gated suggestions (no send)
- Telegram delivery when configured in setup

## Not available yet

- SMS, WhatsApp, X
- Push notification delivery to phone
- Hosted OAuth relay / enterprise Secrets Manager

---

## Repository layout

| Path | Purpose |
|------|---------|
| `agents/bigboss.md` | Cursor agent definition (`@bigboss`) |
| `.cursor-plugin/` | Plugin manifest for Cursor |
| `apps/cos-runtime/` | TypeScript runtime (connectors, graph, RAG, CLI) |
| `docs/` | Architecture, deployment, acceptance criteria |
| `fixtures/` | Contributor/CI sample data only ([fixtures/README.md](fixtures/README.md)) |
| `skills/` | COS implementation overlays (load team-kit parent skills first) |
| `scripts/` | Bootstrap and team-kit setup (tracked); `scripts/infra/` is local-only |

## For contributors and CI

CLI, tests, and contributor workflows: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Architecture

Ingest (real APIs) → libSQL graph → RAG (live embed) → notifications → suggestions → **Cursor `@bigboss`**

Canonical architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)  
Canonical acceptance list: [docs/ACCEPTANCE_CRITERIA.md](docs/ACCEPTANCE_CRITERIA.md)  
Setup and deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
