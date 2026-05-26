import type { ProviderId, KnowledgeNodeType } from "../graph/schema.js";

export interface ConnectorConfig {
  connectorId: string;
  providerId: ProviderId;
  accountLabel: string;
  credentials: ConnectorCredentials;
}

export interface ConnectorCredentials {
  type: "oauth2" | "pat" | "api-key";
  // Stored in Secrets Manager (prod) or .env (dev); never in code
}

export interface SyncCursor {
  connectorId: string;
  lastSyncedAt: string; // ISO 8601
  providerCursor: string;
  fullSyncRequired: boolean;
}

export interface NormalizedEvent {
  eventId: string; // sha256(connectorId + ":" + providerEventId)
  connectorId: string;
  providerId: ProviderId;
  providerEventId: string;
  eventType: KnowledgeNodeType;
  occurredAt: string; // ISO 8601
  payload: Record<string, unknown>;
  rawHash: string; // sha256 of serialized payload for idempotency
}

export interface Connector {
  readonly config: ConnectorConfig;

  /** Full sync from scratch; used on first run and after cursor reset */
  fullSync(): AsyncGenerator<NormalizedEvent>;

  /** Incremental sync from last cursor; no-op if nothing changed */
  incrementalSync(cursor: SyncCursor): AsyncGenerator<NormalizedEvent>;

  /** Current cursor state after sync completes */
  currentCursor(): Promise<SyncCursor>;

  /** Verify credentials; throw ConnectorAuthError if invalid */
  verifyAuth(): Promise<void>;
}

// ─── Error hierarchy ──────────────────────────────────────────────────────────

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly connectorId: string,
    public readonly providerStatusCode?: number,
    public readonly retryCount: number = 0
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export class ConnectorAuthError extends ConnectorError {
  constructor(connectorId: string, message?: string, providerStatusCode?: number) {
    super(message ?? "Authentication failed", connectorId, providerStatusCode);
    this.name = "ConnectorAuthError";
  }
}

export class ConnectorRateLimitError extends ConnectorError {
  retryAfterMs: number | undefined;
  constructor(connectorId: string, retryAfterMs?: number) {
    super(
      `Rate limit exceeded${retryAfterMs !== undefined ? `; retry after ${retryAfterMs}ms` : ""}`,
      connectorId
    );
    this.name = "ConnectorRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ConnectorCursorError extends ConnectorError {
  constructor(connectorId: string, reason: string) {
    super(`Cursor invalid: ${reason}`, connectorId);
    this.name = "ConnectorCursorError";
  }
}

export class ConnectorNetworkError extends ConnectorError {
  constructor(connectorId: string, cause?: unknown, retryCount?: number) {
    super(
      `Network error${cause instanceof Error ? `: ${cause.message}` : ""}`,
      connectorId,
      undefined,
      retryCount
    );
    this.name = "ConnectorNetworkError";
  }
}
