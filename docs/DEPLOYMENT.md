# Deployment and Setup

This document is the canonical setup/deployment reference for operators and contributors.

## Operator Path — Cursor-Only UX, pnpm-Backed Execution

The product interface is `@bigboss` in Cursor chat. Where BigBoss needs to run a command, it proposes a single terminal action — you click **Run** to approve. You never type `pnpm` commands directly.

1. Open repository root in Cursor
2. Select **bigboss** in the agent picker (or `@bigboss` in chat)
3. Run onboarding through chat:
   - `@bigboss setup` → 9-step wizard → `~/.cos/config.json`
   - `@bigboss validate` → credential + schema health
   - `@bigboss ingest` → pull Google (and optional Asana/Microsoft)
   - `@bigboss brief today` → unified calendar timeline

4. Optional first showcase: `@bigboss demo` (maps to `pnpm demo` — full ingest → RAG → notify → suggest → brief)

For operators, daily usage stays in Cursor chat. The pnpm layer handles execution transparently.

Canonical command map: **[BigBoss command reference](#bigboss-command-reference)** below. Agent-facing copy: [agents/bigboss.md](../agents/bigboss.md).

---

## BigBoss command reference

Every row is **Say in Cursor** → **Run** (repo root). Natural language works (e.g. “brief me for today” → `@bigboss brief today`).

### Onboarding and health

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss setup` | `pnpm setup` | Google OAuth (guided substeps A–D in wizard), optional Microsoft/Asana, LLM, local vs AWS backends, Telegram |
| `@bigboss validate` | `pnpm validate` | Owner email, connectors, Bedrock/OpenAI keys, Telegram |
| `@bigboss graph stats` | `pnpm inspect` | JSON: graph + `rag_sources` / `rag_chunks` / `rag_links` counts (`--format text` optional) |

### Sync (ingest) and embeddings

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss ingest` | `pnpm ingest` | Default window: past **30d**, calendar future **30d** |
| `@bigboss ingest last 7 days` | `pnpm ingest -- --period 7d` | Symmetric calendar ±7d; Gmail `newer_than:7d` |
| `@bigboss ingest last 2 weeks` | `pnpm ingest -- --past 2w` | Lookback only (override past, keep default future unless `--future` set) |
| `@bigboss ingest calendar` | `pnpm ingest -- --connector gcal` | Google Calendar only |
| `@bigboss ingest mail` | `pnpm ingest -- --connector gmail` | Gmail only |
| `@bigboss ingest asana` | `pnpm ingest -- --connector asana` | Skipped if no Asana PAT |
| Re-embed only (no API pull) | `pnpm embed` | Local-hash or cloud embed for pending `rag_chunks` |

**Ingest window flags** (combine with `--connector`):

| Flag | Meaning |
|------|---------|
| `--period 7d` | Past **and** calendar future both 7 days |
| `--past 14d` / `--since 14d` | Lookback only |
| `--future 7d` | Calendar horizon ahead only |
| `--window 1m` | Alias for `--period` |

**Units:** `d`/`days`, `w`/`weeks`, `m`/`months` (1 month = 30 days). Max **365** days per direction.

**Per-connector behavior:**

| Source | Window |
|--------|--------|
| Google Calendar / Microsoft Calendar | `timeMin` = now − past, `timeMax` = now + future |
| Gmail | `newer_than:{past}d in:inbox` (max 50 threads) |
| Microsoft Mail | `receivedDateTime ge` cutoff (max 50 messages) |
| Asana | All **open** tasks; **completed** only if completed within `past` |

Log line: `[ingest] window: past Nd, future Nd (calendar)`.

### Brief, query, and paths

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss brief today` | `pnpm brief -- --date today` | Unified calendar timeline |
| `@bigboss brief tomorrow` | `pnpm brief -- --date tomorrow` | |
| `@bigboss brief week` | `pnpm brief -- --date week` | |
| `@bigboss query <question>` | `pnpm query -- "<question>"` | RAG retrieval JSON (default); `--format text` for humans; threshold 0.65 |
| `@bigboss paths <criteria>` | `pnpm paths -- "<criteria>"` | Related executive sources (deep links + 1-hop graph); JSON default |

Agent parsing contract: [`apps/cos-runtime/AGENTS.md`](../apps/cos-runtime/AGENTS.md). Debug: `RAG_DEBUG=true` → stderr only.

**Local demo track:** vectors in `~/.cos/graph.db` (`local-hash` embeddings). Semantic quality is limited vs cloud embed — use **`@bigboss notify list`** for priority ranking when query scores are low.

### Notifications and suggestions

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss notify list` | `pnpm notify` | Scored alerts; Telegram if configured in setup |
| `@bigboss notify dismiss <id>` | `pnpm dismiss -- <id>` | |
| `@bigboss notify snooze <id> 2h` | `pnpm snooze -- <id> --hours 2` | |
| `@bigboss suggest thread-<id>` | `pnpm suggest -- thread-<id>` | Also `task-…`, `cal-…` |
| `@bigboss approve sr-<id>` | `pnpm approve -- sr-<id> --approve` | Never auto-sends |
| `@bigboss reject sr-<id>` | `pnpm approve -- sr-<id> --reject` | Same CLI as approve |

### History and accounts

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss history` | `pnpm history` | Conversation turns + activity events |
| `@bigboss account list` | `pnpm account` | Connected providers |
| `@bigboss account disconnect` | `pnpm disconnect -- <provider>` | Menu if provider omitted |

### Showcase and cleanup

| Say in Cursor | Run | Notes |
|---------------|-----|-------|
| `@bigboss demo` | `pnpm demo` | Live E2E: ingest → chunk/embed → notify → suggest → brief |
| Clear demo graph (keep credentials) | `pnpm clean` | |

### Contributor-only (do not offer executives)

| Command | Purpose |
|---------|---------|
| `pnpm build` / `pnpm test` / `pnpm acceptance` | CI proof |
| `pnpm demo-fixtures` | Fixture E2E (`COS_ALLOW_FIXTURES=true` only) |
| `pnpm setup-soofi-plugin` / `pnpm verify-soofi-plugin` | Team-kit dev plugin |

---

## Contributor Path (CLI + CI)

Contributors use the same commands as the **Run** column above, plus:

- `pnpm build` — TypeScript compile
- `pnpm test` — Vitest (289+)
- `pnpm acceptance` — full proof suite
- `pnpm demo-fixtures` — CI fixture path only

## Environment and Credentials

- Product/operator credentials are stored in `~/.cos/config.json`
- `.env` is optional and must remain uncommitted
- Never log or commit secrets/tokens
- Use validation before live runs

## Deployment Scope

Phase 1 is local/runtime-first and Cursor-centered.

Deferred production hardening items include cloud scheduling, hosted secrets, and expanded provider/channel integrations.

## Customer production prerequisites (future — AWS RAG)

When moving off the local demo track, follow [/alakazam](https://github.com/soofi-xyz/soofi-xyz-team-kit/blob/main/agents/alakazam.md) and `build-rag-systems` (pinned in [external/soofi-team-kit.lock](../external/soofi-team-kit.lock)):

- AWS account, region `us-east-2`, Bedrock model access (embed + LLM)
- OpenSearch Serverless (or team-kit SAM local + Docker OpenSearch for builders)
- DynamoDB for graph metadata; S3 for artifacts; IAM for Lambdas (Phase 2+ CDK in `lib/cos-stack.ts`)
- Migration: export libSQL `rag_*` tables → OpenSearch; **do not** claim production RAG on libSQL cosine alone

**Operators today (local demo track):** graph in `~/.cos/graph.db`, RAG search via **local-hash** vectors (no Bedrock for embeddings). **Notify/suggest** still use the LLM configured in setup (typically Bedrock SSO or API keys). AWS OpenSearch/Dynamo is optional via setup steps 6–7 + env vars below.

## Asana Integration Modes

- **Phase 1 (this repo):** pull-based ingest using Asana Personal Access Token + REST API into the knowledge graph.
- **Phase 2+ automation:** webhook/event-driven Asana flows use [soofi-xyz/chat-adapter-asana](https://github.com/soofi-xyz/chat-adapter-asana) (and companion CDK package where relevant).
- Do not add custom Asana webhook automation to this repo when adapter-based automation applies.

## Google OAuth (setup wizard)

The setup wizard (step 2) prints substeps **A–D**: consent screen → enable Calendar + Gmail APIs → OAuth client (Desktop app recommended) → **test users** while app is in Testing.

If sign-in shows **Access blocked / 403 access_denied**, add your Gmail under **Google Auth Platform → Audience → Test users**, wait ~1 minute, retry.

Redirect URI for Web application clients: `urn:ietf:wg:oauth:2.0:oob`

## Connector Filters

`pnpm ingest -- --connector <filter>` accepts:

| Filter | Resolves to |
|--------|-------------|
| `gcal` | All Google Calendar connectors |
| `gmail` | All Gmail connectors |
| `gcal-{id}` | Single Google Calendar account |
| `mscal` / `microsoft-calendar` | All Microsoft Calendar connectors |
| `msmail` / `microsoft-mail` | All Microsoft Mail connectors |
| `mscal-{id}` | Single Microsoft Calendar account |
| `asana` | Asana connector |

## Microsoft Prerequisites (Azure AD)

To connect a Microsoft account:

1. Register an app in [Azure Portal](https://portal.azure.com) → App registrations
2. Add a redirect URI (use `urn:ietf:wg:oauth:2.0:oob` for the setup wizard)
3. Grant delegated permissions: `Calendars.Read`, `Mail.Read`, `User.Read`, `offline_access`
4. Note Application (client) ID, Directory (tenant) ID, and a client secret
5. Provide these in `@bigboss setup` (step 4/7)

Microsoft account is optional; Google + Asana remain the minimum viable configuration.

## Telegram — chat ID (`pnpm setup` §10)

Private chat ([gist](https://gist.github.com/nafiesl/4ad622f344cd1dc3bb1ecbe468ff9f8a)) — order matters:

1. @BotFather → `/newbot` → copy token.
2. @BotFather → `/mybots` → your bot → **Bot settings** → **Group privacy** → **Disable**.
3. Open your bot in Telegram → send **`/start`** (activates the bot).
4. **Only then**, in a browser — insert the word `bot` before the token (no space):

   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`

5. Chat ID = `result[0].message.chat.id` in the JSON.

**If `"result": []`:** repeat `/start`, refresh the URL (each `getUpdates` consumes the queue). Still empty? `https://api.telegram.org/bot<TOKEN>/deleteWebhook`, then `/start` again. Revoke exposed tokens in @BotFather → `/revoke`.

## Executive Demo Script

> Use `@bigboss` in Cursor; each step maps to one **Run**. Full command map: [BigBoss command reference](#bigboss-command-reference).

**Defaults:** ingest **±30d** calendar / **30d** Gmail (override: `@bigboss ingest last 7 days`). Telegram in setup step **10** (Group privacy off → `/start` → browser `getUpdates`). SMS/WhatsApp/X deferred.

### QuickStart (first session)

| Step | Say | Run |
|------|-----|-----|
| 1 | `@bigboss setup` | `pnpm setup` |
| 2 | `@bigboss validate` | `pnpm validate` |
| 3 | `@bigboss ingest` | `pnpm ingest` |
| 4 | `@bigboss embed` | `pnpm embed` | If needed after ingest |
| 5 | `@bigboss demo` | `pnpm demo` | One-shot scripted E2E (see below) |
| 6 | `@bigboss brief today` | `pnpm brief -- --date today` |

### `pnpm demo` (scripted E2E)

Single pass over the product loop (real APIs only):

1. Preflight — config summary (graph/RAG/Telegram backends, no secrets)
2. Ingest — Google Calendar, Gmail, Asana (skip with `--skip-ingest`)
3. RAG — chunk, embed, OpenSearch index when `ragBackend=opensearch`
4. Query — default question or `--query "…"` (text output)
5. Notify — generate + deliver (Telegram when setup §10 configured; else console; max 3 in demo)
6. Suggest — draft from top notification (never auto-sends)
7. Brief + history — today’s calendar + demo session turns
8. Summary — `inspect` counts

```bash
aws sso login --profile cos-default   # if Bedrock SSO
source ~/.cos/aws-bootstrap-dev.env   # if AWS bootstrap used
export COS_OPENSEARCH_USE_LOCAL_EMBED=true   # optional: skip Bedrock embed quota

pnpm validate
pnpm demo
pnpm demo -- --skip-ingest              # reuse existing graph data
pnpm demo -- --query "overdue COS-SEED"
```

Exits non-zero if embed step fails for all pending chunks.

### 15-minute presenter script

| Step | Say | Demonstrates |
|------|-----|--------------|
| 1 | `@bigboss setup` | `~/.cos/config.json` (+ §10 Telegram optional) |
| 2 | `@bigboss validate` | Health check |
| 3 | `@bigboss demo` | Full scripted loop (or run steps 3–8 individually below) |
| 4 | `@bigboss brief today` | Calendar timeline |
| 5 | `@bigboss notify list` | Priority alerts |
| 6 | `@bigboss query …` | RAG |
| 7 | `@bigboss approve sr-<id>` | Human gate (never auto-sends) |

## AWS SSO Setup (Bedrock + DynamoDB + OpenSearch)

If you chose "Amazon Bedrock" + SSO in `pnpm setup`, the wizard **audits** `~/.aws/config` first (lists SSO profiles, honors `AWS_PROFILE`, removes duplicate `[profile …]` / `[sso-session …]` blocks into `~/.aws/config.cos-backup`), then reuses an existing profile when possible. It only creates or updates via **AWS CLI** (`aws configure set` for profiles, `aws configure sso-session` for new portals) — never raw append. To manually configure or verify:

```bash
# Configure SSO profile (interactive)
aws configure sso

# Authenticate (opens browser)
aws sso login --profile cos-default

# Verify identity
aws sts get-caller-identity --profile cos-default
```

`~/.aws/config` must separate **two regions**:

| Field | Meaning | Example |
|-------|---------|---------|
| `sso_region` on `[sso-session …]` | IAM Identity Center **home** region | `eu-west-1` |
| `region` on `[profile …]` | Default region for Bedrock/DynamoDB/OpenSearch | `us-east-1` |

Wrong `sso_region` causes `InvalidRequestException` on `aws sso login`.  
`cos-session` is a session **block name**, not a profile — always `aws sso login --profile cos-default`.

Example (reuse one session for multiple profiles):

```ini
[sso-session aws-toptal-lab]
sso_start_url = https://d-93679b56d3.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[profile cos-default]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = us-east-1
output = json
```

If login fails after duplicate blocks broke the file (`Unable to parse config file`), run `pnpm setup` step 5 (Bedrock) once to dedupe, or:

```bash
./scripts/fix-aws-sso-config.sh
aws sso login --profile cos-default
```

## Backend Switching (AWS vs Local)

| Backend | Env var | Value | Notes |
|---------|---------|-------|-------|
| Graph storage | `COS_GRAPH_BACKEND` | `dynamo` or `libsql` (default) | `dynamo` requires DynamoDB table |
| RAG search | `COS_RAG_BACKEND` | `opensearch` or unset (default **libSQL local-hash**) | `opensearch` requires collection endpoint + cloud embed |
| DynamoDB table | `COS_DYNAMO_TABLE` | table name | Default: `cos-graph` |
| OpenSearch endpoint | `COS_OPENSEARCH_ENDPOINT` | collection URL | From AWS console |

## AWS CLI bootstrap (one-off dev/test)

Full stack per [Espeon](https://github.com/soofi-xyz/soofi-xyz-team-kit/blob/8e85bc148f5a8c101c135f3cb72a4cfcab176126/agents/espeon.md) / `build-rag-systems` (DynamoDB, S3 corpus, OpenSearch, IAM, Lambda, EventBridge, SQS DLQ):

```bash
aws sso login --profile cos-default
chmod +x scripts/bootstrap-aws-cos.sh
./scripts/bootstrap-aws-cos.sh --profile cos-default --write-config
source ~/.cos/aws-bootstrap-dev.env
# Operator policy (see below — skip attach if you already have AdministratorAccess)
pnpm validate && pnpm ingest && pnpm embed && pnpm query -- "test"
```

### AWS RAG via re-ingest (preferred)

After bootstrap writes `~/.cos/config.json` (`graphBackend: dynamo`, `ragBackend: opensearch`, Bedrock SSO):

```bash
aws sso login --profile cos-default
pnpm validate
pnpm embed -- --reindex   # once: drop local-hash vectors so ingest re-embeds with Bedrock
pnpm ingest               # pull connectors → Dynamo nodes → chunk (libSQL) → Bedrock embed → OpenSearch index
pnpm query -- "overdue COS-SEED" | jq '{belowThreshold, best: .matches[0].rawScore}'
```

`pnpm ingest` applies `~/.cos/config.json` backends automatically (Dynamo + OpenSearch). RAG chunk rows stay in `~/.cos/graph.db`; search uses OpenSearch.

### Switch existing local graph without re-pull (`migrate-aws-rag`)

If you already ingested locally and only need Bedrock + OpenSearch on existing chunks:

```bash
aws sso login --profile cos-default
pnpm migrate-aws-rag --dry-run
pnpm migrate-aws-rag
```

Flags: `--skip-links`, `--skip-embed`, `--dry-run`. Re-embed only: `pnpm embed -- --reindex`.

**Creates (stage=dev, region=us-east-2):**

| Resource | Name |
|----------|------|
| DynamoDB KG | `cos-graph-dev` |
| DynamoDB idempotency | `cos-rag-idempotency-dev` |
| OpenSearch Serverless | `cos-vectors-dev` |
| S3 corpus / ingest / artifacts | `cos-rag-*-dev-{accountId}` |
| SQS DLQ | `cos-rag-ingest-dlq-dev` |
| IAM operator policy | `CosBigBossOperator-dev` (scoped operator access; see below) |
| Lambda + EventBridge | `cos-notification-push-dev` (every 15 min) |

**Operator IAM policy + SSO:** `aws iam attach-role-policy` **does not work** on `AWSReservedSSO_*` roles (`UnmodifiableEntity`). Those roles are owned by IAM Identity Center.

- **`sso_role_name = AdministratorAccess`** (e.g. `cos-default`): you already have account admin — **skip attach**. Bootstrap still registers your session in the OpenSearch **data access** policy.
- **Custom permission set:** IAM Identity Center → **Permission sets** → your set → **Customer managed policies** → attach `CosBigBossOperator-dev` → **Save** → **Assign** (or wait for propagation).

OpenSearch Serverless also requires your principal in the collection **data access policy** (bootstrap does this from `sts get-caller-identity` on first run).

**OpenSearch indexing:** Serverless vector collections do not allow client `_id` on bulk index; COS stores `canonicalId` in the document and deletes-by-query before re-index. If Bedrock embedding hits daily quota during ingest, use local-hash vectors for demo:

```bash
export COS_OPENSEARCH_USE_LOCAL_EMBED=true
pnpm ingest
```

`--minimal` = DynamoDB + OpenSearch only. OpenSearch defaults to **public network** for laptop dev (`--private-network` to lock down).

Teardown (reverse order — EventBridge → Lambda → IAM → OpenSearch → DynamoDB → SQS → S3):

```bash
./scripts/bootstrap-aws-cos.sh --destroy --yes --profile cos-default
./scripts/bootstrap-aws-cos.sh --destroy --yes --clear-config   # also strip ~/.cos/config.json aws fields
```

## CDK Deployment (Phase 2+)

The `lib/cos-stack.ts` CDK stack provisions DynamoDB, OpenSearch Serverless, Lambda + EventBridge:

```bash
# From repo root (requires aws-cdk-lib in devDependencies)
npx cdk synth
npx cdk deploy --profile cos-default
```

The stack creates:
- `cos-graph-{stage}` DynamoDB table (single-table, GSI on ownerUserId+nodeType)
- `cos-vectors-{stage}` OpenSearch Serverless collection (knn_vector, 1024 dims)
- `cos-notification-push-{stage}` Lambda function (EventBridge every 15 min)

## soofi Ecosystem Install

BigBoss is a Cursor-first product in the soofi-xyz ecosystem. For contributors who also work with the team-kit:

```bash
pnpm setup-soofi-plugin   # installs team-kit as a Cursor local plugin
pnpm verify-soofi-plugin  # verifies the plugin is up to date
```

The team-kit plugin provides specialist agents (`/alakazam`, `/espeon`, `/oranguru`, etc.) used during development. It is NOT a runtime dependency.

## Doc Ownership

- Acceptance criteria and status: `docs/ACCEPTANCE_CRITERIA.md`
- System design and extensibility: `docs/ARCHITECTURE.md`
- AWS + soofi ecosystem: this file (`docs/DEPLOYMENT.md`)
