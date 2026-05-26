import { describe, it, expect } from "vitest";
import {
  ConnectorError,
  ConnectorAuthError,
  ConnectorRateLimitError,
  ConnectorCursorError,
  ConnectorNetworkError,
} from "../../connectors/connector.interface.js";

describe("ConnectorError hierarchy", () => {
  it("ConnectorError carries connectorId", () => {
    const err = new ConnectorError("test", "my-connector");
    expect(err.connectorId).toBe("my-connector");
    expect(err.name).toBe("ConnectorError");
    expect(err instanceof ConnectorError).toBe(true);
  });

  it("ConnectorAuthError is a ConnectorError", () => {
    const err = new ConnectorAuthError("my-connector", "token expired", 401);
    expect(err instanceof ConnectorError).toBe(true);
    expect(err instanceof ConnectorAuthError).toBe(true);
    expect(err.name).toBe("ConnectorAuthError");
    expect(err.providerStatusCode).toBe(401);
  });

  it("ConnectorRateLimitError carries retryAfterMs", () => {
    const err = new ConnectorRateLimitError("my-connector", 30000);
    expect(err.retryAfterMs).toBe(30000);
    expect(err.name).toBe("ConnectorRateLimitError");
  });

  it("ConnectorCursorError is a ConnectorError", () => {
    const err = new ConnectorCursorError("my-connector", "410 GONE");
    expect(err instanceof ConnectorError).toBe(true);
    expect(err.name).toBe("ConnectorCursorError");
    expect(err.message).toContain("410 GONE");
  });

  it("ConnectorNetworkError wraps cause message", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new ConnectorNetworkError("my-connector", cause, 1);
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.retryCount).toBe(1);
    expect(err.name).toBe("ConnectorNetworkError");
  });
});

describe("NormalizedEvent shape", () => {
  it("has required fields defined by interface", async () => {
    const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");

    const payload = { title: "Test Event", startAt: "2026-05-27T14:00:00Z" };
    const event = {
      eventId: connectorNodeId("gcal-test", "evt001"),
      connectorId: "gcal-test",
      providerId: "google-calendar" as const,
      providerEventId: "evt001",
      eventType: "CalendarEvent" as const,
      occurredAt: "2026-05-27T14:00:00Z",
      payload,
      rawHash: rawHash(payload),
    };

    expect(event.eventId).toHaveLength(64); // sha256 hex
    expect(event.rawHash).toHaveLength(64);
    expect(typeof event.rawHash).toBe("string");
  });
});
