# COS Runtime — Local RAG CLI (Agent Usage)

This package is a **query-only local RAG CLI** over the Chief of Staff knowledge graph. Populate data with `pnpm ingest` and `pnpm embed` — do not call Google/Asana APIs from `query` or `paths` directly.

## Database

- Default path: `~/.cos/graph.db` (override with `COS_DB_PATH`)
- Gitignored: `*.db`, `*.db-wal`, `*.db-shm`
- Tables: `rag_sources`, `rag_chunks`, `rag_links`, plus graph `nodes` / `edges`

## Command order

1. `pnpm inspect` — confirm corpus exists (sources, chunks, links, embed counts)
2. `pnpm query -- "<question>"` — ranked chunk matches
3. `pnpm paths -- "<criteria>"` — related executive sources (deep links + graph neighbors)

## Output contract

- **Default stdout is JSON.** Parse with `jq` or your agent JSON parser.
- **Human text:** add `--format text`
- **Debug:** `RAG_DEBUG=true` writes diagnostics to **stderr only** (never chunk bodies)

```bash
pnpm inspect | jq .
pnpm query -- "overdue Asana tasks" | jq .
pnpm paths -- "Board Review meeting" | jq .
RAG_DEBUG=true pnpm query -- "test" 2>/dev/null
```

## `inspect` JSON fields

| Field | Meaning |
|-------|---------|
| `graphNodes` | Total knowledge-graph nodes |
| `graphNodesByType` | Counts by `nodeType` |
| `ragSources` | Rows in `rag_sources` |
| `ragChunks` | Rows in `rag_chunks` |
| `ragChunksEmbedded` | Chunks with non-null `embedding` |
| `ragLinks` | Rows in `rag_links` |

## `query` JSON fields

| Field | Meaning |
|-------|---------|
| `query` | User question |
| `belowThreshold` | `true` if best raw score &lt; `minConfidentScore` (0.65) |
| `minConfidentScore` | Hallucination guardrail threshold |
| `matches[]` | Ranked hits: `chunkId`, `sourceNodeId`, `sourceType`, `title`, `score`, `rawScore`, `citation`, `snippet` |
| `retrievedChunkIds` | IDs for tracing (no chunk text in logs) |

When `belowThreshold` is true, treat matches as **hints only** — do not invent facts.

## `paths` JSON fields

| Field | Meaning |
|-------|---------|
| `query` | User criteria |
| `suggestions[]` | Related sources: `canonicalId`, `nodeType`, `title`, `url`, `relation`, `score` |

- Empty `suggestions` means **no linked evidence** — do not guess file paths or URLs.
- `url` may be `https://…` or `[source: NodeType:id]` when no deep link exists.

## Embeddings

| Mode | When | Notes |
|------|------|-------|
| `local-hash` | Default in setup (`ragBackend: local`) | Proves retrieval plumbing; weak semantics |
| Bedrock `cohere.embed-v4:0` | `ragBackend` not `local` + credentials | Use for semantic demos |

## Flags

| Flag | Commands | Purpose |
|------|----------|---------|
| `--format text` | inspect, query, paths | Human-readable stdout |
| `--format json` | inspect, query, paths | Default |
| `--top-k N` | paths | Max suggestions (default 10) |
| `--file path` | paths | Read multiline criteria from file |
| `--skip-ingest` | demo | Reuse existing graph; run RAG→query→notify→brief |
| `--query "…"` | demo | Override default demo RAG question |

## Rules for agents

- Run `pnpm inspect` before relying on retrieval.
- Parse **stdout only** as structured data.
- Do not invent citations; use `citation` / `url` from output.
- Never log or echo email bodies from chunks in traces.
