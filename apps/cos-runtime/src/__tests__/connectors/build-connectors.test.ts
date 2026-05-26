import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config/credentials.js", () => ({
  listGoogleAccounts: () => [
    {
      id: "primary",
      label: "Primary",
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "at",
      refreshToken: "rt",
    },
  ],
  listMicrosoftAccounts: () => [],
}));

vi.mock("../../auth/google-auth-account.js", () => ({
  createGoogleAuthClientForAccount: vi.fn(() => ({})),
  refreshGoogleAccountTokenIfNeeded: vi.fn(async () => undefined),
}));

describe("buildRealConnectors", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env["ASANA_PAT"];
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("skips Asana when PAT is not configured", async () => {
    const { buildRealConnectors } = await import("../../connectors/build-connectors.js");
    const connectors = await buildRealConnectors({
      ownerUserId: "owner-hash",
      ownerEmail: "owner@example.com",
    });
    const ids = connectors.map((c) => c.config.connectorId);
    expect(ids.some((id) => id.startsWith("gcal"))).toBe(true);
    expect(ids.some((id) => id.startsWith("gmail"))).toBe(true);
    expect(ids.some((id) => id.startsWith("asana"))).toBe(false);
  });
});
