import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(os.tmpdir(), `cos-token-boundary-test-${Date.now()}.db`);
const TEST_CONFIG_DIR = path.join(os.tmpdir(), `cos-token-boundary-cfg-${Date.now()}`);

beforeEach(() => {
  process.env["COS_DB_PATH"] = TEST_DB;
  process.env["COS_DEMO_MODE"] = "true";
  process.env["COS_ALLOW_FIXTURES"] = "true";
  process.env["COS_MOCK_LLM"] = "true";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["LANGSMITH_TRACING"] = "false";
  delete process.env["AWS_ACCESS_KEY_ID"];
  delete process.env["AWS_SECRET_ACCESS_KEY"];
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

afterEach(async () => {
  const { resetEnvForTest } = await import("../../config/env.js");
  const { closeDb, resetDbForTest } = await import("../../graph/graph.db.js");
  const { resetCosConfigPath } = await import("../../config/credentials.js");
  resetEnvForTest();
  await closeDb();
  resetDbForTest();
  resetCosConfigPath();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("ownerUserId isolation — query boundary", () => {
  it("returns zero chunks for ownerUserId=B when all data belongs to ownerUserId=A", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { connectorNodeId, rawHash, identityId } = await import("../../graph/canonical-id.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks } = await import("../../rag/embed.js");
    const { retrieve } = await import("../../rag/retrieve.js");

    resetDbForTest();
    await initSchema();

    const ownerA = identityId("user-a@example.com");
    const ownerB = identityId("user-b@example.com");

    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: connectorNodeId("asana", "task-owner-a"),
      connectorId: "asana",
      ownerUserId: ownerA,
      providerTaskGid: "task-owner-a",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Confidential task for user A",
      notes: "Confidential content for user A only",
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: null,
      dueAt: null,
      isCompleted: false,
      completedAt: null,
      priority: "high",
      tags: [],
      ingestedAt: new Date().toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-owner-a" }),
    });

    await chunkAllNodes(ownerA);
    await embedPendingChunks(ownerA);

    const result = await retrieve("confidential content user A", { ownerUserId: ownerB });
    expect(result.chunks).toHaveLength(0);
    expect(result.retrievedChunkIds).toHaveLength(0);
  });

  it("returns chunks for ownerUserId=A from A's own embedded data", async () => {
    const { resetDbForTest, initSchema } = await import("../../graph/graph.db.js");
    const { upsertNode } = await import("../../graph/upsert.js");
    const { connectorNodeId, rawHash, identityId } = await import("../../graph/canonical-id.js");
    const { chunkAllNodes } = await import("../../rag/chunk.js");
    const { embedPendingChunks } = await import("../../rag/embed.js");
    const { retrieve } = await import("../../rag/retrieve.js");

    resetDbForTest();
    await initSchema();

    const ownerA = identityId("user-a-retrieve@example.com");

    await upsertNode({
      nodeType: "AsanaTask",
      canonicalId: connectorNodeId("asana", "task-owner-a-retrieve"),
      connectorId: "asana",
      ownerUserId: ownerA,
      providerTaskGid: "task-owner-a-retrieve",
      projectCanonicalId: null,
      workspaceCanonicalId: "ws-1",
      name: "Budget review for Q3",
      notes: "Quarterly budget review task",
      assigneeIdentityId: null,
      followerIdentityIds: [],
      dueDate: null,
      dueAt: null,
      isCompleted: false,
      completedAt: null,
      priority: "high",
      tags: [],
      ingestedAt: new Date().toISOString(),
      rawHash: rawHash({ providerTaskGid: "task-owner-a-retrieve" }),
    });

    await chunkAllNodes(ownerA);
    await embedPendingChunks(ownerA);

    const result = await retrieve("budget review", { ownerUserId: ownerA });
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});

describe("readCosConfig — process-scoped isolation", () => {
  it("returns empty config when pointed at a non-existent path", async () => {
    const { setCosConfigPath, readCosConfig } = await import("../../config/credentials.js");
    const isolatedPath = path.join(TEST_CONFIG_DIR, "isolated.json");
    setCosConfigPath(isolatedPath);
    const config = readCosConfig();
    expect(config).toEqual({});
  });

  it("does not bleed credentials between test-isolated config paths", async () => {
    const { setCosConfigPath, writeCosConfig, readCosConfig, resetCosConfigPath } =
      await import("../../config/credentials.js");

    const pathA = path.join(TEST_CONFIG_DIR, "config-a.json");
    const pathB = path.join(TEST_CONFIG_DIR, "config-b.json");

    setCosConfigPath(pathA);
    writeCosConfig({ ownerEmail: "user-a@example.com" });
    const configA = readCosConfig();
    expect(configA.ownerEmail).toBe("user-a@example.com");

    setCosConfigPath(pathB);
    const configB = readCosConfig();
    expect(configB.ownerEmail).toBeUndefined();

    resetCosConfigPath();
  });
});
