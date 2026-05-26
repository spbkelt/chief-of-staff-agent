import fs from "fs";
import path from "path";
import os from "os";

export interface GoogleAccountConfig {
  id: string;
  label: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: string;
}

export interface MicrosoftAccountConfig {
  id: string;
  label: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: string;
}

export interface CosConfig {
  ownerEmail?: string;
  /** @deprecated use googleAccounts */
  google?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: string;
  };
  googleAccounts?: GoogleAccountConfig[];
  microsoftAccounts?: MicrosoftAccountConfig[];
  asana?: { pat?: string };
  llm?: {
    provider: "bedrock" | "openai" | "anthropic";
    /** bedrock only */
    auth?: "sso" | "keys";
    awsSsoProfile?: string;
    awsRegion?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    /** openai / anthropic */
    apiKey?: string;
    /** anthropic: separate provider used for embeddings */
    embedProvider?: "openai";
    embedApiKey?: string;
    llmModel?: string;
    embedModel?: string;
    /** graph and RAG backend selections */
    graphBackend?: "libsql" | "dynamo";
    dynamoTable?: string;
    ragBackend?: "local" | "opensearch";
    opensearchEndpoint?: string;
  };
  telegram?: {
    botToken?: string;
    chatId?: string;
  };
  notifications?: {
    channels: Array<"console" | "telegram">;
  };
  /** Phase 2+ deployed AWS resources (CDK / console); used by Lambda + EventBridge notify path */
  aws?: CosAwsConfig;
}

export interface CosAwsConfig {
  stage?: string;
  region?: string;
  /** S3: JSONL corpus exports, migration artifacts (build-rag-systems) */
  corpusBucket?: string;
  /** S3: raw ingest payloads / webhook bodies */
  ingestBucket?: string;
  /** S3: evidence bundles, audit exports */
  artifactsBucket?: string;
  /** DynamoDB: idempotency keys for webhook/poller ingestion */
  idempotencyTable?: string;
  /** SQS: failed ingest / embed jobs */
  ingestDlqUrl?: string;
  /** IAM managed policy ARN for local operator (attach to your SSO role) */
  operatorPolicyArn?: string;
  opensearchCollectionArn?: string;
  notificationLambdaArn?: string;
  eventBridgeRuleArn?: string;
  ingestLambdaArn?: string;
}

export interface CosConfigSectionStatus {
  id: string;
  label: string;
  configured: boolean;
  detail?: string | undefined;
}

let _configPathOverride: string | undefined;

export function setCosConfigPath(p: string): void {
  _configPathOverride = p;
}

export function resetCosConfigPath(): void {
  _configPathOverride = undefined;
}

export function getCosConfigPath(): string {
  if (_configPathOverride) return _configPathOverride;
  return path.join(os.homedir(), ".cos", "config.json");
}

function migrateGoogleAccounts(config: CosConfig): GoogleAccountConfig[] {
  if (config.googleAccounts && config.googleAccounts.length > 0) {
    return config.googleAccounts;
  }
  if (config.google?.clientId && config.google.accessToken) {
    const acc: GoogleAccountConfig = {
      id: "primary",
      label: "Primary Google",
      clientId: config.google.clientId,
      accessToken: config.google.accessToken,
    };
    if (config.google.clientSecret) acc.clientSecret = config.google.clientSecret;
    if (config.google.redirectUri) acc.redirectUri = config.google.redirectUri;
    if (config.google.refreshToken) acc.refreshToken = config.google.refreshToken;
    if (config.google.tokenExpiry) acc.tokenExpiry = config.google.tokenExpiry;
    return [acc];
  }
  return [];
}

export function listGoogleAccounts(config?: CosConfig): GoogleAccountConfig[] {
  const c = config ?? readCosConfig();
  return migrateGoogleAccounts(c);
}

export function readCosConfig(): CosConfig {
  const p = getCosConfigPath();
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as CosConfig;
  } catch {
    return {};
  }
}

export function hasCosConfigFile(): boolean {
  return fs.existsSync(getCosConfigPath());
}

function maskSecret(value: string, visibleTail = 4): string {
  if (value.length <= visibleTail) return "****";
  return `****${value.slice(-visibleTail)}`;
}

function sectionStatus(
  id: string,
  label: string,
  configured: boolean,
  detail?: string
): CosConfigSectionStatus {
  if (detail !== undefined && detail !== "") {
    return { id, label, configured, detail };
  }
  return { id, label, configured };
}

