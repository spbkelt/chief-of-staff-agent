import { getNodeCount } from "../graph/upsert.js";
import { getDb } from "../graph/graph.db.js";
import type { InspectOutput } from "./query-output.js";

export async function collectInspectOutput(): Promise<InspectOutput> {
  const db = getDb();
  const total = await getNodeCount();

  const byType = await db.execute(`
    SELECT json_extract(data, '$.nodeType') as node_type, COUNT(*) as count
    FROM nodes
    GROUP BY node_type
    ORDER BY count DESC
  `);

  const graphNodesByType: Record<string, number> = {};
  for (const row of byType.rows) {
    const type = row[0] as string;
    const count = Number(row[1]);
    if (type) graphNodesByType[type] = count;
  }

  const sources = await db.execute("SELECT COUNT(*) FROM rag_sources");
  const chunks = await db.execute("SELECT COUNT(*) FROM rag_chunks");
  const embedded = await db.execute(
    "SELECT COUNT(*) FROM rag_chunks WHERE embedding IS NOT NULL",
  );
  const links = await db.execute("SELECT COUNT(*) FROM rag_links");

  return {
    graphNodes: total,
    graphNodesByType,
    ragSources: Number(sources.rows[0]?.[0] ?? 0),
    ragChunks: Number(chunks.rows[0]?.[0] ?? 0),
    ragChunksEmbedded: Number(embedded.rows[0]?.[0] ?? 0),
    ragLinks: Number(links.rows[0]?.[0] ?? 0),
  };
}
