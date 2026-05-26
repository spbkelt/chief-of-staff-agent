import { google, type Auth } from "googleapis";

type OAuth2Client = Auth.OAuth2Client;
import type { Connector, ConnectorConfig, SyncCursor, NormalizedEvent } from "./connector.interface.js";
import { ConnectorAuthError, ConnectorCursorError, ConnectorNetworkError } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";
import type { CalendarEventNode } from "../graph/schema.js";
import { getGoogleAuthClient, refreshGoogleTokenIfNeeded } from "../auth/google-oauth.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

// Minimal injectable interface — lets tests pass a mock without depending on googleapis internals
export interface CalendarEventsListParams {
  calendarId: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
  syncToken?: string;
}

export interface RawCalendarEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  location?: string | null;
  status?: string | null;
  organizer?: { email?: string | null; displayName?: string | null } | null;
  attendees?: Array<{ email?: string | null; responseStatus?: string | null }> | null;
  recurrence?: string[] | null;
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null;
  } | null;
}

export interface CalendarClientInterface {
  events: {
    list(params: CalendarEventsListParams): Promise<{
      data: {
        items?: RawCalendarEvent[] | null;
        nextPageToken?: string | null;
        nextSyncToken?: string | null;
      };
    }>;
  };
  calendarList: {
    list(params: { maxResults?: number }): Promise<{ data: unknown }>;
  };
}

export class GoogleCalendarConnector implements Connector {
  readonly config: ConnectorConfig;
  private _client: CalendarClientInterface | undefined;
  private latestSyncToken: string | undefined;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string,
    private readonly authClient?: OAuth2Client,
    private readonly clientOverride?: CalendarClientInterface,
    private readonly ingestWindow: IngestWindow = DEFAULT_INGEST_WINDOW
  ) {
    this.config = {
      connectorId,
      providerId: "google-calendar",
      accountLabel: "Google Calendar",
      credentials: { type: "oauth2" },
    };
  }

  private getClient(): CalendarClientInterface {
    if (this.clientOverride) return this.clientOverride;
    if (!this._client) {
      const auth = this.authClient ?? getGoogleAuthClient();
      this._client = google.calendar({ version: "v3", auth }) as unknown as CalendarClientInterface;
    }
    return this._client;
  }

  async verifyAuth(): Promise<void> {
    if (this.clientOverride) return; // injected client — skip OAuth
    const auth = this.authClient ?? getGoogleAuthClient();
    await refreshGoogleTokenIfNeeded(auth);
    try {
      await this.getClient().calendarList.list({ maxResults: 1 });
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
    let pageToken: string | undefined;
    let syncToken: string | undefined;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const timeMin = new Date(now - this.ingestWindow.pastDays * dayMs).toISOString();
    const timeMax = new Date(now + this.ingestWindow.futureDays * dayMs).toISOString();

    do {
      let data: Awaited<ReturnType<CalendarClientInterface["events"]["list"]>>["data"];
      try {
        const resp = await client.events.list({
          calendarId: "primary",
          maxResults: 250,
          singleEvents: true,
          orderBy: "startTime",
          timeMin,
          timeMax,
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

      for (const item of data.items ?? []) {
        const event = this.normalizeEvent(item);
        if (event) yield event;
      }

      pageToken = data.nextPageToken ?? undefined;
      syncToken = data.nextSyncToken ?? syncToken;
    } while (pageToken);

    if (syncToken) this.latestSyncToken = syncToken;
  }

  async *incrementalSync(cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    const client = this.getClient();
    let pageToken: string | undefined;
    let syncToken = cursor.providerCursor;

    do {
      let data: Awaited<ReturnType<CalendarClientInterface["events"]["list"]>>["data"];
      try {
        const resp = await client.events.list({
          calendarId: "primary",
          maxResults: 250,
          syncToken,
          ...(pageToken ? { pageToken } : {}),
        });
        data = resp.data;
      } catch (err: unknown) {
        const e = err as {
          code?: number;
          message?: string;
          errors?: Array<{ reason?: string }>;
        };
        // Google signals stale syncToken via 410 or reason=fullSyncRequired
        if (
          e.code === 410 ||
          e.errors?.[0]?.reason === "fullSyncRequired"
        ) {
          throw new ConnectorCursorError(
            this.config.connectorId,
            "syncToken expired; run fullSync"
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

      for (const item of data.items ?? []) {
        const event = this.normalizeEvent(item);
        if (event) yield event;
      }

      pageToken = data.nextPageToken ?? undefined;
      syncToken = data.nextSyncToken ?? syncToken;
    } while (pageToken);

    this.latestSyncToken = syncToken;
  }

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: this.latestSyncToken ?? "",
      fullSyncRequired: !this.latestSyncToken,
    };
  }

  private normalizeEvent(raw: RawCalendarEvent): NormalizedEvent | null {
    if (!raw.id) return null;

    const now = new Date().toISOString();
    const startAt = raw.start?.dateTime ?? raw.start?.date ?? now;
    const endAt = raw.end?.dateTime ?? raw.end?.date ?? now;
    const isAllDay = !raw.start?.dateTime;

    const canonicalId = connectorNodeId(this.config.connectorId, raw.id);
    const organizerEmail = raw.organizer?.email ?? "unknown@calendar";
    const organizerIdentityId = identityId(organizerEmail);

    const attendeeIdentityIds = (raw.attendees ?? [])
      .filter((a): a is { email: string; responseStatus?: string | null } => Boolean(a.email))
      .map((a) => identityId(a.email));

    const meetingUrl =
      raw.hangoutLink ??
      raw.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
      null;

    const validStatuses = new Set(["confirmed", "tentative", "cancelled"]);
    const status = validStatuses.has(raw.status ?? "")
      ? (raw.status as CalendarEventNode["status"])
      : "confirmed";

    const payload: CalendarEventNode = {
      nodeType: "CalendarEvent",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerEventId: raw.id,
      title: raw.summary ?? "(No title)",
      description: raw.description ?? null,
      startAt,
      endAt,
      isAllDay,
      location: raw.location ?? null,
      status,
      organizerIdentityId,
      attendeeIdentityIds,
      recurrenceRule: raw.recurrence?.[0] ?? null,
      meetingUrl,
      ingestedAt: now,
      rawHash: "",
    };

    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;

    return {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "google-calendar",
      providerEventId: raw.id,
      eventType: "CalendarEvent",
      occurredAt: startAt,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }
}
