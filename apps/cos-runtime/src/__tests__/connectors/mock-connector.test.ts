import { describe, it, expect, beforeEach } from "vitest";
import { MockCalendarConnector, MockGmailConnector, MockAsanaConnector } from "../../connectors/mock.connector.js";

const OWNER_ID = "abc123";

describe("MockCalendarConnector", () => {
  let connector: MockCalendarConnector;

  beforeEach(() => {
    connector = new MockCalendarConnector("gcal-mock", OWNER_ID);
  });

  it("has correct config", () => {
    expect(connector.config.connectorId).toBe("gcal-mock");
    expect(connector.config.providerId).toBe("google-calendar");
  });

  it("fullSync yields CalendarEvent events", async () => {
    const events = [];
    for await (const event of connector.fullSync()) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.eventType).toBe("CalendarEvent");
    expect(events[0]?.connectorId).toBe("gcal-mock");
  });

  it("each event has a 64-char sha256 eventId", async () => {
    for await (const event of connector.fullSync()) {
      expect(event.eventId).toHaveLength(64);
      expect(event.rawHash).toHaveLength(64);
    }
  });

  it("ownerUserId is set on payload", async () => {
    for await (const event of connector.fullSync()) {
      expect(event.payload["ownerUserId"]).toBe(OWNER_ID);
    }
  });

  it("verifyAuth resolves without throwing", async () => {
    await expect(connector.verifyAuth()).resolves.toBeUndefined();
  });
});

describe("MockGmailConnector", () => {
  let connector: MockGmailConnector;

  beforeEach(() => {
    connector = new MockGmailConnector("gmail-mock", OWNER_ID);
  });

  it("yields both EmailThread and EmailMessage events", async () => {
    const types = new Set<string>();
    for await (const event of connector.fullSync()) {
      types.add(event.eventType);
    }
    expect(types.has("EmailThread")).toBe(true);
    expect(types.has("EmailMessage")).toBe(true);
  });

  it("messages have correct threadCanonicalId linking back to thread", async () => {
    const messages: Array<{ payload: Record<string, unknown> }> = [];

    for await (const event of connector.fullSync()) {
      if (event.eventType === "EmailMessage") {
        messages.push(event);
      }
    }

    for (const msg of messages) {
      const threadId = msg.payload["threadCanonicalId"];
      expect(typeof threadId).toBe("string");
      expect((threadId as string).length).toBe(64);
    }
  });
});

describe("MockAsanaConnector", () => {
  let connector: MockAsanaConnector;

  beforeEach(() => {
    connector = new MockAsanaConnector("asana-mock", OWNER_ID);
  });

  it("yields AsanaWorkspace, AsanaProject, AsanaTask, and AsanaComment events", async () => {
    const types = new Set<string>();
    for await (const event of connector.fullSync()) {
      types.add(event.eventType);
    }
    expect(types.has("AsanaWorkspace")).toBe(true);
    expect(types.has("AsanaProject")).toBe(true);
    expect(types.has("AsanaTask")).toBe(true);
    expect(types.has("AsanaComment")).toBe(true);
  });

  it("each event has unique eventId", async () => {
    const ids = new Set<string>();
    for await (const event of connector.fullSync()) {
      expect(ids.has(event.eventId)).toBe(false);
      ids.add(event.eventId);
    }
    expect(ids.size).toBeGreaterThan(0);
  });

  it("same fixture data produces same rawHash (deterministic)", async () => {
    const firstRun: string[] = [];
    const secondRun: string[] = [];

    for await (const event of connector.fullSync()) {
      firstRun.push(event.rawHash);
    }
    for await (const event of connector.fullSync()) {
      secondRun.push(event.rawHash);
    }

    expect(firstRun).toEqual(secondRun);
  });
});
