import { google } from "googleapis";
import type { Auth } from "googleapis";
import type { Connector, ConnectorConfig, SyncCursor, NormalizedEvent } from "./connector.interface.js";
import { ConnectorAuthError, ConnectorCursorError, ConnectorNetworkError } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";
import type { EmailThreadNode, EmailMessageNode } from "../graph/schema.js";
import { getGoogleAuthClient, refreshGoogleTokenIfNeeded } from "../auth/google-oauth.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

type OAuth2Client = Auth.OAuth2Client;

// ─── Injectable interface for DI / testing ────────────────────────────────────

export interface RawGmailMessagePart {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null } | null;
  parts?: RawGmailMessagePart[] | null;
}

export interface RawGmailMessage {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  internalDate?: string | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
    body?: { data?: string | null } | null;
    mimeType?: string | null;
    parts?: RawGmailMessagePart[] | null;
  } | null;
}

export interface RawGmailThread {
  id?: string | null;
  historyId?: string | null;
  messages?: RawGmailMessage[] | null;
}

export interface GmailClientInterface {
  users: {
    threads: {
      list(params: {
        userId: string;
        maxResults?: number;
        q?: string;
        pageToken?: string;
      }): Promise<{
        data: {
          threads?: Array<{ id?: string | null }> | null;
          nextPageToken?: string | null;
        };
      }>;
      get(params: {
        userId: string;
        id: string;
        format?: string;
      }): Promise<{ data: RawGmailThread }>;
    };
    history: {
      list(params: {
        userId: string;
        startHistoryId: string;
        historyTypes?: string[];
        maxResults?: number;
        pageToken?: string;
      }): Promise<{
        data: {
          history?: Array<{
            messages?: Array<{ id?: string | null; threadId?: string | null }> | null;
          }> | null;
          nextPageToken?: string | null;
          historyId?: string | null;
        };
      }>;
    };
    getProfile(params: { userId: string }): Promise<{
      data: { historyId?: string | null };
    }>;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  return (
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].toLowerCase().trim();
  return raw.split(",")[0]?.trim().toLowerCase() ?? "";
}

function extractEmails(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => extractEmail(s.trim()))
    .filter(Boolean);
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function extractTextBody(part: RawGmailMessagePart | null | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractTextBody(child);
    if (text) return text;
  }
  return "";
}

function extractBody(
  payload: RawGmailMessage["payload"],
  labelIds: string[]
): string {
  // Strip body for SPAM or TRASH per spec §5.3 PII handling
  if (labelIds.includes("SPAM") || labelIds.includes("TRASH")) return "";
  if (!payload) return "";

  // Simple (non-multipart) message
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — walk parts recursively looking for text/plain
  for (const part of payload.parts ?? []) {
    const text = extractTextBody(part);
    if (text) return text;
  }

  return "";
}

function hasAttachments(payload: RawGmailMessage["payload"]): boolean {
  if (!payload?.parts) return false;
  return payload.parts.some((p) => Boolean(p.filename && p.filename !== ""));
}

// ─── Connector ────────────────────────────────────────────────────────────────

const MAX_THREADS = 50; // prototype limit per spec §5.3

