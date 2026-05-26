import type { Connector, ConnectorConfig, SyncCursor, NormalizedEvent } from "./connector.interface.js";
import { ConnectorAuthError, ConnectorCursorError, ConnectorNetworkError } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";
import type { EmailThreadNode, EmailMessageNode } from "../graph/schema.js";
import type { MicrosoftAccountConfig } from "../config/credentials.js";
import { getMicrosoftAuthHeaders } from "../auth/microsoft-auth.js";
import type { MsGraphFetchFn } from "./microsoft-calendar.connector.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Parity with Gmail prototype limit (spec §5.3)
const MAX_MESSAGES = 50;

// Well-known Graph folder IDs for junk/deleted — used to strip body content
const STRIP_BODY_FOLDERS = new Set(["junkemail", "deleteditems"]);

// ─── Raw Graph API types ──────────────────────────────────────────────────────

interface RawMsEmailAddress {
  address?: string | null;
  name?: string | null;
}

interface RawMsRecipient {
  emailAddress?: RawMsEmailAddress | null;
}

interface RawMsMessage {
  id?: string | null;
  conversationId?: string | null;
  parentFolderId?: string | null;
  subject?: string | null;
  from?: { emailAddress?: RawMsEmailAddress | null } | null;
  toRecipients?: RawMsRecipient[] | null;
  ccRecipients?: RawMsRecipient[] | null;
  receivedDateTime?: string | null;
  bodyPreview?: string | null;
  hasAttachments?: boolean | null;
}

interface GraphCollectionResponse<T> {
  value?: T[] | null;
  "@odata.nextLink"?: string | null;
  "@odata.deltaLink"?: string | null;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class MicrosoftMailConnector implements Connector {
  readonly config: ConnectorConfig;
  private deltaLink: string | undefined;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string,
    private readonly account: MicrosoftAccountConfig,
    private readonly ingestWindow: IngestWindow = DEFAULT_INGEST_WINDOW,
    private readonly fetchFn: MsGraphFetchFn = defaultFetch
  ) {
    this.config = {
      connectorId,
      providerId: "microsoft-mail",
      accountLabel: account.label,
      credentials: { type: "oauth2" },
    };
  }

  async verifyAuth(): Promise<void> {
    const headers = getMicrosoftAuthHeaders(this.account);
    let resp: Response;
    try {
      resp = await this.fetchFn(`${MS_GRAPH_BASE}/me`, headers);
    } catch (err) {
      throw new ConnectorNetworkError(this.config.connectorId, err instanceof Error ? err : new Error(String(err)));
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new ConnectorAuthError(this.config.connectorId, `Microsoft Graph auth failed (HTTP ${resp.status})`, resp.status);
    }
    if (!resp.ok) {
      throw new ConnectorNetworkError(this.config.connectorId, new Error(`HTTP ${resp.status}`));
    }
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    const headers = getMicrosoftAuthHeaders(this.account);
    const selectFields = "id,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments";
    const cutoff = new Date(Date.now() - this.ingestWindow.pastDays * 86400_000).toISOString();
    const filter = encodeURIComponent(`receivedDateTime ge ${cutoff}`);
    const initialUrl =
      `${MS_GRAPH_BASE}/me/mailFolders/inbox/messages/delta` +
      `?$select=${selectFields}&$top=${MAX_MESSAGES}&$filter=${filter}`;

    yield* this._fetchPages(initialUrl, headers);
  }

