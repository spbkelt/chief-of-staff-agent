import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_CONFIG_DIR = path.join(os.tmpdir(), `cos-aws-creds-test-${Date.now()}`);
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "config.json");

beforeEach(() => {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env["COS_CONFIG_PATH"] = TEST_CONFIG_PATH;
  // Suppress actual AWS credential lookups
  process.env["AWS_ACCESS_KEY_ID"] = "test-key";
  process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
  process.env["AWS_REGION"] = "us-east-2";
  // Prevent the COS_OPENSEARCH_ENDPOINT early-return in getAwsRegion() from
  // masking the config-based region check.
  delete process.env["COS_OPENSEARCH_ENDPOINT"];
});

afterEach(() => {
  delete process.env["COS_CONFIG_PATH"];
  delete process.env["COS_OPENSEARCH_ENDPOINT"];
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true }); } catch { /* ignore */ }
  vi.resetModules();
});

describe("getAwsCredentials", () => {
  it("returns provider chain when no llm config set", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));

    const { getAwsCredentials } = await import("../../config/aws-credentials.js");
    const creds = await getAwsCredentials();
    expect(typeof creds).toBe("function");
  });

  it("returns static key provider when auth=keys", async () => {
    const { setCosConfigPath, writeCosConfig } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({
      llm: {
        provider: "bedrock",
        auth: "keys",
        awsAccessKeyId: "AKIATEST",
        awsSecretAccessKey: "secrettest",
        awsRegion: "us-east-2",
      },
    });

    const { getAwsCredentials } = await import("../../config/aws-credentials.js");
    const provider = await getAwsCredentials();
    const resolved = await provider();
    expect(resolved.accessKeyId).toBe("AKIATEST");
    expect(resolved.secretAccessKey).toBe("secrettest");
  });
});

describe("getAwsRegion", () => {
  it("returns region from config when set", async () => {
    const { setCosConfigPath, writeCosConfig } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    writeCosConfig({
      llm: {
        provider: "bedrock",
        auth: "keys",
        awsRegion: "eu-west-1",
      },
    });

    const { getAwsRegion } = await import("../../config/aws-credentials.js");
    expect(getAwsRegion()).toBe("eu-west-1");
  });

  it("falls back to AWS_REGION env then us-east-2", async () => {
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    process.env["AWS_REGION"] = "ap-southeast-1";

    const { getAwsRegion } = await import("../../config/aws-credentials.js");
    expect(getAwsRegion()).toBe("ap-southeast-1");
  });
});
