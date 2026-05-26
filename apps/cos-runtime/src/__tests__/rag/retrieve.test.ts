import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-rag-retrieve-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
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

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical non-zero vectors", async () => {
    const { cosineSimilarity } = await import("../../rag/retrieve.js");
    const v = [0.6, 0.8, 0.0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for zero vector", async () => {
    const { cosineSimilarity } = await import("../../rag/retrieve.js");
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns -1 for antipodal unit vectors", async () => {
    const { cosineSimilarity } = await import("../../rag/retrieve.js");
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for empty vectors", async () => {
    const { cosineSimilarity } = await import("../../rag/retrieve.js");
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched dimensions", async () => {
    const { cosineSimilarity } = await import("../../rag/retrieve.js");
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe("retrieve", () => {
  async function setupDb() {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks } = await import("../../rag/embed.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("retrieve-test@example.com");
    const connId = "retrieve-conn";

    const makeEvent = (id: string, title: string, description: string, startAt: string) => {
      const payload = {
        nodeType: "CalendarEvent",
        connectorId: connId,
        ownerUserId: ownerId,
        providerEventId: id,
        title,
        description,
        startAt,
        endAt: startAt.replace("T14", "T16"),
        isAllDay: false,
        location: null,
        status: "confirmed" as const,
        organizerIdentityId: identityId("org@example.com"),
        attendeeIdentityIds: [],
        recurrenceRule: null,
        meetingUrl: `https://meet.example.com/${id}`,
        ingestedAt: new Date().toISOString(),
      };
      return { ...payload, nodeType: "CalendarEvent" as const, canonicalId: connectorNodeId(connId, id), rawHash: computeHash(payload) };
    };

    await upsertNode(makeEvent("r-evt-1", "Q3 Board Review", "Quarterly board meeting reviewing financials and roadmap", "2026-05-27T14:00:00Z"));
    await upsertNode(makeEvent("r-evt-2", "Engineering Standup", "Daily engineering team standup", "2026-05-28T09:00:00Z"));
    await upsertNode(makeEvent("r-evt-3", "Product Roadmap Planning", "Planning session for Q4 product roadmap", "2026-05-29T11:00:00Z"));

    await chunkAllNodes(ownerId);
    await embedPendingChunks(ownerId);

    return ownerId;
  }

  it("returns empty result when no chunks in DB", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { identityId } = await import("../../graph/canonical-id.js");
    const { retrieve } = await import("../../rag/retrieve.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("empty@example.com");
    const result = await retrieve("test query", { ownerUserId: ownerId });

    expect(result.chunks).toHaveLength(0);
    expect(result.retrievedChunkIds).toHaveLength(0);
  });

  it("returns results ordered by score descending", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("board review quarterly", { ownerUserId: ownerId });

    expect(result.chunks.length).toBeGreaterThan(0);
    // Scores should be non-increasing
    for (let i = 1; i < result.chunks.length; i++) {
      expect(result.chunks[i]!.score).toBeLessThanOrEqual(result.chunks[i - 1]!.score);
    }
  });

  it("retrieves chunk IDs without chunk text in trace output", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("quarterly board meeting", { ownerUserId: ownerId });

    // retrievedChunkIds should be IDs only (no spaces, URLs, or human text)
    for (const id of result.retrievedChunkIds) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("respects topK limit", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("meeting planning", { ownerUserId: ownerId }, 2);
    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });

  it("enforces ownerUserId — does not return other user chunks", async () => {
    const ownerId = await setupDb();
    const { identityId } = await import("../../graph/canonical-id.js");
    const { retrieve } = await import("../../rag/retrieve.js");

    const differentOwner = identityId("other-user@example.com");
    const result = await retrieve("board review", { ownerUserId: differentOwner });

    expect(result.chunks).toHaveLength(0);
  });

  it("marks results as belowThreshold when best score < 0.65", async () => {
    const ownerId = await setupDb();
    const { retrieve, MIN_CONFIDENT_SCORE } = await import("../../rag/retrieve.js");

    // Query completely unrelated to calendar events — should score low with mock embeddings
    // Since mock embed is deterministic hash-based, we can test the flag behavior
    const result = await retrieve("xyzzy frobnosticator plugh", { ownerUserId: ownerId });

    // With mock embeddings the scores will be low for unrelated text
    if (result.chunks.length > 0) {
      const bestRaw = result.chunks[0]!.rawScore;
      expect(result.belowThreshold).toBe(bestRaw < MIN_CONFIDENT_SCORE);
    }
  });

  it("applies nodeType filter correctly", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("meeting", { ownerUserId: ownerId, nodeType: "CalendarEvent" });

    for (const chunk of result.chunks) {
      expect(chunk.sourceType).toBe("CalendarEvent");
    }
  });

  it("builds citation URLs for CalendarEvent with meetingUrl", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("board review", { ownerUserId: ownerId });

    const withUrl = result.chunks.find((c) => c.citation.startsWith("https://meet.example.com/"));
    expect(withUrl).toBeDefined();
  });

  it("returns retrievedChunkIds that match returned chunks", async () => {
    const ownerId = await setupDb();
    const { retrieve } = await import("../../rag/retrieve.js");

    const result = await retrieve("quarterly review", { ownerUserId: ownerId });

    expect(result.retrievedChunkIds).toEqual(result.chunks.map((c) => c.chunkId));
  });
});
