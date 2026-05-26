---
name: build-cos-connectors
description: >
  How to implement and extend data connectors for the Chief of Staff agent.
  Covers the Connector interface contract, sync cursor model, NormalizedEvent
  mapping, error hierarchy, and idempotency rules. Read before adding or
  modifying GoogleCalendarConnector, GmailConnector, AsanaConnector, or any
  future connector.
spec-section: "docs/ARCHITECTURE.md"
parent-skills:
  - build-ai-agents
team-kit-path: ~/.cursor/plugins/local/soofi-xyz/skills/
---

> **Extends team-kit:** `build-ai-agents` — load from `~/.cursor/plugins/local/soofi-xyz/skills/` first.  
> **COS-only:** This file documents Chief of Staff-specific constraints. Do not duplicate content from the parent skill.  
> **Do not reimplement:** Generic patterns owned by team-kit agents belong in team-kit, not in this repo.

# Building COS Connectors

**Product:** real GCal/Gmail/Asana/MsCal/MsMail — `build-connectors.ts`, multi `googleAccounts` + `microsoftAccounts`. No fake stubs. Fixture ingest: `COS_ALLOW_FIXTURES` + `demo-fixtures` (CI).

## The Contract

Every connector implements one TypeScript interface. Do not deviate from this interface.  
Full interface definition: `docs/ARCHITECTURE.md`

```typescript
interface Connector {
  readonly config: ConnectorConfig;
  fullSync(): AsyncGenerator<NormalizedEvent>;
  incrementalSync(cursor: SyncCursor): AsyncGenerator<NormalizedEvent>;
  currentCursor(): Promise<SyncCursor>;
  verifyAuth(): Promise<void>;
}
```

Key rules:
- `fullSync()` is only called on first run or after a cursor reset. Do not call it on every sync.
- `incrementalSync()` is a no-op if nothing changed — yield nothing, update cursor, return.
- `currentCursor()` returns the cursor state **after** the most recent sync completes, not before.
- `verifyAuth()` throws `ConnectorAuthError` if credentials are invalid. Never returns false.

## NormalizedEvent Mapping

Every connector maps its provider entities to `NormalizedEvent`. The canonical ID rule is non-negotiable:

```
canonicalId = sha256(connectorId + ":" + providerEntityId)
rawHash     = sha256(JSON.stringify(payload))  // stable serialization order required
```

The `rawHash` is the idempotency key. If a `NormalizedEvent` with the same `rawHash` already exists in the graph, the upsert is a no-op. Always compute `rawHash` over the normalized `payload`, not the raw provider response.

The `eventType` field maps directly to a `KnowledgeNodeType`. See the mapping table:

| Provider entity | `eventType` |
|---|---|
| Google Calendar event | `"CalendarEvent"` |
| Gmail thread | `"EmailThread"` |
| Gmail message | `"EmailMessage"` |
| Asana workspace | `"AsanaWorkspace"` |
| Asana project | `"AsanaProject"` |
| Asana task | `"AsanaTask"` |
| Asana story/comment | `"AsanaComment"` |

## Sync Cursor Model

Each connector maintains a `SyncCursor` in the `sync_cursors` table. The `providerCursor` field is provider-specific:

| Provider | Cursor field | Reset condition |
|---|---|---|
| Google Calendar | `syncToken` | HTTP 410 GONE → set `fullSyncRequired = true` |
| Gmail | `historyId` (uint64 string) | HTTP 404 → set `fullSyncRequired = true` |
| Asana | `sync` token from events endpoint | Per-resource; token expires after 30 days |

On cursor reset: log `{event: "cursor.reset", connectorId, reason}`, delete stored cursor, run `fullSync()`.

## Error Hierarchy

```
ConnectorError (base — do not catch this; catch the subtypes)
  ├── ConnectorAuthError      → pause sync; surface re-auth prompt to user
  ├── ConnectorRateLimitError → exponential backoff; respect Retry-After header
  ├── ConnectorCursorError    → reset cursor; trigger fullSync
  └── ConnectorNetworkError   → retry up to 3 times with backoff; then escalate
```

