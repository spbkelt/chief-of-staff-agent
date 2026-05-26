---
name: build-cos-rag
description: >
  How the Chief of Staff agent's RAG pipeline works: chunking strategy per
  content type, embedding via Vercel AI SDK, cosine retrieval with freshness
  weighting, permission-aware filtering, source citations, and hallucination
  guardrails. Read before touching chunk.ts, embed.ts, or retrieve.ts.
spec-section: "docs/ARCHITECTURE.md"
parent-skills:
  - build-local-rag-pocs
  - build-rag-systems
team-kit-path: ~/.cursor/plugins/local/soofi-xyz/skills/
---

> **Extends team-kit:** `build-local-rag-pocs`, `build-rag-systems` — load from `~/.cursor/plugins/local/soofi-xyz/skills/` first.  
> **COS-only:** This file documents Chief of Staff-specific constraints. Do not duplicate content from the parent skill.  
> **Do not reimplement:** Generic RAG framework patterns belong in team-kit (`/espeon`, `/alakazam`); this repo applies them to COS node types only.

**Tracks:** Demo = implement in `rag/*` per `/espeon` (`pnpm inspect` / `pnpm query` / `pnpm paths` — JSON default, `--format text` optional). Agent contract: [`apps/cos-runtime/AGENTS.md`](../apps/cos-runtime/AGENTS.md). Customer production = `/alakazam` + `build-rag-systems` — prerequisites in `docs/DEPLOYMENT.md`; do not ship libSQL cosine as production RAG.

# Building the COS RAG Pipeline

**Product:** live Bedrock/OpenAI embeddings only. `COS_MOCK_EMBED` allowed only with `COS_ALLOW_FIXTURES` (Vitest/CI).

## Overview

The RAG pipeline has three stages: **chunk** → **embed** → **retrieve**. Each stage is a separate module. They are also the three CLI commands: `pnpm query` (retrieval), with ingest running chunk + embed automatically.

Full design: `docs/ARCHITECTURE.md`

## Chunking Strategy

Different content types need different chunking approaches. Use this table — do not apply a uniform strategy:

| Content type | Strategy | Max chunk tokens | Overlap |
|---|---|---|---|
| `EmailMessage.bodyText` | Sentence-window | 512 | 64 |
| `EmailThread` (combined) | Single chunk if <2048t; else sentence-window | 512 | 64 |
| `CalendarEvent.description` | Single chunk (usually short) | Full text | 0 |
| CalendarEvent + attendees | Combined "meeting context" chunk | 256 | 0 |
| `AsanaTask.notes` | Single chunk | Full text | 0 |
| AsanaTask + comments | Append comments to task chunk; new chunk if total >1024t | 512 | 64 |
| `AsanaProject` (name + task list) | Summary chunk | 256 | 0 |

Each chunk becomes a `SourceArtifact` node linked to its parent via a `CHUNK_OF` edge.  
`chunkText` stores the plain text. `embedding` starts as `null` and is set by the embed step.

## Embedding

Use Vercel AI SDK `embed()` function. Do not call Bedrock or OpenAI directly.

```typescript
import { embed } from 'ai';
// Bedrock (default)
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

const bedrock = createAmazonBedrock({ region: 'us-east-2' });
const { embedding } = await embed({
  model: bedrock.embedding(process.env.COS_EMBED_MODEL), // cohere.embed-v4:0
  value: chunkText,
});
// Store as JSON array in rag_chunks.embedding
```

Model: `cohere.embed-v4:0` (Bedrock default). Fallback: `text-embedding-3-small` (OpenAI, for dev).  
Dimensions: 1024 (Bedrock Cohere). Store `embeddingModel` and `embeddingDimensions` on every chunk — required for migration (spec §16).

