---
name: build-cos-knowledge-graph
description: >
  How the Chief of Staff agent's knowledge graph works: libSQL schema, node
  types, edge types, canonical ID rules, upsert idempotency, and the
  prototype-to-production migration path. Read before touching graph.db.ts,
  schema.ts, upsert.ts, or any code that writes to or reads from the graph.
spec-section: "docs/ARCHITECTURE.md"
parent-skills:
  - build-ai-agents
team-kit-path: ~/.cursor/plugins/local/soofi-xyz/skills/
---

> **Extends team-kit:** `build-ai-agents` — load from `~/.cursor/plugins/local/soofi-xyz/skills/` first.  
> **COS-only:** This file documents Chief of Staff-specific constraints. Do not duplicate content from the parent skill.  
> **Do not reimplement:** Generic patterns owned by team-kit agents belong in team-kit, not in this repo.

**Runtime:** Operators use `@bigboss` / `pnpm inspect` only. Contributors: parent skill + this overlay — not loaded on operator paths.

# Building the COS Knowledge Graph

## Design Philosophy

The prototype uses a single libSQL file (`~/.cos/graph.db`) that mimics a property graph: `nodes` table + `edges` table. Production migrates to DynamoDB single-table + OpenSearch. The schema is designed so that migration is a data export/import, not a code rewrite.

Full schema with TypeScript interfaces: `docs/ARCHITECTURE.md`

## Canonical ID Rules

Every node's `canonicalId` is a deterministic `sha256` hex string. This enables idempotent upserts without a read-before-write.

| Node origin | Canonical ID formula |
|---|---|
| Connector-sourced node | `sha256(connectorId + ":" + providerEntityId)` |
| Topic (derived) | `sha256("Topic:" + normalizedLabel)` where normalized = lowercase, stripped |
| Organization (derived) | `sha256("Organization:" + domain)` |
| ConversationTurn | `sha256(sessionId + ":" + turnIndex.toString())` |
| Notification | `sha256(triggerType + ":" + sourceNodeIds.join(",") + ":" + generatedAt)` |
| SuggestedResponse | `sha256(responseType + ":" + targetNodeId + ":" + generatedAt)` |

Stable serialization is required. If your formula includes an array (`sourceNodeIds`), sort it before joining so that the same logical inputs always produce the same hash.

## Idempotency via rawHash

Every connector-sourced node carries a `rawHash` field: `sha256(JSON.stringify(normalizedPayload))`.

Upsert rule:
1. Compute `canonicalId` from the ID formula.
2. Check the existing `raw_hash` in the `nodes` table for that `canonical_id`.
3. If `raw_hash` matches: skip the write entirely (no-op).
4. If `raw_hash` differs or row doesn't exist: write/overwrite the node.

This ensures that re-ingesting the same data produces no side effects. Never skip the `rawHash` check as a performance shortcut.

## libSQL Schema

Full DDL: `docs/ARCHITECTURE.md`

Key tables:
- `nodes(canonical_id, node_type, data JSON, created_at, updated_at, raw_hash)` — all node types in one table; `data` is the typed node struct as JSON
- `edges(id, edge_type, from_id, to_id, created_at)` — `from_id` and `to_id` are `canonical_id` references
- `rag_sources`, `rag_chunks`, `rag_links` — RAG pipeline tables (see `skills/build-cos-rag/SKILL.md`)
- `sync_cursors(connector_id, last_synced_at, provider_cursor, full_sync_required)` — one row per connector

All `canonical_id` values are unique across node types — there is no separate namespace per type. The `node_type` column is the discriminator.

## Node Types (21 total)

Brief catalog — full TypeScript interfaces in spec §6.2:

