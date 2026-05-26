import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-runner-cursor-${Date.now()}.db`);

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
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { resetEnvForTest } = await import("../../config/env.js");
  const { runConnectors } = await import("../../graph/ingest-runner.js");
  const { loadCursor } = await import("../../graph/sync-cursor.js");
  const { ConnectorCursorError } = await import("../../connectors/connector.interface.js");
  const { connectorNodeId, rawHash } = await import("../../graph/canonical-id.js");

  resetEnvForTest();
  resetDbForTest();
  await initSchema();

  return { runConnectors, loadCursor, ConnectorCursorError, connectorNodeId, rawHash };
}

function makeEvent(connectorId: string, id: string) {
  const payload = {
    nodeType: "CalendarEvent" as const,
    connectorId,
    ownerUserId: "owner",
    providerEventId: id,
    canonicalId: "",
    title: `Event ${id}`,
    description: null,
    startAt: "2026-06-01T10:00:00Z",
    endAt: "2026-06-01T11:00:00Z",
    isAllDay: false,
    location: null,
    status: "confirmed" as const,
    organizerIdentityId: "org-id",
    attendeeIdentityIds: [],
    recurrenceRule: null,
    meetingUrl: null,
    ingestedAt: "2026-06-01T00:00:00Z",
    rawHash: "",
  };
  const { createHash } = require("crypto");
  const stable = Object.fromEntries(
    Object.entries(payload).filter(([k]) => !["ingestedAt", "updatedAt", "lastSeenAt"].includes(k))
  );
  const hash = createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
  const eventId = createHash("sha256").update(`${connectorId}:${id}`, "utf8").digest("hex");
  return {
    eventId,
    connectorId,
    providerId: "google-calendar" as const,
    providerEventId: id,
    eventType: "CalendarEvent" as const,
    occurredAt: "2026-06-01T10:00:00Z",
    payload: { ...payload, canonicalId: eventId, rawHash: hash } as Record<string, unknown>,
    rawHash: hash,
  };
}

import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);

describe("ingest-runner — cursor selection", () => {
  it("first run uses fullSync when no cursor exists", async () => {
    const { runConnectors, loadCursor } = await setup();
    const CONN_ID = "gcal-cursor-test";

    const calls: string[] = [];
    const connector = {
      config: {
        connectorId: CONN_ID,
        providerId: "google-calendar" as const,
        accountLabel: "test",
        credentials: { type: "oauth2" as const },
      },
      verifyAuth: async () => {},
      async *fullSync() { calls.push("fullSync"); yield makeEvent(CONN_ID, "evt001"); },
      async *incrementalSync(_c: unknown) { calls.push("incrementalSync"); },
      currentCursor: async () => ({
        connectorId: CONN_ID,
        lastSyncedAt: new Date().toISOString(),
        providerCursor: "tok-1",
        fullSyncRequired: false,
      }),
    };

    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);

    expect(calls).toEqual(["fullSync"]);
    const cursor = await loadCursor(CONN_ID);
    expect(cursor).not.toBeNull();
    expect(cursor!.providerCursor).toBe("tok-1");
  });

  it("second run uses incrementalSync when cursor exists", async () => {
    const { runConnectors } = await setup();
    const CONN_ID = "gcal-cursor-test-2";

    const calls: string[] = [];
    const connector = {
      config: {
        connectorId: CONN_ID,
        providerId: "google-calendar" as const,
        accountLabel: "test",
        credentials: { type: "oauth2" as const },
      },
      verifyAuth: async () => {},
      async *fullSync() { calls.push("fullSync"); yield makeEvent(CONN_ID, "evtA"); },
      async *incrementalSync(_c: unknown) { calls.push("incrementalSync"); },
      currentCursor: async () => ({
        connectorId: CONN_ID,
        lastSyncedAt: new Date().toISOString(),
        providerCursor: "tok-latest",
        fullSyncRequired: false,
      }),
    };

    // First run — fullSync, saves cursor
    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);
    // Second run — should use incrementalSync
    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);

    expect(calls).toEqual(["fullSync", "incrementalSync"]);
  });

  it("ConnectorCursorError resets cursor and retries with fullSync", async () => {
    const { runConnectors, loadCursor, ConnectorCursorError } = await setup();
    const CONN_ID = "gcal-410-test";

    const calls: string[] = [];
    let cursorSaved = false;

    const connector = {
      config: {
        connectorId: CONN_ID,
        providerId: "google-calendar" as const,
        accountLabel: "test",
        credentials: { type: "oauth2" as const },
      },
      verifyAuth: async () => {},
      async *fullSync() {
        calls.push("fullSync");
        yield makeEvent(CONN_ID, "evtFull");
      },
      async *incrementalSync(_c: unknown) {
        calls.push("incrementalSync");
        throw new ConnectorCursorError(CONN_ID, "syncToken expired");
        yield; // unreachable
      },
      currentCursor: async () => ({
        connectorId: CONN_ID,
        lastSyncedAt: new Date().toISOString(),
        providerCursor: cursorSaved ? "tok-new" : "tok-stale",
        fullSyncRequired: false,
      }),
    };

    // Seed a cursor so second run goes to incrementalSync
    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);
    cursorSaved = true;

    // Second run: incrementalSync throws 410 → should reset and fullSync
    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);

    expect(calls).toEqual(["fullSync", "incrementalSync", "fullSync"]);
  });

  it("fullSyncRequired=true in cursor forces fullSync", async () => {
    const { runConnectors, ConnectorCursorError } = await setup();
    const { saveCursor } = await import("../../graph/sync-cursor.js");
    const CONN_ID = "gcal-force-full";

    // Pre-seed a cursor with fullSyncRequired=true
    await saveCursor({
      connectorId: CONN_ID,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: "tok-stale",
      fullSyncRequired: true,
    });

    const calls: string[] = [];
    const connector = {
      config: {
        connectorId: CONN_ID,
        providerId: "google-calendar" as const,
        accountLabel: "test",
        credentials: { type: "oauth2" as const },
      },
      verifyAuth: async () => {},
      async *fullSync() { calls.push("fullSync"); },
      async *incrementalSync(_c: unknown) { calls.push("incrementalSync"); },
      currentCursor: async () => ({
        connectorId: CONN_ID,
        lastSyncedAt: new Date().toISOString(),
        providerCursor: "tok-new",
        fullSyncRequired: false,
      }),
    };

    await runConnectors([connector as Parameters<typeof runConnectors>[0][number]]);

    expect(calls).toEqual(["fullSync"]);
  });
});
