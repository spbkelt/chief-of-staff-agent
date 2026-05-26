import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  dedupeAwsConfigFile,
  findUsableSsoProfile,
  getAwsConfigPath,
  listUsableSsoProfiles,
  profileFieldsMatch,
  readAwsConfigFile,
  type ParsedAwsConfig,
} from "./aws-ini-config.js";

export type EnsureProfileResult = "unchanged" | "created" | "updated";

export interface SsoProfileSpec {
  profileName: string;
  ssoSession: string;
  accountId: string;
  roleName: string;
  region: string;
  output?: string;
}

export interface SsoSessionSpec {
  sessionName: string;
  startUrl: string;
  region: string;
  registrationScopes?: string;
}

export function isAwsCliAvailable(): boolean {
  try {
    execFileSync("aws", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function awsConfigureSet(profile: string, key: string, value: string): void {
  execFileSync("aws", ["configure", "set", key, value, "--profile", profile], {
    stdio: "pipe",
    encoding: "utf8",
  });
}

/** Non-interactive [sso-session] via AWS CLI (stdin prompts). */
export function ensureSsoSessionViaCli(
  spec: SsoSessionSpec,
  parsed?: ParsedAwsConfig | null,
): EnsureProfileResult {
  const file = parsed ?? readAwsConfigFile();
  const existing = file?.ssoSessions.get(spec.sessionName);
  if (
    existing?.["sso_start_url"]?.trim() === spec.startUrl.trim() &&
    (existing["sso_region"] ?? "").trim() === spec.region.trim()
  ) {
    return "unchanged";
  }

  const scopes = spec.registrationScopes ?? "sso:account:access";
  const input = `${spec.sessionName}\n${spec.startUrl.trim()}\n${spec.region.trim()}\n${scopes}\n`;
  const result = spawnSync("aws", ["configure", "sso-session"], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = result.stderr?.trim() || result.stdout?.trim() || "aws configure sso-session failed";
    throw new Error(err);
  }
  return existing ? "updated" : "created";
}

/** Profile keys via `aws configure set` (never raw-append ~/.aws/config). */
export function ensureSsoProfileViaCli(
  spec: SsoProfileSpec,
  parsed?: ParsedAwsConfig | null,
): EnsureProfileResult {
  const file = parsed ?? readAwsConfigFile();
  const existing = file?.profiles.get(spec.profileName);
  const expected: Record<string, string> = {
    sso_session: spec.ssoSession,
    sso_account_id: spec.accountId,
    sso_role_name: spec.roleName,
    region: spec.region,
    output: spec.output ?? "json",
  };

  if (existing && profileFieldsMatch(existing, expected)) {
    return "unchanged";
  }

  const configPath = getAwsConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const [key, value] of Object.entries(expected)) {
    awsConfigureSet(spec.profileName, key, value);
  }
  return existing ? "updated" : "created";
}

export interface AwsConfigPrecheck {
  configPath: string;
  awsCliAvailable: boolean;
  activeProfile?: string;
  duplicateSections: string[];
  deduped: boolean;
  recommendedProfile: ReturnType<typeof findUsableSsoProfile>;
  usableProfiles: ReturnType<typeof listUsableSsoProfiles>;
}

/** Audit ~/.aws/config, dedupe duplicate sections, surface active profile. */
export function precheckAwsConfig(options?: {
  preferredProfiles?: string[];
  dedupe?: boolean;
}): AwsConfigPrecheck {
  const configPath = getAwsConfigPath();
  const activeProfile = process.env["AWS_PROFILE"]?.trim() || undefined;
  const dedupe = options?.dedupe !== false;

  let duplicateSections: string[] = [];
  let deduped = false;
  if (dedupe && existsSync(configPath)) {
    const result = dedupeAwsConfigFile(configPath);
    duplicateSections = result.removed;
    deduped = result.changed;
  }

  const file = readAwsConfigFile(configPath);
  const preferred = options?.preferredProfiles ?? ["cos-default"];

  const out: AwsConfigPrecheck = {
    configPath,
    awsCliAvailable: isAwsCliAvailable(),
    duplicateSections,
    deduped,
    recommendedProfile: file ? findUsableSsoProfile(file, preferred) : null,
    usableProfiles: file ? listUsableSsoProfiles(file) : [],
  };
  if (activeProfile) out.activeProfile = activeProfile;
  return out;
}
