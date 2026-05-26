import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-local-embed-${Date.now()}.db`);
const TEST_CONFIG = path.join(os.tmpdir(), `cos-config-${Date.now()}.json`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["LANGSMITH_TRACING"] = "false";
  delete process.env["COS_MOCK_EMBED"];
  delete process.env["COS_ALLOW_FIXTURES"];
  delete process.env["COS_RAG_BACKEND"];
  fs.writeFileSync(
    TEST_CONFIG,
    JSON.stringify({ ownerEmail: "local@example.com", llm: { provider: "bedrock", ragBackend: "local" } }),
    "utf8"
  );
});

afterEach(async () => {
  const { resetEnvForTest } = await import("../../config/env.js");
  const { closeDb, resetDbForTest } = await import("../../graph/graph.db.js");
  const { resetCosConfigPath } = await import("../../config/credentials.js");
  resetCosConfigPath();
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
  try {
    fs.unlinkSync(TEST_CONFIG);
  } catch {
    /* ignore */
  }
});

describe("local-hash embeddings (product local RAG track)", () => {
  it("embeds pending chunks without COS_MOCK_EMBED or live AWS", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG);

    const { usesLocalHashEmbeddings } = await import("../../rag/embed-mode.js");
    expect(usesLocalHashEmbeddings()).toBe(true);

    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { identityId, connectorNodeId, rawHash: computeHash } = await import("../../graph/canonical-id.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks, LOCAL_HASH_EMBED_MODEL } = await import("../../rag/embed.js");

    resetDbForTest();
    await initSchema();

    const ownerId = identityId("local@example.com");
    const connId = "local-conn";
    const payload = {
      nodeType: "CalendarEvent",
      connectorId: connId,
      ownerUserId: ownerId,
      providerEventId: "evt-l1",
      title: "Local embed event",
      description: "No AWS embed call",
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
      canonicalId: connectorNodeId(connId, "evt-l1"),
      rawHash: computeHash(payload),
    });

    await chunkAllNodes(ownerId);
    const result = await embedPendingChunks(ownerId);
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);

    const { getDb } = await import("../../graph/graph.db.js");
    const db = getDb();
    const rows = await db.execute({
      sql: "SELECT embedding_model FROM rag_chunks WHERE owner_user_id = ? LIMIT 1",
      args: [ownerId],
    });
    expect(rows.rows[0]?.[0]).toBe(LOCAL_HASH_EMBED_MODEL);
  });
});
