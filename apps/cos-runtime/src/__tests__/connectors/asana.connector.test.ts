import { describe, it, expect } from "vitest";
import { AsanaConnector } from "../../connectors/asana.connector.js";
import { connectorNodeId, identityId } from "../../graph/canonical-id.js";
import type { FetchFn } from "../../connectors/asana.connector.js";

const OWNER_ID = identityId("owner@example.com");
const CONNECTOR_ID = "asana-test";
const PAT = "test-pat";

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildMockFetch(responses: Map<string, unknown>): FetchFn {
  return async (url: string) => {
    const key = new URL(url).pathname;
    const match = [...responses.entries()].find(([k]) => key.includes(k));
    if (!match) return jsonResp({ data: [], next_page: null });
    return jsonResp({ data: match[1], next_page: null });
  };
}

const workspace = { gid: "ws001", name: "Prism Team", is_organization: true };
const project = { gid: "proj001", name: "Q3 Roadmap", color: "green", archived: false, due_date: null };
const task = {
  gid: "task001",
  name: "Launch feature",
  notes: "Details here",
  completed: false,
  completed_at: null,
  due_on: "2026-08-01",
  due_at: null,
  assignee: { gid: "user001", email: "alice@prismteam.ai" },
  followers: [{ gid: "user002", email: "bob@prismteam.ai" }],
  tags: [{ name: "urgent" }],
  memberships: [{ project: { gid: "proj001" } }],
  workspace: { gid: "ws001" },
};
const story = {
  gid: "story001",
  type: "comment",
  text: "Please review before EOD",
  created_at: "2026-05-20T09:00:00Z",
  created_by: { gid: "user001", email: "alice@prismteam.ai" },
};

function makeFetch(): FetchFn {
  return async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
    if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
    if (path === "/api/1.0/projects") return jsonResp({ data: [project], next_page: null });
    if (path === "/api/1.0/tasks") return jsonResp({ data: [task], next_page: null });
    if (path.startsWith("/api/1.0/tasks/") && path.endsWith("/stories"))
      return jsonResp({ data: [story], next_page: null });
    return jsonResp({ data: [], next_page: null });
  };
}

