import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_CONFIG_DIR = path.join(os.tmpdir(), `cos-provider-test-${Date.now()}`);
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "config.json");

beforeEach(() => {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env["COS_CONFIG_PATH"] = TEST_CONFIG_PATH;
  process.env["AWS_ACCESS_KEY_ID"] = "test-key";
  process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
  process.env["AWS_REGION"] = "us-east-2";
  process.env["OPENAI_API_KEY"] = "sk-test-openai";
  process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
  process.env["LANGSMITH_TRACING"] = "false";
});

afterEach(() => {
  delete process.env["COS_CONFIG_PATH"];
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true }); } catch { /* ignore */ }
  vi.resetModules();
});

function writeConfig(config: object): void {
  fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
}

describe("getLlmModel", () => {
  it("returns a model object for openai provider", async () => {
    writeConfig({ llm: { provider: "openai", apiKey: "sk-test" } });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getLlmModel } = await import("../../llm/provider.js");
    const model = await getLlmModel();
    expect(model).toBeDefined();
    expect(typeof model.doGenerate).toBe("function");
  });

  it("returns a model object for anthropic provider", async () => {
    writeConfig({ llm: { provider: "anthropic", apiKey: "sk-ant-test" } });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getLlmModel } = await import("../../llm/provider.js");
    const model = await getLlmModel();
    expect(model).toBeDefined();
    expect(typeof model.doGenerate).toBe("function");
  });

  it("throws for openai provider when no API key", async () => {
    delete process.env["OPENAI_API_KEY"];
    writeConfig({ llm: { provider: "openai" } });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getLlmModel } = await import("../../llm/provider.js");
    await expect(getLlmModel()).rejects.toThrow("OpenAI API key not configured");
  });
});

describe("getEmbeddingModel", () => {
  it("returns openai embedding model when provider=anthropic (no native embeddings)", async () => {
    writeConfig({
      llm: {
        provider: "anthropic",
        apiKey: "sk-ant-test",
        embedProvider: "openai",
        embedApiKey: "sk-test-openai",
      },
    });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getEmbeddingModel } = await import("../../llm/provider.js");
    const model = await getEmbeddingModel();
    expect(model).toBeDefined();
    expect(typeof model.doEmbed).toBe("function");
  });

  it("returns openai embedding model when provider=openai", async () => {
    writeConfig({ llm: { provider: "openai", apiKey: "sk-test" } });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getEmbeddingModel } = await import("../../llm/provider.js");
    const model = await getEmbeddingModel();
    expect(model).toBeDefined();
  });

  it("throws for anthropic when no embedApiKey", async () => {
    delete process.env["OPENAI_API_KEY"];
    writeConfig({ llm: { provider: "anthropic", apiKey: "sk-ant-test" } });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG_PATH);

    const { getEmbeddingModel } = await import("../../llm/provider.js");
    await expect(getEmbeddingModel()).rejects.toThrow("OpenAI API key (for embeddings) not configured");
  });
});
