import readline from "readline";
import {
  readCosConfig,
  mergeCosConfig,
  listGoogleAccounts,
  type CosConfig,
} from "../config/credentials.js";
import { google } from "googleapis";
import { buildMicrosoftAuthUrl, exchangeMicrosoftAuthCode } from "../auth/microsoft-auth.js";
import {
  GOOGLE_OAUTH_REDIRECT_URI,
  printGoogleCloudSetupGuide,
  printGoogleSignInTroubleshooting,
  formatGoogleOAuthFailure,
} from "./google-oauth-setup-guide.js";
import {
  DEFAULT_ANTHROPIC_LLM,
  DEFAULT_BEDROCK_EMBED,
  DEFAULT_BEDROCK_LLM,
  DEFAULT_OPENAI_EMBED,
  DEFAULT_OPENAI_LLM,
} from "../llm/model-defaults.js";
import { inferSsoDefaultsForSession, readAwsConfigFile } from "../config/aws-ini-config.js";
import {
  ensureSsoProfileViaCli,
  ensureSsoSessionViaCli,
  precheckAwsConfig,
  type AwsConfigPrecheck,
} from "../config/aws-config-cli.js";

function printAwsConfigPrecheck(precheck: AwsConfigPrecheck): void {
  if (precheck.deduped && precheck.duplicateSections.length > 0) {
    console.log(
      `\n  ~/.aws/config had duplicate sections (removed: ${precheck.duplicateSections.join(", ")}).`,
    );
    console.log(`  Backup: ${precheck.configPath}.cos-backup`);
  }
  if (precheck.usableProfiles.length > 0) {
    console.log("\n  SSO profiles in ~/.aws/config:");
    for (const p of precheck.usableProfiles) {
      const markers = [
        p.profileName === precheck.recommendedProfile?.profileName ? "recommended" : "",
        p.profileName === precheck.activeProfile ? "AWS_PROFILE" : "",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `    • ${p.profileName}  region=${p.region ?? "?"}  session=${p.ssoSession}${markers ? `  (${markers})` : ""}`,
      );
    }
  }
  if (!precheck.awsCliAvailable) {
    console.log("\n  ⚠️  AWS CLI not on PATH — install it to create or update SSO profiles.");
  }
}

function applyBedrockSsoToCosConfig(
  profileName: string,
  workloadRegion: string,
  base: NonNullable<CosConfig["llm"]>,
  models: { llmModel: string; embedModel: string },
): void {
  mergeCosConfig({
    llm: {
      ...base,
      provider: "bedrock",
      auth: "sso",
      awsSsoProfile: profileName,
      awsRegion: workloadRegion,
      ...models,
    },
    aws: { ...readCosConfig().aws, region: workloadRegion },
  });
}

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export type SetupRl = readline.Interface;

