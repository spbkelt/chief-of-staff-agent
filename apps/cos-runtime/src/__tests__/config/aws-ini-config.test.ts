import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  dedupeAwsConfigFile,
  findUsableSsoProfile,
  inferSsoDefaultsForSession,
  parseAwsConfigIni,
  profileFieldsMatch,
  resolveExistingSsoProfile,
  serializeAwsConfig,
} from "../../config/aws-ini-config.js";

const SAMPLE = `
[profile AdministratorAccess-998765338360]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = eu-west-1
output = json
[sso-session aws-toptal-lab]
sso_start_url = https://d-93679b56d3.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[profile cos-default]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = us-east-1
output = json
`;

const DUPLICATE_TAIL = `
[sso-session aws-toptal-lab]
sso_start_url = https://duplicate.example/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[profile cos-default]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = us-east-1
output = json
`;

describe("parseAwsConfigIni", () => {
  it("finds cos-default when preferred", () => {
    const parsed = parseAwsConfigIni(SAMPLE);
    const info = findUsableSsoProfile(parsed, ["cos-default"]);
    expect(info).toEqual({
      profileName: "cos-default",
      region: "us-east-1",
      ssoSession: "aws-toptal-lab",
      ssoAccountId: "998765338360",
      ssoRoleName: "AdministratorAccess",
    });
  });

  it("keeps first block when duplicate sections exist", () => {
    const parsed = parseAwsConfigIni(SAMPLE + DUPLICATE_TAIL);
    expect(parsed.duplicateSections).toEqual(["sso-session:aws-toptal-lab", "profile:cos-default"]);
    expect(parsed.ssoSessions.get("aws-toptal-lab")?.sso_start_url).toBe(
      "https://d-93679b56d3.awsapps.com/start",
    );
  });

  it("infers account and role from sibling profile on same sso-session", () => {
    const parsed = parseAwsConfigIni(SAMPLE);
    const inferred = inferSsoDefaultsForSession(parsed, "aws-toptal-lab");
    expect(inferred.sessionBlockExists).toBe(true);
    expect(inferred.accountId).toBe("998765338360");
    expect(inferred.roleName).toBe("AdministratorAccess");
    expect(inferred.fromProfileName).toBeTruthy();
  });

  it("skips profiles without linked sso-session", () => {
    const parsed = parseAwsConfigIni(`
[profile orphan]
sso_session = missing
sso_account_id = 1
sso_role_name = Admin
`);
    expect(findUsableSsoProfile(parsed, ["orphan"])).toBeNull();
  });
});

describe("dedupeAwsConfigFile", () => {
  it("writes canonical file without duplicate sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "cos-aws-config-"));
    const path = join(dir, "config");
    writeFileSync(path, SAMPLE + DUPLICATE_TAIL, "utf8");
    const result = dedupeAwsConfigFile(path);
    expect(result.changed).toBe(true);
    expect(result.removed.length).toBe(2);
    const after = parseAwsConfigIni(readFileSync(path, "utf8"));
    expect(after.duplicateSections).toEqual([]);
    expect(after.ssoSessions.get("aws-toptal-lab")?.sso_start_url).toBe(
      "https://d-93679b56d3.awsapps.com/start",
    );
    const roundTrip = serializeAwsConfig(after);
    expect(parseAwsConfigIni(roundTrip).duplicateSections).toEqual([]);
  });
});

describe("profileFieldsMatch", () => {
  it("compares trimmed profile keys", () => {
    expect(
      profileFieldsMatch(
        { region: "us-east-1", output: "json" },
        { region: "us-east-1", output: "json" },
      ),
    ).toBe(true);
  });
});

describe("resolveExistingSsoProfile", () => {
  it("returns null when config file missing", () => {
    expect(resolveExistingSsoProfile(["cos-default"], "/nonexistent/aws/config")).toBeNull();
  });
});
