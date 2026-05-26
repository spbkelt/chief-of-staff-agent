import { retrieve as localRetrieve } from "./retrieve.js";
import { embedQuery } from "./embed.js";
import { embedPendingChunks, type EmbedOptions, type EmbedResult } from "./embed.js";
import { backendGetNode } from "../graph/backend.js";
import type { RetrievalFilter, RetrievalResult, RetrievedChunk } from "./retrieve.js";
import { MIN_CONFIDENT_SCORE } from "./retrieve.js";

function usesOpenSearch(): boolean {
  return process.env["COS_RAG_BACKEND"] === "opensearch";
}

export async function backendRetrieve(
  queryText: string,
  filter: RetrievalFilter,
  topK = 8,
): Promise<RetrievalResult> {
  if (!usesOpenSearch()) {
    return localRetrieve(queryText, filter, topK);
  }

  const { searchChunks } = await import("./opensearch-store.js");
  const { embedding: queryVector } = await embedQuery(queryText);
  const hits = await searchChunks(queryVector, filter.ownerUserId, topK);

  const chunks: RetrievedChunk[] = await Promise.all(
    hits.map(async (hit) => {
      const parent = await backendGetNode(hit.sourceNodeId);
      const sourceType = (parent as { nodeType?: string } | null)?.nodeType ?? "Unknown";
      const title =
        (parent as { subject?: string; name?: string; title?: string } | null)?.subject ??
        (parent as { subject?: string; name?: string; title?: string } | null)?.name ??
        (parent as { subject?: string; name?: string; title?: string } | null)?.title ??
        hit.sourceNodeId;

      return {
        chunkId: hit.canonicalId,
        sourceNodeId: hit.sourceNodeId,
        sourceType,
        title,
        chunkText: hit.chunkText,
        chunkIndex: 0,
        score: hit.score,
        rawScore: hit.score,
        referenceDate: null,
        citation: `[source: ${sourceType}:${hit.sourceNodeId}]`,
      };
    }),
  );

  const bestRaw = chunks[0]?.rawScore ?? 0;
  const retrievedChunkIds = chunks.map((c) => c.chunkId);
  return { chunks, retrievedChunkIds, belowThreshold: bestRaw < MIN_CONFIDENT_SCORE };
}

export async function backendEmbedPending(
  ownerUserId: string,
  options?: EmbedOptions,
): Promise<EmbedResult> {
  const result = await embedPendingChunks(ownerUserId, options);

  if (usesOpenSearch() && result.indexedDocs && result.indexedDocs.length > 0) {
    const { indexChunks } = await import("./opensearch-store.js");
    const now = new Date().toISOString();
    await indexChunks(
      result.indexedDocs.map((d) => ({
        ...d,
        nodeType: "Chunk",
        createdAt: now,
      })),
      options?.onProgress,
    );
  }

  return result;
}