export function prompt(rl: SetupRl, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export function hr(): void {
  console.log("─────────────────────────────────────────────────────────");
}

export function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

export function skip(msg: string): void {
  console.log(`  ⚠️  ${msg}`);
}

function maskSecret(value: string): string {
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}

/** Prompt; empty line keeps `current` when provided. */
export async function promptOptional(
  rl: SetupRl,
  question: string,
  current?: string
): Promise<string> {
  if (current) {
    const suffix = current.includes("@") ? current : maskSecret(current);
    const ans = await prompt(rl, `  ? ${question} [keep: ${suffix}]: `);
    return ans.trim() || current;
  }
  return (await prompt(rl, `  ? ${question}: `)).trim();
}

export async function stepIdentity(rl: SetupRl): Promise<void> {
  console.log("\n[Identity] Your email anchors ownership of ingested data.");
  const existing = readCosConfig().ownerEmail;
  const email = await promptOptional(rl, "Your email address", existing);
  if (email) {
    mergeCosConfig({ ownerEmail: email });
    ok(`Owner email saved: ${email}`);
  } else {
    skip("No email provided");
  }
}

export async function stepGoogle(rl: SetupRl): Promise<void> {
  console.log("\n[Google Workspace] Calendar + Gmail in one sign-in.");
  const ownerEmail = readCosConfig().ownerEmail;
  printGoogleCloudSetupGuide(ownerEmail);
  const readyGoogle = await prompt(
    rl,
    "  ? Completed substeps A–D (consent, APIs, OAuth client, test user)? [Y/n]: "
  );
  if (readyGoogle.trim().toLowerCase() === "n") {
    skip("Finish Google Cloud setup, then re-run this section.");
    return;
  }

  const existing = readCosConfig();
  const primary = listGoogleAccounts(existing)[0] ?? existing.google;
  const clientId = await promptOptional(rl, "Google Client ID", primary?.clientId);
  const clientSecret = await promptOptional(rl, "Google Client Secret", primary?.clientSecret);

  if (!clientId || !clientSecret) {
    skip("Skipped — need Client ID and Secret");
    return;
  }

  const redirectUri = GOOGLE_OAUTH_REDIRECT_URI;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",
  });
  printGoogleSignInTroubleshooting(ownerEmail);
  console.log("\n  Open this URL in your browser:");
  console.log(`  ${authUrl}\n`);
  const code = await prompt(rl, "  ? Paste the authorization code (Enter to skip re-auth): ");
  if (!code.trim()) {
    if (primary?.accessToken) {
      mergeCosConfig({ google: { clientId, clientSecret, redirectUri } });
      ok("Google client credentials updated (existing tokens kept)");
    } else {
      skip("No code — tokens unchanged");
    }
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    const googleConfig: NonNullable<CosConfig["google"]> = {
      clientId,
      clientSecret,
      redirectUri,
    };
    if (tokens.access_token != null) googleConfig.accessToken = tokens.access_token;
    if (tokens.refresh_token != null) googleConfig.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date != null) googleConfig.tokenExpiry = String(tokens.expiry_date);
    mergeCosConfig({
      google: googleConfig,
      googleAccounts: [{ id: "primary", label: "Primary Google", ...googleConfig }],
    });
    ok("Google tokens saved to ~/.cos/config.json");
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ Token exchange failed:\n  ${formatGoogleOAuthFailure(raw, ownerEmail)}`);
  }
}

export async function stepMicrosoft(rl: SetupRl): Promise<void> {
  console.log("\n[Microsoft 365] Calendar + Mail [optional].");
  const wantMs = await prompt(rl, "  ? Connect or update Microsoft 365? [y/N]: ");
  if (wantMs.trim().toLowerCase() !== "y") {
    skip("Microsoft 365 unchanged");
    return;
  }
  const msClientId = await prompt(rl, "  ? Azure AD Application (client) ID: ");
  const msClientSecret = await prompt(rl, "  ? Azure AD Client Secret: ");
  const msTenantId = (await prompt(rl, "  ? Azure AD Tenant ID [common]: ")).trim() || "common";
  const msLabel = (await prompt(rl, "  ? Account label [Work Microsoft]: ")).trim() || "Work Microsoft";
  if (!msClientId.trim() || !msClientSecret.trim()) {
    skip("Provide both Client ID and Secret");
    return;
  }
  const redirectUri = "urn:ietf:wg:oauth:2.0:oob";
  const authUrl = buildMicrosoftAuthUrl(msClientId.trim(), msTenantId, redirectUri);
  console.log(`\n  Open: ${authUrl}\n`);
  const msCode = await prompt(rl, "  ? Authorization code: ");
  if (!msCode.trim()) {
    skip("Skipped token exchange");
    return;
  }
  try {
    const tokens = await exchangeMicrosoftAuthCode(
      msClientId.trim(),
      msClientSecret.trim(),
      msTenantId,
      redirectUri,
      msCode.trim()
    );
    const { addMicrosoftAccount } = await import("../config/credentials.js");
    addMicrosoftAccount({
      id: "primary-ms",
      label: msLabel,
      clientId: msClientId.trim(),
      clientSecret: msClientSecret.trim(),
      tenantId: msTenantId,
      accessToken: tokens.accessToken,
      tokenExpiry: tokens.tokenExpiry,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    });
    ok("Microsoft 365 account saved");
  } catch (err) {
    console.error(`  ❌ Microsoft auth failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stepAsana(rl: SetupRl): Promise<void> {
  console.log("\n[Asana] Tasks and projects for ingest / RAG.");
  console.log("  Get a PAT at: https://app.asana.com/0/my-apps");
  const existing = readCosConfig().asana?.pat;
  const asanaPat = await promptOptional(rl, "Asana Personal Access Token", existing);
  if (asanaPat) {
    mergeCosConfig({ asana: { pat: asanaPat } });
    ok("Asana PAT saved");
  } else {
    skip("No PAT provided — existing Asana config unchanged");
  }
}