/** Human-readable status for setup menu (no secret values). */
export function summarizeCosConfig(config: CosConfig = readCosConfig()): CosConfigSectionStatus[] {
  const googleN = listGoogleAccounts(config).filter((a) => a.accessToken).length;
  const msN = listMicrosoftAccounts(config).filter((a) => a.accessToken).length;
  const llm = config.llm;
  const graph = llm?.graphBackend === "dynamo" ? `DynamoDB (${llm.dynamoTable ?? "cos-graph"})` : "libSQL (~/.cos/graph.db)";
  const rag =
    llm?.ragBackend === "opensearch"
      ? `OpenSearch (${llm.opensearchEndpoint ? "configured" : "endpoint missing"})`
      : "local vectors (libSQL)";
  const llmCred =
    llm?.apiKey ||
    llm?.awsSsoProfile ||
    llm?.awsAccessKeyId ||
    process.env["AWS_ACCESS_KEY_ID"] ||
    process.env["OPENAI_API_KEY"];

  return [
    sectionStatus(
      "identity",
      "Owner identity",
      !!(config.ownerEmail || process.env["COS_OWNER_EMAIL"]),
      config.ownerEmail ?? process.env["COS_OWNER_EMAIL"]
    ),
    sectionStatus(
      "google",
      "Google Workspace",
      googleN > 0,
      googleN > 0 ? `${googleN} account(s)` : undefined
    ),
    sectionStatus(
      "microsoft",
      "Microsoft 365",
      msN > 0,
      msN > 0 ? `${msN} account(s)` : undefined
    ),
    sectionStatus(
      "asana",
      "Asana PAT",
      !!(config.asana?.pat || process.env["ASANA_PAT"]),
      config.asana?.pat ? maskSecret(config.asana.pat) : undefined
    ),
    sectionStatus(
      "llm",
      "AI provider",
      !!(llm?.provider && llmCred),
      llm?.provider ? `${llm.provider}${llm.llmModel ? ` · ${llm.llmModel}` : ""}` : undefined
    ),
    sectionStatus("graph", "Knowledge graph storage", true, graph),
    sectionStatus("rag", "RAG search backend", true, rag),
    sectionStatus(
      "aws",
      "AWS automation (Lambda / EventBridge)",
      !!(config.aws?.notificationLambdaArn || config.aws?.eventBridgeRuleArn),
      config.aws?.stage ? `stage ${config.aws.stage}` : undefined
    ),
    sectionStatus(
      "telegram",
      "Telegram notifications",
      !!(config.telegram?.botToken && config.telegram?.chatId),
      config.notifications?.channels?.includes("telegram") ? "channel enabled" : undefined
    ),
  ];
}

export function writeCosConfig(config: CosConfig): void {
  const p = getCosConfigPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // best-effort on platforms that restrict chmod
  }
}

export function removeGoogleAccount(id: string): void {
  const config = readCosConfig();
  const accounts = listGoogleAccounts(config);
  const filtered = accounts.filter((a) => a.id !== id);
  writeCosConfig({ ...config, googleAccounts: filtered });
}

export function clearAsanaPat(): void {
  const config = readCosConfig();
  writeCosConfig({ ...config, asana: {} });
}

export function clearTelegramConfig(): void {
  const config = readCosConfig();
  const updated = { ...config };
  delete updated.telegram;
  writeCosConfig(updated);
}

export function listMicrosoftAccounts(config?: CosConfig): MicrosoftAccountConfig[] {
  const c = config ?? readCosConfig();
  return c.microsoftAccounts ?? [];
}

export function addMicrosoftAccount(account: MicrosoftAccountConfig): void {
  const config = readCosConfig();
  const accounts = config.microsoftAccounts ?? [];
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx !== -1) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  writeCosConfig({ ...config, microsoftAccounts: accounts });
}

export function removeMicrosoftAccount(id: string): void {
  const config = readCosConfig();
  const accounts = (config.microsoftAccounts ?? []).filter((a) => a.id !== id);
  writeCosConfig({ ...config, microsoftAccounts: accounts });
}

export function mergeCosConfig(partial: Partial<CosConfig>): void {
  const existing = readCosConfig();
  const merged: CosConfig = { ...existing };

  if ("ownerEmail" in partial && partial.ownerEmail !== undefined) {
    merged.ownerEmail = partial.ownerEmail;
  }

  if (partial.google !== undefined) {
    merged.google = { ...existing.google, ...partial.google };
    const accounts = migrateGoogleAccounts({ ...merged, google: merged.google });
    if (accounts.length > 0) {
      merged.googleAccounts = [{ ...accounts[0], ...partial.google, id: accounts[0]?.id ?? "primary", label: accounts[0]?.label ?? "Primary Google" }];
    }
  }

  if (partial.googleAccounts !== undefined) {
    merged.googleAccounts = partial.googleAccounts;
  }

  if (partial.microsoftAccounts !== undefined) {
    merged.microsoftAccounts = partial.microsoftAccounts;
  }

  if (partial.asana !== undefined) {
    merged.asana = { ...existing.asana, ...partial.asana };
  }

  if (partial.llm !== undefined) {
    const llmBase = existing.llm ?? { provider: partial.llm.provider };
    merged.llm = { ...llmBase, ...partial.llm };
  }

  if (partial.notifications !== undefined) {
    const prevChannels = existing.notifications?.channels ?? ["console"];
    const nextChannels = partial.notifications.channels ?? prevChannels;
    merged.notifications = {
      channels: [...new Set([...prevChannels, ...nextChannels])],
    };
  }

  if (partial.telegram !== undefined) {
    merged.telegram = { ...existing.telegram, ...partial.telegram };
  }

  if (partial.aws !== undefined) {
    merged.aws = { ...existing.aws, ...partial.aws };
  }

  writeCosConfig(merged);
}
