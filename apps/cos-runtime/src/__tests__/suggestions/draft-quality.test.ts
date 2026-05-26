import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-draft-quality-test-${Date.now()}.db`);
const OWNER = "draft-quality-test-owner";

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

async function setupAndGenerate() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");
  const { generateSuggestion } = await import("../../suggestions/generator.js");

  resetDbForTest();
  await initSchema();

  const threadId = connectorNodeId("gmail", "thread-draft-quality");
  await upsertNode({
    nodeType: "EmailThread",
    canonicalId: threadId,
    connectorId: "gmail",
    ownerUserId: OWNER,
    providerThreadId: "thread-draft-quality",
    subject: "Partnership discussion follow-up",
    firstMessageAt: "2026-05-20T10:00:00Z",
    lastMessageAt: "2026-05-25T10:00:00Z",
    participantIdentityIds: [],
    labels: [],
    isResolved: false,
    replyNeeded: true,
    messageCount: 2,
    ingestedAt: new Date().toISOString(),
    rawHash: rawHash({ providerThreadId: "thread-draft-quality" }),
  });

  const suggestion = await generateSuggestion(OWNER, threadId);
  return { threadId, suggestion };
}

describe("resolveResponseType", () => {
  it("maps EmailThread to email-reply", async () => {
    const { resolveResponseType } = await import("../../suggestions/generator.js");
    expect(resolveResponseType("EmailThread")).toBe("email-reply");
  });

  it("maps AsanaTask to asana-comment", async () => {
    const { resolveResponseType } = await import("../../suggestions/generator.js");
    expect(resolveResponseType("AsanaTask")).toBe("asana-comment");
  });

  it("maps CalendarEvent to meeting-followup", async () => {
    const { resolveResponseType } = await import("../../suggestions/generator.js");
    expect(resolveResponseType("CalendarEvent")).toBe("meeting-followup");
  });

  it("maps unknown type to clarification", async () => {
    const { resolveResponseType } = await import("../../suggestions/generator.js");
    expect(resolveResponseType("Unknown")).toBe("clarification");
    expect(resolveResponseType("Topic")).toBe("clarification");
  });
});

describe("getToneExamples — first run", () => {
  it("returns empty array when no approved/sent suggestions exist", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { getToneExamples } = await import("../../suggestions/generator.js");
    resetDbForTest();
    await initSchema();
    const examples = await getToneExamples(OWNER);
    expect(examples).toEqual([]);
  });
});

describe("draft quality", () => {
  it("draftText is non-empty", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(suggestion.draftText.length).toBeGreaterThan(0);
  });

  it("citedSourceNodeIds has at least 1 item", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(suggestion.citedSourceNodeIds.length).toBeGreaterThanOrEqual(1);
  });

  it("toneAssessment is non-empty", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(suggestion.toneAssessment.length).toBeGreaterThan(0);
  });

  it("factualBasis has at least 1 item", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(suggestion.factualBasis.length).toBeGreaterThanOrEqual(1);
  });

  it("assumptions is an array (may be empty)", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(Array.isArray(suggestion.assumptions)).toBe(true);
  });

  it("first-run toneAssessment mentions generic/default tone", async () => {
    const { suggestion } = await setupAndGenerate();
    // When no prior approved responses, toneAssessment should note this
    expect(suggestion.toneAssessment.toLowerCase()).toMatch(/first run|default|generic|professional/);
  });

  it("responseType is email-reply for EmailThread target", async () => {
    const { suggestion } = await setupAndGenerate();
    expect(suggestion.responseType).toBe("email-reply");
  });
});
