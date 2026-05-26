import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface AwsSsoProfileInfo {
  profileName: string;
  region?: string;
  ssoSession: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
}

export type ParsedAwsConfig = {
  profiles: Map<string, Record<string, string>>;
  ssoSessions: Map<string, Record<string, string>>;
};

export type ParseAwsConfigResult = ParsedAwsConfig & {
  /** Section headers seen more than once (first block kept). */
  duplicateSections: string[];
};

export function getAwsConfigPath(): string {
  return join(homedir(), ".aws", "config");
}

/** Minimal INI parser for ~/.aws/config ([profile …] and [sso-session …]). First block wins on duplicates. */
export function parseAwsConfigIni(content: string): ParseAwsConfigResult {
  const profiles = new Map<string, Record<string, string>>();
  const ssoSessions = new Map<string, Record<string, string>>();
  const duplicateSections: string[] = [];
  let section: { kind: "profile" | "sso-session"; name: string } | null = null;
  let data: Record<string, string> = {};

  const flush = (): void => {
    if (!section) return;
    const target = section.kind === "profile" ? profiles : ssoSessions;
    const label = `${section.kind}:${section.name}`;
    if (target.has(section.name)) {
      duplicateSections.push(label);
      section = null;
      data = {};
      return;
    }
    target.set(section.name, data);
    section = null;
    data = {};
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      flush();
      const header = sectionMatch[1] ?? "";
      if (header.startsWith("profile ")) {
        section = { kind: "profile", name: header.slice("profile ".length).trim() };
      } else if (header.startsWith("sso-session ")) {
        section = { kind: "sso-session", name: header.slice("sso-session ".length).trim() };
      } else {
        section = null;
      }
      continue;
    }
    if (!section) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    data[key] = value;
  }
  flush();
  return { profiles, ssoSessions, duplicateSections };
}

