import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import { getEnv, isDemoMode, isMockLLM, isMockEmbed, resetEnvForTest } from "../config/env.js";
import { setCosConfigPath, resetCosConfigPath } from "../config/credentials.js";

// Point getEnv()'s config-file fallback at a non-existent path so it cannot
// read real credentials from ~/.cos/config.json during these tests.
const NONEXISTENT_CONFIG = path.join(os.tmpdir(), `cos-env-test-${Date.now()}-nonexistent.json`);

const SAVED: Record<string, string | undefined> = {};
const TRACKED_KEYS = [
  "AWS_REGION", "COS_LLM_MODEL", "COS_EMBED_MODEL", "COS_DB_PATH",
  "LANGSMITH_PROJECT", "LANGSMITH_ENDPOINT", "LANGSMITH_TRACING",
  "COS_DEMO_MODE", "COS_MOCK_LLM", "COS_MOCK_EMBED", "COS_OWNER_EMAIL",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ASANA_PAT",
];

beforeEach(() => {
  setCosConfigPath(NONEXISTENT_CONFIG);
  for (const key of TRACKED_KEYS) {
    SAVED[key] = process.env[key];
    delete process.env[key];
  }
  resetEnvForTest();
});

afterEach(() => {
  resetCosConfigPath();
  for (const key of TRACKED_KEYS) {
    if (SAVED[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = SAVED[key];
    }
  }
  resetEnvForTest();
});

describe("getEnv() defaults", () => {
  it("returns correct defaults when no env vars are set", () => {
    const env = getEnv();
    expect(env.AWS_REGION).toBe("us-east-2");
    expect(env.COS_LLM_MODEL).toBe("anthropic.claude-sonnet-4-6");
    expect(env.COS_EMBED_MODEL).toBe("cohere.embed-v4:0");
    expect(env.COS_DB_PATH).toBe("~/.cos/graph.db");
    expect(env.LANGSMITH_PROJECT).toBe("cos-prototype");
    expect(env.COS_DEMO_MODE).toBe(false);
    expect(env.LANGSMITH_TRACING).toBe(false);
  });

  it("caches the result — returns same object on second call", () => {
    const a = getEnv();
    const b = getEnv();
    expect(a).toBe(b);
  });
});

describe("boolean coercion", () => {
  it("COS_DEMO_MODE=true → true", () => {
    process.env["COS_DEMO_MODE"] = "true";
    resetEnvForTest();
    expect(getEnv().COS_DEMO_MODE).toBe(true);
    expect(isDemoMode()).toBe(true);
  });

  it("COS_DEMO_MODE=false → false", () => {
    process.env["COS_DEMO_MODE"] = "false";
    resetEnvForTest();
    expect(isDemoMode()).toBe(false);
  });

  it("COS_MOCK_LLM=true → isMockLLM()=true", () => {
    process.env["COS_MOCK_LLM"] = "true";
    resetEnvForTest();
    expect(isMockLLM()).toBe(true);
  });

  it("COS_MOCK_EMBED=true → isMockEmbed()=true", () => {
    process.env["COS_MOCK_EMBED"] = "true";
    resetEnvForTest();
    expect(isMockEmbed()).toBe(true);
  });
});

describe("model ID configurability", () => {
  it("accepts a custom LLM model ID", () => {
    process.env["COS_LLM_MODEL"] = "anthropic.claude-3-5-sonnet-20241022-v2:0";
    resetEnvForTest();
    expect(getEnv().COS_LLM_MODEL).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
  });
});

describe("optional fields", () => {
  it("COS_OWNER_EMAIL is optional", () => {
    expect(getEnv().COS_OWNER_EMAIL).toBeUndefined();
  });

  it("ASANA_PAT is optional", () => {
    expect(getEnv().ASANA_PAT).toBeUndefined();
  });

  it("GOOGLE_CLIENT_ID is optional", () => {
    expect(getEnv().GOOGLE_CLIENT_ID).toBeUndefined();
  });
});
