import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-conv-turn-test-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
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

async function setupDb() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  resetDbForTest();
  await initSchema();
}

describe("writeConversationTurn", () => {
  it("writes node with all required fields", async () => {
    await setupDb();
    const { writeConversationTurn } = await import("../../history/store.js");
    const turn = await writeConversationTurn({
      sessionId: "session-001",
      turnIndex: 0,
      role: "user",
      content: "Brief me on today",
    });
    expect(turn.nodeType).toBe("ConversationTurn");
    expect(turn.sessionId).toBe("session-001");
    expect(turn.turnIndex).toBe(0);
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("Brief me on today");
    expect(turn.canonicalId).toBeTruthy();
    expect(turn.createdAt).toBeTruthy();
  });

  it("canonicalId is deterministic for same sessionId + turnIndex", async () => {
    await setupDb();
    const { conversationTurnId } = await import("../../graph/canonical-id.js");
    const { writeConversationTurn } = await import("../../history/store.js");
    const turn1 = await writeConversationTurn({ sessionId: "sess-A", turnIndex: 3, role: "assistant", content: "Hello" });
    const expected = conversationTurnId("sess-A", 3);
    expect(turn1.canonicalId).toBe(expected);
  });

  it("is idempotent — double write produces no duplicate", async () => {
    await setupDb();
    const { writeConversationTurn } = await import("../../history/store.js");
    const { getDb } = await import("../../graph/graph.db.js");
    await writeConversationTurn({ sessionId: "sess-idem", turnIndex: 0, role: "user", content: "First write" });
    await writeConversationTurn({ sessionId: "sess-idem", turnIndex: 0, role: "user", content: "Second write" });
    const db = getDb();
    const result = await db.execute({
      sql: "SELECT COUNT(*) FROM nodes WHERE node_type = 'ConversationTurn' AND json_extract(data, '$.sessionId') = 'sess-idem'",
      args: [],
    });
    expect(result.rows[0]?.[0]).toBe(1);
  });

  it("caps content at 2000 chars", async () => {
    await setupDb();
    const { writeConversationTurn } = await import("../../history/store.js");
    const longContent = "x".repeat(3000);
    const turn = await writeConversationTurn({ sessionId: "sess-cap", turnIndex: 0, role: "user", content: longContent });
    expect(turn.content.length).toBeLessThanOrEqual(2000);
  });
});

describe("getConversationHistory", () => {
  it("returns turns in turnIndex order", async () => {
    await setupDb();
    const { writeConversationTurn, getConversationHistory } = await import("../../history/store.js");
    await writeConversationTurn({ sessionId: "sess-order", turnIndex: 2, role: "assistant", content: "Third" });
    await writeConversationTurn({ sessionId: "sess-order", turnIndex: 0, role: "user", content: "First" });
    await writeConversationTurn({ sessionId: "sess-order", turnIndex: 1, role: "assistant", content: "Second" });
    const history = await getConversationHistory({ sessionId: "sess-order" });
    expect(history[0]?.turnIndex).toBe(0);
    expect(history[1]?.turnIndex).toBe(1);
    expect(history[2]?.turnIndex).toBe(2);
  });

  it("filters by sessionId", async () => {
    await setupDb();
    const { writeConversationTurn, getConversationHistory } = await import("../../history/store.js");
    await writeConversationTurn({ sessionId: "sess-A", turnIndex: 0, role: "user", content: "Session A" });
    await writeConversationTurn({ sessionId: "sess-B", turnIndex: 0, role: "user", content: "Session B" });
    const historyA = await getConversationHistory({ sessionId: "sess-A" });
    expect(historyA).toHaveLength(1);
    expect(historyA[0]?.content).toBe("Session A");
  });

  it("respects limit parameter", async () => {
    await setupDb();
    const { writeConversationTurn, getConversationHistory } = await import("../../history/store.js");
    for (let i = 0; i < 5; i++) {
      await writeConversationTurn({ sessionId: "sess-limit", turnIndex: i, role: "user", content: `Turn ${i}` });
    }
    const limited = await getConversationHistory({ sessionId: "sess-limit", limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe("writeActivityEvent", () => {
  it("writes node with correct fields", async () => {
    await setupDb();
    const { writeActivityEvent } = await import("../../history/store.js");
    const event = await writeActivityEvent({
      actorId: "actor-123",
      verb: "ingested",
      objectNodeId: "node-456",
      occurredAt: "2026-05-26T12:00:00Z",
      sourceConnectorId: "gmail",
    });
    expect(event.nodeType).toBe("ActivityEvent");
    expect(event.actorId).toBe("actor-123");
    expect(event.verb).toBe("ingested");
    expect(event.objectNodeId).toBe("node-456");
    expect(event.occurredAt).toBe("2026-05-26T12:00:00Z");
    expect(event.sourceConnectorId).toBe("gmail");
    expect(event.canonicalId).toBeTruthy();
  });

  it("canonicalId is deterministic", async () => {
    await setupDb();
    const { writeActivityEvent } = await import("../../history/store.js");
    const { derivedNodeId } = await import("../../graph/canonical-id.js");
    const params = { actorId: "actor-1", verb: "sent", objectNodeId: "node-1", occurredAt: "2026-01-01T00:00:00Z", sourceConnectorId: "asana" };
    const event = await writeActivityEvent(params);
    const expected = derivedNodeId("ActivityEvent", `${params.actorId}:${params.verb}:${params.objectNodeId}:${params.occurredAt}`);
    expect(event.canonicalId).toBe(expected);
  });
});