export async function stepLlmProvider(rl: SetupRl): Promise<void> {
  console.log("\n[AI provider] LLM + embeddings via Vercel AI SDK.");
  const existing = readCosConfig().llm;
  if (existing?.provider) {
    console.log(`  Current: ${existing.provider}${existing.llmModel ? ` (${existing.llmModel})` : ""}`);
  }
  console.log("    1. Amazon Bedrock");
  console.log("    2. OpenAI");
  console.log("    3. Anthropic + OpenAI embeddings");
  console.log("    [Enter] Keep current / skip\n");

  const providerChoice = await prompt(rl, "  ? Provider [1/2/3]: ");
  if (!providerChoice.trim()) {
    skip("AI provider unchanged");
    return;
  }

  const llmBase = () => ({ ...readCosConfig().llm }) as NonNullable<CosConfig["llm"]>;

  if (providerChoice.trim() === "2") {
    const apiKey = await prompt(rl, "  ? OpenAI API key: ");
    const llmModel = (await prompt(rl, `  ? LLM model [${DEFAULT_OPENAI_LLM}]: `)).trim() || DEFAULT_OPENAI_LLM;
    const embedModel =
      (await prompt(rl, `  ? Embedding model [${DEFAULT_OPENAI_EMBED}]: `)).trim() ||
      DEFAULT_OPENAI_EMBED;
    if (apiKey.trim()) {
      mergeCosConfig({
        llm: { ...llmBase(), provider: "openai", apiKey: apiKey.trim(), llmModel, embedModel },
      });
      ok(`OpenAI configured (${llmModel})`);
    }
    return;
  }

  if (providerChoice.trim() === "3") {
    const anthropicKey = await prompt(rl, "  ? Anthropic API key: ");
    const llmModel =
      (await prompt(rl, `  ? Claude model [${DEFAULT_ANTHROPIC_LLM}]: `)).trim() ||
      DEFAULT_ANTHROPIC_LLM;
    const openaiKey = await prompt(rl, "  ? OpenAI API key (embeddings): ");
    const embedModel =
      (await prompt(rl, `  ? Embedding model [${DEFAULT_OPENAI_EMBED}]: `)).trim() ||
      DEFAULT_OPENAI_EMBED;
    if (anthropicKey.trim() && openaiKey.trim()) {
      mergeCosConfig({
        llm: {
          ...llmBase(),
          provider: "anthropic",
          apiKey: anthropicKey.trim(),
          llmModel,
          embedProvider: "openai",
          embedApiKey: openaiKey.trim(),
          embedModel,
        },
      });
      ok("Anthropic + OpenAI embeddings configured");
    }
    return;
  }

  // Bedrock
  const base = llmBase();
  const models = {
    llmModel: base.llmModel ?? DEFAULT_BEDROCK_LLM,
    embedModel: base.embedModel ?? DEFAULT_BEDROCK_EMBED,
  };

  const preferredProfiles = ["cos-default", base.awsSsoProfile].filter(
    (n): n is string => Boolean(n?.trim()),
  );
  const precheck = precheckAwsConfig({ preferredProfiles, dedupe: true });
  printAwsConfigPrecheck(precheck);

  const existingSso = precheck.recommendedProfile;
  if (existingSso) {
    const workloadRegion = existingSso.region ?? base.awsRegion ?? "us-east-1";
    applyBedrockSsoToCosConfig(existingSso.profileName, workloadRegion, base, models);
    ok(
      `Bedrock SSO — reusing profile "${existingSso.profileName}" (${workloadRegion}); no ~/.aws/config changes`,
    );
    console.log(`  Run: aws sso login --profile ${existingSso.profileName}`);
    return;
  }

  console.log("\n  a. AWS SSO  |  b. Access keys\n");
  const credMethod = await prompt(rl, "  ? Credential method [a/b]: ");

  if (credMethod.trim().toLowerCase() === "b") {
    const keyId = await promptOptional(rl, "AWS Access Key ID", base.awsAccessKeyId);
    const keySecret = await promptOptional(rl, "AWS Secret Access Key", base.awsSecretAccessKey);
    const region = (await prompt(rl, `  ? AWS Region [${base.awsRegion ?? "us-east-2"}]: `)).trim() || base.awsRegion || "us-east-2";
    if (keyId && keySecret) {
      mergeCosConfig({
        llm: {
          ...base,
          provider: "bedrock",
          auth: "keys",
          awsAccessKeyId: keyId,
          awsSecretAccessKey: keySecret,
          awsRegion: region,
          ...models,
        },
      });
      ok(`Bedrock (keys) — region ${region}`);
    }
    return;
  }

  if (!precheck.awsCliAvailable) {
    skip("Install AWS CLI v2, then re-run setup to add SSO profiles safely");
    return;
  }

  const ssoSession =
    (await prompt(rl, "  ? sso-session name [aws-toptal-lab]: ")).trim() || "aws-toptal-lab";
  const parsed = readAwsConfigFile();
  const inferred = parsed ? inferSsoDefaultsForSession(parsed, ssoSession) : { sessionBlockExists: false };

  let ssoUrl = inferred.ssoStartUrl ?? "";
  let identityCenterRegion = inferred.identityCenterRegion ?? "eu-west-1";
  let accountId = inferred.accountId ?? "";
  let roleName = inferred.roleName ?? "";

  if (inferred.sessionBlockExists) {
    console.log(`\n  Reusing [sso-session ${ssoSession}] from ~/.aws/config.`);
  } else {
    console.log(
      "\n  New SSO portal — two regions: (1) IAM Identity Center (sso_region),\n" +
        "      (2) workload region on [profile] (Bedrock/DynamoDB).\n"
    );
    ssoUrl = (await prompt(rl, "  ? SSO start URL: ")).trim();
    identityCenterRegion =
      (await prompt(rl, "  ? IAM Identity Center region (sso_region) [eu-west-1]: ")).trim() ||
      "eu-west-1";
  }

  const workloadRegion =
    (await prompt(rl, "  ? Default AWS region on profile (Bedrock/DynamoDB) [us-east-1]: ")).trim() ||
    "us-east-1";

  if (inferred.fromProfileName && accountId && roleName) {
    console.log(
      `  Account ${accountId} + role ${roleName} copied from [profile ${inferred.fromProfileName}]`,
    );
    console.log("  (AWS CLI requires these on every profile — COS only stores the profile name.)\n");
  } else {
    console.log(
      "\n  AWS account ID + role name go in ~/.aws/config only (IAM Identity Center picks account + permission set).\n"
    );
    accountId = (await prompt(rl, "  ? AWS account ID: ")).trim();
    roleName = (await prompt(rl, "  ? IAM role name: ")).trim();
  }

  const profileName = (await prompt(rl, "  ? Profile name [cos-default]: ")).trim() || "cos-default";

  if (!ssoUrl || !accountId || !roleName) {
    skip("SSO profile incomplete — need portal URL, account ID, and role name");
    return;
  }

  try {
    let sessionAction: string | null = null;
    if (!inferred.sessionBlockExists) {
      sessionAction = ensureSsoSessionViaCli(
        {
          sessionName: ssoSession,
          startUrl: ssoUrl,
          region: identityCenterRegion,
        },
        readAwsConfigFile(),
      );
      if (sessionAction !== "unchanged") {
        console.log(`  [sso-session ${ssoSession}] ${sessionAction} via aws configure sso-session`);
      }
    }

    const profileAction = ensureSsoProfileViaCli(
      {
        profileName,
        ssoSession,
        accountId,
        roleName,
        region: workloadRegion,
      },
      readAwsConfigFile(),
    );

    if (profileAction === "unchanged" && !sessionAction) {
      console.log(`  Profile "${profileName}" already matches — no aws configure changes.`);
    } else if (profileAction !== "unchanged") {
      console.log(`  Profile "${profileName}" ${profileAction} via aws configure set`);
    }

    applyBedrockSsoToCosConfig(profileName, workloadRegion, base, models);
    ok(`Bedrock SSO profile "${profileName}" ready`);
    console.log(`  Run: aws sso login --profile ${profileName}`);
  } catch (err) {
    skip(err instanceof Error ? err.message : String(err));
  }
}

