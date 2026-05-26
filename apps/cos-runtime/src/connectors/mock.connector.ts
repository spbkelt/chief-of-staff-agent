import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import type { Connector, ConnectorConfig, ConnectorCredentials, NormalizedEvent, SyncCursor } from "./connector.interface.js";
import { connectorNodeId, rawHash, identityId } from "../graph/canonical-id.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../../fixtures");

interface CalendarFixture {
  providerEventId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  location: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  organizerEmail: string;
  attendeeEmails: string[];
  meetingUrl: string | null;
}

interface EmailMessage {
  providerMessageId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  sentAt: string;
  bodyText: string;
  hasAttachments: boolean;
  labels: string[];
}

interface EmailThreadFixture {
  providerThreadId: string;
  subject: string;
  firstMessageAt: string;
  lastMessageAt: string;
  participantEmails: string[];
  labels: string[];
  isResolved: boolean;
  replyNeeded: boolean;
  messages: EmailMessage[];
}

interface AsanaCommentFixture {
  providerStoryGid: string;
  authorEmail: string;
  text: string;
  createdAt: string;
  isSystem: boolean;
}

interface AsanaTaskFixture {
  providerTaskGid: string;
  projectGid: string | null;
  name: string;
  notes: string | null;
  assigneeEmail: string | null;
  followerEmails: string[];
  dueDate: string | null;
  dueAt: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  priority: "high" | "medium" | "low" | null;
  tags: string[];
  comments: AsanaCommentFixture[];
}

interface AsanaFixtures {
  workspace: { providerWorkspaceGid: string; name: string; isOrganization: boolean };
  projects: Array<{
    providerProjectGid: string;
    name: string;
    color: string | null;
    isArchived: boolean;
    dueDate: string | null;
  }>;
  tasks: AsanaTaskFixture[];
}

function loadJson<T>(filename: string): T {
  return require(path.join(FIXTURES_DIR, filename)) as T;
}

function makeCreds(): ConnectorCredentials {
  return { type: "api-key" };
}

export class MockCalendarConnector implements Connector {
  readonly config: ConnectorConfig;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string
  ) {
    this.config = {
      connectorId,
      providerId: "google-calendar",
      accountLabel: "Mock Calendar",
      credentials: makeCreds(),
    };
  }

  async verifyAuth(): Promise<void> {
    // Mock always succeeds
  }

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: "mock-cursor",
      fullSyncRequired: false,
    };
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    const events = loadJson<CalendarFixture[]>("calendar-events.json");
    for (const evt of events) {
      yield this.toNormalizedEvent(evt);
    }
  }

  async *incrementalSync(_cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    yield* this.fullSync();
  }

  private toNormalizedEvent(evt: CalendarFixture): NormalizedEvent {
    const payload: Record<string, unknown> = {
      nodeType: "CalendarEvent",
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerEventId: evt.providerEventId,
      title: evt.title,
      description: evt.description,
      startAt: evt.startAt,
      endAt: evt.endAt,
      isAllDay: evt.isAllDay,
      location: evt.location,
      status: evt.status,
      organizerIdentityId: identityId(evt.organizerEmail),
      attendeeIdentityIds: evt.attendeeEmails.map(identityId),
      recurrenceRule: null,
      meetingUrl: evt.meetingUrl,
      ingestedAt: new Date().toISOString(),
    };
    return {
      eventId: connectorNodeId(this.config.connectorId, evt.providerEventId),
      connectorId: this.config.connectorId,
      providerId: this.config.providerId,
      providerEventId: evt.providerEventId,
      eventType: "CalendarEvent",
      occurredAt: evt.startAt,
      payload,
      rawHash: rawHash(payload),
    };
  }
}

export class MockGmailConnector implements Connector {
  readonly config: ConnectorConfig;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string
  ) {
    this.config = {
      connectorId,
      providerId: "gmail",
      accountLabel: "Mock Gmail",
      credentials: makeCreds(),
    };
  }

  async verifyAuth(): Promise<void> {}

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: "mock-history-id",
      fullSyncRequired: false,
    };
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    const threads = loadJson<EmailThreadFixture[]>("email-threads.json");
    for (const thread of threads) {
      yield* this.threadToEvents(thread);
    }
  }

  async *incrementalSync(_cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    yield* this.fullSync();
  }

  private *threadToEvents(thread: EmailThreadFixture): Generator<NormalizedEvent> {
    const threadPayload: Record<string, unknown> = {
      nodeType: "EmailThread",
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerThreadId: thread.providerThreadId,
      subject: thread.subject,
      firstMessageAt: thread.firstMessageAt,
      lastMessageAt: thread.lastMessageAt,
      participantIdentityIds: thread.participantEmails.map(identityId),
      labels: thread.labels,
      isResolved: thread.isResolved,
      replyNeeded: thread.replyNeeded,
      messageCount: thread.messages.length,
      ingestedAt: new Date().toISOString(),
    };

    yield {
      eventId: connectorNodeId(this.config.connectorId, thread.providerThreadId),
      connectorId: this.config.connectorId,
      providerId: this.config.providerId,
      providerEventId: thread.providerThreadId,
      eventType: "EmailThread",
      occurredAt: thread.firstMessageAt,
      payload: threadPayload,
      rawHash: rawHash(threadPayload),
    };

    for (const msg of thread.messages) {
      const msgPayload: Record<string, unknown> = {
        nodeType: "EmailMessage",
        connectorId: this.config.connectorId,
        ownerUserId: this.ownerUserId,
        providerMessageId: msg.providerMessageId,
        threadCanonicalId: connectorNodeId(this.config.connectorId, thread.providerThreadId),
        fromIdentityId: identityId(msg.fromEmail),
        toIdentityIds: msg.toEmails.map(identityId),
        ccIdentityIds: msg.ccEmails.map(identityId),
        sentAt: msg.sentAt,
        subject: thread.subject,
        bodyText: msg.bodyText,
        bodyHtml: null,
        hasAttachments: msg.hasAttachments,
        labels: msg.labels,
        ingestedAt: new Date().toISOString(),
      };

      yield {
        eventId: connectorNodeId(this.config.connectorId, msg.providerMessageId),
        connectorId: this.config.connectorId,
        providerId: this.config.providerId,
        providerEventId: msg.providerMessageId,
        eventType: "EmailMessage",
        occurredAt: msg.sentAt,
        payload: msgPayload,
        rawHash: rawHash(msgPayload),
      };
    }
  }
}

