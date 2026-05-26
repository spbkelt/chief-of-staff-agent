import type { Connector, ConnectorConfig, SyncCursor, NormalizedEvent } from "./connector.interface.js";
import { ConnectorAuthError, ConnectorNetworkError, ConnectorRateLimitError } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";
import type {
  AsanaWorkspaceNode,
  AsanaProjectNode,
  AsanaTaskNode,
  AsanaCommentNode,
} from "../graph/schema.js";
import {
  DEFAULT_INGEST_WINDOW,
  type IngestWindow,
} from "../config/ingest-window.js";

const ASANA_BASE = "https://app.asana.com/api/1.0";
const PAGE_SIZE = 100;
const MAX_TASKS_TOTAL = 200;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface AsanaWorkspace {
  gid: string;
  name: string;
  is_organization: boolean;
}

interface AsanaProject {
  gid: string;
  name: string;
  color: string | null;
  archived: boolean;
  due_date: string | null;
}

interface AsanaTask {
  gid: string;
  name: string;
  notes: string | null;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  due_at: string | null;
  assignee: { gid: string; email?: string } | null;
  followers: Array<{ gid: string; email?: string }>;
  tags: Array<{ name: string }>;
  memberships: Array<{ project: { gid: string } }>;
  workspace: { gid: string };
}

interface AsanaStory {
  gid: string;
  type: string;
  text: string;
  created_at: string;
  created_by: { gid: string; email?: string };
}

interface AsanaPage<T> {
  data: T[];
  next_page: { offset: string } | null;
}