export async function stepGraphStorage(rl: SetupRl): Promise<void> {
  console.log("\n[Knowledge graph] Where calendar, mail, and task nodes are stored.");
  const existing = readCosConfig().llm;
  const current =
    existing?.graphBackend === "dynamo"
      ? `DynamoDB table ${existing.dynamoTable ?? "cos-graph"}`
      : "local libSQL (~/.cos/graph.db)";
  console.log(`  Current: ${current}`);
  console.log("  1. Local libSQL (default)  2. AWS DynamoDB\n");
  const storageChoice = await prompt(rl, "  ? Change storage? [1/2, Enter=keep]: ");
  if (!storageChoice.trim()) {
    skip("Knowledge graph storage unchanged");
    return;
  }
  if (storageChoice.trim() === "2") {
    const tableName =
      (await prompt(rl, `  ? DynamoDB table name [${existing?.dynamoTable ?? "cos-graph"}]: `)).trim() ||
      existing?.dynamoTable ||
      "cos-graph";
    mergeCosConfig({
      llm: { ...(existing ?? { provider: "bedrock" }), graphBackend: "dynamo", dynamoTable: tableName },
    });
    ok(`DynamoDB configured (table: ${tableName})`);
    console.log("  Use: COS_GRAPH_BACKEND=dynamo");
  } else if (storageChoice.trim() === "1") {
    const llm = existing ?? { provider: "bedrock" as const };
    const { graphBackend: _g, dynamoTable: _t, ...rest } = llm;
    mergeCosConfig({ llm: { ...rest, graphBackend: "libsql" } });
    ok("Local libSQL — ~/.cos/graph.db");
  }
}

