import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-ingest-idem-${Date.now()}.db`);

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

async function ingestOnce() {
  const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
  const { runConnectors } = await import("../../graph/ingest-runner.js");
  const { getNodeCount } = await import("../../graph/upsert.js");
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

  const stats = await runConnectors(connectors);
  const total = await getNodeCount();
  return { ...stats, total };
}

describe("ingest idempotency (end-to-end)", () => {
  it("first run writes all nodes (skipped=0)", async () => {
    const { written, skipped } = await ingestOnce();
    expect(written).toBeGreaterThan(0);
    expect(skipped).toBe(0);
  });

  it("second run skips all nodes — rawHash dedup works end-to-end", async () => {
    const first = await ingestOnce();
    expect(first.written).toBeGreaterThan(0);

    const second = await ingestOnce();
    expect(second.skipped).toBe(first.written);
    expect(second.written).toBe(0);
  });

  it("total node count does not grow on re-ingest", async () => {
    const first = await ingestOnce();
    const second = await ingestOnce();
    expect(second.total).toBe(first.total);
  });
});
