import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-rag-links-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
  delete process.env["COS_RAG_BACKEND"];
});

afterEach(async () => {
  const { resetEnvForTest } = await import("../../config/env.js");
  const { closeDb, resetDbForTest } = await import("../../graph/graph.db.js");
  resetEnvForTest();
  await closeDb();
  resetDbForTest();
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("rag_links", () => {
  it("creates CHUNK_OF links when chunking calendar events", async () => {
    const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("links-test@example.com");
    const connId = "links-conn";
    const payload = {
      nodeType: "CalendarEvent" as const,
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-1",
      title: "Strategy Review",
      description: "Quarterly strategy",
      startAt: "2026-05-27T14:00:00Z",
      endAt: "2026-05-27T16:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: identityId("org@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: "https://meet.example.com/strategy",
      ingestedAt: new Date().toISOString(),
    };
    await upsertNode({
      ...payload,
      canonicalId: connectorNodeId(connId, "evt-1"),
      rawHash: computeHash(payload),
    });

    await chunkAllNodes(ownerId);

    const db = getDb();
    const links = await db.execute("SELECT COUNT(*) FROM rag_links");
    const count = Number(links.rows[0]?.[0] ?? 0);
    expect(count).toBeGreaterThan(0);

    const chunkOf = await db.execute(
      "SELECT link_type FROM rag_links WHERE link_type = 'CHUNK_OF' LIMIT 1",
    );
    expect(chunkOf.rows.length).toBe(1);
  });
});
