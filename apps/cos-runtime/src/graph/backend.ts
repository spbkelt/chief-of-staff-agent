import { upsertNode as libsqlUpsert, upsertEdge as libsqlUpsertEdge, getNode as libsqlGetNode } from "./upsert.js";
import type { KnowledgeNode, GraphEdge } from "./schema.js";
import type { UpsertResult } from "./upsert.js";

function usesDynamo(): boolean {
  return process.env["COS_GRAPH_BACKEND"] === "dynamo";
}

export async function backendUpsertNode(node: KnowledgeNode): Promise<UpsertResult> {
  if (usesDynamo()) {
    const { dynamoUpsertNode } = await import("./dynamo-store.js");
    return dynamoUpsertNode(node);
  }
  return libsqlUpsert(node);
}

export async function backendUpsertEdge(edge: GraphEdge): Promise<void> {
  // Edges are libSQL-only in the current schema; DynamoDB path falls through to libSQL.
  return libsqlUpsertEdge(edge);
}

export async function backendGetNode(canonicalId: string): Promise<KnowledgeNode | null> {
  if (usesDynamo()) {
    const { dynamoGetNodeByPk } = await import("./dynamo-store.js");
    return dynamoGetNodeByPk(canonicalId);
  }
  return libsqlGetNode(canonicalId);
}

export async function backendGetTypedNode(
  canonicalId: string,
  nodeType: string,
): Promise<KnowledgeNode | null> {
  if (usesDynamo()) {
    const { dynamoGetNode } = await import("./dynamo-store.js");
    return dynamoGetNode(canonicalId, nodeType);
  }
  return libsqlGetNode(canonicalId);
}

export async function backendGetNodesByType(
  ownerUserId: string,
  nodeType: string,
): Promise<KnowledgeNode[]> {
  if (usesDynamo()) {
    const { dynamoQueryNodesByType } = await import("./dynamo-store.js");
    return dynamoQueryNodesByType(ownerUserId, nodeType);
  }
  const { getDb } = await import("./graph.db.js");
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT data FROM nodes WHERE node_type = ? AND json_extract(data, '$.ownerUserId') = ?`,
    args: [nodeType, ownerUserId],
  });
  return result.rows
    .map((r) => {
      const v = r[0];
      return typeof v === "string" ? (JSON.parse(v) as KnowledgeNode) : null;
    })
    .filter((n): n is KnowledgeNode => n !== null);
}