export class AsanaConnector implements Connector {
  readonly config: ConnectorConfig;
  private lastSyncedAt: string | undefined;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string,
    private readonly pat: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly ingestWindow: IngestWindow = DEFAULT_INGEST_WINDOW
  ) {
    this.config = {
      connectorId,
      providerId: "asana",
      accountLabel: "Asana",
      credentials: { type: "pat" },
    };
  }

  async verifyAuth(): Promise<void> {
    await this.get<{ data: { gid: string } }>("/users/me");
  }

  /** Active tasks always; completed tasks only if completed within past window. */
  private taskInIngestWindow(task: AsanaTask): boolean {
    if (!task.completed) return true;
    if (!task.completed_at) return false;
    const completedMs = new Date(task.completed_at).getTime();
    if (Number.isNaN(completedMs)) return false;
    const cutoff = Date.now() - this.ingestWindow.pastDays * 86400_000;
    return completedMs >= cutoff;
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    this.lastSyncedAt = new Date().toISOString();
    const workspaces = await this.paginate<AsanaWorkspace>("/workspaces", {
      opt_fields: "gid,name,is_organization",
    });

    let tasksTotal = 0;

    for (const ws of workspaces) {
      yield* this.yieldWorkspace(ws);

      const projects = await this.paginate<AsanaProject>("/projects", {
        workspace: ws.gid,
        opt_fields: "gid,name,color,archived,due_date",
      });

      for (const proj of projects) {
        if (proj.archived) continue; // skip archived projects

        yield* this.yieldProject(proj, ws.gid);

        if (tasksTotal >= MAX_TASKS_TOTAL) continue;

        const tasks = await this.paginate<AsanaTask>("/tasks", {
          project: proj.gid,
          opt_fields:
            "gid,name,notes,completed,completed_at,due_on,due_at,assignee.gid,assignee.email,followers.gid,followers.email,tags.name,memberships.project.gid,workspace.gid",
        });

        for (const task of tasks) {
          if (tasksTotal >= MAX_TASKS_TOTAL) break;
          if (!this.taskInIngestWindow(task)) continue;

          tasksTotal++;

          yield* this.yieldTask(task, proj.gid, ws.gid);

          const stories = await this.paginate<AsanaStory>(`/tasks/${task.gid}/stories`, {
            opt_fields: "gid,type,text,created_at,created_by.gid,created_by.email",
          });

          for (const story of stories) {
            if (story.type === "comment") {
              yield* this.yieldComment(story, task.gid);
            }
          }
        }
      }
    }
  }

  async *incrementalSync(_cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    // Asana PAT connector uses fullSync for the prototype; incremental via Events API deferred to Phase 2
    yield* this.fullSync();
  }

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: this.lastSyncedAt ?? new Date().toISOString(),
      providerCursor: this.lastSyncedAt ?? "",
      fullSyncRequired: false,
    };
  }

  private *yieldWorkspace(ws: AsanaWorkspace): Generator<NormalizedEvent> {
    const now = new Date().toISOString();
    const canonicalId = connectorNodeId(this.config.connectorId, ws.gid);
    const payload: AsanaWorkspaceNode = {
      nodeType: "AsanaWorkspace",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerWorkspaceGid: ws.gid,
      name: ws.name,
      isOrganization: ws.is_organization,
      ingestedAt: now,
      rawHash: "",
    };
    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;
    yield {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "asana",
      providerEventId: ws.gid,
      eventType: "AsanaWorkspace",
      occurredAt: now,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }

  private *yieldProject(proj: AsanaProject, workspaceGid: string): Generator<NormalizedEvent> {
    const now = new Date().toISOString();
    const canonicalId = connectorNodeId(this.config.connectorId, proj.gid);
    const workspaceCanonicalId = connectorNodeId(this.config.connectorId, workspaceGid);
    const payload: AsanaProjectNode = {
      nodeType: "AsanaProject",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerProjectGid: proj.gid,
      workspaceCanonicalId,
      name: proj.name,
      color: proj.color,
      isArchived: proj.archived,
      dueDate: proj.due_date,
      ingestedAt: now,
      rawHash: "",
    };
    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;
    yield {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "asana",
      providerEventId: proj.gid,
      eventType: "AsanaProject",
      occurredAt: now,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }

  private *yieldTask(
    task: AsanaTask,
    projectGid: string,
    workspaceGid: string
  ): Generator<NormalizedEvent> {
    const now = new Date().toISOString();
    const canonicalId = connectorNodeId(this.config.connectorId, task.gid);
    const projectCanonicalId = connectorNodeId(this.config.connectorId, projectGid);
    const workspaceCanonicalId = connectorNodeId(this.config.connectorId, workspaceGid);

    const assigneeIdentityId = task.assignee?.email
      ? identityId(task.assignee.email)
      : task.assignee?.gid
      ? identityId(task.assignee.gid)
      : null;

    const followerIdentityIds = task.followers.map((f) =>
      f.email ? identityId(f.email) : identityId(f.gid)
    );

    const payload: AsanaTaskNode = {
      nodeType: "AsanaTask",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerTaskGid: task.gid,
      projectCanonicalId,
      workspaceCanonicalId,
      name: task.name,
      notes: task.notes,
      assigneeIdentityId,
      followerIdentityIds,
      dueDate: task.due_on,
      dueAt: task.due_at,
      isCompleted: task.completed,
      completedAt: task.completed_at,
      priority: null,
      tags: task.tags.map((t) => t.name),
      ingestedAt: now,
      rawHash: "",
    };
    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;
    yield {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "asana",
      providerEventId: task.gid,
      eventType: "AsanaTask",
      occurredAt: now,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }

  private *yieldComment(story: AsanaStory, taskGid: string): Generator<NormalizedEvent> {
    const now = new Date().toISOString();
    const canonicalId = connectorNodeId(this.config.connectorId, story.gid);
    const taskCanonicalId = connectorNodeId(this.config.connectorId, taskGid);

    const authorIdentityId = story.created_by.email
      ? identityId(story.created_by.email)
      : identityId(story.created_by.gid);

    const payload: AsanaCommentNode = {
      nodeType: "AsanaComment",
      canonicalId,
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerStoryGid: story.gid,
      taskCanonicalId,
      authorIdentityId,
      text: story.text,
      createdAt: story.created_at,
      isSystem: false,
      ingestedAt: now,
      rawHash: "",
    };
    const hash = rawHash(payload as unknown as Record<string, unknown>);
    payload.rawHash = hash;
    yield {
      eventId: canonicalId,
      connectorId: this.config.connectorId,
      providerId: "asana",
      providerEventId: story.gid,
      eventType: "AsanaComment",
      occurredAt: story.created_at,
      payload: payload as unknown as Record<string, unknown>,
      rawHash: hash,
    };
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${ASANA_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const resp = await this.fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.pat}`,
        Accept: "application/json",
      },
    });

    if (resp.status === 401) {
      throw new ConnectorAuthError(this.config.connectorId, "Asana PAT invalid or expired", 401);
    }
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      throw new ConnectorRateLimitError(
        this.config.connectorId,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
      );
    }
    if (!resp.ok) {
      throw new ConnectorNetworkError(
        this.config.connectorId,
        new Error(`Asana API ${resp.status}: ${await resp.text()}`)
      );
    }

    return resp.json() as Promise<T>;
  }

  private async paginate<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const results: T[] = [];
    let offset: string | undefined;

    do {
      const pageParams: Record<string, string> = {
        ...params,
        limit: String(PAGE_SIZE),
        ...(offset ? { offset } : {}),
      };
      const page = await this.get<AsanaPage<T>>(path, pageParams);
      results.push(...page.data);
      offset = page.next_page?.offset;
    } while (offset);

    return results;
  }
}
