// Knowledge graph node and edge type definitions

export type ProviderId =
  | "google-calendar"
  | "gmail"
  | "asana"
  | "microsoft-calendar"
  | "microsoft-mail"
  | "slack"
  | "google-chat";

export type KnowledgeNodeType =
  | "User"
  | "Account"
  | "Provider"
  | "Identity"
  | "CalendarEvent"
  | "EmailThread"
  | "EmailMessage"
  | "AsanaWorkspace"
  | "AsanaProject"
  | "AsanaTask"
  | "AsanaComment"
  | "Organization"
  | "Contact"
  | "Topic"
  | "PrioritySignal"
  | "Notification"
  | "SuggestedResponse"
  | "Decision"
  | "SourceArtifact"
  | "ConversationTurn"
  | "ActivityEvent";

export type EdgeType =
  | "HAS_ACCOUNT"
  | "USES_PROVIDER"
  | "HAS_IDENTITY"
  | "SAME_PERSON"
  | "ATTENDS"
  | "ORGANIZES"
  | "IN_THREAD"
  | "SENDS"
  | "RECEIVES"
  | "MEMBER_OF"
  | "IN_PROJECT"
  | "ASSIGNED_TO"
  | "COMMENTED_ON"
  | "AUTHORED_BY"
  | "TAGGED_WITH"
  | "SIGNALS"
  | "GENERATED"
  | "SUGGESTS"
  | "CHUNK_OF"
  | "CITES"
  | "TURN_OF"
  | "ACTED"
  | "PART_OF";

export type NotificationTriggerType =
  | "upcoming-meeting"
  | "meeting-prep-needed"
  | "unresolved-email-thread"
  | "reply-needed"
  | "asana-task-due"
  | "asana-task-overdue"
  | "asana-mention"
  | "missed-commitment"
  | "calendar-task-conflict"
  | "repeated-topic-priority"
  | "executive-priority-signal";

export type NotificationStatus = "pending" | "delivered" | "dismissed" | "snoozed" | "acted-on";

export type SuggestedResponseType =
  | "email-reply"
  | "asana-comment"
  | "meeting-followup"
  | "delegation"
  | "clarification"
  | "status-update";

export type SuggestedResponseStatus = "pending" | "approved" | "rejected" | "modified" | "sent";

// ─── Node interfaces ──────────────────────────────────────────────────────────