Log every error with `{connectorId, errorType, providerStatusCode, retryCount}`. Never swallow errors silently.

## Connector-Specific Notes

### Google Calendar
- Required scope: `https://www.googleapis.com/auth/calendar.readonly` (read-only, non-negotiable)
- Use `googleapis` library for token exchange and API calls. This is not an LLM SDK — library use is permitted.
- Expand recurring events at fetch time (use `singleEvents=true` in Events.list).
- Full spec: `docs/ARCHITECTURE.md`

### Gmail
- Required scope: `https://www.googleapis.com/auth/gmail.readonly` (read-only, non-negotiable)
- Same Google OAuth app / credentials as Calendar.
- Fetch threads via `threads.get` (not individual messages) — this gets the full thread in one call.
- Strip body for messages labeled `SPAM` or `TRASH` — do not ingest their `bodyText`.
- Prototype: last 50 threads only. Do not attempt backfill in the prototype.
- Full spec: `docs/ARCHITECTURE.md`

### Asana
- Prototype: Personal Access Token (PAT) only. OAuth2 is Phase 2.
- Use **direct fetch** (not `@asana/node-sdk`) for API calls. `asana@3` is OpenAPI-generated with awkward typings; direct fetch is simpler and testable via DI. See `AsanaConnector` in `src/connectors/asana.connector.ts` for the pattern.
- Poll workspaces → projects → tasks → stories. Asana Events API (`/events?resource=workspace_gid&sync=...`) is the incremental cursor mechanism.
- Asana is a **data source** in Phase 1 product runtime (pull-based ingest only).
- Event-driven Asana automation (webhooks, mention/comment triggers) belongs to [`@soofi-xyz/chat-adapter-asana`](https://github.com/soofi-xyz/chat-adapter-asana) in Phase 2+ paths.
- Do not build custom webhook automation in this repo when adapter-based automation applies.
- Full spec: `docs/ARCHITECTURE.md`

### Microsoft Graph Connectors (implemented)
- `MicrosoftCalendarConnector` — `src/connectors/microsoft-calendar.connector.ts`. Uses delta API (`calendarView/delta`). Injectable `MsGraphFetchFn` for tests.
- `MicrosoftMailConnector` — `src/connectors/microsoft-mail.connector.ts`. Uses delta API (`mailFolders/inbox/messages/delta`). Groups messages by `conversationId` into `EmailThread` + `EmailMessage` nodes.
- Auth: `src/auth/microsoft-auth.ts` — raw `fetch` refresh (no `@azure/msal-node`); persists refreshed tokens to `~/.cos/config.json`.
- 50-message cap (parity with Gmail prototype).

### Future channels (Phase 3+)
- SMS, WhatsApp, X: implement the `NotificationDeliveryAdapter` interface (see `notifications/delivery/adapter.ts`). Proves extensibility without modifying core.

## Adding a New Connector

1. Create `src/connectors/<name>.connector.ts` implementing `Connector`.
2. Add the provider's `NormalizedEvent` mapping to `src/graph/schema.ts` if it introduces a new node type.
3. Register the connector in `src/config/env.ts` (connector config + credentials).
4. Verify: adding the connector requires **no changes** to `src/graph/upsert.ts`, `src/rag/chunk.ts`, or `src/rag/retrieve.ts`. If changes are required, the interface is being violated.
5. Add unit tests in `src/__tests__/connectors/<name>.connector.test.ts` covering: normalization, cursor behavior, and `rawHash` dedup.

## What Not to Do

- Do not call the provider's API directly inside `graph/upsert.ts`. Connectors own data fetching; the graph owns persistence.
- Do not use connector credentials for anything other than the connector's own API.
- Do not include email body text in any log line or LangSmith trace field.
- Do not add any write capability (create/update/delete) to any connector. All connectors are read-only.
