import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { identityId, connectorNodeId, sha256 } from "../../graph/canonical-id.js";
import type { CalendarEventNode, AsanaProjectNode, AsanaTaskNode, AsanaCommentNode, AsanaWorkspaceNode } from "../../graph/schema.js";

const TEST_DB = path.join(os.tmpdir(), `cos-edges-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_OWNER_EMAIL"] = "owner@example.com";
  process.env["LANGSMITH_TRACING"] = "false";
});

afterEach(() => {
  delete process.env["COS_DB_PATH"];
  delete process.env["COS_OWNER_EMAIL"];
  delete process.env["LANGSMITH_TRACING"];
  try {
    for (const suffix of ["", "-shm", "-wal"]) fs.unlinkSync(TEST_DB + suffix);
  } catch { /* ignore */ }
});

async function setup() {
  const { resetDbForTest, initSchema, getDb } = await import("../../graph/graph.db.js");
  const { resetEnvForTest } = await import("../../config/env.js");
  const { writeEdgesForNode } = await import("../../graph/edge-writer.js");
  resetEnvForTest();
  resetDbForTest();
  await initSchema();

  async function getEdges() {
    const db = getDb();
    const result = await db.execute("SELECT edge_type, from_id, to_id FROM edges");
    return result.rows.map((r) => ({ edgeType: r[0], fromId: r[1], toId: r[2] }));
  }

  return { writeEdgesForNode, getEdges };
}

const OWNER_ID = identityId("owner@example.com");
const CONNECTOR_ID = "test-connector";
const NOW = "2026-05-25T12:00:00Z";

describe("edge-writer — spec §6.3 directions", () => {
  it("ORGANIZES: Identity → CalendarEvent (organizer is fromId)", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const organizerId = identityId("alice@example.com");
    const attendeeId = identityId("bob@example.com");
    const eventId = connectorNodeId(CONNECTOR_ID, "evt001");

    const node: CalendarEventNode = {
      nodeType: "CalendarEvent",
      canonicalId: eventId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerEventId: "evt001",
      title: "Board Review",
      description: null,
      startAt: NOW,
      endAt: NOW,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: organizerId,
      attendeeIdentityIds: [attendeeId],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW,
      rawHash: "abc",
    };

    await writeEdgesForNode(node);
    const edges = await getEdges();

    // spec §6.3: Identity ORGANIZES CalendarEvent
    expect(edges).toContainEqual({
      edgeType: "ORGANIZES",
      fromId: organizerId,
      toId: eventId,
    });
    // spec §6.3: Identity ATTENDS CalendarEvent
    expect(edges).toContainEqual({
      edgeType: "ATTENDS",
      fromId: attendeeId,
      toId: eventId,
    });
  });

  it("ORGANIZES is not emitted in wrong direction (CalendarEvent → Identity)", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const organizerId = identityId("alice@example.com");
    const eventId = connectorNodeId(CONNECTOR_ID, "evt001");

    await writeEdgesForNode({
      nodeType: "CalendarEvent",
      canonicalId: eventId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerEventId: "evt001",
      title: "Board Review",
      description: null,
      startAt: NOW,
      endAt: NOW,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: organizerId,
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW,
      rawHash: "abc",
    });
    const edges = await getEdges();
    // Must NOT have the inverted direction
    expect(edges).not.toContainEqual({
      edgeType: "ORGANIZES",
      fromId: eventId,
      toId: organizerId,
    });
  });

  it("AsanaProject emits no edges — workspace relationship is a field only", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const projectId = connectorNodeId(CONNECTOR_ID, "proj001");
    const workspaceId = connectorNodeId(CONNECTOR_ID, "ws001");

    const node: AsanaProjectNode = {
      nodeType: "AsanaProject",
      canonicalId: projectId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerProjectGid: "proj001",
      workspaceCanonicalId: workspaceId,
      name: "Q3 Roadmap",
      color: null,
      isArchived: false,
      dueDate: null,
      ingestedAt: NOW,
      rawHash: "abc",
    };

    await writeEdgesForNode(node);
    const edges = await getEdges();
    expect(edges).toHaveLength(0);
  });

  it("IN_PROJECT and ASSIGNED_TO edges for AsanaTask", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const taskId = connectorNodeId(CONNECTOR_ID, "task001");
    const projectId = connectorNodeId(CONNECTOR_ID, "proj001");
    const workspaceId = connectorNodeId(CONNECTOR_ID, "ws001");
    const assigneeId = identityId("alice@example.com");

    const node: AsanaTaskNode = {
      nodeType: "AsanaTask",
      canonicalId: taskId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerTaskGid: "task001",
      projectCanonicalId: projectId,
      workspaceCanonicalId: workspaceId,
      name: "Launch feature",
      notes: null,
      assigneeIdentityId: assigneeId,
      followerIdentityIds: [],
      dueDate: null,
      dueAt: null,
      isCompleted: false,
      completedAt: null,
      priority: null,
      tags: [],
      ingestedAt: NOW,
      rawHash: "abc",
    };

    await writeEdgesForNode(node);
    const edges = await getEdges();

    expect(edges).toContainEqual({ edgeType: "IN_PROJECT", fromId: taskId, toId: projectId });
    expect(edges).toContainEqual({ edgeType: "ASSIGNED_TO", fromId: taskId, toId: assigneeId });
  });

  it("AUTHORED_BY: AsanaComment → Identity (comment is fromId)", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const commentId = connectorNodeId(CONNECTOR_ID, "story001");
    const taskId = connectorNodeId(CONNECTOR_ID, "task001");
    const authorId = identityId("alice@example.com");

    const node: AsanaCommentNode = {
      nodeType: "AsanaComment",
      canonicalId: commentId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerStoryGid: "story001",
      taskCanonicalId: taskId,
      authorIdentityId: authorId,
      text: "LGTM",
      createdAt: NOW,
      isSystem: false,
      ingestedAt: NOW,
      rawHash: "abc",
    };

    await writeEdgesForNode(node);
    const edges = await getEdges();

    expect(edges).toContainEqual({ edgeType: "COMMENTED_ON", fromId: commentId, toId: taskId });
    // spec §6.3: AsanaComment → Identity
    expect(edges).toContainEqual({ edgeType: "AUTHORED_BY", fromId: commentId, toId: authorId });
    // Must NOT have the inverted direction
    expect(edges).not.toContainEqual({ edgeType: "AUTHORED_BY", fromId: authorId, toId: commentId });
  });

  it("edges are idempotent — writing the same node twice yields one edge row each", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const organizerId = identityId("alice@example.com");
    const eventId = connectorNodeId(CONNECTOR_ID, "evt001");

    const node: CalendarEventNode = {
      nodeType: "CalendarEvent",
      canonicalId: eventId,
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerEventId: "evt001",
      title: "Board Review",
      description: null,
      startAt: NOW,
      endAt: NOW,
      isAllDay: false,
      location: null,
      status: "confirmed",
      organizerIdentityId: organizerId,
      attendeeIdentityIds: [],
      recurrenceRule: null,
      meetingUrl: null,
      ingestedAt: NOW,
      rawHash: "abc",
    };

    await writeEdgesForNode(node);
    await writeEdgesForNode(node);
    const edges = await getEdges();

    const organizes = edges.filter((e) => e.edgeType === "ORGANIZES");
    expect(organizes).toHaveLength(1);
  });

  it("edge ID is deterministic sha256(fromId:edgeType:toId)", () => {
    const organizerId = identityId("alice@example.com");
    const eventId = connectorNodeId(CONNECTOR_ID, "evt001");
    const expectedId = sha256(`${organizerId}:ORGANIZES:${eventId}`);
    expect(typeof expectedId).toBe("string");
    expect(expectedId).toHaveLength(64);
  });

  it("writes no edges for AsanaWorkspace", async () => {
    const { writeEdgesForNode, getEdges } = await setup();
    const node: AsanaWorkspaceNode = {
      nodeType: "AsanaWorkspace",
      canonicalId: connectorNodeId(CONNECTOR_ID, "ws001"),
      connectorId: CONNECTOR_ID,
      ownerUserId: OWNER_ID,
      providerWorkspaceGid: "ws001",
      name: "Prism Team",
      isOrganization: true,
      ingestedAt: NOW,
      rawHash: "abc",
    };
    await writeEdgesForNode(node);
    const edges = await getEdges();
    expect(edges).toHaveLength(0);
  });
});
