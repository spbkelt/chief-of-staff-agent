import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-history-pres-test-${Date.now()}.db`);
const OWNER = "history-pres-test-owner";

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_MOCK_LLM"] = "true";
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

async function setup() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");
  resetDbForTest();
  await initSchema();

  const threadId = connectorNodeId("gmail", "thread-history-pres");
  await upsertNode({
    nodeType: "EmailThread",
    canonicalId: threadId,
    connectorId: "gmail",
    ownerUserId: OWNER,
    providerThreadId: "thread-history-pres",
    subject: "Board prep materials",
    firstMessageAt: "2026-05-20T10:00:00Z",
    lastMessageAt: "2026-05-25T10:00:00Z",
    participantIdentityIds: [],
    labels: [],
    isResolved: false,
    replyNeeded: true,
    messageCount: 1,
    ingestedAt: new Date().toISOString(),
    rawHash: rawHash({ providerThreadId: "thread-history-pres" }),
  });

  return { threadId, upsertNode };
}

describe("history preservation — rejected nodes stay in DB", () => {
  it("rejected suggestion remains retrievable after rejection", async () => {
    const { threadId } = await setup();
    const { generateSuggestion } = await import("../../suggestions/generator.js");
    const { getNode, upsertNode } = await import("../../graph/upsert.js");
    const suggestion = await generateSuggestion(OWNER, threadId);

    // Simulate rejection (approve CLI sets status=rejected)
    await upsertNode({ ...suggestion, status: "rejected", reviewedAt: new Date().toISOString() });

    const retrieved = await getNode(suggestion.canonicalId);
    expect(retrieved).not.toBeNull();
    expect((retrieved as { status?: string })?.status).toBe("rejected");
  });
});

describe("history preservation — tone examples", () => {
  it("approved suggestion appears in getToneExamples", async () => {
    const { threadId } = await setup();
    const { generateSuggestion, getToneExamples } = await import("../../suggestions/generator.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const suggestion = await generateSuggestion(OWNER, threadId);

    // Simulate approval
    await upsertNode({ ...suggestion, status: "approved", reviewedAt: new Date().toISOString(), approvedText: "Approved text" });

    const examples = await getToneExamples(OWNER);
    expect(examples.some((e) => e.canonicalId === suggestion.canonicalId)).toBe(true);
  });

  it("rejected suggestion does NOT appear in getToneExamples", async () => {
    const { threadId } = await setup();
    const { generateSuggestion, getToneExamples } = await import("../../suggestions/generator.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const suggestion = await generateSuggestion(OWNER, threadId);

    // Simulate rejection
    await upsertNode({ ...suggestion, status: "rejected", reviewedAt: new Date().toISOString() });

    const examples = await getToneExamples(OWNER);
    expect(examples.some((e) => e.canonicalId === suggestion.canonicalId)).toBe(false);
  });

  it("node count does not decrease after status update", async () => {
    const { threadId } = await setup();
    const { generateSuggestion } = await import("../../suggestions/generator.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { getDb } = await import("../../graph/graph.db.js");
    const suggestion = await generateSuggestion(OWNER, threadId);

    const db = getDb();
    const before = (await db.execute("SELECT COUNT(*) FROM nodes")).rows[0]?.[0] as number;

    await upsertNode({ ...suggestion, status: "rejected", reviewedAt: new Date().toISOString() });

    const after = (await db.execute("SELECT COUNT(*) FROM nodes")).rows[0]?.[0] as number;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
