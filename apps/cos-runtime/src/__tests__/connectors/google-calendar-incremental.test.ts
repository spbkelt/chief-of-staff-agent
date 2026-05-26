import { describe, it, expect } from "vitest";
import { GoogleCalendarConnector } from "../../connectors/google-calendar.connector.js";
import type { CalendarClientInterface, RawCalendarEvent } from "../../connectors/google-calendar.connector.js";
import { ConnectorCursorError } from "../../connectors/connector.interface.js";
import { identityId } from "../../graph/canonical-id.js";

const OWNER_ID = identityId("owner@example.com");
const CONNECTOR_ID = "gcal-incr-test";

const sampleEvent: RawCalendarEvent = {
  id: "evt001",
  summary: "Standup",
  start: { dateTime: "2026-06-01T09:00:00Z" },
  end: { dateTime: "2026-06-01T09:30:00Z" },
  status: "confirmed",
  organizer: { email: "alice@prismteam.ai" },
};

const updatedEvent: RawCalendarEvent = {
  id: "evt001",
  summary: "Standup (updated)",
  start: { dateTime: "2026-06-01T09:00:00Z" },
  end: { dateTime: "2026-06-01T09:45:00Z" },
  status: "confirmed",
  organizer: { email: "alice@prismteam.ai" },
};

function makeIncrementalClient(
  items: RawCalendarEvent[],
  opts: { nextSyncToken?: string; throw410?: boolean } = {}
): CalendarClientInterface {
  return {
    events: {
      list: async (_params) => {
        if (opts.throw410) {
          const err = Object.assign(new Error("Gone"), {
            code: 410,
            errors: [{ reason: "fullSyncRequired" }],
          });
          throw err;
        }
        return {
          data: {
            items,
            nextSyncToken: opts.nextSyncToken ?? null,
            nextPageToken: null,
          },
        };
      },
    },
    calendarList: {
      list: async () => ({ data: {} }),
    },
  };
}

describe("GoogleCalendarConnector — incrementalSync", () => {
  it("uses syncToken from cursor and emits only returned events", async () => {
    const client = makeIncrementalClient([updatedEvent], { nextSyncToken: "tok-v2" });
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);

    const cursor = {
      connectorId: CONNECTOR_ID,
      lastSyncedAt: "2026-05-01T00:00:00Z",
      providerCursor: "tok-v1",
      fullSyncRequired: false,
    };

    const events = [];
    for await (const e of connector.incrementalSync(cursor)) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.payload["title"]).toBe("Standup (updated)");
  });

  it("updates latestSyncToken after incrementalSync", async () => {
    const client = makeIncrementalClient([updatedEvent], { nextSyncToken: "tok-v2" });
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);

    const cursor = {
      connectorId: CONNECTOR_ID,
      lastSyncedAt: "2026-05-01T00:00:00Z",
      providerCursor: "tok-v1",
      fullSyncRequired: false,
    };

    for await (const _ of connector.incrementalSync(cursor)) { /* drain */ }

    const newCursor = await connector.currentCursor();
    expect(newCursor.providerCursor).toBe("tok-v2");
    expect(newCursor.fullSyncRequired).toBe(false);
  });

  it("emits empty result when no events changed since last sync", async () => {
    const client = makeIncrementalClient([], { nextSyncToken: "tok-unchanged" });
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);

    const cursor = {
      connectorId: CONNECTOR_ID,
      lastSyncedAt: "2026-05-01T00:00:00Z",
      providerCursor: "tok-v1",
      fullSyncRequired: false,
    };

    const events = [];
    for await (const e of connector.incrementalSync(cursor)) events.push(e);
    expect(events).toHaveLength(0);
  });

  it("throws ConnectorCursorError on 410 / fullSyncRequired", async () => {
    const client = makeIncrementalClient([], { throw410: true });
    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);

    const cursor = {
      connectorId: CONNECTOR_ID,
      lastSyncedAt: "2026-05-01T00:00:00Z",
      providerCursor: "tok-expired",
      fullSyncRequired: false,
    };

    await expect(async () => {
      for await (const _ of connector.incrementalSync(cursor)) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorCursorError" });
  });

  it("throws ConnectorCursorError when error.errors[0].reason is fullSyncRequired (not just code 410)", async () => {
    const client: CalendarClientInterface = {
      events: {
        list: async () => {
          const err = Object.assign(new Error("Sync token invalid"), {
            code: 400,
            errors: [{ reason: "fullSyncRequired" }],
          });
          throw err;
        },
      },
      calendarList: { list: async () => ({ data: {} }) },
    };

    const connector = new GoogleCalendarConnector(CONNECTOR_ID, OWNER_ID, undefined, client);
    const cursor = {
      connectorId: CONNECTOR_ID,
      lastSyncedAt: "2026-05-01T00:00:00Z",
      providerCursor: "tok-bad",
      fullSyncRequired: false,
    };

    await expect(async () => {
      for await (const _ of connector.incrementalSync(cursor)) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorCursorError" });
  });
});
