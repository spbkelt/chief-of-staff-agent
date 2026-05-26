import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-no-send-test-${Date.now()}.db`);
const OWNER = "no-send-test-owner";

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

async function setupAndGenerateSuggestion() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");
  const { generateSuggestion } = await import("../../suggestions/generator.js");

  resetDbForTest();
  await initSchema();

  const threadId = connectorNodeId("gmail", "thread-no-send-test");
  await upsertNode({
    nodeType: "EmailThread",
    canonicalId: threadId,
    connectorId: "gmail",
    ownerUserId: OWNER,
    providerThreadId: "thread-no-send-test",
    subject: "Urgent: Q3 review needed",
    firstMessageAt: "2026-05-20T10:00:00Z",
    lastMessageAt: "2026-05-25T10:00:00Z",
    participantIdentityIds: [],
    labels: [],
    isResolved: false,
    replyNeeded: true,
    messageCount: 3,
    ingestedAt: new Date().toISOString(),
    rawHash: rawHash({ providerThreadId: "thread-no-send-test" }),
  });

  return { threadId, generateSuggestion };
}

describe("no-auto-send — status gate", () => {
  it("generateSuggestion always produces status=pending", async () => {
    const { threadId, generateSuggestion } = await setupAndGenerateSuggestion();
    const suggestion = await generateSuggestion(OWNER, threadId);
    expect(suggestion.status).toBe("pending");
  });

  it("sentAt is null on creation", async () => {
    const { threadId, generateSuggestion } = await setupAndGenerateSuggestion();
    const suggestion = await generateSuggestion(OWNER, threadId);
    expect(suggestion.sentAt).toBeNull();
  });

  it("approvedText is null on creation", async () => {
    const { threadId, generateSuggestion } = await setupAndGenerateSuggestion();
    const suggestion = await generateSuggestion(OWNER, threadId);
    expect(suggestion.approvedText).toBeNull();
  });

  it("reviewedAt is null on creation", async () => {
    const { threadId, generateSuggestion } = await setupAndGenerateSuggestion();
    const suggestion = await generateSuggestion(OWNER, threadId);
    expect(suggestion.reviewedAt).toBeNull();
  });

  it("node is persisted with status=pending after generation", async () => {
    const { threadId, generateSuggestion } = await setupAndGenerateSuggestion();
    const { getNode } = await import("../../graph/upsert.js");
    const suggestion = await generateSuggestion(OWNER, threadId);
    const retrieved = await getNode(suggestion.canonicalId);
    expect(retrieved).not.toBeNull();
    expect((retrieved as { status?: string })?.status).toBe("pending");
  });
});
