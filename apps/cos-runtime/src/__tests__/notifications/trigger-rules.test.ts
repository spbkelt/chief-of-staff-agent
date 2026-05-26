import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-notify-trigger-test-${Date.now()}.db`);

const NOW = new Date("2026-05-26T12:00:00Z");
const OWNER = "trigger-test-owner";

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_MOCK_LLM"] = "true";
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

async function setup() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { upsertNode } = await import("../../graph/upsert.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");
  resetDbForTest();
  await initSchema();
  return { upsertNode, connectorNodeId, rawHash };
}

describe("trigger: upcoming-meeting", () => {
  it("fires when meeting starts within 60 min", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gcal", "evt-upcoming");
    const startAt = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(); // 30 min from now
    const endAt = new Date(NOW.getTime() + 90 * 60 * 1000).toISOString();

    await upsertNode({
      nodeType: "CalendarEvent",
      canonicalId: id,
      connectorId: "gcal",
      ownerUserId: OWNER,
      providerEventId: "evt-upcoming",
      title: "Team Sync",
      description: null,
      startAt,
      endAt,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerEventId: "evt-upcoming" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "upcoming-meeting");
    expect(found).toBeDefined();
    expect(found!.sourceNodeIds).toContain(id);
  });

  it("does NOT fire when meeting starts >60 min from now", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gcal", "evt-far");
    const startAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2h away
    const endAt = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();

    await upsertNode({
      nodeType: "CalendarEvent",
      canonicalId: id,
      connectorId: "gcal",
      ownerUserId: OWNER,
      providerEventId: "evt-far",
      title: "Far Meeting",
      description: null,
      startAt,
      endAt,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerEventId: "evt-far" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "upcoming-meeting" && c.sourceNodeIds.includes(id));
    expect(found).toBeUndefined();
  });

  it("does NOT fire for already-ended meetings", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gcal", "evt-past");
    const startAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();

    await upsertNode({
      nodeType: "CalendarEvent",
      canonicalId: id,
      connectorId: "gcal",
      ownerUserId: OWNER,
      providerEventId: "evt-past",
      title: "Past Meeting",
      description: null,
      startAt,
      endAt,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerEventId: "evt-past" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "upcoming-meeting" && c.sourceNodeIds.includes(id));
    expect(found).toBeUndefined();
  });
});

describe("trigger: meeting-prep-needed", () => {
  it("fires when meeting is 1-3h away", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gcal", "evt-prep");
    const startAt = new Date(NOW.getTime() + 90 * 60 * 1000).toISOString(); // 90 min away
    const endAt = new Date(NOW.getTime() + 150 * 60 * 1000).toISOString();

    await upsertNode({
      nodeType: "CalendarEvent",
      canonicalId: id,
      connectorId: "gcal",
      ownerUserId: OWNER,
      providerEventId: "evt-prep",
      title: "Board Review",
      description: null,
      startAt,
      endAt,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: "org-id",
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerEventId: "evt-prep" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "meeting-prep-needed" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
  });
});

describe("trigger: reply-needed", () => {
  it("fires when replyNeeded=true and last message >24h ago", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gmail", "thread-reply");
    await upsertNode({
      nodeType: "EmailThread",
      canonicalId: id,
      connectorId: "gmail",
      ownerUserId: OWNER,
      providerThreadId: "thread-reply",
      subject: "Awaiting your reply",
      firstMessageAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
      lastMessageAt: new Date(NOW.getTime() - 36 * 60 * 60 * 1000).toISOString(),
      participantIdentityIds: [],
      labels: ["INBOX"],
      isResolved: false,
      replyNeeded: true,
      messageCount: 2,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerThreadId: "thread-reply" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "reply-needed" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
  });

  it("does NOT fire when replyNeeded=false", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gmail", "thread-no-reply");
    await upsertNode({
      nodeType: "EmailThread",
      canonicalId: id,
      connectorId: "gmail",
      ownerUserId: OWNER,
      providerThreadId: "thread-no-reply",
      subject: "FYI thread",
      firstMessageAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
      lastMessageAt: new Date(NOW.getTime() - 36 * 60 * 60 * 1000).toISOString(),
      participantIdentityIds: [],
      labels: ["INBOX"],
      isResolved: false,
      replyNeeded: false,
      messageCount: 1,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerThreadId: "thread-no-reply" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "reply-needed" && c.sourceNodeIds.includes(id));
    expect(found).toBeUndefined();
  });
});

describe("trigger: unresolved-email-thread", () => {
  it("fires when thread unresolved >72h", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gmail", "thread-old");
    await upsertNode({
      nodeType: "EmailThread",
      canonicalId: id,
      connectorId: "gmail",
      ownerUserId: OWNER,
      providerThreadId: "thread-old",
      subject: "Stale thread",
      firstMessageAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString(),
      lastMessageAt: new Date(NOW.getTime() - 80 * 60 * 60 * 1000).toISOString(),
      participantIdentityIds: [],
      labels: ["INBOX"],
      isResolved: false,
      replyNeeded: false,
      messageCount: 3,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerThreadId: "thread-old" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "unresolved-email-thread" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
  });

  it("does NOT fire when thread is resolved", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("gmail", "thread-resolved");
    await upsertNode({
      nodeType: "EmailThread",
      canonicalId: id,
      connectorId: "gmail",
      ownerUserId: OWNER,
      providerThreadId: "thread-resolved",
      subject: "Resolved",
      firstMessageAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString(),
      lastMessageAt: new Date(NOW.getTime() - 80 * 60 * 60 * 1000).toISOString(),
      participantIdentityIds: [],
      labels: ["INBOX"],
      isResolved: true,
      replyNeeded: false,
      messageCount: 5,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerThreadId: "thread-resolved" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "unresolved-email-thread" && c.sourceNodeIds.includes(id));
    expect(found).toBeUndefined();
  });
});

describe("trigger: asana-task-overdue", () => {
  it("fires when task is past due and not completed", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("asana", "task-overdue");
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: id,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerTaskGid: "task-overdue",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Critical approval",
      notes: null,
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: "2026-05-24",
      dueAt: "2026-05-24T23:59:00Z",
      isCompleted: false,
      completedAt: null,
      priority: "high",
      tags: [],
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-overdue" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "asana-task-overdue" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
    expect(found!.priorityScore).toBeGreaterThan(0.4);
  });

  it("does NOT fire for completed tasks", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("asana", "task-done");
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: id,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerTaskGid: "task-done",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Done task",
      notes: null,
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: "2026-05-24",
      dueAt: "2026-05-24T23:59:00Z",
      isCompleted: true,
      completedAt: NOW.toISOString(),
      priority: "high",
      tags: [],
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-done" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "asana-task-overdue" && c.sourceNodeIds.includes(id));
    expect(found).toBeUndefined();
  });
});

describe("trigger: asana-task-due", () => {
  it("fires when task due within 24h, not yet overdue", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("asana", "task-due-soon");
    const dueAt = new Date(NOW.getTime() + 8 * 60 * 60 * 1000).toISOString(); // 8h from now
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: id,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerTaskGid: "task-due-soon",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Upcoming task",
      notes: null,
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: "2026-05-26",
      dueAt,
      isCompleted: false,
      completedAt: null,
      priority: "high",
      tags: [],
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-due-soon" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "asana-task-due" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
  });
});

describe("trigger: asana-mention", () => {
  it("fires when comment with @ symbol is within last 4h", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const taskId = connectorNodeId("asana", "task-mention-target");
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: taskId,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerTaskGid: "task-mention-target",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Some task",
      notes: null,
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: null,
      dueAt: null,
      isCompleted: false,
      completedAt: null,
      priority: null,
      tags: [],
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-mention-target" }),
    });

    const commentId = connectorNodeId("asana", "comment-mention");
    const createdAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    await upsertNode({
      nodeType: "AsanaComment",
      canonicalId: commentId,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerStoryGid: "comment-mention",
      taskCanonicalId: taskId,
      authorIdentityId: "other-person",
      text: "Hey @exec can you review this?",
      createdAt,
      isSystem: false,
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerStoryGid: "comment-mention" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "asana-mention" && c.sourceNodeIds.includes(commentId));
    expect(found).toBeDefined();
  });
});

describe("trigger: repeated-topic-priority", () => {
  it("fires when topic has ≥3 occurrences in last 7 days", async () => {
    const { upsertNode, connectorNodeId } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const topicId = connectorNodeId("system", "topic-q3");
    const lastSeenAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    await upsertNode({
      nodeType: "Topic",
      canonicalId: topicId,
      ownerUserId: OWNER,
      label: "Q3 Budget",
      frequency: 5,
      firstSeenAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt,
    } as Parameters<typeof upsertNode>[0]);

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "repeated-topic-priority" && c.sourceNodeIds.includes(topicId));
    expect(found).toBeDefined();
  });

  it("does NOT fire for topics with <3 occurrences", async () => {
    const { upsertNode, connectorNodeId } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const topicId = connectorNodeId("system", "topic-rare");
    await upsertNode({
      nodeType: "Topic",
      canonicalId: topicId,
      ownerUserId: OWNER,
      label: "Rare topic",
      frequency: 2,
      firstSeenAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    } as Parameters<typeof upsertNode>[0]);

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "repeated-topic-priority" && c.sourceNodeIds.includes(topicId));
    expect(found).toBeUndefined();
  });
});

describe("trigger: missed-commitment", () => {
  it("fires for overdue task with assigneeIdentityId set", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    const id = connectorNodeId("asana", "task-committed");
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: id,
      connectorId: "asana",
      ownerUserId: OWNER,
      providerTaskGid: "task-committed",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Committed task",
      notes: null,
      assigneeIdentityId: "identity-owner",
      followerIdentityIds: [],
      dueDate: "2026-05-23",
      dueAt: "2026-05-23T23:59:00Z",
      isCompleted: false,
      completedAt: null,
      priority: "high",
      tags: [],
      ingestedAt: NOW.toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-committed" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.find((c) => c.triggerType === "missed-commitment" && c.sourceNodeIds.includes(id));
    expect(found).toBeDefined();
  });
});

describe("detectCandidates — ownerUserId filter", () => {
  it("does not return notifications for other owners", async () => {
    const { upsertNode, connectorNodeId, rawHash } = await setup();
    const { detectCandidates } = await import("../../notifications/rules.js");

    // Write a node for a different owner
    const id = connectorNodeId("asana", "task-other-owner");
    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: id,
      connectorId: "asana",
      ownerUserId: "some-other-user",
      providerTaskGid: "task-other-owner",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Other user task",
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
      rawHash: rawHash({ providerTaskGid: "task-other-owner" }),
    });

    const candidates = await detectCandidates(OWNER, NOW);
    const found = candidates.some((c) => c.sourceNodeIds.includes(id));
    expect(found).toBe(false);
  });
});