export class GmailConnector implements Connector {
  readonly config: ConnectorConfig;
  private _client: GmailClientInterface | undefined;
  private latestHistoryId: string | undefined;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string,
    private readonly ownerEmail: string,
    private readonly authClient?: OAuth2Client,
    private readonly clientOverride?: GmailClientInterface,
    private readonly ingestWindow: IngestWindow = DEFAULT_INGEST_WINDOW
  ) {
    this.config = {
      connectorId,
      providerId: "gmail",
      accountLabel: "Gmail",
      credentials: { type: "oauth2" },
    };
  }

  private getClient(): GmailClientInterface {
    if (this.clientOverride) return this.clientOverride;
    if (!this._client) {
      const auth = this.authClient ?? getGoogleAuthClient();
      this._client = google.gmail({ version: "v1", auth }) as unknown as GmailClientInterface;
    }
    return this._client;
  }

  async verifyAuth(): Promise<void> {
    if (this.clientOverride) return;
    const auth = this.authClient ?? getGoogleAuthClient();
    await refreshGoogleTokenIfNeeded(auth);
    try {
      await this.getClient().users.getProfile({ userId: "me" });
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 401 || e.code === 403) {
        throw new ConnectorAuthError(this.config.connectorId, e.message, e.code);
      }
      throw new ConnectorNetworkError(
        this.config.connectorId,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    const client = this.getClient();
    const threadIds: string[] = [];
    let pageToken: string | undefined;

    // Collect up to MAX_THREADS thread IDs from recent inbox
    do {
      let data: Awaited<ReturnType<GmailClientInterface["users"]["threads"]["list"]>>["data"];
      try {
        const resp = await client.users.threads.list({
          userId: "me",
          maxResults: MAX_THREADS,
          q: `newer_than:${this.ingestWindow.pastDays}d in:inbox`,
          ...(pageToken ? { pageToken } : {}),
        });
        data = resp.data;
      } catch (err: unknown) {
        const e = err as { code?: number; message?: string };
        if (e.code === 401 || e.code === 403) {
          throw new ConnectorAuthError(this.config.connectorId, e.message, e.code);
        }
        throw new ConnectorNetworkError(
          this.config.connectorId,
          err instanceof Error ? err : new Error(String(err))
        );
      }

      for (const t of data.threads ?? []) {
        if (t.id && threadIds.length < MAX_THREADS) threadIds.push(t.id);
      }
      pageToken = threadIds.length < MAX_THREADS ? (data.nextPageToken ?? undefined) : undefined;
    } while (pageToken);

    // Fetch + yield each thread
    for (const threadId of threadIds) {
      yield* await this.fetchThread(threadId);
    }

    // Get current historyId for cursor
    try {
      const profile = await client.users.getProfile({ userId: "me" });
      this.latestHistoryId = profile.data.historyId ?? undefined;
    } catch { /* non-fatal; cursor will have fullSyncRequired=true */ }
  }

  async *incrementalSync(cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    const client = this.getClient();
    const changedThreadIds = new Set<string>();
    let pageToken: string | undefined;
    let newHistoryId: string | undefined;

    do {
      let data: Awaited<ReturnType<GmailClientInterface["users"]["history"]["list"]>>["data"];
      try {
        const resp = await client.users.history.list({
          userId: "me",
          startHistoryId: cursor.providerCursor,
          historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
          maxResults: 500,
          ...(pageToken ? { pageToken } : {}),
        });
        data = resp.data;
      } catch (err: unknown) {
        const e = err as { code?: number; message?: string };
        // 404 means historyId is too old — full sync required
        if (e.code === 404) {
          throw new ConnectorCursorError(
            this.config.connectorId,
            "historyId expired; run fullSync"
          );
        }
        if (e.code === 401 || e.code === 403) {
          throw new ConnectorAuthError(this.config.connectorId, e.message, e.code);
        }
        throw new ConnectorNetworkError(
          this.config.connectorId,
          err instanceof Error ? err : new Error(String(err))
        );
      }

      for (const record of data.history ?? []) {
        for (const msg of record.messages ?? []) {
          if (msg.threadId) changedThreadIds.add(msg.threadId);
        }
      }

      pageToken = data.nextPageToken ?? undefined;
      newHistoryId = data.historyId ?? newHistoryId;
    } while (pageToken);

    for (const threadId of changedThreadIds) {
      yield* await this.fetchThread(threadId);
    }

    if (newHistoryId) this.latestHistoryId = newHistoryId;
  }

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: this.latestHistoryId ?? "",
      fullSyncRequired: !this.latestHistoryId,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async fetchThread(threadId: string): Promise<NormalizedEvent[]> {
    const client = this.getClient();
    let thread: RawGmailThread;
    try {
      const resp = await client.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      thread = resp.data;
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 401 || e.code === 403) {
        throw new ConnectorAuthError(this.config.connectorId, e.message, e.code);
      }
      // Skip individual thread failures (partial thread is acceptable per spec §5.3)
      console.error(
        JSON.stringify({ event: "connector.thread.skip", connectorId: this.config.connectorId, threadId, error: e.message })
      );
      return [];
    }

    return this.normalizeThread(thread);
  }

  private normalizeThread(thread: RawGmailThread): NormalizedEvent[] {
    if (!thread.id) return [];

    const messages = [...(thread.messages ?? [])].sort((a, b) => {
      const ta = parseInt(a.internalDate ?? "0", 10);
      const tb = parseInt(b.internalDate ?? "0", 10);
      return ta - tb;
    });

    if (messages.length === 0) return [];

    const now = new Date().toISOString();
    const threadCanonicalId = connectorNodeId(this.config.connectorId, thread.id);

    // ── Collect thread-level aggregates ──
    const allLabels = new Set<string>();
    const participantIds = new Set<string>();
    let firstMessageAt = "";
    let lastMessageAt = "";
    let subject = "";

    for (const msg of messages) {
      const headers = msg.payload?.headers ?? [];
      const msgSubject = getHeader(headers, "Subject");
      if (msgSubject && !subject) subject = msgSubject;

      const sentAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : now;

      if (!firstMessageAt || sentAt < firstMessageAt) firstMessageAt = sentAt;
      if (!lastMessageAt || sentAt > lastMessageAt) lastMessageAt = sentAt;

      for (const label of msg.labelIds ?? []) allLabels.add(label);

      const fromEmail = extractEmail(getHeader(headers, "From"));
      if (fromEmail) participantIds.add(identityId(fromEmail));
      for (const e of extractEmails(getHeader(headers, "To"))) participantIds.add(identityId(e));
      for (const e of extractEmails(getHeader(headers, "Cc"))) participantIds.add(identityId(e));
    }

    // replyNeeded: last message was not from the owner
    const lastMsg = messages[messages.length - 1]!;
    const lastFrom = extractEmail(getHeader(lastMsg.payload?.headers ?? [], "From"));
    const replyNeeded = lastFrom.toLowerCase() !== this.ownerEmail.toLowerCase();

    const threadPayload: EmailThreadNode = {
      nodeType: "EmailThread",
      canonicalId: threadCanonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerThreadId: thread.id,
      subject: subject || "(No subject)",
      firstMessageAt: firstMessageAt || now,
      lastMessageAt: lastMessageAt || now,
      participantIdentityIds: [...participantIds],
      labels: [...allLabels],
      isResolved: false,
      replyNeeded,
      messageCount: messages.length,
      ingestedAt: now,
      rawHash: "",
    };
    const threadHash = rawHash(threadPayload as unknown as Record<string, unknown>);
    threadPayload.rawHash = threadHash;

    const events: NormalizedEvent[] = [
      {
        eventId: threadCanonicalId,
        connectorId: this.config.connectorId,
        providerId: "gmail",
        providerEventId: thread.id,
        eventType: "EmailThread",
        occurredAt: firstMessageAt,
        payload: threadPayload as unknown as Record<string, unknown>,
        rawHash: threadHash,
      },
    ];

    // ── Yield individual messages ──
    for (const msg of messages) {
      if (!msg.id) continue;

      const headers = msg.payload?.headers ?? [];
      const labelIds = msg.labelIds ?? [];
      const sentAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : now;

      const fromEmail = extractEmail(getHeader(headers, "From"));
      const toEmails = extractEmails(getHeader(headers, "To"));
      const ccEmails = extractEmails(getHeader(headers, "Cc"));

      const msgPayload: EmailMessageNode = {
        nodeType: "EmailMessage",
        canonicalId: connectorNodeId(this.config.connectorId, msg.id),
        connectorId: this.config.connectorId,
        ownerUserId: this.ownerUserId,
        providerMessageId: msg.id,
        threadCanonicalId,
        fromIdentityId: identityId(fromEmail || "unknown@gmail"),
        toIdentityIds: toEmails.map(identityId),
        ccIdentityIds: ccEmails.map(identityId),
        sentAt,
        subject: getHeader(headers, "Subject") || subject || "(No subject)",
        bodyText: extractBody(msg.payload, labelIds),
        bodyHtml: null,
        hasAttachments: hasAttachments(msg.payload),
        labels: labelIds,
        ingestedAt: now,
        rawHash: "",
      };
      const msgHash = rawHash(msgPayload as unknown as Record<string, unknown>);
      msgPayload.rawHash = msgHash;

      events.push({
        eventId: connectorNodeId(this.config.connectorId, msg.id),
        connectorId: this.config.connectorId,
        providerId: "gmail",
        providerEventId: msg.id,
        eventType: "EmailMessage",
        occurredAt: sentAt,
        payload: msgPayload as unknown as Record<string, unknown>,
        rawHash: msgHash,
      });
    }

    return events;
  }
}