export class MockAsanaConnector implements Connector {
  readonly config: ConnectorConfig;

  constructor(
    connectorId: string,
    private readonly ownerUserId: string
  ) {
    this.config = {
      connectorId,
      providerId: "asana",
      accountLabel: "Mock Asana",
      credentials: makeCreds(),
    };
  }

  async verifyAuth(): Promise<void> {}

  async currentCursor(): Promise<SyncCursor> {
    return {
      connectorId: this.config.connectorId,
      lastSyncedAt: new Date().toISOString(),
      providerCursor: "mock-sync-token",
      fullSyncRequired: false,
    };
  }

  async *fullSync(): AsyncGenerator<NormalizedEvent> {
    const data = loadJson<AsanaFixtures>("asana-tasks.json");

    // Workspace
    const wsPayload: Record<string, unknown> = {
      nodeType: "AsanaWorkspace",
      connectorId: this.config.connectorId,
      ownerUserId: this.ownerUserId,
      providerWorkspaceGid: data.workspace.providerWorkspaceGid,
      name: data.workspace.name,
      isOrganization: data.workspace.isOrganization,
      ingestedAt: new Date().toISOString(),
    };
    yield {
      eventId: connectorNodeId(this.config.connectorId, data.workspace.providerWorkspaceGid),
      connectorId: this.config.connectorId,
      providerId: this.config.providerId,
      providerEventId: data.workspace.providerWorkspaceGid,
      eventType: "AsanaWorkspace",
      occurredAt: new Date().toISOString(),
      payload: wsPayload,
      rawHash: rawHash(wsPayload),
    };

    // Projects
    for (const project of data.projects) {
      const projectPayload: Record<string, unknown> = {
        nodeType: "AsanaProject",
        connectorId: this.config.connectorId,
        ownerUserId: this.ownerUserId,
        providerProjectGid: project.providerProjectGid,
        workspaceCanonicalId: connectorNodeId(
          this.config.connectorId,
          data.workspace.providerWorkspaceGid
        ),
        name: project.name,
        color: project.color,
        isArchived: project.isArchived,
        dueDate: project.dueDate,
        ingestedAt: new Date().toISOString(),
      };
      yield {
        eventId: connectorNodeId(this.config.connectorId, project.providerProjectGid),
        connectorId: this.config.connectorId,
        providerId: this.config.providerId,
        providerEventId: project.providerProjectGid,
        eventType: "AsanaProject",
        occurredAt: new Date().toISOString(),
        payload: projectPayload,
        rawHash: rawHash(projectPayload),
      };
    }

    // Tasks
    for (const task of data.tasks) {
      const taskPayload: Record<string, unknown> = {
        nodeType: "AsanaTask",
        connectorId: this.config.connectorId,
        ownerUserId: this.ownerUserId,
        providerTaskGid: task.providerTaskGid,
        projectCanonicalId: task.projectGid
          ? connectorNodeId(this.config.connectorId, task.projectGid)
          : null,
        workspaceCanonicalId: connectorNodeId(
          this.config.connectorId,
          data.workspace.providerWorkspaceGid
        ),
        name: task.name,
        notes: task.notes,
        assigneeIdentityId: task.assigneeEmail ? identityId(task.assigneeEmail) : null,
        followerIdentityIds: task.followerEmails.map(identityId),
        dueDate: task.dueDate,
        dueAt: task.dueAt,
        isCompleted: task.isCompleted,
        completedAt: task.completedAt,
        priority: task.priority,
        tags: task.tags,
        ingestedAt: new Date().toISOString(),
      };

      yield {
        eventId: connectorNodeId(this.config.connectorId, task.providerTaskGid),
        connectorId: this.config.connectorId,
        providerId: this.config.providerId,
        providerEventId: task.providerTaskGid,
        eventType: "AsanaTask",
        occurredAt: task.dueAt ?? new Date().toISOString(),
        payload: taskPayload,
        rawHash: rawHash(taskPayload),
      };

      // Comments
      for (const comment of task.comments) {
        const commentPayload: Record<string, unknown> = {
          nodeType: "AsanaComment",
          connectorId: this.config.connectorId,
          ownerUserId: this.ownerUserId,
          providerStoryGid: comment.providerStoryGid,
          taskCanonicalId: connectorNodeId(this.config.connectorId, task.providerTaskGid),
          authorIdentityId: identityId(comment.authorEmail),
          text: comment.text,
          createdAt: comment.createdAt,
          isSystem: comment.isSystem,
          ingestedAt: new Date().toISOString(),
        };

        yield {
          eventId: connectorNodeId(this.config.connectorId, comment.providerStoryGid),
          connectorId: this.config.connectorId,
          providerId: this.config.providerId,
          providerEventId: comment.providerStoryGid,
          eventType: "AsanaComment",
          occurredAt: comment.createdAt,
          payload: commentPayload,
          rawHash: rawHash(commentPayload),
        };
      }
    }
  }

  async *incrementalSync(_cursor: SyncCursor): AsyncGenerator<NormalizedEvent> {
    yield* this.fullSync();
  }
}