Embed only `SourceArtifact` nodes that have `embedding IS NULL`. Never re-embed unless the chunk text has changed (check via the parent node's `rawHash`).

## Retrieval

Prototype retrieval is cosine similarity over all non-null embeddings in `rag_chunks`, with a freshness boost:

```
adjustedScore = cosineSimilarity(queryEmbedding, chunkEmbedding)
                * (1 + 0.1 * exp(-daysSinceEvent / 14))
```

Events in the last 14 days get up to +10% score boost. This constant is in `src/rag/retrieve.ts` as a named config value (not a magic number).

Default `topK = 8` for general queries. For response suggestion generation, `topK = 12` (more context needed).

### Retrieval Filters

All retrieval calls support optional filters. Never expose an unfiltered retrieval path:

```typescript
interface RetrievalFilter {
  connectorId?: string;         // restrict to one account
  nodeType?: KnowledgeNodeType; // restrict to CalendarEvent, EmailThread, etc.
  dateRange?: { from: string; to: string }; // ISO 8601
  identityId?: string;          // restrict to items involving a person
  ownerUserId: string;          // MANDATORY — permission boundary
}
```

`ownerUserId` is not optional. Every retrieval call must pass it. In the prototype it is always the single configured user. In production it is the authenticated user's `sha256(email)`.

### Hallucination Guardrails

1. If no retrieved chunk scores above **0.65**, do not pass them to the LLM. Instead, respond: _"I don't have enough context in the knowledge graph to answer this confidently."_ Then list what data is currently ingested.
2. Every LLM generation (notification, suggestion, query answer) must include `citedSourceNodeIds[]`. If the LLM produces output without citations, reject the response and retry once. If citations are still absent on retry, surface an error.
3. All LangSmith traces must include `inputs.retrievedChunkIds` (list of chunk IDs). Never include `chunkText` in traces.

## Source Citations

Every generated `Notification` and `SuggestedResponse` includes `citedSourceNodeIds`. The CLI renders these as deep links:
- `CalendarEvent` → Google Calendar event URL (if available in node `meetingUrl` field)
- `EmailThread` → Gmail thread URL: `https://mail.google.com/mail/u/0/#inbox/<providerThreadId>`
- `AsanaTask` → Asana task URL: `https://app.asana.com/0/<providerProjectGid>/<providerTaskGid>`

If the deep link cannot be constructed (missing field), show `[source: <nodeType>:<canonicalId>]`.

## Eval Cases

These queries must return correct results against the demo fixtures. Wire them as Vitest tests:

| Query | Expected top result | Min cosine |
|---|---|---|
| "What meetings do I have tomorrow?" | `CalendarEvent:cal-001` (Q3 Board Review) | 0.70 |
| "Is there anything unread from Sarah?" | `EmailThread` with `sarah@prismcorp.com` | Identity match |
| "What Asana tasks are overdue?" | `AsanaTask:task-003` | `dueDate < today` filter |
| "Prepare context for Board Review meeting" | `CalendarEvent:cal-001` + `AsanaTask:task-001` + `AsanaComment:story-001a` | ≥3 chunks ≥0.65 |
| "Suggest a reply to Q3 budget email" | Thread-001 chunks | ≥1 citation |

Full eval table: `docs/ARCHITECTURE.md`

## Production Migration to OpenSearch

When migrating from libSQL to OpenSearch Serverless (Phase 2):
1. Export `rag_chunks` as JSONL
2. Map to OpenSearch index with `knn_vector` field (1024 dims)
3. Add `ownerUserId` as a keyword filter field — this is the permission boundary in OpenSearch
4. Use SAM local Docker OpenSearch for dev (per `build-rag-systems` skill)
5. Run shadow mode → suggest-only → canary → full (per `build-rag-systems` rollout sequence)

The `retrieve.ts` interface must be stable across backends: same inputs, same output shape. The backend is swapped by replacing the implementation, not the interface.

## What Not to Do

- Do not call embedding or LLM APIs from `graph/upsert.ts`. The graph layer is storage-only.
- Do not store raw `chunkText` in LangSmith traces.
- Do not skip the `ownerUserId` filter for "convenience" in single-user mode — production safety depends on it being always present.
- Do not use a uniform chunk size for all content types — email bodies and calendar descriptions need very different strategies.
