import { z } from "zod";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { readCosConfig, getCosConfigPath, listGoogleAccounts } from "./credentials.js";
import { DEFAULT_BEDROCK_EMBED, DEFAULT_BEDROCK_LLM } from "../llm/model-defaults.js";

// Load .env from project root (two levels up from apps/cos-runtime)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const EnvSchema = z.object({
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_TOKEN_EXPIRY: z.string().optional(),

  // Microsoft OAuth (optional overrides — primary store is ~/.cos/config.json)
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_ACCESS_TOKEN: z.string().optional(),
  MICROSOFT_REFRESH_TOKEN: z.string().optional(),
  MICROSOFT_TOKEN_EXPIRY: z.string().optional(),

  // Asana
  ASANA_PAT: z.string().optional(),

  // LLM backend — Bedrock
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default("us-east-2"),
  COS_LLM_MODEL: z.string().default(DEFAULT_BEDROCK_LLM),
  COS_EMBED_MODEL: z.string().default(DEFAULT_BEDROCK_EMBED),

  // Mock mode
  COS_MOCK_LLM: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  COS_MOCK_EMBED: z
    .string()
    .transform((v) => v === "true")
    .optional(),

  // Database
  COS_DB_PATH: z.string().default("~/.cos/graph.db"),

  // LangSmith
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("cos-prototype"),
  LANGSMITH_ENDPOINT: z.string().url().default("https://api.smith.langchain.com"),
  LANGSMITH_TRACING: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Application
  COS_OWNER_EMAIL: z.string().email().optional(),
  COS_DEMO_MODE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (_env) return _env;

  // Fallback: populate missing env vars from ~/.cos/config.json (product path)
  try {
    const cosConfig = readCosConfig();
    if (cosConfig.ownerEmail && !process.env["COS_OWNER_EMAIL"]) process.env["COS_OWNER_EMAIL"] = cosConfig.ownerEmail;
    const accounts = listGoogleAccounts(cosConfig);
    const primary = accounts[0] ?? (cosConfig.google?.clientId ? {
      clientId: cosConfig.google.clientId,
      clientSecret: cosConfig.google.clientSecret,
      redirectUri: cosConfig.google.redirectUri,
      accessToken: cosConfig.google.accessToken,
      refreshToken: cosConfig.google.refreshToken,
      tokenExpiry: cosConfig.google.tokenExpiry,
    } : undefined);
    if (primary) {
      if (primary.clientId && !process.env["GOOGLE_CLIENT_ID"]) process.env["GOOGLE_CLIENT_ID"] = primary.clientId;
      if (primary.clientSecret && !process.env["GOOGLE_CLIENT_SECRET"]) process.env["GOOGLE_CLIENT_SECRET"] = primary.clientSecret;
      if (primary.redirectUri && !process.env["GOOGLE_REDIRECT_URI"]) process.env["GOOGLE_REDIRECT_URI"] = primary.redirectUri;
      if (primary.accessToken && !process.env["GOOGLE_ACCESS_TOKEN"]) process.env["GOOGLE_ACCESS_TOKEN"] = primary.accessToken;
      if (primary.refreshToken && !process.env["GOOGLE_REFRESH_TOKEN"]) process.env["GOOGLE_REFRESH_TOKEN"] = primary.refreshToken;
      if (primary.tokenExpiry && !process.env["GOOGLE_TOKEN_EXPIRY"]) process.env["GOOGLE_TOKEN_EXPIRY"] = primary.tokenExpiry;
    }
    if (cosConfig.asana?.pat && !process.env["ASANA_PAT"]) process.env["ASANA_PAT"] = cosConfig.asana.pat;
    if (cosConfig.llm?.awsAccessKeyId && !process.env["AWS_ACCESS_KEY_ID"]) process.env["AWS_ACCESS_KEY_ID"] = cosConfig.llm.awsAccessKeyId;
    if (cosConfig.llm?.awsSecretAccessKey && !process.env["AWS_SECRET_ACCESS_KEY"]) process.env["AWS_SECRET_ACCESS_KEY"] = cosConfig.llm.awsSecretAccessKey;
    if (cosConfig.llm?.awsRegion && !process.env["AWS_REGION"]) process.env["AWS_REGION"] = cosConfig.llm.awsRegion;
  } catch {
    // credentials file missing or unreadable — continue with env vars only
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  _env = result.data;
  return _env;
}

export function isDemoMode(): boolean {
  return getEnv().COS_DEMO_MODE;
}

/** True when running the customer product path (real connectors), not fixture demo. */
export function isProductMode(): boolean {
  if (getEnv().COS_DEMO_MODE) return false;
  try {
    return fs.existsSync(getCosConfigPath());
  } catch {
    return false;
  }
}

export function isMockLLM(): boolean {
  return getEnv().COS_MOCK_LLM === true;
}

export function isMockEmbed(): boolean {
  return getEnv().COS_MOCK_EMBED === true;
}

/** CI-only fixture ingest (COS_ALLOW_FIXTURES=true). Never for executive product proof. */
export function allowsFixtures(): boolean {
  return process.env["COS_ALLOW_FIXTURES"] === "true";
}

export function assertProductNoMocks(context: string): void {
  if (allowsFixtures()) return;
  if (isMockLLM() || isMockEmbed() || isDemoMode()) {
    throw new Error(
      `${context}: mock/demo modes are disabled for product paths. Use live credentials or set COS_ALLOW_FIXTURES=true for CI only.`
    );
  }
}

export function resetEnvForTest(): void {
  _env = undefined;
}
