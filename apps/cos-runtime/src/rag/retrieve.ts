import { getDb } from "../graph/graph.db.js";
import { backendGetNode } from "../graph/backend.js";
import { initLangSmith, sanitizeForTrace } from "../observability/langsmith.js";
import { embedQuery } from "./embed.js";
import { buildCitation, extractReferenceDate } from "./citations.js";
import type { KnowledgeNodeType } from "../graph/schema.js";

// Freshness boost constants (SKILL.md §7)
const FRESHNESS_BOOST_WEIGHT = 0.1;
const FRESHNESS_HALF_LIFE_DAYS = 14;

/** Minimum cosine score to pass results to an LLM — hallucination guardrail */
export const MIN_CONFIDENT_SCORE = 0.65;

export const DEFAULT_TOP_K = 8;
export const SUGGESTION_TOP_K = 12;

export interface RetrievalFilter {
  ownerUserId: string; // MANDATORY permission boundary — never omit
  connectorId?: string;
  nodeType?: KnowledgeNodeType;
  dateRange?: { from: string; to: string };
  identityId?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  sourceNodeId: string;
  sourceType: string;
  title: string;
  chunkText: string;
  chunkIndex: number;
  score: number; // adjusted (cosine * freshness boost)
  rawScore: number; // cosine only
  referenceDate: string | null;
  citation: string;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  retrievedChunkIds: string[]; // for LangSmith traces — IDs only, never text
  belowThreshold: boolean; // true when best rawScore < MIN_CONFIDENT_SCORE
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function freshnessBoost(referenceDate: string | null): number {
  if (!referenceDate) return 0;
  const refMs = new Date(referenceDate).getTime();
  if (isNaN(refMs)) return 0;
  const daysSince = (Date.now() - refMs) / (1000 * 60 * 60 * 24);
  return FRESHNESS_BOOST_WEIGHT * Math.exp(-Math.max(0, daysSince) / FRESHNESS_HALF_LIFE_DAYS);
}

export async function retrieve(
  queryText: string,
  filter: RetrievalFilter,
  topK = DEFAULT_TOP_K,
): Promise<RetrievalResult> {
  initLangSmith();
  const db = getDb();

  const { embedding: queryEmbedding } = await embedQuery(queryText);

  const rows = await db.execute({
    sql: `SELECT rc.canonical_id, rc.chunk_index, rc.chunk_text, rc.embedding,
                 rs.source_node_id, rs.source_type, rs.title
          FROM rag_chunks rc
          JOIN rag_sources rs ON rc.source_id = rs.canonical_id
          WHERE rc.owner_user_id = ? AND rc.embedding IS NOT NULL`,
    args: [filter.ownerUserId],
  });

  type ScoredRow = {
    chunkId: string;
    chunkIndex: number;
    chunkText: string;
    sourceNodeId: string;
    sourceType: string;
    title: string;
    rawScore: number;
    score: number;
    referenceDate: string | null;
  };

  // Score all chunks
  const scored: ScoredRow[] = [];
  for (const row of rows.rows) {
    const chunkId = row[0] as string;
    const chunkIndex = row[1] as number;
    const chunkText = row[2] as string;
    const embeddingJson = row[3] as string;
    const sourceNodeId = row[4] as string;
    const sourceType = row[5] as string;
    const title = row[6] as string;

    let chunkEmbedding: number[];
    try {
      chunkEmbedding = JSON.parse(embeddingJson) as number[];
    } catch {
      continue;
    }
    if (chunkEmbedding.length !== queryEmbedding.length) continue;

    const rawScore = cosineSimilarity(queryEmbedding, chunkEmbedding);

    // Look up parent node for freshness + reference date
    const parentNode = await backendGetNode(sourceNodeId);
    const nodeData = parentNode as Record<string, unknown> | null;
    const referenceDate = nodeData ? extractReferenceDate(nodeData) : null;
    const boost = freshnessBoost(referenceDate);
    const adjustedScore = rawScore * (1 + boost);

    scored.push({ chunkId, chunkIndex, chunkText, sourceNodeId, sourceType, title, rawScore, score: adjustedScore, referenceDate });
  }

  // Apply optional filters
  let filtered = scored;
  if (filter.nodeType) {
    filtered = filtered.filter((s) => s.sourceType === filter.nodeType);
  }
  if (filter.dateRange) {
    const { from, to } = filter.dateRange;
    filtered = filtered.filter((s) => {
      if (!s.referenceDate) return true;
      return s.referenceDate >= from && s.referenceDate <= to;
    });
  }

  // Sort by adjusted score, take topK
  filtered.sort((a, b) => b.score - a.score);
  const top = filtered.slice(0, topK);

  const bestRaw = top[0]?.rawScore ?? 0;
  const belowThreshold = bestRaw < MIN_CONFIDENT_SCORE;

  // Build output with citations
  const chunks: RetrievedChunk[] = await Promise.all(
    top.map(async (s) => {
      const parentNode = await backendGetNode(s.sourceNodeId);
      const citation = buildCitation(s.sourceType, s.sourceNodeId, parentNode as Record<string, unknown> | null);
      return {
        chunkId: s.chunkId,
        sourceNodeId: s.sourceNodeId,
        sourceType: s.sourceType,
        title: s.title,
        chunkText: s.chunkText,
        chunkIndex: s.chunkIndex,
        score: s.score,
        rawScore: s.rawScore,
        referenceDate: s.referenceDate,
        citation,
      };
    }),
  );

  // Trace input: query + chunk IDs only — never include chunkText
  const retrievedChunkIds = chunks.map((c) => c.chunkId);
  void sanitizeForTrace(queryText); // ensure query is safe before any upstream LLM call

  return { chunks, retrievedChunkIds, belowThreshold };
}