  async *incrementalSync(cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    if (!cursor.providerCursor) {
      yield* this.fullSync();
      return;
    }
    const headers = getMicrosoftAuthHeaders(this.account);
    yield* this._fetchPages(cursor.providerCursor, headers, true);
  }

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: this.deltaLink ?? "",
      fullSyncRequired: !this.deltaLink,
    };
  }

  private async *_fetchPages(
    startUrl: string,
    headers: Record<string, string>,
    _isIncremental = false
  ): AsyncGenerator<NormalizedEvent> {
    let url: string | null = startUrl;
    let totalFetched = 0;
    const threadMap = new Map<string, RawMsMessage[]>();

    while (url && totalFetched < MAX_MESSAGES) {
      let resp: Response;
      try {
        resp = await this.fetchFn(url, headers);
      } catch (err) {
        throw new ConnectorNetworkError(this.config.connectorId, err instanceof Error ? err : new Error(String(err)));
      }

      if (resp.status === 410) {
        throw new ConnectorCursorError(this.config.connectorId, "delta link expired; run fullSync");
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new ConnectorAuthError(this.config.connectorId, `Microsoft Graph auth failed (HTTP ${resp.status})`, resp.status);
      }
      if (!resp.ok) {
        throw new ConnectorNetworkError(this.config.connectorId, new Error(`HTTP ${resp.status}`));
      }

      const data = (await resp.json()) as GraphCollectionResponse<RawMsMessage>;

      for (const msg of data.value ?? []) {
        if (totalFetched >= MAX_MESSAGES) break;
        const convId = msg.conversationId ?? msg.id ?? "";
        const existing = threadMap.get(convId) ?? [];
        existing.push(msg);
        threadMap.set(convId, existing);
        totalFetched++;
      }

      if (data["@odata.deltaLink"]) {
        this.deltaLink = data["@odata.deltaLink"];
        url = null;
      } else if (data["@odata.nextLink"] && totalFetched < MAX_MESSAGES) {
        url = data["@odata.nextLink"];
      } else {
        url = null;
      }
    }

    // Emit thread + message events per conversation group
    for (const [convId, messages] of threadMap) {
      yield* this.normalizeConversation(convId, messages);
    }
  }

  private *normalizeConversation(convId: string, messages: RawMsMessage[]): Iterable<NormalizedEvent> {
    if (messages.length === 0) return;

    const now = new Date().toISOString();
    const sorted = [...messages].sort((a, b) => {
      const ta = a.receivedDateTime ?? "";
      const tb = b.receivedDateTime ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const firstMsg = sorted[0]!;
    const lastMsg = sorted[sorted.length - 1]!;
    const subject = firstMsg.subject ?? "(No subject)";

    const threadCanonicalId = connectorNodeId(this.config.connectorId, convId);

    const participantIds = new Set<string>();
    for (const msg of sorted) {
      const fromAddr = msg.from?.emailAddress?.address;
      if (fromAddr) participantIds.add(identityId(fromAddr));
      for (const r of msg.toRecipients ?? []) {
        const a = r.emailAddress?.address;
        if (a) participantIds.add(identityId(a));
      }
      for (const r of msg.ccRecipients ?? []) {
        const a = r.emailAddress?.address;
        if (a) participantIds.add(identityId(a));
      }
    }

    const threadPayload: EmailThreadNode = {
      nodeType: "EmailThread",
      canonicalId: threadCanonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerThreadId: convId,
      subject,
      firstMessageAt: firstMsg.receivedDateTime ?? now,
      lastMessageAt: lastMsg.receivedDateTime ?? now,
      participantIdentityIds: [...participantIds],
      labels: [],
      isResolved: false,
      replyNeeded: false,
      messageCount: messages.length,
      ingestedAt: now,
      rawHash: "",
    };
    const threadHash = rawHash(threadPayload as unknown as Record<string, unknown>);
    threadPayload.rawHash = threadHash;

    yield {
      eventId: threadCanonicalId,
      connectorId: this.config.connectorId,
      providerId: "microsoft-mail",
      providerEventId: convId,
      eventType: "EmailThread",
      occurredAt: firstMsg.receivedDateTime ?? now,
      payload: threadPayload as unknown as Record<string, unknown>,
      rawHash: threadHash,
    };

    for (const msg of sorted) {
      if (!msg.id) continue;

      const fromAddr = msg.from?.emailAddress?.address ?? "unknown@microsoft";
      const toIds = (msg.toRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter((a): a is string => Boolean(a))
        .map(identityId);
      const ccIds = (msg.ccRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter((a): a is string => Boolean(a))
        .map(identityId);

      // Strip body for junk/deleted folders
      const folderId = msg.parentFolderId?.toLowerCase() ?? "";
      const bodyText = STRIP_BODY_FOLDERS.has(folderId) ? "" : (msg.bodyPreview ?? "");

      const msgPayload: EmailMessageNode = {
        nodeType: "EmailMessage",
        canonicalId: connectorNodeId(this.config.connectorId, msg.id),
        connectorId: this.config.connectorId,
        ownerUserId: this.ownerUserId,
        providerMessageId: msg.id,
        threadCanonicalId,
        fromIdentityId: identityId(fromAddr),
        toIdentityIds: toIds,
        ccIdentityIds: ccIds,
        sentAt: msg.receivedDateTime ?? now,
        subject: msg.subject ?? subject,
        bodyText,
        bodyHtml: null,
        hasAttachments: msg.hasAttachments ?? false,
        labels: [],
        ingestedAt: now,
        rawHash: "",
      };
      const msgHash = rawHash(msgPayload as unknown as Record<string, unknown>);
      msgPayload.rawHash = msgHash;

      yield {
        eventId: connectorNodeId(this.config.connectorId, msg.id),
        connectorId: this.config.connectorId,
        providerId: "microsoft-mail",
        providerEventId: msg.id,
        eventType: "EmailMessage",
        occurredAt: msg.receivedDateTime ?? now,
        payload: msgPayload as unknown as Record<string, unknown>,
        rawHash: msgHash,
      };
    }
  }
}

function defaultFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { headers });
}