describe("AsanaConnector", () => {
  it("emits Workspace, Project, Task, Comment nodes", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const types = events.map((e) => e.eventType);
    expect(types).toContain("AsanaWorkspace");
    expect(types).toContain("AsanaProject");
    expect(types).toContain("AsanaTask");
    expect(types).toContain("AsanaComment");
  });

  it("uses canonical ID sha256(connectorId:gid) for workspace", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const ws = events.find((e) => e.eventType === "AsanaWorkspace");
    expect(ws!.eventId).toBe(connectorNodeId(CONNECTOR_ID, "ws001"));
  });

  it("sets ownerUserId on all node types", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    for (const e of events) {
      expect(e.payload["ownerUserId"]).toBe(OWNER_ID);
    }
  });

  it("maps assignee email to identityId", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const taskEvent = events.find((e) => e.eventType === "AsanaTask");
    expect(taskEvent!.payload["assigneeIdentityId"]).toBe(identityId("alice@prismteam.ai"));
  });

  it("links task to project via projectCanonicalId", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const taskEvent = events.find((e) => e.eventType === "AsanaTask");
    expect(taskEvent!.payload["projectCanonicalId"]).toBe(
      connectorNodeId(CONNECTOR_ID, "proj001")
    );
  });

  it("links comment to task via taskCanonicalId", async () => {
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const comment = events.find((e) => e.eventType === "AsanaComment");
    expect(comment!.payload["taskCanonicalId"]).toBe(connectorNodeId(CONNECTOR_ID, "task001"));
  });

  it("produces deterministic rawHash across two fullSync calls", async () => {
    const makeConnector = () => new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, makeFetch());

    const events1: typeof Array.prototype = [];
    for await (const e of makeConnector().fullSync()) events1.push(e);
    const events2: typeof Array.prototype = [];
    for await (const e of makeConnector().fullSync()) events2.push(e);

    for (let i = 0; i < (events1 as { rawHash: string }[]).length; i++) {
      expect((events1 as { rawHash: string }[])[i]!.rawHash).toBe(
        (events2 as { rawHash: string }[])[i]!.rawHash
      );
    }
  });

  it("throws ConnectorAuthError on 401", async () => {
    const failFetch: FetchFn = async () => jsonResp({ errors: [{ message: "Unauthorized" }] }, 401);
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, failFetch);
    await expect(connector.verifyAuth()).rejects.toMatchObject({ name: "ConnectorAuthError" });
  });

  it("fetches paginated tasks across multiple pages", async () => {
    const task2 = { ...task, gid: "task002", name: "Second task" };
    let page1Fetched = false;

    const paginatedFetch: FetchFn = async (url: string) => {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;
      const offset = parsedUrl.searchParams.get("offset");

      if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
      if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
      if (path === "/api/1.0/projects") return jsonResp({ data: [project], next_page: null });
      if (path === "/api/1.0/tasks") {
        if (!offset && !page1Fetched) {
          page1Fetched = true;
          return jsonResp({ data: [task], next_page: { offset: "page2-token" } });
        }
        if (offset === "page2-token") {
          return jsonResp({ data: [task2], next_page: null });
        }
      }
      if (path.includes("/stories")) return jsonResp({ data: [], next_page: null });
      return jsonResp({ data: [], next_page: null });
    };

    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, paginatedFetch);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);

    const tasks = events.filter((e) => e.eventType === "AsanaTask");
    expect(tasks.length).toBe(2);
    const gids = tasks.map((e) => (e.payload as { providerTaskGid: string }).providerTaskGid);
    expect(gids).toContain("task001");
    expect(gids).toContain("task002");
  });

  it("throws ConnectorRateLimitError on 429", async () => {
    const rateLimitFetch: FetchFn = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
      if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
      if (path === "/api/1.0/projects") return jsonResp({ data: [project], next_page: null });
      // 429 on task fetch
      if (path === "/api/1.0/tasks") {
        return new Response(JSON.stringify({ errors: [{ message: "Rate Limited" }] }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonResp({ data: [], next_page: null });
    };

    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, rateLimitFetch);
    await expect(async () => {
      for await (const _ of connector.fullSync()) { /* consume */ }
    }).rejects.toMatchObject({ name: "ConnectorRateLimitError" });
  });

  it("skips archived projects and does not fetch their tasks", async () => {
    const archivedProject = { ...project, gid: "proj-archived", name: "Old Stuff", archived: true };
    const fetchFn: FetchFn = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
      if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
      if (path === "/api/1.0/projects")
        return jsonResp({ data: [archivedProject, project], next_page: null });
      if (path === "/api/1.0/tasks") return jsonResp({ data: [task], next_page: null });
      if (path.includes("/stories")) return jsonResp({ data: [], next_page: null });
      return jsonResp({ data: [], next_page: null });
    };
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);
    // Only one project's tasks should appear (the non-archived one)
    const projects = events.filter((e) => e.eventType === "AsanaProject");
    expect(projects).toHaveLength(1);
    expect((projects[0]!.payload as { providerProjectGid: string }).providerProjectGid).toBe("proj001");
    const tasks = events.filter((e) => e.eventType === "AsanaTask");
    expect(tasks).toHaveLength(1);
  });

  it("stops ingesting tasks once MAX_TASKS_TOTAL (200) is reached", async () => {
    // Build 250 tasks across 2 projects (125 each) — expect only 200 total
    const proj2 = { gid: "proj002", name: "Project 2", color: null, archived: false, due_date: null };
    const makeTasks = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({
        ...task,
        gid: `${prefix}-task-${i}`,
        name: `Task ${i}`,
      }));

    const fetchFn: FetchFn = async (url: string) => {
      const path = new URL(url).pathname;
      const params = new URL(url).searchParams;
      if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
      if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
      if (path === "/api/1.0/projects")
        return jsonResp({ data: [project, proj2], next_page: null });
      if (path === "/api/1.0/tasks") {
        const projGid = params.get("project");
        const tasks125 = projGid === "proj001" ? makeTasks(125, "p1") : makeTasks(125, "p2");
        return jsonResp({ data: tasks125, next_page: null });
      }
      if (path.includes("/stories")) return jsonResp({ data: [], next_page: null });
      return jsonResp({ data: [], next_page: null });
    };

    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);
    const tasks = events.filter((e) => e.eventType === "AsanaTask");
    expect(tasks).toHaveLength(200);
  });

  it("skips system stories (type != comment)", async () => {
    const systemStory = { ...story, type: "system" };
    const fetchFn: FetchFn = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/1.0/users/me") return jsonResp({ data: { gid: "me" } });
      if (path === "/api/1.0/workspaces") return jsonResp({ data: [workspace], next_page: null });
      if (path === "/api/1.0/projects") return jsonResp({ data: [project], next_page: null });
      if (path === "/api/1.0/tasks") return jsonResp({ data: [task], next_page: null });
      if (path.includes("/stories")) return jsonResp({ data: [systemStory], next_page: null });
      return jsonResp({ data: [], next_page: null });
    };
    const connector = new AsanaConnector(CONNECTOR_ID, OWNER_ID, PAT, fetchFn);
    const events = [];
    for await (const e of connector.fullSync()) events.push(e);
    expect(events.filter((e) => e.eventType === "AsanaComment")).toHaveLength(0);
  });
});