export interface UserNode {
  nodeType: "User";
  canonicalId: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountNode {
  nodeType: "Account";
  canonicalId: string;
  connectorId: string;
  providerId: ProviderId;
  accountLabel: string;
  ownerUserId: string;
  connectedAt: string;
  lastSyncedAt: string | null;
}

export interface ProviderNode {
  nodeType: "Provider";
  canonicalId: string;
  providerId: ProviderId;
  displayName: string;
  connectorVersion: string;
}

export interface IdentityNode {
  nodeType: "Identity";
  canonicalId: string;
  email: string | null;
  displayName: string;
  providerIds: { providerId: ProviderId; providerUserId: string }[];
  isOrganizationMember: boolean;
  lastSeenAt: string;
}

export interface CalendarEventNode {
  nodeType: "CalendarEvent";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerEventId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  location: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  organizerIdentityId: string;
  attendeeIdentityIds: string[];
  recurrenceRule: string | null;
  meetingUrl: string | null;
  ingestedAt: string;
  rawHash: string;
}

export interface EmailThreadNode {
  nodeType: "EmailThread";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerThreadId: string;
  subject: string;
  firstMessageAt: string;
  lastMessageAt: string;
  participantIdentityIds: string[];
  labels: string[];
  isResolved: boolean;
  replyNeeded: boolean;
  messageCount: number;
  ingestedAt: string;
  rawHash: string;
}

export interface EmailMessageNode {
  nodeType: "EmailMessage";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerMessageId: string;
  threadCanonicalId: string;
  fromIdentityId: string;
  toIdentityIds: string[];
  ccIdentityIds: string[];
  sentAt: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  hasAttachments: boolean;
  labels: string[];
  ingestedAt: string;
  rawHash: string;
}

export interface AsanaWorkspaceNode {
  nodeType: "AsanaWorkspace";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerWorkspaceGid: string;
  name: string;
  isOrganization: boolean;
  ingestedAt: string;
  rawHash: string;
}

export interface AsanaProjectNode {
  nodeType: "AsanaProject";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerProjectGid: string;
  workspaceCanonicalId: string;
  name: string;
  color: string | null;
  isArchived: boolean;
  dueDate: string | null;
  ingestedAt: string;
  rawHash: string;
}

export interface AsanaTaskNode {
  nodeType: "AsanaTask";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerTaskGid: string;
  projectCanonicalId: string | null;
  workspaceCanonicalId: string;
  name: string;
  notes: string | null;
  assigneeIdentityId: string | null;
  followerIdentityIds: string[];
  dueDate: string | null;
  dueAt: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  priority: "high" | "medium" | "low" | null;
  tags: string[];
  ingestedAt: string;
  rawHash: string;
}

export interface AsanaCommentNode {
  nodeType: "AsanaComment";
  canonicalId: string;
  connectorId: string;
  ownerUserId: string;
  providerStoryGid: string;
  taskCanonicalId: string;
  authorIdentityId: string;
  text: string;
  createdAt: string;
  isSystem: boolean;
  ingestedAt: string;
  rawHash: string;
}

export interface OrganizationNode {
  nodeType: "Organization";
  canonicalId: string;
  name: string;
  domain: string | null;
  memberIdentityIds: string[];
}

export interface ContactNode {
  nodeType: "Contact";
  canonicalId: string;
  identityCanonicalId: string;
  relationship: "colleague" | "direct-report" | "manager" | "client" | "vendor" | "external";
  notes: string | null;
  firstContactAt: string;
  lastContactAt: string;
  interactionCount: number;
}

export interface TopicNode {
  nodeType: "Topic";
  canonicalId: string;
  label: string;
  frequency: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PrioritySignalNode {
  nodeType: "PrioritySignal";
  canonicalId: string;
  sourceNodeId: string;
  signalType: "deadline" | "mention" | "conflict" | "unanswered" | "repeated-topic";
  score: number;
  reason: string;
  detectedAt: string;
  expiresAt: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
}

export interface NotificationNode {
  nodeType: "Notification";
  canonicalId: string;
  ownerUserId: string;
  triggerType: NotificationTriggerType;
  priorityScore: number;
  title: string;
  explanation: string;
  suggestedAction: string;
  confidence: number;
  sourceNodeIds: string[];
  generatedAt: string;
  deliveredAt: string | null;
  status: NotificationStatus;
  snoozedUntil: string | null;
  followUpAt: string | null;
}

export interface SuggestedResponseNode {
  nodeType: "SuggestedResponse";
  canonicalId: string;
  ownerUserId: string;
  targetNodeId: string;
  responseType: SuggestedResponseType;
  draftText: string;
  citedSourceNodeIds: string[];
  toneAssessment: string;
  factualBasis: string[];
  assumptions: string[];
  generatedAt: string;
  reviewedAt: string | null;
  status: SuggestedResponseStatus;
  approvedText: string | null;
  sentAt: string | null;
}

export interface DecisionNode {
  nodeType: "Decision";
  canonicalId: string;
  description: string;
  sourceNodeIds: string[];
  ownerId: string;
  dueDate: string | null;
  status: "open" | "resolved" | "deferred";
  resolvedAt: string | null;
  createdAt: string;
}

export interface SourceArtifactNode {
  nodeType: "SourceArtifact";
  canonicalId: string;
  sourceNodeId: string;
  ownerUserId: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[] | null;
  embeddingModel: string;
  embeddingDimensions: number;
  tokenCount: number;
  createdAt: string;
}

export interface ConversationTurnNode {
  nodeType: "ConversationTurn";
  canonicalId: string;
  sessionId: string;
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
  toolCallIds: string[];
  createdAt: string;
}

export interface ActivityEventNode {
  nodeType: "ActivityEvent";
  canonicalId: string;
  actorId: string;
  verb: string;
  objectNodeId: string;
  occurredAt: string;
  sourceConnectorId?: string;
}

export type KnowledgeNode =
  | UserNode
  | AccountNode
  | ProviderNode
  | IdentityNode
  | CalendarEventNode
  | EmailThreadNode
  | EmailMessageNode
  | AsanaWorkspaceNode
  | AsanaProjectNode
  | AsanaTaskNode
  | AsanaCommentNode
  | OrganizationNode
  | ContactNode
  | TopicNode
  | PrioritySignalNode
  | NotificationNode
  | SuggestedResponseNode
  | DecisionNode
  | SourceArtifactNode
  | ConversationTurnNode
  | ActivityEventNode;

export interface GraphEdge {
  id: string;
  edgeType: EdgeType;
  fromId: string;
  toId: string;
  createdAt: string;
}
