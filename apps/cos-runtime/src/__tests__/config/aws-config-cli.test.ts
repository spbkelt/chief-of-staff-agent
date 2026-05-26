import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

import { execFileSync, spawnSync } from "child_process";
import { ensureSsoProfileViaCli, ensureSsoSessionViaCli } from "../../config/aws-config-cli.js";
import { parseAwsConfigIni } from "../../config/aws-ini-config.js";

describe("ensureSsoProfileViaCli", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockClear();
  });

  it("does not call aws when profile already matches", () => {
    const parsed = parseAwsConfigIni(`
[profile cos-default]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = us-east-1
output = json
[sso-session aws-toptal-lab]
sso_start_url = https://example.awsapps.com/start
sso_region = eu-west-1
`);
    const result = ensureSsoProfileViaCli(
      {
        profileName: "cos-default",
        ssoSession: "aws-toptal-lab",
        accountId: "998765338360",
        roleName: "AdministratorAccess",
        region: "us-east-1",
      },
      parsed,
    );
    expect(result).toBe("unchanged");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("calls aws configure set for each key when profile missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cos-aws-cli-"));
    const configPath = join(dir, "config");
    writeFileSync(configPath, "", "utf8");

    const parsed = parseAwsConfigIni("");
    const result = ensureSsoProfileViaCli(
      {
        profileName: "cos-default",
        ssoSession: "aws-toptal-lab",
        accountId: "998765338360",
        roleName: "AdministratorAccess",
        region: "us-east-1",
      },
      parsed,
    );
    expect(result).toBe("created");
    expect(execFileSync).toHaveBeenCalled();
  });
});

describe("ensureSsoSessionViaCli", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockClear();
  });

  it("skips aws when session block already matches", () => {
    const parsed = parseAwsConfigIni(`
[sso-session aws-toptal-lab]
sso_start_url = https://example.awsapps.com/start
sso_region = eu-west-1
`);
    const result = ensureSsoSessionViaCli(
      {
        sessionName: "aws-toptal-lab",
        startUrl: "https://example.awsapps.com/start",
        region: "eu-west-1",
      },
      parsed,
    );
    expect(result).toBe("unchanged");
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