export async function stepRagBackend(rl: SetupRl): Promise<void> {
  console.log("\n[RAG search] Vector retrieval for query / notify / suggest.");
  const existing = readCosConfig().llm;
  const current =
    existing?.ragBackend === "opensearch"
      ? `OpenSearch (${existing.opensearchEndpoint ?? "endpoint not set"})`
      : "local hash embeddings in libSQL";
  console.log(`  Current: ${current}`);
  console.log("  1. Local vectors  2. AWS OpenSearch Serverless\n");
  const ragChoice = await prompt(rl, "  ? Change RAG backend? [1/2, Enter=keep]: ");
  if (!ragChoice.trim()) {
    skip("RAG backend unchanged");
    return;
  }
  const base = existing ?? { provider: "bedrock" as const };
  if (ragChoice.trim() === "2") {
    const defaultEp = existing?.opensearchEndpoint ?? "";
    const osEndpoint = await prompt(
      rl,
      `  ? OpenSearch collection endpoint URL${defaultEp ? ` [${defaultEp}]` : ""}: `
    );
    const endpoint = (osEndpoint.trim() || defaultEp).trim();
    if (endpoint) {
      mergeCosConfig({
        llm: { ...base, ragBackend: "opensearch", opensearchEndpoint: endpoint },
      });
      ok("OpenSearch RAG configured");
      console.log("  Use: COS_RAG_BACKEND=opensearch");
    } else {
      skip("Endpoint required");
    }
  } else if (ragChoice.trim() === "1") {
    mergeCosConfig({ llm: { ...base, ragBackend: "local" } });
    ok("Local RAG vectors (libSQL)");
  }
}

export async function stepAwsAutomation(rl: SetupRl): Promise<void> {
  console.log("\n[AWS automation] Lambda + EventBridge for scheduled notification push.");
  console.log("  Deploy with CDK: lib/cos-stack.ts (DynamoDB, OpenSearch, notification Lambda, cron rule).\n");
  const existing = readCosConfig().aws ?? {};
  const stage =
    (await prompt(rl, `  ? Stage name [${existing.stage ?? "dev"}]: `)).trim() || existing.stage || "dev";
  const region =
    (await prompt(rl, `  ? AWS region [${existing.region ?? readCosConfig().llm?.awsRegion ?? "us-east-2"}]: `)).trim() ||
    existing.region ||
    "us-east-2";
  const lambdaArn = await promptOptional(
    rl,
    "Notification-push Lambda ARN",
    existing.notificationLambdaArn
  );
  const ruleArn = await promptOptional(rl, "EventBridge rule ARN", existing.eventBridgeRuleArn);
  const ingestArn = await promptOptional(rl, "Ingest Lambda ARN (optional)", existing.ingestLambdaArn);

  mergeCosConfig({
    aws: {
      stage,
      region,
      ...(lambdaArn ? { notificationLambdaArn: lambdaArn } : {}),
      ...(ruleArn ? { eventBridgeRuleArn: ruleArn } : {}),
      ...(ingestArn ? { ingestLambdaArn: ingestArn } : {}),
    },
  });
  ok("AWS automation metadata saved");
}

