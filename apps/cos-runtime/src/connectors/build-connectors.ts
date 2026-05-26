import type { Connector } from "./connector.interface.js";
import { GoogleCalendarConnector } from "./google-calendar.connector.js";
import { GmailConnector } from "./gmail.connector.js";
import { AsanaConnector } from "./asana.connector.js";
import { MicrosoftCalendarConnector } from "./microsoft-calendar.connector.js";
import { MicrosoftMailConnector } from "./microsoft-mail.connector.js";
import {
  MockCalendarConnector,
  MockGmailConnector,
  MockAsanaConnector,
} from "./mock.connector.js";
import { listGoogleAccounts, listMicrosoftAccounts } from "../config/credentials.js";
import {
  createGoogleAuthClientForAccount,
  refreshGoogleAccountTokenIfNeeded,
} from "../auth/google-auth-account.js";
import { refreshMicrosoftTokenIfNeeded } from "../auth/microsoft-auth.js";
import { getEnv } from "../config/env.js";
import { allowsFixtures } from "../config/env.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

export interface BuildConnectorsOptions {
  ownerUserId: string;
  ownerEmail: string;
  connectorFilter?: string;
  ingestWindow?: IngestWindow;
}

function matchesMsCal(f: string): boolean {
  return f.startsWith("mscal") || f.startsWith("microsoft-calendar");
}

function matchesMsMail(f: string): boolean {
  return f.startsWith("msmail") || f.startsWith("microsoft-mail");
}

export async function buildRealConnectors(opts: BuildConnectorsOptions): Promise<Connector[]> {
  const env = getEnv();
  const { ownerUserId, ownerEmail, connectorFilter } = opts;
  const ingestWindow = opts.ingestWindow ?? DEFAULT_INGEST_WINDOW;

  const wantsGcal = !connectorFilter || connectorFilter.startsWith("gcal");
  const wantsGmail = !connectorFilter || connectorFilter.startsWith("gmail");
  const wantsAsana = !connectorFilter || connectorFilter === "asana";
  const wantsMsCal = !connectorFilter || matchesMsCal(connectorFilter);
  const wantsMsMail = !connectorFilter || matchesMsMail(connectorFilter);

  const accounts = listGoogleAccounts();
  const connectors: Connector[] = [];

  if (wantsGcal || wantsGmail) {
    if (accounts.length === 0 && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_ACCESS_TOKEN)) {
      throw new Error(
        "Google credentials missing. Connect accounts via setup (writes ~/.cos/config.json)."
      );
    }

    for (const account of accounts) {
      const auth = createGoogleAuthClientForAccount(account);
      await refreshGoogleAccountTokenIfNeeded(account, auth);

      if (wantsGcal && (!connectorFilter || connectorFilter === `gcal-${account.id}` || connectorFilter === "gcal")) {
        connectors.push(new GoogleCalendarConnector(`gcal-${account.id}`, ownerUserId, auth, undefined, ingestWindow));
      }
      if (wantsGmail && (!connectorFilter || connectorFilter === `gmail-${account.id}` || connectorFilter === "gmail")) {
        connectors.push(new GmailConnector(`gmail-${account.id}`, ownerUserId, ownerEmail, auth, undefined, ingestWindow));
      }
    }

    if (accounts.length === 0 && env.GOOGLE_CLIENT_ID && env.GOOGLE_ACCESS_TOKEN) {
      if (wantsGcal && (!connectorFilter || connectorFilter === "gcal")) {
        connectors.push(new GoogleCalendarConnector("gcal", ownerUserId, undefined, undefined, ingestWindow));
      }
      if (wantsGmail && (!connectorFilter || connectorFilter === "gmail")) {
        connectors.push(new GmailConnector("gmail", ownerUserId, ownerEmail, undefined, undefined, ingestWindow));
      }
    }
  }

  // Asana is optional — skip silently when PAT not configured (same as Microsoft)
  if (wantsAsana && env.ASANA_PAT) {
    connectors.push(new AsanaConnector("asana", ownerUserId, env.ASANA_PAT, fetch, ingestWindow));
  }

  // Microsoft Graph connectors — skip silently if no accounts configured
  if (wantsMsCal || wantsMsMail) {
    const msAccounts = listMicrosoftAccounts();
    for (const msAccount of msAccounts) {
      const refreshed = await refreshMicrosoftTokenIfNeeded(msAccount);
      if (wantsMsCal && (!connectorFilter || connectorFilter === `mscal-${msAccount.id}` || matchesMsCal(connectorFilter))) {
        connectors.push(
          new MicrosoftCalendarConnector(`mscal-${msAccount.id}`, ownerUserId, refreshed, ingestWindow)
        );
      }
      if (wantsMsMail && (!connectorFilter || connectorFilter === `msmail-${msAccount.id}` || matchesMsMail(connectorFilter))) {
        connectors.push(
          new MicrosoftMailConnector(`msmail-${msAccount.id}`, ownerUserId, refreshed, ingestWindow)
        );
      }
    }
  }

  return connectors;
}

export function buildFixtureConnectors(
  ownerUserId: string,
  connectorFilter?: string
): Connector[] {
  if (!allowsFixtures()) {
    throw new Error(
      "Fixture connectors require COS_ALLOW_FIXTURES=true (CI only). Use real ingest for product validation."
    );
  }

  const all: Connector[] = [
    new MockCalendarConnector("gcal-mock", ownerUserId),
    new MockGmailConnector("gmail-mock", ownerUserId),
    new MockAsanaConnector("asana-mock", ownerUserId),
  ];

  if (!connectorFilter) return all;
  return all.filter((c) => c.config.connectorId.startsWith(connectorFilter));
}
