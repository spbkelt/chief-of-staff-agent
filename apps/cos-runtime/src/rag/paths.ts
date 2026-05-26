import { getDb } from "../graph/graph.db.js";
import { backendGetNode } from "../graph/backend.js";
import { retrieve, DEFAULT_TOP_K, type RetrievedChunk } from "./retrieve.js";
import type { RetrievalFilter } from "./retrieve.js";
import { buildCitation } from "./citations.js";
import type { PathsOutput, PathSuggestion } from "./query-output.js";

const DEFAULT_PATHS_TOP_K = 10;

/** Edge types that connect executive entities (1-hop from a retrieval hit). */
const TRAVERSE_EDGE_TYPES = new Set([
  "COMMENTED_ON",
  "IN_THREAD",
  "IN_PROJECT",
  "ORGANIZES",
  "ATTENDS",
  "ASSIGNED_TO",
  "AUTHORED_BY",
  "SENDS",
  "RECEIVES",
]);

export async function findRelatedSources(
  queryText: string,
  filter: RetrievalFilter,
  topK = DEFAULT_PATHS_TOP_K,
): Promise<PathsOutput> {
  const retrieval = await retrieve(queryText, filter, DEFAULT_TOP_K);
  const suggestions: PathSuggestion[] = [];
  const seen = new Set<string>();

  const addSuggestion = (
    canonicalId: string,
    nodeType: string,
    title: string,
    url: string,
    relation: string,
    score: number,
    seedChunkId?: string,
  ): void => {
    if (seen.has(canonicalId)) return;
    seen.add(canonicalId);
    suggestions.push({
      canonicalId,
      nodeType,
      title,
      url,
      relation,
      score,
      ...(seedChunkId ? { seedChunkId } : {}),
    });
  };

  for (const hit of retrieval.chunks) {
    const parent = await backendGetNode(hit.sourceNodeId);
    const parentData = parent as unknown as Record<string, unknown> | null;
    const parentTitle =
      (parentData?.["title"] as string) ??
      (parentData?.["name"] as string) ??
      (parentData?.["subject"] as string) ??
      hit.title;
    const parentType = hit.sourceType;

    addSuggestion(
      hit.sourceNodeId,
      parentType,
      parentTitle,
      hit.citation,
      "retrieval_hit",
      hit.score,
      hit.chunkId,
    );

    await addFromRagLinks(hit, addSuggestion);
    await addFromGraphEdges(hit, addSuggestion);
  }

  suggestions.sort((a, b) => b.score - a.score);
  return {
    query: queryText,
    suggestions: suggestions.slice(0, topK),
  };
}

async function addFromRagLinks(
  hit: RetrievedChunk,
  add: (
    canonicalId: string,
    nodeType: string,
    title: string,
    url: string,
    relation: string,
    score: number,
    seedChunkId?: string,
  ) => void,
): Promise<void> {
  const db = getDb();
  const rows = await db.execute({
    sql: `SELECT to_chunk_id, link_type FROM rag_links WHERE from_chunk_id = ?`,
    args: [hit.chunkId],
  });

  for (const row of rows.rows) {
    const targetId = row[0] as string;
    const linkType = row[1] as string;
    if (targetId === hit.sourceNodeId) continue;

    const node = await backendGetNode(targetId);
    if (!node) continue;
    const data = node as unknown as Record<string, unknown>;
    const nodeType = (data["nodeType"] as string) ?? "Unknown";
    const title =
      (data["title"] as string) ??
      (data["name"] as string) ??
      (data["subject"] as string) ??
      targetId;
    const url = buildCitation(nodeType, targetId, data);
    add(targetId, nodeType, title, url, linkType, hit.score * 0.9, hit.chunkId);
  }
}

async function addFromGraphEdges(
  hit: RetrievedChunk,
  add: (
    canonicalId: string,
    nodeType: string,
    title: string,
    url: string,
    relation: string,
    score: number,
    seedChunkId?: string,
  ) => void,
): Promise<void> {
  const db = getDb();
  const outRows = await db.execute({
    sql: `SELECT edge_type, to_id FROM edges WHERE from_id = ?`,
    args: [hit.sourceNodeId],
  });
  const inRows = await db.execute({
    sql: `SELECT edge_type, from_id FROM edges WHERE to_id = ?`,
    args: [hit.sourceNodeId],
  });

  for (const row of outRows.rows) {
    const edgeType = row[0] as string;
    const targetId = row[1] as string;
    if (!TRAVERSE_EDGE_TYPES.has(edgeType)) continue;
    await addNodeSuggestion(targetId, edgeType, hit, add);
  }

  for (const row of inRows.rows) {
    const edgeType = row[0] as string;
    const targetId = row[1] as string;
    if (!TRAVERSE_EDGE_TYPES.has(edgeType)) continue;
    await addNodeSuggestion(targetId, edgeType, hit, add);
  }
}

async function addNodeSuggestion(
  targetId: string,
  relation: string,
  hit: RetrievedChunk,
  add: (
    canonicalId: string,
    nodeType: string,
    title: string,
    url: string,
    relation: string,
    score: number,
    seedChunkId?: string,
  ) => void,
): Promise<void> {
  const node = await backendGetNode(targetId);
  if (!node) return;
  const data = node as unknown as Record<string, unknown>;
  const nodeType = (data["nodeType"] as string) ?? "Unknown";
  const title =
    (data["title"] as string) ??
    (data["name"] as string) ??
    (data["subject"] as string) ??
    targetId;
  const url = buildCitation(nodeType, targetId, data);
  add(targetId, nodeType, title, url, relation, hit.score * 0.85, hit.chunkId);
}
