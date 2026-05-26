import { getDb } from "../graph/graph.db.js";
import { backendUpsertNode } from "../graph/backend.js";
import { conversationTurnId, derivedNodeId } from "../graph/canonical-id.js";
import type { ConversationTurnNode, ActivityEventNode } from "../graph/schema.js";

const CONTENT_MAX_CHARS = 2000;

export async function writeConversationTurn(params: {
  sessionId: string;
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
  toolCallIds?: string[];
}): Promise<ConversationTurnNode> {
  const canonicalId = conversationTurnId(params.sessionId, params.turnIndex);
  const node: ConversationTurnNode = {
    nodeType: "ConversationTurn",
    canonicalId,
    sessionId: params.sessionId,
    turnIndex: params.turnIndex,
    role: params.role,
    content: params.content.slice(0, CONTENT_MAX_CHARS),
    toolCallIds: params.toolCallIds ?? [],
    createdAt: new Date().toISOString(),
  };
  await backendUpsertNode(node);
  return node;
}

export async function getConversationHistory(opts: {
  sessionId?: string;
  limit?: number;
} = {}): Promise<ConversationTurnNode[]> {
  const db = getDb();
  const limit = opts.limit ?? 50;

  let sql: string;
  let args: (string | number)[];

  if (opts.sessionId) {
    sql = `SELECT data FROM nodes
           WHERE node_type = 'ConversationTurn'
           AND json_extract(data, '$.sessionId') = ?
           ORDER BY json_extract(data, '$.turnIndex') ASC
           LIMIT ?`;
    args = [opts.sessionId, limit];
  } else {
    sql = `SELECT data FROM nodes
           WHERE node_type = 'ConversationTurn'
           ORDER BY json_extract(data, '$.turnIndex') ASC
           LIMIT ?`;
    args = [limit];
  }

  const result = await db.execute({ sql, args });
  return result.rows
    .map((r) => {
      const v = r[0];
      return typeof v === "string" ? (JSON.parse(v) as ConversationTurnNode) : null;
    })
    .filter((n): n is ConversationTurnNode => n !== null);
}

export async function writeActivityEvent(params: {
  actorId: string;
  verb: string;
  objectNodeId: string;
  occurredAt: string;
  sourceConnectorId?: string;
}): Promise<ActivityEventNode> {
  const canonicalId = derivedNodeId(
    "ActivityEvent",
    `${params.actorId}:${params.verb}:${params.objectNodeId}:${params.occurredAt}`
  );
  const node: ActivityEventNode = {
    nodeType: "ActivityEvent",
    canonicalId,
    actorId: params.actorId,
    verb: params.verb,
    objectNodeId: params.objectNodeId,
    occurredAt: params.occurredAt,
    ...(params.sourceConnectorId !== undefined ? { sourceConnectorId: params.sourceConnectorId } : {}),
  };
  await backendUpsertNode(node);
  return node;
}
