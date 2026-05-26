import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-notify-snooze-test-${Date.now()}.db`);
const NOW = new Date("2026-05-26T12:00:00Z");
const OWNER = "snooze-test-owner";

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

async function setupGraph() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");

  resetDbForTest();
  await initSchema();

  // Write an overdue task that will trigger notifications
  const taskId = connectorNodeId("asana", "task-overdue-snooze-test");
  await upsertNode({
    nodeType: "AsanaTask",
    canonicalId: taskId,
    connectorId: "asana",
    ownerUserId: OWNER,
    providerTaskGid: "task-overdue-snooze-test",
    projectCanonicalId: null,
    workspaceCanonicalId: "ws-1",
    name: "Overdue task for snooze test",
    notes: null,
    assigneeIdentityId: null,
    followerIdentityIds: [],
    dueDate: "2026-05-23",
    dueAt: "2026-05-23T23:59:00Z",
    isCompleted: false,
    completedAt: null,
    priority: "high",
    tags: [],
    ingestedAt: NOW.toISOString(),
    rawHash: rawHash({ providerTaskGid: "task-overdue-snooze-test" }),
  });

  return { taskId, upsertNode, connectorNodeId, rawHash };
}

describe("deduplication — 60-minute window", () => {
  it("returns 0 new notifications when same condition generated within 60 min", async () => {
    const { taskId } = await setupGraph();
    const { generateNotifications } = await import("../../notifications/generator.js");

    // First run
    const first = await generateNotifications(OWNER, { now: NOW });
    expect(first.generated.length).toBeGreaterThan(0);

    // Second run at same time — should be deduped
    const second = await generateNotifications(OWNER, { now: NOW });
    const newForSameTask = second.generated.filter((n) =>
      n.sourceNodeIds.includes(taskId)
    );
    expect(newForSameTask).toHaveLength(0);
    expect(second.skippedDedup).toBeGreaterThan(0);
  });

  it("generates new notifications after 60-min window expires", async () => {
    const { taskId } = await setupGraph();
    const { generateNotifications } = await import("../../notifications/generator.js");
    const { isDuplicate } = await import("../../notifications/rules.js");

    // Generate at T=0
    await generateNotifications(OWNER, { now: NOW });

    // Check isDuplicate at T=0: should be true
    const dupNow = await isDuplicate(OWNER, "asana-task-overdue", [taskId], NOW);
    expect(dupNow).toBe(true);

    // Check isDuplicate at T=61min: should be false
    const future = new Date(NOW.getTime() + 61 * 60 * 1000);
    const dupFuture = await isDuplicate(OWNER, "asana-task-overdue", [taskId], future);
    expect(dupFuture).toBe(false);
  });
});

describe("isDuplicate", () => {
  it("returns false when no notifications exist", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    resetDbForTest();
    await initSchema();

    const { isDuplicate } = await import("../../notifications/rules.js");
    const result = await isDuplicate(OWNER, "asana-task-overdue", ["some-node-id"], NOW);
    expect(result).toBe(false);
  });

  it("returns true when overlapping sourceNodeId exists within 60 min", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { notificationId } = await import("../../graph/canonical-id.js");
    resetDbForTest();
    await initSchema();

    const sourceNodeId = "node-to-dedup";
    const genAt = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago

    const notifId = notificationId("asana-task-overdue", [sourceNodeId], genAt);
    await upsertNode({
      nodeType: "Notification",
      canonicalId: notifId,
      ownerUserId: OWNER,
      triggerType: "asana-task-overdue",
      priorityScore: 0.8,
      title: "Test",
      explanation: "Test notification",
      suggestedAction: "Do something",
      confidence: 0.9,
      sourceNodeIds: [sourceNodeId],
      generatedAt: genAt,
      deliveredAt: null,
      status: "pending",
      snoozedUntil: null,
      followUpAt: null,
    });

    const { isDuplicate } = await import("../../notifications/rules.js");
    const result = await isDuplicate(OWNER, "asana-task-overdue", [sourceNodeId], NOW);
    expect(result).toBe(true);
  });

  it("returns false for different triggerType", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { notificationId } = await import("../../graph/canonical-id.js");
    resetDbForTest();
    await initSchema();

    const sourceNodeId = "node-different-trigger";
    const genAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const notifId = notificationId("asana-task-due", [sourceNodeId], genAt);

    await upsertNode({
      nodeType: "Notification",
      canonicalId: notifId,
      ownerUserId: OWNER,
      triggerType: "asana-task-due",
      priorityScore: 0.7,
      title: "Due soon",
      explanation: "Test",
      suggestedAction: "Act",
      confidence: 0.85,
      sourceNodeIds: [sourceNodeId],
      generatedAt: genAt,
      deliveredAt: null,
      status: "pending",
      snoozedUntil: null,
      followUpAt: null,
    });

    const { isDuplicate } = await import("../../notifications/rules.js");
    // Different triggerType — should NOT match
    const result = await isDuplicate(OWNER, "asana-task-overdue", [sourceNodeId], NOW);
    expect(result).toBe(false);
  });
});

describe("isSuppressedByDismissal", () => {
  it("returns false when no dismissed notifications exist", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    resetDbForTest();
    await initSchema();

    const { isSuppressedByDismissal } = await import("../../notifications/rules.js");
    const result = await isSuppressedByDismissal(OWNER, "reply-needed", "node-123", NOW);
    expect(result).toBe(false);
  });

  it("returns true for dismissed notification within 7 days", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { notificationId } = await import("../../graph/canonical-id.js");
    resetDbForTest();
    await initSchema();

    const sourceNodeId = "node-dismissed";
    const genAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const notifId = notificationId("reply-needed", [sourceNodeId], genAt);

    await upsertNode({
      nodeType: "Notification",
      canonicalId: notifId,
      ownerUserId: OWNER,
      triggerType: "reply-needed",
      priorityScore: 0.65,
      title: "Dismissed notification",
      explanation: "This was dismissed",
      suggestedAction: "Do nothing",
      confidence: 0.8,
      sourceNodeIds: [sourceNodeId],
      generatedAt: genAt,
      deliveredAt: null,
      status: "dismissed",
      snoozedUntil: null,
      followUpAt: null,
    });

    const { isSuppressedByDismissal } = await import("../../notifications/rules.js");
    const result = await isSuppressedByDismissal(OWNER, "reply-needed", sourceNodeId, NOW);
    expect(result).toBe(true);
  });

  it("returns false for dismissed notification older than 7 days", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { notificationId } = await import("../../graph/canonical-id.js");
    resetDbForTest();
    await initSchema();

    const sourceNodeId = "node-old-dismissed";
    const genAt = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
    const notifId = notificationId("reply-needed", [sourceNodeId], genAt);

    await upsertNode({
      nodeType: "Notification",
      canonicalId: notifId,
      ownerUserId: OWNER,
      triggerType: "reply-needed",
      priorityScore: 0.6,
      title: "Old dismissed",
      explanation: "This is old",
      suggestedAction: "Ignore",
      confidence: 0.75,
      sourceNodeIds: [sourceNodeId],
      generatedAt: genAt,
      deliveredAt: null,
      status: "dismissed",
      snoozedUntil: null,
      followUpAt: null,
    });

    const { isSuppressedByDismissal } = await import("../../notifications/rules.js");
    const result = await isSuppressedByDismissal(OWNER, "reply-needed", sourceNodeId, NOW);
    expect(result).toBe(false);
  });
});

describe("generateNotifications — mock LLM path", () => {
  it("writes NotificationNode with status=pending and all required fields", async () => {
    await setupGraph();
    const { generateNotifications } = await import("../../notifications/generator.js");

    const result = await generateNotifications(OWNER, { now: NOW });
    expect(result.generated.length).toBeGreaterThan(0);

    for (const n of result.generated) {
      expect(n.nodeType).toBe("Notification");
      expect(n.ownerUserId).toBe(OWNER);
      expect(n.status).toBe("pending");
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.title.length).toBeLessThanOrEqual(100);
      expect(n.explanation.length).toBeGreaterThan(0);
      expect(n.suggestedAction.length).toBeGreaterThan(0);
      expect(n.confidence).toBeGreaterThanOrEqual(0);
      expect(n.confidence).toBeLessThanOrEqual(1);
      expect(n.priorityScore).toBeGreaterThanOrEqual(0);
      expect(n.priorityScore).toBeLessThanOrEqual(1);
      expect(n.sourceNodeIds.length).toBeGreaterThan(0);
      expect(n.deliveredAt).toBeNull();
      expect(n.snoozedUntil).toBeNull();
      expect(n.followUpAt).toBeNull();
    }
  });

  it("returns notifications sorted highest priorityScore first", async () => {
    await setupGraph();
    const { generateNotifications } = await import("../../notifications/generator.js");

    const result = await generateNotifications(OWNER, { now: NOW });
    for (let i = 1; i < result.generated.length; i++) {
      expect(result.generated[i - 1]!.priorityScore).toBeGreaterThanOrEqual(
        result.generated[i]!.priorityScore
      );
    }
  });

  it("never sets status to delivered (prototype constraint)", async () => {
    await setupGraph();
    const { generateNotifications } = await import("../../notifications/generator.js");

    const result = await generateNotifications(OWNER, { now: NOW });
    for (const n of result.generated) {
      expect(n.status).not.toBe("delivered");
      expect(n.deliveredAt).toBeNull();
    }
  });
});
