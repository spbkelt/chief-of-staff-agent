import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// Use an isolated test database
const TEST_DB_PATH = path.join(os.tmpdir(), `cos-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB_PATH;
  process.env["COS_DEMO_MODE"] = "false";
  process.env["LANGSMITH_TRACING"] = "false";
});

afterEach(() => {
  // Clean up test database
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  } catch {
    // ignore
  }
  // Reset module state
  resetModules();
});

function resetModules() {
  // Vitest module isolation — dynamic import cache is process-scoped
  // We reset the singletons directly
}

describe("upsert idempotency", () => {
  it("writing the same node twice produces one row", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode, getNodeCount } = await import("../../graph/upsert.js");
    const { rawHash: computeHash } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const nodePayload = {
      title: "Board Review",
      startAt: "2026-05-27T14:00:00Z",
      endAt: "2026-05-27T16:00:00Z",
    };
    const hash = computeHash(nodePayload);

    const node = {
      nodeType: "CalendarEvent" as const,
      canonicalId: "test-canonical-id-001",
      connectorId: "gcal-test",
      ownerUserId: "owner-hash",
      providerEventId: "evt001",
      title: "Board Review",
      description: null,
      startAt: "2026-05-27T14:00:00Z",
      endAt: "2026-05-27T16:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
      rawHash: hash,
    };

    const result1 = await upsertNode(node);
    expect(result1.skipped).toBe(false);

    const result2 = await upsertNode(node);
    expect(result2.skipped).toBe(true);

    const count = await getNodeCount();
    expect(count).toBe(1);
  });

  it("changed rawHash triggers an update", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode, getNode } = await import("../../graph/upsert.js");
    const { rawHash: computeHash } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const nodePayload1 = { title: "Board Review v1", startAt: "2026-05-27T14:00:00Z" };
    const hash1 = computeHash(nodePayload1);

    const node = {
      nodeType: "CalendarEvent" as const,
      canonicalId: "test-canonical-id-002",
      connectorId: "gcal-test",
      ownerUserId: "owner-hash",
      providerEventId: "evt002",
      title: "Board Review v1",
      description: null,
      startAt: "2026-05-27T14:00:00Z",
      endAt: "2026-05-27T16:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
      rawHash: hash1,
    };

    await upsertNode(node);

    const nodePayload2 = { title: "Board Review UPDATED", startAt: "2026-05-27T14:00:00Z" };
    const hash2 = computeHash(nodePayload2);

    const updatedNode = { ...node, title: "Board Review UPDATED", rawHash: hash2 };
    const result = await upsertNode(updatedNode);
    expect(result.skipped).toBe(false);

    const stored = await getNode("test-canonical-id-002");
    expect(stored).not.toBeNull();
    if (stored && stored.nodeType === "CalendarEvent") {
      expect(stored.title).toBe("Board Review UPDATED");
    }
  });
});
