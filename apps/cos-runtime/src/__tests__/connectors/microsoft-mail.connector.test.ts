import { describe, it, expect } from "vitest";
import { MicrosoftMailConnector } from "../../connectors/microsoft-mail.connector.js";
import { connectorNodeId } from "../../graph/canonical-id.js";
import type { MicrosoftAccountConfig } from "../../config/credentials.js";

const OWNER_ID = "owner-hash-abc";
const CONNECTOR_ID = "msmail-test";
const ACCOUNT: MicrosoftAccountConfig = {
  id: "test-ms",
  label: "Test Microsoft Mail",
  accessToken: "tok-test",
};

const nowIso = new Date().toISOString();

const msg1: object = {
  id: "msg001",
  conversationId: "conv001",
  parentFolderId: "inbox",
  subject: "Project update",
  from: { emailAddress: { address: "alice@example.com", name: "Alice" } },
  toRecipients: [{ emailAddress: { address: "bob@example.com" } }],
  ccRecipients: [],
  receivedDateTime: "2026-05-01T10:00:00Z",
  bodyPreview: "Here is the update for the project.",
  hasAttachments: false,
};

const msg2: object = {
  id: "msg002",
  conversationId: "conv001",
  parentFolderId: "inbox",
  subject: "Re: Project update",
  from: { emailAddress: { address: "bob@example.com", name: "Bob" } },
  toRecipients: [{ emailAddress: { address: "alice@example.com" } }],
  ccRecipients: [],
  receivedDateTime: "2026-05-01T11:00:00Z",
  bodyPreview: "Looks great, thanks!",
  hasAttachments: true,
};

const msg3: object = {
  id: "msg003",
  conversationId: "conv002",
  parentFolderId: "inbox",
  subject: "Separate thread",
  from: { emailAddress: { address: "carol@example.com" } },
  toRecipients: [],
  ccRecipients: [],
  receivedDateTime: "2026-05-02T09:00:00Z",
  bodyPreview: "Different conversation.",
  hasAttachments: false,
};

function makeDeltaFetch(msgs: object[]): (url: string, headers: Record<string, string>) => Promise<Response> {
  return async () =>
    new Response(
      JSON.stringify({ value: msgs, "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=xyz" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

describe("MicrosoftMailConnector", () => {
  it("fullSync emits both EmailMessage and EmailThread nodes", async () => {
    const fetchFn = makeDeltaFetch([msg1, msg2, msg3]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const types = events.map((e) => e.eventType);
    expect(types).toContain("EmailThread");
    expect(types).toContain("EmailMessage");
  });

  it("groups messages by conversationId into threads", async () => {
    const fetchFn = makeDeltaFetch([msg1, msg2, msg3]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const threads = events.filter((e) => e.eventType === "EmailThread");
    const messages = events.filter((e) => e.eventType === "EmailMessage");

    // 2 conversations → 2 threads
    expect(threads).toHaveLength(2);
    // 3 messages total
    expect(messages).toHaveLength(3);
  });

  it("thread messageCount reflects grouped messages", async () => {
    const fetchFn = makeDeltaFetch([msg1, msg2, msg3]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const conv1Thread = events.find(
      (e) => e.eventType === "EmailThread" && e.payload["providerThreadId"] === "conv001"
    );
    expect(conv1Thread).toBeDefined();
    expect(conv1Thread!.payload["messageCount"]).toBe(2);
  });

  it("EmailMessage threadCanonicalId links to its EmailThread", async () => {
    const fetchFn = makeDeltaFetch([msg1, msg2]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const thread = events.find((e) => e.eventType === "EmailThread");
    const messages = events.filter((e) => e.eventType === "EmailMessage");

    expect(thread).toBeDefined();
    for (const m of messages) {
      expect(m.payload["threadCanonicalId"]).toBe(thread!.eventId);
    }
  });

  it("strips body for junk/deleted folder messages", async () => {
    const junkMsg: object = { ...msg1, id: "msg-junk", parentFolderId: "junkemail", bodyPreview: "SPAM content here" };
    const fetchFn = makeDeltaFetch([junkMsg]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const msgNode = events.find((e) => e.eventType === "EmailMessage");
    expect(msgNode!.payload["bodyText"]).toBe("");
  });

  it("rawHash determinism across two fullSync calls", async () => {
    const make = () => new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, makeDeltaFetch([msg1, msg2]));

    const ev1: { rawHash: string; eventId: string }[] = [];
    for await (const e of make().fullSync()) ev1.push(e);
    const ev2: { rawHash: string; eventId: string }[] = [];
    for await (const e of make().fullSync()) ev2.push(e);

    for (let i = 0; i < ev1.length; i++) {
      expect(ev1[i]!.rawHash).toBe(ev2[i]!.rawHash);
    }
  });

  it("paginates via @odata.nextLink", async () => {
    const page1 = {
      value: [msg1],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/page2",
    };
    const page2 = {
      value: [msg3],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc",
    };

    let call = 0;
    const fetchFn = async (): Promise<Response> => {
      call++;
      const body = call === 1 ? page1 : page2;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const messages = events.filter((e) => e.eventType === "EmailMessage");
    expect(messages).toHaveLength(2);

    const cursor = await connector.currentCursor();
    expect(cursor.providerCursor).toBe("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc");
  });

  it("incrementalSync uses stored delta token", async () => {
    const deltaToken = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc";
    let calledUrl = "";
    const fetchFn = async (url: string): Promise<Response> => {
      calledUrl = url;
      return new Response(JSON.stringify({ value: [msg1], "@odata.deltaLink": deltaToken }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };

    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const cursor = { connectorId: CONNECTOR_ID, lastSyncedAt: nowIso, providerCursor: deltaToken, fullSyncRequired: false };
    const events = [];
    for await (const e of connector.incrementalSync(cursor)) events.push(e);

    expect(calledUrl).toBe(deltaToken);
    expect(events.length).toBeGreaterThan(0);
  });

  it("throws ConnectorCursorError on 410", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: "DeltaTokenExpired" } }), { status: 410, headers: { "Content-Type": "application/json" } });

    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const cursor = { connectorId: CONNECTOR_ID, lastSyncedAt: nowIso, providerCursor: "https://stale-delta", fullSyncRequired: false };
    await expect(async () => {
      for await (const _ of connector.incrementalSync(cursor)) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorCursorError" });
  });

  it("throws ConnectorAuthError on 401", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: "InvalidAuthenticationToken" } }), { status: 401, headers: { "Content-Type": "application/json" } });

    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    await expect(async () => {
      for await (const _ of connector.fullSync()) { /* drain */ }
    }).rejects.toMatchObject({ name: "ConnectorAuthError" });
  });

  it("sets ownerUserId on all nodes", async () => {
    const fetchFn = makeDeltaFetch([msg1, msg2]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    for (const e of events) {
      expect(e.payload["ownerUserId"]).toBe(OWNER_ID);
    }
  });

  it("produces canonical message ID using connectorNodeId", async () => {
    const fetchFn = makeDeltaFetch([msg1]);
    const connector = new MicrosoftMailConnector(CONNECTOR_ID, OWNER_ID, ACCOUNT, undefined, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const msgEvent = events.find((e) => e.eventType === "EmailMessage");
    expect(msgEvent!.eventId).toBe(connectorNodeId(CONNECTOR_ID, "msg001"));
  });
});
