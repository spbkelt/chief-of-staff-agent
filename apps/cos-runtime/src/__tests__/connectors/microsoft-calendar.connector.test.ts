import { describe, it, expect } from "vitest";
import { MicrosoftCalendarConnector } from "../../connectors/microsoft-calendar.connector.js";
import { connectorNodeId } from "../../graph/canonical-id.js";
import type { MicrosoftAccountConfig } from "../../config/credentials.js";

const OWNER_ID = "owner-hash-abc";
const CONNECTOR_ID = "mscal-test";
const ACCOUNT: MicrosoftAccountConfig = {
  id: "test-ms",
  label: "Test Microsoft",
  accessToken: "tok-test",
};

const nowIso = new Date().toISOString();
const futureIso = new Date(Date.now() + 3600_000).toISOString();

const rawEvent = {
  id: "evt001",
  subject: "Q3 Review",
  body: { content: "Quarterly review meeting" },
  start: { dateTime: nowIso, timeZone: "UTC" },
  end: { dateTime: futureIso, timeZone: "UTC" },
  location: { displayName: "Room A" },
  isCancelled: false,
  isAllDay: false,
  organizer: { emailAddress: { address: "alice@example.com", name: "Alice" } },
  attendees: [
    { emailAddress: { address: "bob@example.com" }, status: { response: "accepted" } },
  ],
  recurrence: null,
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/meeting/abc" },
};

function makeSuccessfulFetch(responses: Record<string, object>): (url: string, headers: Record<string, string>) => Promise<Response> {
  return async (url: string) => {
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ value: [], "@odata.deltaLink": "https://delta-link" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function makeDeltaFetch(events: object[]): (url: string, headers: Record<string, string>) => Promise<Response> {
  return async () =>
    new Response(
      JSON.stringify({ value: events, "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=xyz" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

describe("MicrosoftCalendarConnector", () => {
  it("fullSync emits CalendarEvent nodes", async () => {
    const fetchFn = makeDeltaFetch([rawEvent]);
    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("CalendarEvent");
  });

  it("fullSync event has correct fields", async () => {
    const fetchFn = makeDeltaFetch([rawEvent]);
    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const ev = events[0]!;
    expect(ev.providerId).toBe("microsoft-calendar");
    expect(ev.providerEventId).toBe("evt001");
    expect(ev.payload["ownerUserId"]).toBe(OWNER_ID);
    expect(ev.payload["title"]).toBe("Q3 Review");
    expect(ev.payload["location"]).toBe("Room A");
    expect(ev.payload["meetingUrl"]).toBe("https://teams.microsoft.com/meeting/abc");
  });

  it("uses canonical ID connectorNodeId(connectorId, eventId)", async () => {
    const fetchFn = makeDeltaFetch([rawEvent]);
    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events[0]!.eventId).toBe(connectorNodeId(CONNECTOR_ID, "evt001"));
  });

  it("rawHash is deterministic across two fullSync calls", async () => {
    const make = () => new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, makeDeltaFetch([rawEvent]));
    const ev1: { rawHash: string }[] = [];
    for await (const e of make().fullSync()) ev1.push(e);
    const ev2: { rawHash: string }[] = [];
    for await (const e of make().fullSync()) ev2.push(e);

    expect(ev1[0]!.rawHash).toBe(ev2[0]!.rawHash);
  });

  it("paginates via @odata.nextLink then stores deltaLink", async () => {
    const page1 = {
      value: [rawEvent],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$skip=1",
    };
    const page2 = {
      value: [{ ...rawEvent, id: "evt002", subject: "Kickoff" }],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc",
    };

    let call = 0;
    const fetchFn = async (_url: string, _headers: Record<string, string>): Promise<Response> => {
      call++;
      const body = call === 1 ? page1 : page2;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events).toHaveLength(2);
    const cursor = await connector.currentCursor();
    expect(cursor.providerCursor).toBe("https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc");
    expect(cursor.fullSyncRequired).toBe(false);
  });

  it("incrementalSync uses stored delta token", async () => {
    const deltaToken = "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc";
    let calledUrl = "";
    const fetchFn = async (url: string, _headers: Record<string, string>): Promise<Response> => {
      calledUrl = url;
      return new Response(JSON.stringify({ value: [rawEvent], "@odata.deltaLink": deltaToken }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };

    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const cursor = { connectorId: CONNECTOR_ID, lastSyncedAt: nowIso, providerCursor: deltaToken, fullSyncRequired: false };
    const events = [];
    for await (const e of connector.incrementalSync(cursor)) events.push(e);

    expect(calledUrl).toBe(deltaToken);
    expect(events).toHaveLength(1);
  });

  it("throws ConnectorCursorError on 410", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: "DeltaTokenExpired" } }), { status: 410, headers: { "Content-Type": "application/json" } });

    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const cursor = { connectorId: CONNECTOR_ID, lastSyncedAt: nowIso, providerCursor: "https://stale-delta", fullSyncRequired: false };
    await expect(async () => {
      for await (const _ of connector.incrementalSync(cursor)) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorCursorError" });
  });

  it("throws ConnectorAuthError on 401", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: "InvalidAuthenticationToken" } }), { status: 401, headers: { "Content-Type": "application/json" } });

    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    await expect(async () => {
      for await (const _ of connector.fullSync()) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorAuthError" });
  });

  it("verifyAuth throws ConnectorAuthError on 401", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } });

    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    await expect(connector.verifyAuth()).rejects.toMatchObject({ name: "ConnectorAuthError" });
  });

  it("sets ownerUserId on all nodes", async () => {
    const event2 = { ...rawEvent, id: "evt003", subject: "Standup" };
    const fetchFn = makeDeltaFetch([rawEvent, event2]);
    const connector = new MicrosoftCalendarConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    for (const e of events) {
      expect(e.payload["ownerUserId"]).toBe(OWNER_ID);
    }
  });
});
