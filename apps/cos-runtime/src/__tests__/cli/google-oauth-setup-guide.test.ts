import { describe, expect, it } from "vitest";
import {
  GOOGLE_OAUTH_REDIRECT_URI,
  formatGoogleOAuthFailure,
} from "../../cli/google-oauth-setup-guide.js";

describe("google-oauth-setup-guide", () => {
  it("uses OOB redirect URI for desktop wizard flow", () => {
    expect(GOOGLE_OAUTH_REDIRECT_URI).toBe("urn:ietf:wg:oauth:2.0:oob");
  });

  it("explains access_denied with test user hint", () => {
    const msg = formatGoogleOAuthFailure("Error 403: access_denied", "user@example.com");
    expect(msg).toContain("access_denied");
    expect(msg).toContain("user@example.com");
    expect(msg).toContain("Test users");
  });

  it("explains redirect_uri_mismatch", () => {
    const msg = formatGoogleOAuthFailure("redirect_uri_mismatch");
    expect(msg).toContain(GOOGLE_OAUTH_REDIRECT_URI);
  });
});
