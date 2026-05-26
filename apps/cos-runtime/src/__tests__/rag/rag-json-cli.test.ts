import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-rag-json-cli-${Date.now()}.db`);

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

async function seedCalendarCorpus(): Promise<string> {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
  const { chunkAllNodes } = await import("../../rag/chunk.js");
  const { embedPendingChunks } = await import("../../rag/embed.js");

  resetDbForTest();
  await initSchema();

  const ownerId = identityId("json-cli@example.com");
  const connId = "json-conn";
  const payload = {
    nodeType: "CalendarEvent" as const,
    connectorId: connId,
    ownerUserId: ownerId,
    providerEventId: "board-1",
    title: "Q3 Board Review",
    description: "Quarterly board meeting",
    startAt: "2026-05-27T14:00:00Z",
    endAt: "2026-05-27T16:00:00Z",
    isAllDay: false,
    location: null,
    status: "confirmed" as const,
    organizerIdentityId: identityId("org@example.com"),
    attendeeIdentityIds: [],
    recurrenceRule: null,
    meetingUrl: "https://meet.example.com/board",
    ingestedAt: new Date().toISOString(),
  };
  await upsertNode({
    ...payload,
    canonicalId: connectorNodeId(connId, "board-1"),
    rawHash: computeHash(payload),
  });

  await chunkAllNodes(ownerId);
  await embedPendingChunks(ownerId);
  return ownerId;
}

describe("inspect JSON output", () => {
  it("collectInspectOutput includes rag link counts", async () => {
    await seedCalendarCorpus();
    const { collectInspectOutput } = await import("../../rag/inspect-stats.js");
    const { InspectOutputSchema } = await import("../../rag/query-output.js");

    const output = await collectInspectOutput();
    const parsed = InspectOutputSchema.parse(output);

    expect(parsed.ragSources).toBeGreaterThan(0);
    expect(parsed.ragChunks).toBeGreaterThan(0);
    expect(parsed.ragChunksEmbedded).toBeGreaterThan(0);
    expect(parsed.ragLinks).toBeGreaterThan(0);
  });
});

describe("query JSON output", () => {
  it("retrievalToQueryOutput matches QueryOutputSchema", async () => {
    const ownerId = await seedCalendarCorpus();
    const { retrieve } = await import("../../rag/retrieve.js");
    const { retrievalToQueryOutput, QueryOutputSchema } = await import("../../rag/query-output.js");

    const result = await retrieve("board review quarterly", { ownerUserId: ownerId });
    const output = retrievalToQueryOutput("board review quarterly", result);
    const parsed = QueryOutputSchema.parse(output);

    expect(parsed.query).toBe("board review quarterly");
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches[0]!.chunkId).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.retrievedChunkIds).toEqual(parsed.matches.map((m) => m.chunkId));
  });
});

describe("paths JSON output", () => {
  it("findRelatedSources returns suggestions with citation URLs", async () => {
    const ownerId = await seedCalendarCorpus();
    const { findRelatedSources } = await import("../../rag/paths.js");
    const { PathsOutputSchema } = await import("../../rag/query-output.js");

    const output = await findRelatedSources("Board Review meeting", { ownerUserId: ownerId }, 10);
    const parsed = PathsOutputSchema.parse(output);

    expect(parsed.suggestions.length).toBeGreaterThan(0);
    const hit = parsed.suggestions.find((s) => s.relation === "retrieval_hit");
    expect(hit).toBeDefined();
    expect(hit!.canonicalId).toMatch(/^[0-9a-f]{64}$/);
    expect(hit!.url.length).toBeGreaterThan(0);
  });
});

describe("backfillRagLinks", () => {
  it("writes CHUNK_OF links for existing chunks", async () => {
    await seedCalendarCorpus();
    const { getDb } = await import("../../graph/graph.db.js");

    const { identityId } = await import("../../graph/canonical-id.js");
    const { backfillRagLinks } = await import("../../rag/backfill-links.js");
    const ownerId = identityId("json-cli@example.com");
    // chunkAllNodes already writes rag_links inline — backfillRagLinks processes
    // all chunks idempotently and reports how many were processed.
    const result = await backfillRagLinks(ownerId);
    expect(result.linksWritten).toBeGreaterThan(0);

    const after = await getDb().execute("SELECT COUNT(*) FROM rag_links");
    expect(Number(after.rows[0]?.[0] ?? 0)).toBeGreaterThan(0);
  });
});

describe("formatters", () => {
  it("formatQueryText and formatInspectText produce non-empty strings", async () => {
    await seedCalendarCorpus();
    const { collectInspectOutput } = await import("../../rag/inspect-stats.js");
    const { formatInspectText, retrievalToQueryOutput, formatQueryText } = await import(
      "../../rag/query-output.js",
    );
    const { retrieve } = await import("../../rag/retrieve.js");
    const { identityId } = await import("../../graph/canonical-id.js");

    const ownerId = identityId("json-cli@example.com");
    const inspectText = formatInspectText(await collectInspectOutput());
    expect(inspectText).toContain("RAG sources");

    const q = retrievalToQueryOutput(
      "board",
      await retrieve("board", { ownerUserId: ownerId }),
    );
    expect(formatQueryText(q)).toContain("Query:");
  });
});
