import { describe, it, expect } from "vitest";
import { GoogleCalendarConnector } from "../../connectors/google-calendar.connector.js";
import type { CalendarClientInterface, CalendarEventsListParams, RawCalendarEvent } from "../../connectors/google-calendar.connector.js";
import { connectorNodeId, identityId } from "../../graph/canonical-id.js";

function mockClient(
  pages: Array<{ items: RawCalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }>
): CalendarClientInterface {
  let callIndex = 0;
  return {
    events: {
      list: async (_params) => {
        const page = pages[callIndex++] ?? { items: [] };
        return {
          data: {
            items: page.items,
            nextPageToken: page.nextPageToken ?? null,
            nextSyncToken: page.nextSyncToken ?? null,
          },
        };
      },
    },
    calendarList: {
      list: async (_params) => ({ data: {} }),
    },
  };
}

function capturingClient(
  page: { items: RawCalendarEvent[] }
): { client: CalendarClientInterface; capturedParams: CalendarEventsListParams[] } {
  const capturedParams: CalendarEventsListParams[] = [];
  const client: CalendarClientInterface = {
    events: {
      list: async (params) => {
        capturedParams.push(params);
        return { data: { items: page.items, nextPageToken: null, nextSyncToken: "tok-x" } };
      },
    },
    calendarList: { list: async (_p) => ({ data: {} }) },
  };
  return { client, capturedParams };
}

const OWNER_ID = identityId("owner@example.com");
const CONNECTOR_ID = "gcal-test";

const sampleEvent: RawCalendarEvent = {
  id: "event001",
  summary: "Board Review",
  description: "Quarterly board review",
  start: { dateTime: "2026-06-01T10:00:00Z" },
  end: { dateTime: "2026-06-01T11:00:00Z" },
  status: "confirmed",
  organizer: { email: "alice@prismteam.ai" },
  attendees: [
    { email: "alice@prismteam.ai" },
    { email: "bob@prismteam.ai" },
  ],
  hangoutLink: "https://meet.google.com/abc-def",
};

const allDayEvent: RawCalendarEvent = {
  id: "event002",
  summary: "Company Offsite",
  start: { date: "2026-06-15" },
  end: { date: "2026-06-16" },
  status: "confirmed",
  organizer: { email: "hr@prismteam.ai" },
};

describe("GoogleCalendarConnector", () => {
  it("emits CalendarEvent nodes from mock client", async () => {
    const client = mockClient([{ items: [sampleEvent], nextSyncToken: "tok-abc" }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);

    const events = [];
    for await (const e of connector.fullSync()) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.eventType).toBe("CalendarEvent");
    expect(e.connectorId).toBe(CONNECTOR_ID);
    expect(e.providerId).toBe("google-calendar");
    expect(e.providerEventId).toBe("event001");
  });

  it("sets canonical ID as sha256(connectorId:eventId)", async () => {
    const client = mockClient([{ items: [sampleEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events[0]!.eventId).toBe(connectorNodeId(CONNECTOR_ID, "event001"));
  });

  it("sets ownerUserId on every node", async () => {
    const client = mockClient([{ items: [sampleEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events[0]!.payload["ownerUserId"]).toBe(OWNER_ID);
  });

  it("handles all-day events — isAllDay=true, startAt=date string", async () => {
    const client = mockClient([{ items: [allDayEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events[0]!.payload["isAllDay"]).toBe(true);
    expect(events[0]!.payload["startAt"]).toBe("2026-06-15");
  });

  it("maps organizer and attendees to identity IDs", async () => {
    const client = mockClient([{ items: [sampleEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const payload = events[0]!.payload;
    expect(payload["organizerIdentityId"]).toBe(identityId("alice@prismteam.ai"));
    expect(payload["attendeeIdentityIds"]).toContain(identityId("bob@prismteam.ai"));
  });

  it("captures hangoutLink as meetingUrl", async () => {
    const client = mockClient([{ items: [sampleEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    expect(events[0]!.payload["meetingUrl"]).toBe("https://meet.google.com/abc-def");
  });

  it("produces deterministic rawHash across two calls", async () => {
    const makeConnector = () =>
      new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, mockClient([{ items: [sampleEvent] }]));

    const [e1] = await (async () => { const r = []; for await (const e of makeConnector().fullSync()) r.push(e); return r; })();
    const [e2] = await (async () => { const r = []; for await (const e of makeConnector().fullSync()) r.push(e); return r; })();

    expect(e1!.rawHash).toBe(e2!.rawHash);
  });

  it("stores syncToken in currentCursor after fullSync", async () => {
    const client = mockClient([{ items: [sampleEvent], nextSyncToken: "tok-xyz" }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    for await (const _ of connector.fullSync()) { /* drain */ }
    const cursor = await connector.currentCursor();
    expect(cursor.providerCursor).toBe("tok-xyz");
    expect(cursor.fullSyncRequired).toBe(false);
  });

  it("paginates across multiple pages", async () => {
    const client = mockClient([
      { items: [sampleEvent], nextPageToken: "page2" },
      { items: [allDayEvent], nextSyncToken: "tok-final" },
    ]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);
    expect(events).toHaveLength(2);
  });

  it("skips events with no id", async () => {
    const noId: RawCalendarEvent = { summary: "Ghost event" };
    const client = mockClient([{ items: [noId, sampleEvent] }]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);
    expect(events).toHaveLength(1);
  });

  it("verifyAuth is a no-op for injected client", async () => {
    const client = mockClient([]);
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    await expect(connector.verifyAuth()).resolves.toBeUndefined();
  });

  it("fullSync passes both timeMin (-30d) and timeMax (+30d) to events.list", async () => {
    const before = Date.now();
    const { client, capturedParams } = capturingClient({ items: [sampleEvent] });
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    for await (const _ of connector.fullSync()) { /* drain */ }

    expect(capturedParams).toHaveLength(1);
    const params = capturedParams[0]!;
    expect(params.timeMin).toBeDefined();
    expect(params.timeMax).toBeDefined();
    const minTs = new Date(params.timeMin!).getTime();
    const maxTs = new Date(params.timeMax!).getTime();
    expect(minTs).toBeLessThan(before); // timeMin is in the past
    expect(maxTs).toBeGreaterThan(before); // timeMax is in the future
    // Approximately ±30 days (allow 1-minute margin for test timing)
    const margin = 60_000;
    expect(minTs).toBeGreaterThan(before - 30 * 24 * 60 * 60 * 1000 - margin);
    expect(maxTs).toBeLessThan(before + 30 * 24 * 60 * 60 * 1000 + margin);
  });
});