export function serializeAwsConfig(parsed: ParsedAwsConfig): string {
  const lines: string[] = [];
  for (const [name, data] of parsed.ssoSessions) {
    lines.push(`[sso-session ${name}]`);
    for (const [key, value] of Object.entries(data)) {
      lines.push(`${key} = ${value}`);
    }
    lines.push("");
  }
  for (const [name, data] of parsed.profiles) {
    lines.push(`[profile ${name}]`);
    for (const [key, value] of Object.entries(data)) {
      lines.push(`${key} = ${value}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function readAwsConfigFile(configPath?: string): ParseAwsConfigResult | null {
  const path = configPath ?? getAwsConfigPath();
  if (!existsSync(path)) return null;
  try {
    return parseAwsConfigIni(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Rewrite ~/.aws/config keeping first occurrence of each section (fixes duplicate blocks). */
export function dedupeAwsConfigFile(configPath?: string): {
  path: string;
  removed: string[];
  changed: boolean;
} {
  const path = configPath ?? getAwsConfigPath();
  if (!existsSync(path)) {
    return { path, removed: [], changed: false };
  }
  const parsed = parseAwsConfigIni(readFileSync(path, "utf8"));
  if (parsed.duplicateSections.length === 0) {
    return { path, removed: [], changed: false };
  }
  const backupPath = `${path}.cos-backup`;
  writeFileSync(backupPath, readFileSync(path, "utf8"), "utf8");
  writeFileSync(path, serializeAwsConfig(parsed), "utf8");
  return { path, removed: parsed.duplicateSections, changed: true };
}

export function isUsableSsoProfile(
  profileName: string,
  profile: Record<string, string>,
  ssoSessions: Map<string, Record<string, string>>,
): boolean {
  const sessionName = profile["sso_session"];
  if (!sessionName) return false;
  const session = ssoSessions.get(sessionName);
  if (!session?.["sso_start_url"]?.trim()) return false;
  if (!profile["sso_account_id"]?.trim() || !profile["sso_role_name"]?.trim()) return false;
  return true;
}

export function profileToSsoInfo(
  profileName: string,
  profile: Record<string, string>,
): AwsSsoProfileInfo {
  const info: AwsSsoProfileInfo = {
    profileName,
    ssoSession: profile["sso_session"] ?? "",
  };
  const region = profile["region"];
  if (region) info.region = region;
  const ssoAccountId = profile["sso_account_id"];
  if (ssoAccountId) info.ssoAccountId = ssoAccountId;
  const ssoRoleName = profile["sso_role_name"];
  if (ssoRoleName) info.ssoRoleName = ssoRoleName;
  return info;
}

export function findUsableSsoProfile(
  parsed: ParsedAwsConfig,
  preferredNames: string[],
): AwsSsoProfileInfo | null {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const name of preferredNames) {
    if (name && !seen.has(name)) {
      seen.add(name);
      candidates.push(name);
    }
  }
  for (const name of parsed.profiles.keys()) {
    if (!seen.has(name)) {
      seen.add(name);
      candidates.push(name);
    }
  }

  for (const profileName of candidates) {
    const profile = parsed.profiles.get(profileName);
    if (!profile) continue;
    if (!isUsableSsoProfile(profileName, profile, parsed.ssoSessions)) continue;
    return profileToSsoInfo(profileName, profile);
  }
  return null;
}

/** @deprecated Use readAwsConfigFile — returns parsed maps only. */
export function readAwsConfigFromDisk(configPath?: string): ParsedAwsConfig | null {
  const result = readAwsConfigFile(configPath);
  if (!result) return null;
  return { profiles: result.profiles, ssoSessions: result.ssoSessions };
}

export function resolveExistingSsoProfile(
  preferredNames: string[] = [],
  configPath?: string,
): AwsSsoProfileInfo | null {
  const parsed = readAwsConfigFile(configPath);
  if (!parsed) return null;
  return findUsableSsoProfile(parsed, preferredNames);
}

export function listUsableSsoProfiles(parsed: ParsedAwsConfig): AwsSsoProfileInfo[] {
  const out: AwsSsoProfileInfo[] = [];
  for (const profileName of parsed.profiles.keys()) {
    const profile = parsed.profiles.get(profileName);
    if (!profile) continue;
    if (!isUsableSsoProfile(profileName, profile, parsed.ssoSessions)) continue;
    out.push(profileToSsoInfo(profileName, profile));
  }
  return out;
}

export function profileFieldsMatch(
  profile: Record<string, string>,
  expected: Record<string, string>,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if ((profile[key] ?? "").trim() !== value.trim()) return false;
  }
  return true;
}

export function findProfileForSsoSession(
  parsed: ParsedAwsConfig,
  ssoSessionName: string,
): { profileName: string; profile: Record<string, string> } | null {
  for (const [profileName, profile] of parsed.profiles) {
    if (profile["sso_session"] === ssoSessionName) {
      return { profileName, profile };
    }
  }
  return null;
}

export interface SsoSessionDefaults {
  ssoStartUrl: string;
  identityCenterRegion: string;
  accountId: string;
  roleName: string;
  fromProfileName?: string;
}

export function inferSsoDefaultsForSession(
  parsed: ParsedAwsConfig,
  ssoSessionName: string,
): Partial<SsoSessionDefaults> & { sessionBlockExists: boolean } {
  const session = parsed.ssoSessions.get(ssoSessionName);
  const sibling = findProfileForSsoSession(parsed, ssoSessionName);
  const sessionBlockExists = Boolean(session?.["sso_start_url"]?.trim());
  const out: Partial<SsoSessionDefaults> & { sessionBlockExists: boolean } = {
    sessionBlockExists,
  };
  if (session?.["sso_start_url"]) out.ssoStartUrl = session["sso_start_url"];
  if (session?.["sso_region"]) out.identityCenterRegion = session["sso_region"];
  if (sibling?.profile["sso_account_id"]) out.accountId = sibling.profile["sso_account_id"];
  if (sibling?.profile["sso_role_name"]) out.roleName = sibling.profile["sso_role_name"];
  if (sibling) out.fromProfileName = sibling.profileName;
  return out;
}
