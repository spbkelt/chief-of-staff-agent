/**
 * Google Cloud OAuth checklist for the setup wizard (Calendar + Gmail, desktop/OOB flow).
 */

export const GOOGLE_OAUTH_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

const CONSOLE = "https://console.cloud.google.com";
const APIS_LIBRARY = `${CONSOLE}/apis/library`;
const AUTH_AUDIENCE = `${CONSOLE}/auth/audience`;
const AUTH_CLIENTS = `${CONSOLE}/auth/clients`;

export function printGoogleCloudSetupGuide(ownerEmail?: string): void {
  const email = ownerEmail?.trim();
  const testUserLine = email
    ? `     Add this exact Google account: ${email}`
    : "     Add the same Gmail you will sign in with below";

  console.log(`
  Complete these in Google Cloud (project: any name, e.g. "My First Project"):

  Substep A — OAuth consent screen
  ────────────────────────────────
  1. Open: ${CONSOLE}/apis/credentials (or Google Auth Platform → Branding)
  2. Configure consent screen if prompted (yellow banner)
  3. User type: External
  4. App name: BigBoss COS (or your choice) + support/developer emails
  5. Scopes → Add:
       • Google Calendar API → .../auth/calendar.readonly
       • Gmail API           → .../auth/gmail.readonly
  6. Save

  Substep B — Enable APIs
  ───────────────────────
  1. ${APIS_LIBRARY}
  2. Enable "Google Calendar API" and "Gmail API"

  Substep C — Create OAuth client (Client ID + Secret)
  ───────────────────────────────────────────────────
  1. Credentials → + Create credentials → OAuth client ID
  2. Application type: Desktop app (recommended)
     (If only "Web application" is available, add redirect URI below.)
  3. Name: e.g. BigBoss local → Create
  4. Copy Client ID and Client secret (you will paste them next)

  Web application only — Authorized redirect URIs must include:
     ${GOOGLE_OAUTH_REDIRECT_URI}

  Substep D — Test users (REQUIRED while app is in Testing)
  ─────────────────────────────────────────────────────────
  While Publishing status = Testing, only listed test users can sign in.
  If you skip this, Google shows: "Access blocked" / Error 403: access_denied

  1. Google Auth Platform → Audience (or OAuth consent screen → Test users)
  2. + Add users
  ${testUserLine}
  3. Save — wait ~1 minute, then continue sign-in

  Quick links:
    Audience (test users): ${AUTH_AUDIENCE}
    OAuth clients:       ${AUTH_CLIENTS}
`);
}

export function printGoogleSignInTroubleshooting(ownerEmail?: string): void {
  const email = ownerEmail?.trim();
  console.log(`
  Sign-in tips:
  • Use the same Google account you added as a Test user${email ? ` (${email})` : ""}.
  • "Google hasn't verified this app" → Advanced → Go to BigBoss COS (unsafe) — normal in Testing.
  • Still blocked (403 access_denied)? → Audience → + Add users → save → try the URL again.
  • Do not click "Publish app" unless you intend to complete Google verification.
`);
}

export function formatGoogleOAuthFailure(message: string, ownerEmail?: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("access_denied") || lower.includes("403")) {
    return [
      "Google returned access_denied (app in Testing mode).",
      "Fix: Google Cloud → Auth Platform → Audience → Test users → + Add users",
      ownerEmail?.trim()
        ? `     → add: ${ownerEmail.trim()}`
        : "     → add the Gmail you use to sign in",
      "Save, wait ~1 minute, then open the auth URL again.",
    ].join("\n  ");
  }
  if (lower.includes("redirect_uri_mismatch")) {
    return [
      "Redirect URI mismatch.",
      `Fix: OAuth client → Authorized redirect URIs → add: ${GOOGLE_OAUTH_REDIRECT_URI}`,
      "Or recreate the client as Application type: Desktop app.",
    ].join("\n  ");
  }
  return message;
}
