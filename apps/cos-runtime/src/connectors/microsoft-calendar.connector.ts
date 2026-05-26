import type { Connector, ConnectorConfig, SyncCursor, NormalizedEvent } from "./connector.interface.js";
import { ConnectorAuthError, ConnectorCursorError, ConnectorNetworkError } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";
import type { CalendarEventNode } from "../graph/schema.js";
import type { MicrosoftAccountConfig } from "../config/credentials.js";
import { getMicrosoftAuthHeaders } from "../auth/microsoft-auth.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type MsGraphFetchFn = (url: string, headers: Record<string, string>) => Promise<Response>;

// ─── Raw Graph API types ──────────────────────────────────────────────────────

interface RawMsCalendarEvent {
  id?: string | null;
  subject?: string | null;
  body?: { content?: string | null } | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  location?: { displayName?: string | null } | null;
  isCancelled?: boolean | null;
  isAllDay?: boolean | null;
  organizer?: { emailAddress?: { address?: string | null; name?: string | null } | null } | null;
  attendees?: Array<{
    emailAddress?: { address?: string | null } | null;
    status?: { response?: string | null } | null;
  }> | null;
  recurrence?: unknown | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  webLink?: string | null;
}

interface GraphCollectionResponse<T> {
  value?: T[] | null;
  "@odata.nextLink"?: string | null;
  "@odata.deltaLink"?: string | null;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class MicrosoftCalendarConnector implements Connector {
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
      providerId: "microsoft-calendar",
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
    const now = new Date();
    const startDt = new Date(now.getTime() - this.ingestWindow.pastDays * 86400_000).toISOString();
    const endDt = new Date(now.getTime() + this.ingestWindow.futureDays * 86400_000).toISOString();

    const initialUrl =
      `${MS_GRAPH_BASE}/me/calendarView/delta` +
      `?startDateTime=${startDt}&endDateTime=${endDt}` +
      `&$select=id,subject,body,start,end,location,isCancelled,isAllDay,organizer,attendees,recurrence,onlineMeeting,webLink`;

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
    isIncremental = false
  ): AsyncGenerator<NormalizedEvent> {
    let url: string | null = startUrl;

    while (url) {
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

      const data = (await resp.json()) as GraphCollectionResponse<RawMsCalendarEvent>;

      for (const item of data.value ?? []) {
        const event = this.normalizeEvent(item);
        if (event) yield event;
      }

      if (data["@odata.deltaLink"]) {
        this.deltaLink = data["@odata.deltaLink"];
        url = null;
      } else if (data["@odata.nextLink"]) {
        url = data["@odata.nextLink"];
      } else {
        url = null;
      }
    }
  }

  private normalizeEvent(raw: RawMsCalendarEvent): NormalizedEvent | null {
    if (!raw.id) return null;

    const now = new Date().toISOString();
    const startAt = raw.start?.dateTime ?? now;
    const endAt = raw.end?.dateTime ?? now;
    const isAllDay = raw.isAllDay ?? !raw.start?.dateTime;

    const canonicalId = connectorNodeId(this.config.connectorId, raw.id);
    const organizerEmail = raw.organizer?.emailAddress?.address ?? "unknown@microsoft";
    const organizerIdentityId = identityId(organizerEmail);

    const attendeeIdentityIds = (raw.attendees ?? [])
      .filter((a) => Boolean(a.emailAddress?.address))
      .map((a) => identityId(a.emailAddress!.address!));

    const meetingUrl = raw.onlineMeeting?.joinUrl ?? raw.webLink ?? null;

    let status: CalendarEventNode["status"] = "confirmed";
    if (raw.isCancelled) status = "cancelled";

    const payload: CalendarEventNode = {
      nodeType: "CalendarEvent",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerEventId: raw.id,
      title: raw.subject ?? "(No title)",
      description: raw.body?.content ?? null,
      startAt,
      endAt,
      isAllDay,
      location: raw.location?.displayName ?? null,
      status,
      organizerIdentityId,
      attendeeIdentityIds,
      recurrenceRule: raw.recurrence ? JSON.stringify(raw.recurrence) : null,
      meetingUrl,
      ingestedAt: now,
      rawHash: "",
    };

    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;

    return {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "microsoft-calendar",
      providerEventId: raw.id,
      eventType: "CalendarEvent",
      occurredAt: startAt,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }
}

function defaultFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { headers });
}
