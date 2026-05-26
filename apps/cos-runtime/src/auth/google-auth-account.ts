import { google, type Auth } from "googleapis";
import {
  type GoogleAccountConfig,
  readCosConfig,
  listGoogleAccounts,
  mergeCosConfig,
} from "../config/credentials.js";
import { ConnectorAuthError } from "../connectors/connector.interface.js";

type OAuth2Client = Auth.OAuth2Client;

function persistAccountTokens(
  accountId: string,
  credentials: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }
): void {
  try {
    const config = readCosConfig();
    const accounts = listGoogleAccounts(config).map((a) => {
      if (a.id !== accountId) return a;
      const next = { ...a };
      if (credentials.access_token != null) next.accessToken = credentials.access_token;
      if (credentials.refresh_token != null) next.refreshToken = credentials.refresh_token;
      if (credentials.expiry_date != null) next.tokenExpiry = String(credentials.expiry_date);
      return next;
    });
    mergeCosConfig({ googleAccounts: accounts });
  } catch {
    // non-fatal
  }
}

export function createGoogleAuthClientForAccount(account: GoogleAccountConfig): OAuth2Client {
  if (!account.clientId || !account.clientSecret) {
    throw new ConnectorAuthError(
      account.id,
      `Google account "${account.label}" missing clientId/clientSecret`
    );
  }

  const client = new google.auth.OAuth2(
    account.clientId,
    account.clientSecret,
    account.redirectUri ?? "urn:ietf:wg:oauth:2.0:oob"
  );

  if (account.accessToken) {
    client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken ?? null,
      expiry_date: account.tokenExpiry ? parseInt(account.tokenExpiry, 10) : null,
    });
  }

  return client;
}

export async function refreshGoogleAccountTokenIfNeeded(
  account: GoogleAccountConfig,
  client: OAuth2Client
): Promise<void> {
  const credentials = client.credentials;
  const fiveMinutesMs = 5 * 60 * 1000;
  const expiresAt = credentials.expiry_date;

  const needsRefresh =
    !credentials.access_token ||
    (typeof expiresAt === "number" && expiresAt < Date.now() + fiveMinutesMs);

  if (!needsRefresh) return;

  if (!credentials.refresh_token) {
    throw new ConnectorAuthError(account.id, "No refresh token; re-run setup for this account");
  }

  try {
    const { credentials: refreshed } = await client.refreshAccessToken();
    client.setCredentials(refreshed);
    persistAccountTokens(account.id, refreshed);
  } catch (err) {
    throw new ConnectorAuthError(
      account.id,
      `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
