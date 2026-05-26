import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-cursor-${Date.now()}.db`);

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
  const { loadCursor, saveCursor, resetCursor } = await import("../../graph/sync-cursor.js");
  resetEnvForTest();
  resetDbForTest();
  await initSchema();
  return { loadCursor, saveCursor, resetCursor };
}

describe("sync-cursor", () => {
  it("returns null for unknown connectorId", async () => {
    const { loadCursor } = await setup();
    const cursor = await loadCursor("unknown-connector");
    expect(cursor).toBeNull();
  });

  it("saves and loads a cursor round-trip", async () => {
    const { loadCursor, saveCursor } = await setup();
    const cursor = {
      connectorId: "gcal-test",
      lastSyncedAt: "2026-05-25T12:00:00Z",
      providerCursor: "syncToken-abc123",
      fullSyncRequired: false,
    };
    await saveCursor(cursor);
    const loaded = await loadCursor("gcal-test");
    expect(loaded).toEqual(cursor);
  });

  it("updates existing cursor on second save", async () => {
    const { loadCursor, saveCursor } = await setup();
    await saveCursor({
      connectorId: "gcal-test",
      lastSyncedAt: "2026-05-25T10:00:00Z",
      providerCursor: "tok-v1",
      fullSyncRequired: false,
    });
    await saveCursor({
      connectorId: "gcal-test",
      lastSyncedAt: "2026-05-25T12:00:00Z",
      providerCursor: "tok-v2",
      fullSyncRequired: false,
    });
    const loaded = await loadCursor("gcal-test");
    expect(loaded!.providerCursor).toBe("tok-v2");
    expect(loaded!.lastSyncedAt).toBe("2026-05-25T12:00:00Z");
  });

  it("persists fullSyncRequired=true", async () => {
    const { loadCursor, saveCursor } = await setup();
    await saveCursor({
      connectorId: "asana-test",
      lastSyncedAt: "2026-05-25T12:00:00Z",
      providerCursor: "",
      fullSyncRequired: true,
    });
    const loaded = await loadCursor("asana-test");
    expect(loaded!.fullSyncRequired).toBe(true);
  });

  it("resetCursor removes the stored cursor", async () => {
    const { loadCursor, saveCursor, resetCursor } = await setup();
    await saveCursor({
      connectorId: "gcal-test",
      lastSyncedAt: "2026-05-25T12:00:00Z",
      providerCursor: "tok-abc",
      fullSyncRequired: false,
    });
    await resetCursor("gcal-test");
    const loaded = await loadCursor("gcal-test");
    expect(loaded).toBeNull();
  });
});
