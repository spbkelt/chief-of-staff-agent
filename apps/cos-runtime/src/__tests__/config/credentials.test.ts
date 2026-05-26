import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_CONFIG_DIR = path.join(os.tmpdir(), `cos-creds-test-${Date.now()}`);
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "config.json");

beforeEach(() => {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

afterEach(async () => {
  const { resetCosConfigPath } = await import("../../config/credentials.js");
  resetCosConfigPath();
  try {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("readCosConfig", () => {
  it("returns empty object when file does not exist", async () => {
    const { setCosConfigPath, readCosConfig } = await import("../../config/credentials.js");
    setCosConfigPath(path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`));
    const config = readCosConfig();
    expect(config).toEqual({});
  });

  it("returns parsed config from existing file", async () => {
    const { setCosConfigPath, readCosConfig } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ ownerEmail: "test@example.com" }));
    const config = readCosConfig();
    expect(config.ownerEmail).toBe("test@example.com");
  });
});

describe("writeCosConfig + readCosConfig roundtrip", () => {
  it("writes and reads back config correctly", async () => {
    const { setCosConfigPath, writeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ ownerEmail: "user@test.com", asana: { pat: "test-pat-123" } });
    const config = readCosConfig();
    expect(config.ownerEmail).toBe("user@test.com");
    expect(config.asana?.pat).toBe("test-pat-123");
  });
});

describe("mergeCosConfig", () => {
  it("merges without overwriting existing keys", async () => {
    const { setCosConfigPath, writeCosConfig, mergeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ ownerEmail: "original@test.com", asana: { pat: "original-pat" } });
    mergeCosConfig({ asana: { pat: "new-pat" } });
    const config = readCosConfig();
    expect(config.ownerEmail).toBe("original@test.com");
    expect(config.asana?.pat).toBe("new-pat");
  });

  it("merges nested google fields", async () => {
    const { setCosConfigPath, writeCosConfig, mergeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ google: { clientId: "cid-1", accessToken: "token-1" } });
    mergeCosConfig({ google: { refreshToken: "refresh-1" } });
    const config = readCosConfig();
    expect(config.google?.clientId).toBe("cid-1");
    expect(config.google?.accessToken).toBe("token-1");
    expect(config.google?.refreshToken).toBe("refresh-1");
  });

  it("merges llm without dropping graphBackend when updating provider fields", async () => {
    const { setCosConfigPath, writeCosConfig, mergeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({
      llm: {
        provider: "bedrock",
        graphBackend: "dynamo",
        dynamoTable: "my-table",
        ragBackend: "opensearch",
        opensearchEndpoint: "https://os.example.com",
      },
    });
    mergeCosConfig({ llm: { provider: "bedrock", awsRegion: "us-west-2" } });
    const config = readCosConfig();
    expect(config.llm?.graphBackend).toBe("dynamo");
    expect(config.llm?.ragBackend).toBe("opensearch");
    expect(config.llm?.awsRegion).toBe("us-west-2");
  });

  it("union notification channels instead of replacing", async () => {
    const { setCosConfigPath, writeCosConfig, mergeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ notifications: { channels: ["console", "telegram"] } });
    mergeCosConfig({ notifications: { channels: ["console"] } });
    expect(readCosConfig().notifications?.channels).toEqual(["console", "telegram"]);
  });

  it("merges telegram without wiping other keys", async () => {
    const { setCosConfigPath, writeCosConfig, mergeCosConfig, readCosConfig } = await import(
      "../../config/credentials.js"
    );
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ ownerEmail: "keep@test.com", telegram: { botToken: "old", chatId: "1" } });
    mergeCosConfig({ telegram: { chatId: "2" } });
    const config = readCosConfig();
    expect(config.ownerEmail).toBe("keep@test.com");
    expect(config.telegram?.botToken).toBe("old");
    expect(config.telegram?.chatId).toBe("2");
  });
});

describe("env.ts integration — ~/.cos/config.json fallback", () => {
  it("populates process.env from config.json when env var not set", async () => {
    const { setCosConfigPath, writeCosConfig } = await import("../../config/credentials.js");
    const { resetEnvForTest } = await import("../../config/env.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ ownerEmail: "from-config@test.com", asana: { pat: "config-pat" } });

    const savedOwner = process.env["COS_OWNER_EMAIL"];
    const savedAsana = process.env["ASANA_PAT"];
    delete process.env["COS_OWNER_EMAIL"];
    delete process.env["ASANA_PAT"];
    resetEnvForTest();

    const { getEnv } = await import("../../config/env.js");
    const env = getEnv();
    expect(env.COS_OWNER_EMAIL).toBe("from-config@test.com");
    expect(env.ASANA_PAT).toBe("config-pat");

    // Restore
    if (savedOwner !== undefined) process.env["COS_OWNER_EMAIL"] = savedOwner;
    if (savedAsana !== undefined) process.env["ASANA_PAT"] = savedAsana;
    resetEnvForTest();
  });

  it("does not overwrite existing env vars with config values", async () => {
    const { setCosConfigPath, writeCosConfig } = await import("../../config/credentials.js");
    const { resetEnvForTest } = await import("../../config/env.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({ asana: { pat: "config-pat" } });

    process.env["ASANA_PAT"] = "env-pat";
    resetEnvForTest();

    const { getEnv } = await import("../../config/env.js");
    const env = getEnv();
    expect(env.ASANA_PAT).toBe("env-pat");

    process.env["ASANA_PAT"] = "env-pat";
    resetEnvForTest();
  });
});
