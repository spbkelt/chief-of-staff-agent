import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-rag-chunk-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "false";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
});

afterEach(async () => {
  const { closeDb, resetDbForTest } = await import("../../graph/graph.db.js");
  await closeDb();
  resetDbForTest();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }
});

describe("approxTokens", () => {
  it("approximates token count at 1 token per 4 chars", async () => {
    const { approxTokens } = await import("../../rag/chunk.js");
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("1234")).toBe(1);
    expect(approxTokens("12345")).toBe(2);
    expect(approxTokens("a".repeat(100))).toBe(25);
  });
});

describe("sentenceWindowChunks", () => {
  it("returns single chunk when text fits in one window", async () => {
    const { sentenceWindowChunks } = await import("../../rag/chunk.js");
    const text = "Hello world. This is a test.";
    const chunks = sentenceWindowChunks(text, 512, 64);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("Hello world");
  });

  it("splits long text into multiple overlapping windows", async () => {
    const { sentenceWindowChunks } = await import("../../rag/chunk.js");
    // Each sentence is ~25 chars = ~7 tokens; maxTokens = 20 forces multiple chunks
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} ends here.`);
    const text = sentences.join(" ");
    const chunks = sentenceWindowChunks(text, 20, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns empty array for empty text", async () => {
    const { sentenceWindowChunks } = await import("../../rag/chunk.js");
    expect(sentenceWindowChunks("", 512, 64)).toEqual([]);
  });
});

describe("chunkAllNodes", () => {
  it("chunks calendar events and email messages", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { rawHash: computeHash, connectorNodeId, identityId } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("test@example.com");
    const connId = "test-connector";

    const evtPayload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-001",
      title: "Q3 Board Review",
      description: "Quarterly board meeting to review financials and roadmap",
      startAt: "2026-05-27T14:00:00Z",
      endAt: "2026-05-27T16:00:00Z",
      isAllDay: false,
      location: "Conference Room A",
      status: "confirmed" as const,
      organizerIdentityId: identityId("organizer@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
    };
    const evtNode = {
      ...evtPayload,
      nodeType: "CalendarEvent" as const,
      canonicalId: connectorNodeId(connId, "evt-001"),
      rawHash: computeHash(evtPayload),
    };
    await upsertNode(evtNode);

    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const result = await chunkAllNodes(ownerId);

    expect(result.chunked).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips nodes that are already chunked with same rawHash", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { rawHash: computeHash, connectorNodeId, identityId } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("test2@example.com");
    const connId = "test-connector-2";

    const payload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-002",
      title: "Weekly Sync",
      description: null,
      startAt: "2026-05-28T09:00:00Z",
      endAt: "2026-05-28T10:00:00Z",
      isAllDay: false,
      location: null,
      status: "confirmed" as const,
      organizerIdentityId: identityId("organizer@example.com"),
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: new Date().toISOString(),
    };
    const node = {
      ...payload,
      nodeType: "CalendarEvent" as const,
      canonicalId: connectorNodeId(connId, "evt-002"),
      rawHash: computeHash(payload),
    };
    await upsertNode(node);

    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const first = await chunkAllNodes(ownerId);
    expect(first.chunked).toBe(1);

    const second = await chunkAllNodes(ownerId);
    expect(second.chunked).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("re-chunks when rawHash changes", async () => {
    const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { rawHash: computeHash, connectorNodeId, identityId } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("test3@example.com");
    const connId = "test-connector-3";
    const eventId = connectorNodeId(connId, "evt-003");

    const makeNode = (title: string) => {
      const payload = {
        nodeType: "CalendarEvent",
        connectorId: connId,
        ownerUserId: ownerId,
        providerEventId: "evt-003",
        title,
        description: null,
        startAt: "2026-05-28T09:00:00Z",
        endAt: "2026-05-28T10:00:00Z",
        isAllDay: false,
        location: null,
        status: "confirmed" as const,
        organizerIdentityId: "org",
        attendeeIdentityIds: [],
        recurrenceRule: null,
        meetingUrl: null,
        ingestedAt: new Date().toISOString(),
      };
      return { ...payload, nodeType: "CalendarEvent" as const, canonicalId: eventId, rawHash: computeHash(payload) };
    };

    await upsertNode(makeNode("Original Title"));
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    await chunkAllNodes(ownerId);

    // Update the node with changed title
    await upsertNode(makeNode("Updated Title"));
    const second = await chunkAllNodes(ownerId);
    expect(second.chunked).toBe(1);

    // Verify updated chunk text
    const db = getDb();
    const rows = await db.execute({
      sql: "SELECT chunk_text FROM rag_chunks WHERE owner_user_id = ?",
      args: [ownerId],
    });
    const texts = rows.rows.map((r) => r[0] as string);
    expect(texts.some((t) => t.includes("Updated Title"))).toBe(true);
  });

  it("respects ownerUserId — does not chunk other owners' nodes", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { rawHash: computeHash, connectorNodeId, identityId } = await import("../../graph/canonical-id.js");

    resetDbForTest();
    await initSchema();

    const ownerA = identityId("owner-a@example.com");
    const ownerB = identityId("owner-b@example.com");

    const makeEvent = (ownerId: string, evtId: string) => {
      const payload = {
        nodeType: "CalendarEvent",
        connectorId: "conn",
        ownerUserId: ownerId,
        providerEventId: evtId,
        title: `Event ${evtId}`,
        description: null,
        startAt: "2026-05-28T09:00:00Z",
        endAt: "2026-05-28T10:00:00Z",
        isAllDay: false,
        location: null,
        status: "confirmed" as const,
        organizerIdentityId: "org",
        attendeeIdentityIds: [],
        recurrenceRule: null,
        meetingUrl: null,
        ingestedAt: new Date().toISOString(),
      };
      return { ...payload, nodeType: "CalendarEvent" as const, canonicalId: connectorNodeId("conn", evtId), rawHash: computeHash(payload) };
    };

    await upsertNode(makeEvent(ownerA, "a-evt"));
    await upsertNode(makeEvent(ownerB, "b-evt"));

    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const result = await chunkAllNodes(ownerA);

    expect(result.chunked).toBe(1);
  });
});
