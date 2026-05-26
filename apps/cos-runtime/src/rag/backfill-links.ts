import { getDb } from "../graph/graph.db.js";
import { upsertRagLink } from "./links.js";

export interface BackfillLinksResult {
  linksWritten: number;
  chunksProcessed: number;
}

/**
 * Populate rag_links for existing chunks (CHUNK_OF chunk → parent source node).
 * Safe to run after upgrading from pre-links ingest data.
 */
export async function backfillRagLinks(ownerUserId?: string): Promise<BackfillLinksResult> {
  const db = getDb();
  const rows = ownerUserId
    ? await db.execute({
        sql: `SELECT rc.canonical_id, rs.source_node_id
              FROM rag_chunks rc
              JOIN rag_sources rs ON rc.source_id = rs.canonical_id
              WHERE rc.owner_user_id = ?`,
        args: [ownerUserId],
      })
    : await db.execute({
        sql: `SELECT rc.canonical_id, rs.source_node_id
              FROM rag_chunks rc
              JOIN rag_sources rs ON rc.source_id = rs.canonical_id`,
        args: [],
      });

  let linksWritten = 0;
  for (const row of rows.rows) {
    const chunkId = row[0] as string;
    const parentNodeId = row[1] as string;
    await upsertRagLink(chunkId, parentNodeId, "CHUNK_OF");
    linksWritten++;
  }

  return { linksWritten, chunksProcessed: rows.rows.length };
}