| Node | Created by | Key fields |
|---|---|---|
| `User` | Config on setup | `email`, `displayName` |
| `Account` | Connector registration | `connectorId`, `providerId`, `ownerUserId` |
| `Provider` | Connector registration | `providerId`, `connectorVersion` |
| `Identity` | Ingestion (dedup by email) | `email`, `displayName`, `providerIds[]` |
| `CalendarEvent` | Google Calendar connector | `startAt`, `endAt`, `attendeeIdentityIds[]` |
| `EmailThread` | Gmail connector | `subject`, `replyNeeded`, `lastMessageAt` |
| `EmailMessage` | Gmail connector | `bodyText` (truncated at 50k chars), `fromIdentityId` |
| `AsanaWorkspace` | Asana connector | `name`, `isOrganization` |
| `AsanaProject` | Asana connector | `workspaceCanonicalId`, `isArchived` |
| `AsanaTask` | Asana connector | `dueDate`, `isCompleted`, `assigneeIdentityId` |
| `AsanaComment` | Asana connector | `taskCanonicalId`, `text`, `isSystem` |
| `Organization` | Identity dedup | `domain`, `memberIdentityIds[]` |
| `Contact` | Identity dedup + enrichment | `relationship`, `interactionCount` |
| `Topic` | LLM extraction during ingestion | `label`, `frequency` |
| `PrioritySignal` | Notification rules engine | `signalType`, `score`, `expiresAt` |
| `Notification` | Notification generator | `triggerType`, `priorityScore`, `status` |
| `SuggestedResponse` | Suggestion generator | `draftText`, `status`, `citedSourceNodeIds[]` |
| `Decision` | LLM extraction | `description`, `ownerId`, `status` |
| `SourceArtifact` | RAG chunking pipeline | `chunkText`, `embedding`, `embeddingModel` |
| `ConversationTurn` | History store | `sessionId`, `role`, `content` |
| `ActivityEvent` | Ingestion hooks | `actorId`, `verb`, `objectNodeId` |

## Edge Types

Full list: `docs/ARCHITECTURE.md`

Key edges to know:
- `CHUNK_OF`: `SourceArtifact → (any content node)` — do not retrieve chunks without this link
- `CITES`: `(Notification | SuggestedResponse) → SourceArtifact` — every generated output must cite
- `TAGGED_WITH`: `(CalendarEvent | EmailThread | AsanaTask) → Topic` — cross-source linking
- `SAME_PERSON`: `Identity ↔ Identity` — dedup link; transitive merge not required in prototype

## Identity Dedup

When ingesting a new entity with an email address:
1. Compute `sha256(email)` as the candidate `canonicalId`.
2. If a node with that `canonicalId` already exists: merge `providerIds[]` array (add new entry, deduplicate).
3. If not: create new `Identity` node.

In the prototype, identity dedup is email-only. The `SAME_PERSON` edge (for display-name matching without email) is defined but not required for Phase 1.

## ownerUserId Is Mandatory

Every node that comes from a connector must have `ownerUserId: sha256(ownerEmail)` in its `data` JSON. This is the permission boundary. The retrieval layer always filters by `ownerUserId`. If you create a new node type from a connector and omit this field, you have introduced a cross-user data leak.

## Retention

Implement retention as a cleanup CLI command (`pnpm clean --expired`), not as part of the ingest path. Retention windows: spec §6.5. Do not implement retention in the prototype — add a `TODO` comment referencing the spec section.

## Production Migration Path

Prototype → Production:
1. Export `nodes` table as JSONL (one row per line)
2. Map each row to a DynamoDB item: `PK = "NODE#<nodeType>#<canonicalId>"`, `SK = "METADATA"`, all other fields as DynamoDB attributes
3. Export `edges` as adjacency items: `PK = "NODE#<fromId>"`, `SK = "EDGE#<edgeType>#<toId>"`
4. Export `rag_chunks` to OpenSearch (see `skills/build-cos-rag/SKILL.md`)

The TypeScript interfaces for all node types must remain identical across prototype and production — the only thing changing is the storage backend. Do not introduce production-specific fields into the node types without updating the prototype schema as well.