/** Bedrock + DynamoDB + OpenSearch + Lambda/EventBridge in one pass. */
export async function stepAwsProductionBundle(rl: SetupRl): Promise<void> {
  console.log("\n[AWS production bundle] Bedrock, DynamoDB graph, OpenSearch RAG, automation.");
  await stepLlmProvider(rl);
  const storage = await prompt(rl, "  ? Use DynamoDB for knowledge graph? [Y/n]: ");
  if (storage.trim().toLowerCase() !== "n") {
    const tableName = (await prompt(rl, "  ? DynamoDB table name [cos-graph]: ")).trim() || "cos-graph";
    const existing = readCosConfig().llm ?? { provider: "bedrock" as const };
    mergeCosConfig({
      llm: { ...existing, graphBackend: "dynamo", dynamoTable: tableName },
    });
    ok(`DynamoDB: ${tableName}`);
  }
  const rag = await prompt(rl, "  ? Use OpenSearch for RAG? [Y/n]: ");
  if (rag.trim().toLowerCase() !== "n") {
    const ep = await prompt(rl, "  ? OpenSearch collection endpoint URL: ");
    if (ep.trim()) {
      const existing = readCosConfig().llm ?? { provider: "bedrock" as const };
      mergeCosConfig({
        llm: { ...existing, ragBackend: "opensearch", opensearchEndpoint: ep.trim() },
      });
      ok("OpenSearch RAG configured");
    }
  }
  await stepAwsAutomation(rl);
}

export async function stepTelegram(rl: SetupRl): Promise<void> {
  console.log("\n[Telegram] Push notifications (console always on).");
  const existing = readCosConfig();
  console.log("  1. @BotFather → /newbot → copy bot token");
  console.log("  2. @BotFather → /mybots → your bot → Bot settings → Group privacy → Disable");
  console.log("  3. Open your bot in Telegram → send /start (activates the bot)");
  console.log("  4. Only then, in a browser — prefix token with bot (no space):");
  console.log("     https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates");
  console.log("  5. Chat ID = result[0].message.chat.id from the JSON");
  console.log("  If result is []: /start again, refresh URL; see DEPLOYMENT.md.\n");
  const botToken = await promptOptional(rl, "Bot token", existing.telegram?.botToken);
  if (!botToken) {
    skip("Telegram unchanged");
    return;
  }
  const chatId = await promptOptional(rl, "Chat ID", existing.telegram?.chatId);
  if (!chatId) {
    skip("Chat ID required");
    return;
  }
  mergeCosConfig({
    telegram: { botToken, chatId },
    notifications: { channels: ["console", "telegram"] },
  });
  ok("Telegram configured");
}

export async function stepVerify(rl: SetupRl): Promise<void> {
  const { summarizeCosConfig } = await import("../config/credentials.js");
  console.log("\n[Verify] Configuration status:\n");
  for (const s of summarizeCosConfig()) {
    console.log(`  ${s.configured ? "✅" : "⚠️ "} ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
  }
  console.log();
  const config = readCosConfig();
  const googleOk = listGoogleAccounts(config).some((a) => a.accessToken);
  const llmOk = !!(
    config.llm?.apiKey ||
    config.llm?.awsSsoProfile ||
    config.llm?.awsAccessKeyId
  );
  if (googleOk && llmOk) {
    const doIngest = await prompt(rl, "  Run sync now (pnpm ingest)? [y/N]: ");
    if (doIngest.trim().toLowerCase() === "y") {
      const { execSync } = await import("child_process");
      try {
        execSync("pnpm run ingest", { stdio: "inherit", cwd: process.cwd() });
        ok("Sync complete");
      } catch {
        skip("Sync failed — run `pnpm ingest` manually");
      }
    }
  }
}

export async function runFullWizard(rl: SetupRl): Promise<void> {
  await stepIdentity(rl);
  await stepGoogle(rl);
  const addCorp = await prompt(rl, "\n  Add second Google account? [y/N]: ");
  if (addCorp.trim().toLowerCase() === "y") {
    await stepGoogle(rl);
  }
  await stepMicrosoft(rl);
  await stepAsana(rl);
  await stepLlmProvider(rl);
  await stepGraphStorage(rl);
  await stepRagBackend(rl);
  await stepAwsAutomation(rl);
  await stepTelegram(rl);
  await stepVerify(rl);
}
