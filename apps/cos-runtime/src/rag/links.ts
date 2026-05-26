import { getDb } from "../graph/graph.db.js";
import { sha256 } from "../graph/canonical-id.js";

export type RagLinkType = "CHUNK_OF" | "RELATED_TO";

function linkId(fromChunkId: string, toId: string, linkType: RagLinkType): string {
  return sha256(`${fromChunkId}:${linkType}:${toId}`);
}

/** Remove all rag_links originating from chunks of a given rag source. */
export async function deleteLinksForSource(sourceId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM rag_links
          WHERE from_chunk_id IN (SELECT canonical_id FROM rag_chunks WHERE source_id = ?)`,
    args: [sourceId],
  });
}

export async function upsertRagLink(
  fromChunkId: string,
  toChunkOrNodeId: string,
  linkType: RagLinkType,
): Promise<void> {
  const db = getDb();
  const id = linkId(fromChunkId, toChunkOrNodeId, linkType);
  await db.execute({
    sql: `INSERT INTO rag_links (id, from_chunk_id, to_chunk_id, link_type)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
    args: [id, fromChunkId, toChunkOrNodeId, linkType],
  });
}

/** CHUNK_OF: chunk → parent knowledge-graph node. */
export async function writeChunkOfLinks(
  parentNodeId: string,
  chunkIds: string[],
): Promise<void> {
  for (const chunkId of chunkIds) {
    await upsertRagLink(chunkId, parentNodeId, "CHUNK_OF");
  }
}
