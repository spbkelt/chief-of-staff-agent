import { getDb } from "./graph.db.js";
import type { KnowledgeNode, GraphEdge } from "./schema.js";

export interface UpsertResult {
  canonicalId: string;
  skipped: boolean; // true if rawHash matched — no write performed
}

function extractRawHash(node: KnowledgeNode): string {
  if ("rawHash" in node) return node.rawHash as string;
  // Nodes without rawHash (User, Provider, etc.) always upsert
  return "";
}

/**
 * Idempotently upsert a node. If rawHash matches the stored value, skip the write.
 * Returns skipped=true when no write was performed.
 */
export async function upsertNode(node: KnowledgeNode): Promise<UpsertResult> {
  const db = getDb();
  const now = new Date().toISOString();
  const nodeRawHash = extractRawHash(node);

  if (nodeRawHash) {
    const existing = await db.execute({
      sql: "SELECT raw_hash FROM nodes WHERE canonical_id = ?",
      args: [node.canonicalId],
    });
    if (existing.rows.length > 0 && existing.rows[0]?.[0] === nodeRawHash) {
      return { canonicalId: node.canonicalId, skipped: true };
    }
  }

  const dataJson = JSON.stringify(node);

  await db.execute({
    sql: `
      INSERT INTO nodes (canonical_id, node_type, data, created_at, updated_at, raw_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (canonical_id) DO UPDATE SET
        data       = excluded.data,
        updated_at = excluded.updated_at,
        raw_hash   = excluded.raw_hash
    `,
    args: [node.canonicalId, node.nodeType, dataJson, now, now, nodeRawHash],
  });

  return { canonicalId: node.canonicalId, skipped: false };
}

export async function upsertEdge(edge: GraphEdge): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO edges (id, edge_type, from_id, to_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `,
    args: [edge.id, edge.edgeType, edge.fromId, edge.toId, now],
  });
}

export async function getNode(canonicalId: string): Promise<KnowledgeNode | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT data FROM nodes WHERE canonical_id = ?",
    args: [canonicalId],
  });
  if (result.rows.length === 0) return null;
  const dataStr = result.rows[0]?.[0];
  if (typeof dataStr !== "string") return null;
  return JSON.parse(dataStr) as KnowledgeNode;
}

export async function getNodesByType(nodeType: string): Promise<KnowledgeNode[]> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT data FROM nodes WHERE node_type = ?",
    args: [nodeType],
  });
  return result.rows
    .map((r) => {
      const v = r[0];
      return typeof v === "string" ? (JSON.parse(v) as KnowledgeNode) : null;
    })
    .filter((n): n is KnowledgeNode => n !== null);
}

export async function getNodeCount(): Promise<number> {
  const db = getDb();
  const result = await db.execute("SELECT COUNT(*) FROM nodes");
  const v = result.rows[0]?.[0];
  return typeof v === "number" ? v : 0;
}
