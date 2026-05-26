import { google, type Auth } from "googleapis";
import { getEnv } from "../config/env.js";
import { mergeCosConfig } from "../config/credentials.js";

type OAuth2Client = Auth.OAuth2Client;
import { ConnectorAuthError } from "../connectors/connector.interface.js";

let _cachedClient: OAuth2Client | undefined;

function persistGoogleTokens(credentials: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}): void {
  try {
    const googlePatch: NonNullable<Parameters<typeof mergeCosConfig>[0]["google"]> = {};
    if (credentials.access_token != null) googlePatch.accessToken = credentials.access_token;
    if (credentials.refresh_token != null) googlePatch.refreshToken = credentials.refresh_token;
    if (credentials.expiry_date != null) googlePatch.tokenExpiry = String(credentials.expiry_date);
    mergeCosConfig({ google: googlePatch });
  } catch {
    // persistence failure is non-fatal — tokens remain in memory for this process
  }
}

export function getGoogleAuthClient(): OAuth2Client {
  const env = getEnv();

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ConnectorAuthError(
      "google",
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required"
    );
  }

  if (!_cachedClient) {
    _cachedClient = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );
  }

  if (env.GOOGLE_ACCESS_TOKEN) {
    _cachedClient.setCredentials({
      access_token: env.GOOGLE_ACCESS_TOKEN,
      refresh_token: env.GOOGLE_REFRESH_TOKEN ?? null,
      expiry_date: env.GOOGLE_TOKEN_EXPIRY ? parseInt(env.GOOGLE_TOKEN_EXPIRY, 10) : null,
    });
  }

  return _cachedClient;
}

export async function refreshGoogleTokenIfNeeded(client: OAuth2Client): Promise<void> {
  const credentials = client.credentials;
  const fiveMinutesMs = 5 * 60 * 1000;
  const expiresAt = credentials.expiry_date;

  const needsRefresh =
    !credentials.access_token ||
    (typeof expiresAt === "number" && expiresAt < Date.now() + fiveMinutesMs);

  if (!needsRefresh) return;

  if (!credentials.refresh_token) {
    throw new ConnectorAuthError("google", "No refresh token available; re-auth required");
  }

  try {
    const { credentials: refreshed } = await client.refreshAccessToken();
    client.setCredentials(refreshed);
    persistGoogleTokens(refreshed);
  } catch (err) {
    throw new ConnectorAuthError(
      "google",
      `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function verifyGoogleToken(client: OAuth2Client): Promise<void> {
  if (!client.credentials.access_token) {
    throw new ConnectorAuthError(
      "google",
      "No access token; check .env GOOGLE_ACCESS_TOKEN"
    );
  }
  await refreshGoogleTokenIfNeeded(client);
}

export function resetGoogleAuthForTest(): void {
  _cachedClient = undefined;
}
