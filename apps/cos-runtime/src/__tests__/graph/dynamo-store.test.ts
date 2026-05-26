import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_CONFIG_DIR = path.join(os.tmpdir(), `cos-dynamo-test-${Date.now()}`);
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "config.json");

// Mock DynamoDB client before any imports
vi.mock("@aws-sdk/lib-dynamodb", () => {
  const sent: Array<{ type: string; input: unknown }> = [];
  const items: Map<string, Record<string, unknown>> = new Map();

  const send = vi.fn(async (cmd: { input: unknown; constructor: { name: string } }) => {
    const type = cmd.constructor.name;
    sent.push({ type, input: cmd.input });

    if (type === "GetCommand") {
      const key = JSON.stringify((cmd.input as Record<string, unknown>)["Key"]);
      return { Item: items.get(key) };
    }
    if (type === "PutCommand") {
      const item = (cmd.input as Record<string, unknown>)["Item"] as Record<string, unknown>;
      const key = JSON.stringify({ pk: item["pk"], sk: item["sk"] });
      items.set(key, item);
      return {};
    }
    if (type === "DeleteCommand") {
      const k = (cmd.input as Record<string, unknown>)["Key"] as Record<string, unknown>;
      items.delete(JSON.stringify(k));
      return {};
    }
    if (type === "QueryCommand") {
      return { Items: [] };
    }
    return {};
  });

  const mockClient = { send };

  return {
    DynamoDBDocumentClient: {
      from: () => mockClient,
    },
    PutCommand: vi.fn((input: unknown) => ({ input, constructor: { name: "PutCommand" } })),
    GetCommand: vi.fn((input: unknown) => ({ input, constructor: { name: "GetCommand" } })),
    DeleteCommand: vi.fn((input: unknown) => ({ input, constructor: { name: "DeleteCommand" } })),
    QueryCommand: vi.fn((input: unknown) => ({ input, constructor: { name: "QueryCommand" } })),
  };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/credential-providers", () => ({
  fromSSO: vi.fn(() => async () => ({ accessKeyId: "test", secretAccessKey: "test" })),
  fromNodeProviderChain: vi.fn(() => async () => ({ accessKeyId: "test", secretAccessKey: "test" })),
}));

beforeEach(() => {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env["COS_CONFIG_PATH"] = TEST_CONFIG_PATH;
  process.env["AWS_REGION"] = "us-east-2";
  process.env["LANGSMITH_TRACING"] = "false";
  fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ llm: { provider: "bedrock", auth: "keys", awsAccessKeyId: "test", awsSecretAccessKey: "test", awsRegion: "us-east-2" } }));
});

afterEach(() => {
  delete process.env["COS_CONFIG_PATH"];
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true }); } catch { /* ignore */ }
  vi.resetModules();
});

describe("dynamo-store", () => {
  it("upsertNode writes item and returns not-skipped", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { dynamoUpsertNode } = await import("../../graph/dynamo-store.js");
    const result = await dynamoUpsertNode({
      nodeType: "ConversationTurn",
      canonicalId: "ct-001",
      sessionId: "s1",
      turnIndex: 0,
      role: "user",
      content: "hello",
      toolCallIds: [],
      createdAt: new Date().toISOString(),
    });

    expect(result.canonicalId).toBe("ct-001");
    expect(result.skipped).toBe(false);
  });

  it("getNode returns null for unknown item", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { dynamoGetNode } = await import("../../graph/dynamo-store.js");
    const node = await dynamoGetNode("nonexistent", "ConversationTurn");
    expect(node).toBeNull();
  });

  it("queryNodesByType returns empty array when no items", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { dynamoQueryNodesByType } = await import("../../graph/dynamo-store.js");
    const nodes = await dynamoQueryNodesByType("owner-1", "Notification");
    expect(nodes).toEqual([]);
  });
});
