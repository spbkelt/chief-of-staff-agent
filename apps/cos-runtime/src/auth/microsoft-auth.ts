import {
  type MicrosoftAccountConfig,
  readCosConfig,
  addMicrosoftAccount,
} from "../config/credentials.js";
import { ConnectorAuthError } from "../connectors/connector.interface.js";

const FIVE_MIN_MS = 5 * 60 * 1000;
const TOKEN_ENDPOINT_BASE = "https://login.microsoftonline.com";
const MS_GRAPH_SCOPES = "Calendars.Read Mail.Read User.Read offline_access";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export function getMicrosoftAuthHeaders(account: MicrosoftAccountConfig): Record<string, string> {
  if (!account.accessToken) {
    throw new ConnectorAuthError(account.id, `Microsoft account "${account.label}" has no access token`);
  }
  return { Authorization: `Bearer ${account.accessToken}` };
}

export async function refreshMicrosoftTokenIfNeeded(
  account: MicrosoftAccountConfig
): Promise<MicrosoftAccountConfig> {
  if (!account.accessToken) {
    throw new ConnectorAuthError(account.id, `Microsoft account "${account.label}" missing access token — re-run setup`);
  }

  const expiresAt = account.tokenExpiry ? parseInt(account.tokenExpiry, 10) : 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + FIVE_MIN_MS;
  if (!needsRefresh) return account;

  if (!account.refreshToken) {
    throw new ConnectorAuthError(account.id, `Microsoft account "${account.label}" has no refresh token — re-run setup`);
  }

  const tenantId = account.tenantId ?? "common";
  const tokenUrl = `${TOKEN_ENDPOINT_BASE}/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    scope: MS_GRAPH_SCOPES,
    ...(account.clientId ? { client_id: account.clientId } : {}),
    ...(account.clientSecret ? { client_secret: account.clientSecret } : {}),
  });

  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new ConnectorAuthError(
      account.id,
      `Microsoft token refresh network error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ConnectorAuthError(account.id, `Microsoft token refresh failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as TokenResponse;
  const updated: MicrosoftAccountConfig = {
    id: account.id,
    label: account.label,
    accessToken: data.access_token,
    tokenExpiry: String(Date.now() + data.expires_in * 1000),
  };
  if (account.clientId) updated.clientId = account.clientId;
  if (account.clientSecret) updated.clientSecret = account.clientSecret;
  if (account.tenantId) updated.tenantId = account.tenantId;
  if (data.refresh_token) updated.refreshToken = data.refresh_token;

  // Persist back to config
  try {
    addMicrosoftAccount(updated);
  } catch {
    // non-fatal — continue with in-memory token
  }

  return updated;
}

/** Build the OAuth2 authorization URL for initial setup. */
export function buildMicrosoftAuthUrl(clientId: string, tenantId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: MS_GRAPH_SCOPES,
    response_mode: "query",
  });
  return `${TOKEN_ENDPOINT_BASE}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Exchange authorization code for tokens. */
export async function exchangeMicrosoftAuthCode(
  clientId: string,
  clientSecret: string,
  tenantId: string,
  redirectUri: string,
  code: string
): Promise<{ accessToken: string; refreshToken?: string; tokenExpiry: string }> {
  const tokenUrl = `${TOKEN_ENDPOINT_BASE}/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    scope: MS_GRAPH_SCOPES,
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Microsoft auth code exchange failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as TokenResponse;
  const result: { accessToken: string; refreshToken?: string; tokenExpiry: string } = {
    accessToken: data.access_token,
    tokenExpiry: String(Date.now() + data.expires_in * 1000),
  };
  if (data.refresh_token) result.refreshToken = data.refresh_token;
  return result;
}
