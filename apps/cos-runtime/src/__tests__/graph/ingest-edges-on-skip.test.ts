/**
 * B3 end-to-end: edges are written even when nodes are dedup-skipped.
 * Verifies that re-ingesting the same fixtures produces the same edge count
 * (not zero, because edges must be written on the skip path too).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-edges-skip-${Date.now()}.db`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_OWNER_EMAIL"] = "owner@example.com";
  process.env["LANGSMITH_TRACING"] = "false";
});

afterEach(() => {
  delete process.env["COS_DB_PATH"];
  delete process.env["COS_DEMO_MODE"];
  delete process.env["COS_OWNER_EMAIL"];
  delete process.env["LANGSMITH_TRACING"];
  try {
    for (const suffix of ["", "-shm", "-wal"]) fs.unlinkSync(TEST_DB + suffix);
  } catch { /* ignore */ }
});

async function getEdgeCount(): Promise<number> {
  const { getDb } = await import("../../graph/graph.db.js");
  const db = getDb();
  const result = await db.execute("SELECT COUNT(*) FROM edges");
  const v = result.rows[0]?.[0];
  return typeof v === "number" ? v : 0;
}

async function ingestOnce() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { runConnectors } = await import("../../graph/ingest-runner.js");
  const { identityId } = await import("../../graph/canonical-id.js");
  const { MockCalendarConnector, MockGmailConnector, MockAsanaConnector } = await import(
    "../../connectors/mock.connector.js"
  );
  const { resetEnvForTest, getEnv } = await import("../../config/env.js");

  resetEnvForTest();
  resetDbForTest();
  await initSchema();

  const ownerId = identityId(getEnv().COS_OWNER_EMAIL ?? "owner@example.com");
  const connectors = [
    new MockCalendarConnector("gcal-mock", ownerId),
    new MockGmailConnector("gmail-mock", ownerId),
    new MockAsanaConnector("asana-mock", ownerId),
  ];

  return runConnectors(connectors);
}

describe("B3 — edges written on dedup-skip path (end-to-end)", () => {
  it("first ingest writes edges (edge count > 0)", async () => {
    await ingestOnce();
    const edgeCount = await getEdgeCount();
    expect(edgeCount).toBeGreaterThan(0);
  });

  it("second ingest skips all nodes but edge count is unchanged (edges still written)", async () => {
    const first = await ingestOnce();
    const edgeCountAfterFirst = await getEdgeCount();

    const second = await ingestOnce();
    const edgeCountAfterSecond = await getEdgeCount();

    // All nodes skipped on second run
    expect(second.skipped).toBe(first.written);
    expect(second.written).toBe(0);

    // Edge count must be the same — edges written on skip path, idempotent
    expect(edgeCountAfterSecond).toBe(edgeCountAfterFirst);
    expect(edgeCountAfterSecond).toBeGreaterThan(0);
  });

  it("edge count stays stable across three re-ingests", async () => {
    await ingestOnce();
    const after1 = await getEdgeCount();
    await ingestOnce();
    const after2 = await getEdgeCount();
    await ingestOnce();
    const after3 = await getEdgeCount();

    expect(after1).toBe(after2);
    expect(after2).toBe(after3);
    expect(after3).toBeGreaterThan(0);
  });
});
