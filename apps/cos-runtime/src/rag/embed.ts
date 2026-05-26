import { getDb } from "../graph/graph.db.js";
import { getEnv } from "../config/env.js";
import { sha256 } from "../graph/canonical-id.js";
import {
  usesCiFixtureEmbed,
  usesLocalHashEmbeddings,
  usesOpenSearchRag,
} from "./embed-mode.js";

export const MOCK_EMBED_DIMS = 1024;
const BEDROCK_DIMS = 1024;
export const LOCAL_HASH_EMBED_MODEL = "local-hash";

/**
 * Deterministic unit-vector embedding for local libSQL RAG and CI fixtures.
 * Same input always produces the same 1024-d vector (cosine search in libSQL).
 */
export function mockEmbed(text: string): number[] {
  const hash = sha256(text);
  const raw: number[] = [];
  for (let i = 0; i < MOCK_EMBED_DIMS; i++) {
    const pos = (i * 2) % hash.length;
    const byte = parseInt(hash.slice(pos, pos + 2), 16);
    raw.push(byte / 127.5 - 1);
  }
  const mag = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return mag === 0 ? raw : raw.map((v) => v / mag);
}

async function liveEmbed(text: string): Promise<{ embedding: number[]; model: string; dims: number }> {
  const env = getEnv();
  const { embed } = await import("ai");
  const { getEmbeddingModel } = await import("../llm/provider.js");
  const { readCosConfig } = await import("../config/credentials.js");

  const llm = readCosConfig().llm;
  const provider = llm?.provider ?? "bedrock";
  const useOpenAiEmbed = provider === "openai" || llm?.embedProvider === "openai";

  const model = await getEmbeddingModel();
  const { embedding } = await embed({
    model,
    value: text,
    // OpenSearch knn_vector is 1024-d; shrink text-embedding-3-* to match Cohere v4 on Bedrock.
    ...(useOpenAiEmbed ? { dimensions: BEDROCK_DIMS } : {}),
  });
  return { embedding, model: env.COS_EMBED_MODEL, dims: embedding.length };
}

export interface EmbedChunkDoc {
  canonicalId: string;
  chunkText: string;
  embedding: number[];
  sourceNodeId: string;
  ownerUserId: string;
  embeddingModel: string;
}

export interface EmbedResult {
  embedded: number;
  skipped: number;
  pending: number;
  /** Chunks embedded in this run (for incremental OpenSearch indexing). */
  indexedDocs?: EmbedChunkDoc[];
  lastError?: string;
}

export interface EmbedOptions {
  /** Stop after N chunks (demo / rate-limit guard). */
  maxChunks?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Embed all rag_chunks rows that have embedding IS NULL for the given owner. */
export async function embedPendingChunks(
  ownerUserId: string,
  options?: EmbedOptions,
): Promise<EmbedResult> {
  const db = getDb();
  const useCiMock = usesCiFixtureEmbed();
  const useLocalHash = !useCiMock && usesLocalHashEmbeddings();
  const indexToOpenSearch = usesOpenSearchRag();

  const pending = await db.execute({
    sql: `SELECT canonical_id, chunk_text, source_id FROM rag_chunks
          WHERE embedding IS NULL AND owner_user_id = ?`,
    args: [ownerUserId],
  });

  const rows = pending.rows;
  const pendingCount = rows.length;
  const maxChunks = options?.maxChunks;
  const toProcess =
    maxChunks !== undefined && maxChunks >= 0 ? rows.slice(0, maxChunks) : rows;

  let embedded = 0;
  let skipped = 0;
  let lastError: string | undefined;
  const indexedDocs: EmbedChunkDoc[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i]!;
    const chunkId = row[0] as string;
    const chunkText = row[1] as string;
    const sourceNodeId = row[2] as string;

    try {
      let embedding: number[];
      let model: string;
      let dims: number;

      if (useCiMock || useLocalHash) {
        embedding = mockEmbed(chunkText);
        model = useCiMock ? "mock" : LOCAL_HASH_EMBED_MODEL;
        dims = MOCK_EMBED_DIMS;
      } else {
        const result = await liveEmbed(chunkText);
        embedding = result.embedding;
        model = result.model;
        dims = result.dims;
      }

      await db.execute({
        sql: "UPDATE rag_chunks SET embedding = ?, embedding_model = ?, embedding_dims = ? WHERE canonical_id = ?",
        args: [JSON.stringify(embedding), model, dims, chunkId],
      });
      embedded++;

      if (indexToOpenSearch) {
        indexedDocs.push({
          canonicalId: chunkId,
          chunkText,
          embedding,
          sourceNodeId,
          ownerUserId,
          embeddingModel: model,
        });
      }
    } catch (err) {
      skipped++;
      lastError = err instanceof Error ? err.message : String(err);
    }

    options?.onProgress?.(i + 1, toProcess.length);
  }

  if (pendingCount > 0 && embedded === 0 && skipped > 0) {
    console.warn(
      `[embed] All ${skipped} pending chunk(s) failed.` +
        (lastError ? ` Last error: ${lastError}` : "") +
        (useLocalHash
          ? ""
          : usesOpenSearchRag()
            ? " Set COS_OPENSEARCH_USE_LOCAL_EMBED=true to use local-hash vectors for demo, or wait for Bedrock quota."
            : " For local demo without AWS, re-run setup and choose local vectors (step 7), or run: aws sso login")
    );
  } else if (pendingCount === 0 && embedded === 0) {
    console.log("[embed] No pending chunks (already embedded or run ingest after new data).");
  }

  const result: EmbedResult = {
    embedded,
    skipped,
    pending: pendingCount,
    ...(lastError ? { lastError } : {}),
  };
  if (indexedDocs.length > 0) result.indexedDocs = indexedDocs;
  return result;
}

/**
 * Embed a single query text for retrieval.
 */
export async function embedQuery(queryText: string): Promise<{ embedding: number[]; model: string }> {
  if (usesCiFixtureEmbed() || usesLocalHashEmbeddings()) {
    return {
      embedding: mockEmbed(queryText),
      model: usesCiFixtureEmbed() ? "mock" : LOCAL_HASH_EMBED_MODEL,
    };
  }
  const result = await liveEmbed(queryText);
  return { embedding: result.embedding, model: result.model };
}
