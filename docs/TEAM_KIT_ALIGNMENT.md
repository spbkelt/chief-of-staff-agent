# Team-Kit Alignment Audit

This table documents how each cos-runtime module relates to the soofi team-kit parent skill, its current implementation fidelity, and the AWS production target per the skill spec.

**Principle:** The runtime is custom TypeScript; AWS services are the production substrate per team-kit skill specifications. All LLM/embedding calls use the Vercel AI SDK (`ai` package) regardless of provider.

| cos-runtime module | Team-kit parent skill | Current implementation | AWS production target |
|---|---|---|---|
| `connectors/` (gcal, gmail, asana, ms-calendar, ms-mail) | `build-cos-connectors` → `build-ai-agents` | libSQL connector registry + DI; live Google/Microsoft/Asana APIs | Same. Connector secrets move to AWS Secrets Manager (`/{stage}/cos/{userId}/{connectorId}`) |
| `graph/` (libSQL) | `build-cos-knowledge-graph` → `build-ai-agents` | libSQL single-table (`~/.cos/graph.db`); rawHash dedup; upsertNode/getNode | `graph/dynamo-store.ts` — DynamoDB single-table (pk=canonicalId, sk=nodeType, GSI ownerUserId+nodeType) |
| `rag/embed.ts` + local retrieve | `build-cos-rag` → `build-local-rag-pocs` | libSQL rag_chunks table; Vercel AI SDK `embed()`; cohere.embed-v4:0 (1024 dims) | `rag/opensearch-store.ts` — OpenSearch Serverless knn_vector field (1024 dims); SigV4 auth |
| `llm/provider.ts` | `build-cos-rag` → `build-rag-systems` | Vercel AI SDK abstraction: Bedrock (SSO or keys), OpenAI, Anthropic+OpenAI-embed | Same; cohere.embed-v4:0 for Bedrock embeds; env `COS_RAG_BACKEND=opensearch` switches to OpenSearch |
| `notifications/` (generator, lifecycle) | `build-cos-notifications` → `assemble-communication-runtime` | In-process LLM scoring + libSQL dedup; multi-channel delivery (console + Telegram) | `lambda/notification-push.ts` — EventBridge-triggered Lambda; CDK: `lib/cos-stack.ts` |
| `notifications/delivery/` adapters | `build-cos-notifications` → `assemble-communication-runtime` | TelegramDeliveryAdapter + ConsoleDeliveryAdapter (extensible interface) | Same adapters; Lambda reads TELEGRAM_BOT_TOKEN from env (Secrets Manager binding via CDK) |
| `suggestions/` (generator, lifecycle.ts) | `build-cos-suggestions` → `manage-communication-activity` | Pending → approved/rejected/modified transitions; ownerUserId ownership check | Same; no auto-send; human approval required before any outbound action |
| `history/` (store, record-activity) | `build-cos-knowledge-graph` → `build-ai-agents` | ActivityEventNode written for all product mutations (ingest, notify, suggest, approve) | DynamoDB backend when `COS_GRAPH_BACKEND=dynamo` |
| `config/aws-credentials.ts` | (COS-specific — no team-kit parent) | SSO via `fromSSO({profile})` or static keys via `fromNodeProviderChain()` | Same; SSO is the recommended production path per AWS IAM best practices |
| `lib/cos-stack.ts` | (CDK — Phase 2+) | CDK stack: DynamoDB table + OpenSearch Serverless + Lambda + EventBridge rule | Deploy: `npx cdk deploy --profile cos-default` |

## Scope Boundary

- **In this repo:** Chief of Staff product code only — connectors, graph, RAG, notifications, suggestions, history, LLM provider abstraction, CLI, CDK stack.
- **In team-kit (dev-time only):** Parent skill patterns and specialist agents (`/alakazam`, `/espeon`, `/oranguru`, `/chatot`, `/xatu`, `/ash`, `/arceus`). Not vendored here; loaded as a Cursor local plugin.
- **Never duplicated:** Generic RAG framework patterns, communication scoring algorithms, audience selection logic — these compose from team-kit skills, not reimplemented here.

## ownerUserId Boundary (AC-16)

Every read path (RAG retrieval, notification listing, suggestion listing, graph queries) must filter by `ownerUserId`. This is enforced at:
- `rag/retrieve.ts` — `ownerUserId` is mandatory in `RetrievalFilter`
- `rag/opensearch-store.ts` — `filter: [{ term: { ownerUserId } }]` on every knn query
- `graph/dynamo-store.ts` — GSI queries keyed on `ownerUserId`
- `notifications/generator.ts` — all queries scoped to `ownerUserId`
