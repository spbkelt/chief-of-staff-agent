import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-rag-embed-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
  // Remove live credentials so mock path is always used
  delete process.env["AWS_ACCESS_KEY_ID"];
  delete process.env["AWS_SECRET_ACCESS_KEY"];
});

afterEach(async () => {
  const { resetEnvForTest } = await import("../../config/env.js");
  const { closeDb, resetDbForTest } = await import("../../graph/graph.db.js");
  resetEnvForTest();
  await closeDb();
  resetDbForTest();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }
});

describe("mockEmbed", () => {
  it("returns a 1024-dimensional vector", async () => {
    const { mockEmbed, MOCK_EMBED_DIMS } = await import("../../rag/embed.js");
    const vec = mockEmbed("hello world");
    expect(vec).toHaveLength(MOCK_EMBED_DIMS);
  });

  it("returns a unit vector (magnitude ≈ 1)", async () => {
    const { mockEmbed } = await import("../../rag/embed.js");
    const vec = mockEmbed("test text for unit vector check");
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 5);
  });

  it("is deterministic — same input produces same output", async () => {
    const { mockEmbed } = await import("../../rag/embed.js");
    const text = "deterministic embedding test";
    const v1 = mockEmbed(text);
    const v2 = mockEmbed(text);
    expect(v1).toEqual(v2);
  });

  it("produces different embeddings for different inputs", async () => {
    const { mockEmbed } = await import("../../rag/embed.js");
    const v1 = mockEmbed("text one");
    const v2 = mockEmbed("text two");
    // Vectors should differ (not identical)
    const allSame = v1.every((v, i) => v === v2[i]);
    expect(allSame).toBe(false);
  });
});

describe("embedPendingChunks", () => {
  it("embeds all pending chunks in demo mode", async () => {
    const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks } = await import("../../rag/embed.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("embed-test@example.com");
    const connId = "embed-test-conn";

    const payload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-e1",
      title: "Embed Test Event",
      description: "Testing embedding pipeline with mock embeddings",
      startAt: "2026-05-28T09:00:00Z",
      endAt: "2026-05-28T10:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: identityId("org@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
    };
    await upsertNode({
      ...payload,
      nodeType: "CalendarEvent" as const,
      canonicalId: connectorNodeId(connId, "evt-e1"),
      rawHash: computeHash(payload),
    });

    await chunkAllNodes(ownerId);

    const db = getDb();
    const before = await db.execute({
      sql: "SELECT COUNT(*) FROM rag_chunks WHERE embedding IS NULL AND owner_user_id = ?",
      args: [ownerId],
    });
    const pendingBefore = before.rows[0]?.[0] as number;
    expect(pendingBefore).toBeGreaterThan(0);

    const result = await embedPendingChunks(ownerId);
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);

    const after = await db.execute({
      sql: "SELECT COUNT(*) FROM rag_chunks WHERE embedding IS NULL AND owner_user_id = ?",
      args: [ownerId],
    });
    expect(after.rows[0]?.[0] as number).toBe(0);
  });

  it("skips chunks that already have embeddings", async () => {
    const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks } = await import("../../rag/embed.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("embed-skip-test@example.com");
    const connId = "embed-skip-conn";

    const payload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-skip1",
      title: "Skip Test Event",
      description: null,
      startAt: "2026-05-28T11:00:00Z",
      endAt: "2026-05-28T12:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: identityId("org@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
    };
    await upsertNode({
      ...payload,
      nodeType: "CalendarEvent" as const,
      canonicalId: connectorNodeId(connId, "evt-skip1"),
      rawHash: computeHash(payload),
    });

    await chunkAllNodes(ownerId);
    const first = await embedPendingChunks(ownerId);
    expect(first.embedded).toBeGreaterThan(0);

    // Second run: all already embedded
    const second = await embedPendingChunks(ownerId);
    expect(second.embedded).toBe(0);

    const db = getDb();
    const nullCount = await db.execute({
      sql: "SELECT COUNT(*) FROM rag_chunks WHERE embedding IS NULL AND owner_user_id = ?",
      args: [ownerId],
    });
    expect(nullCount.rows[0]?.[0] as number).toBe(0);
  });

  it("stores embedding model and dimension metadata", async () => {
    const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks, MOCK_EMBED_DIMS } = await import("../../rag/embed.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("embed-meta-test@example.com");
    const connId = "embed-meta-conn";

    const payload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-meta1",
      title: "Meta Test Event",
      description: null,
      startAt: "2026-05-28T13:00:00Z",
      endAt: "2026-05-28T14:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: identityId("org@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
    };
    await upsertNode({
      ...payload,
      nodeType: "CalendarEvent" as const,
      canonicalId: connectorNodeId(connId, "evt-meta1"),
      rawHash: computeHash(payload),
    });

    await chunkAllNodes(ownerId);
    await embedPendingChunks(ownerId);

    const db = getDb();
    const rows = await db.execute({
      sql: "SELECT embedding_model, embedding_dims FROM rag_chunks WHERE owner_user_id = ?",
      args: [ownerId],
    });
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row[0]).toBe("mock");
      expect(row[1]).toBe(MOCK_EMBED_DIMS);
    }
  });
});
